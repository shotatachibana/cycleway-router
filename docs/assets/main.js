const KANTO_CENTER = [139.6, 36.0]; // MapLibreは[lon, lat]の順

// 背景地図: MapLibre GL JS + OpenFreeMap(無料・無制限・キー不要・自己ホスト可能)。
// 2026-09-20時点の調査で、Esriの無料タイル(services.arcgisonline.com)はレガシー扱いで
// 新サービスはAPIキー登録が必要、CartoDB Positronも同様にAPIキー要求の表示が出ることを
// 確認済み。OpenFreeMapは登録・キー・レート制限が無いことを利用規約で確認した。
// 属性(道路・鉄道の太さ・色)を自分でカスタマイズできるベクトルタイルなので、
// Googleマップに近い見やすさを実現しやすい。
// なお、標準のliberty styleはzoom14以上で建物をfill-extrusion(立体・影付き)で
// 描画し見にくいとの指摘があったため、そのレイヤーを平面表示に差し替えている。
// また、鉄道は標準スタイルだと薄い灰色・極細で低いズームではほぼ見えないため、
// 色を濃く・太さを引き上げている(ただし自転車専用道路より目立たせないよう、
// CYCLEWAY_MAX_WIDTHより細い範囲に収める。トンネル区間(地下鉄)・ハッチング
// 装飾を含む全パターンを対象にする)。
const RAIL_LAYER_IDS = [
  "road_major_rail", "road_transit_rail", "bridge_major_rail", "bridge_transit_rail",
  "tunnel_major_rail", "tunnel_transit_rail",
  "road_major_rail_hatching", "road_transit_rail_hatching",
  "bridge_major_rail_hatching", "bridge_transit_rail_hatching",
  "tunnel_major_rail_hatching", "tunnel_transit_rail_hatching",
];

// このサイトは自転車専用道路(自作のcycleway/reference/tileレイヤー)が主役であり、
// 自動車の高速道路・幹線道路や鉄道を目立たせる必要は無い、という指摘を受けて、
// road/bridge/tunnelのmotorway・trunk・primary・secondary・tertiary系レイヤーを
// 縮小・減彩する(ラベルはナビの目安として残す。線の見た目だけを控えめにする)。
const CAR_ROAD_LAYER_PATTERN = /^(road|bridge|tunnel)_(motorway|trunk_primary|secondary_tertiary)(_link)?(_casing)?$/;
const CAR_ROAD_WIDTH_FACTOR = 0.45;
const CAR_ROAD_COLOR = { casing: "#e3ddd2", fill: "#d8cfc0" };

// NAVITIME風の「クリーム色の地面」に寄せる(自転車道の緑を映えさせる)。
const BACKGROUND_COLOR = "#f7f2e7";
// libertyの緑系の土地被覆(森・草地・公園)は自転車道の緑と競合するので薄くする。
// レイヤーIDが違って一致しない場合は何も起きない(害は無い)。
// 実際のIDは console.log(style.layers.map(l => l.id)) で確認できる。
const LAND_FILL_MUTE_PATTERN = /^(landcover_wood|landcover_grass|park|landuse_park|landuse_cemetery)/;
const LAND_FILL_MUTE_COLOR = "#ebeedd";

function scaleWidthExpression(expr, factor) {
  if (!Array.isArray(expr)) return typeof expr === "number" ? expr * factor : expr;
  if (expr[0] !== "interpolate") return expr;
  const [op, interp, input, ...stops] = expr;
  const scaledStops = [];
  for (let i = 0; i < stops.length; i += 2) {
    scaledStops.push(stops[i], typeof stops[i + 1] === "number" ? stops[i + 1] * factor : stops[i + 1]);
  }
  return [op, interp, input, ...scaledStops];
}

function mutedCarRoadLayer(l) {
  const isCasing = l.id.includes("casing");
  return {
    ...l,
    paint: {
      ...l.paint,
      "line-color": isCasing ? CAR_ROAD_COLOR.casing : CAR_ROAD_COLOR.fill,
      "line-width": scaleWidthExpression(l.paint["line-width"], CAR_ROAD_WIDTH_FACTOR),
    },
  };
}

// 地名ラベル(都市名・POI・鉄道駅等)は「name:latin」(英語等)+「name:nonlatin」
// (現地語=主に日本語)を併記する式になっているものが大半。英語表記が不要という
// 指摘を受け、nonlatin(日本語)だけを表示する式に一括で差し替える。
function japaneseOnlyTextField(l) {
  const tf = l.layout && l.layout["text-field"];
  if (!tf || JSON.stringify(tf).indexOf("name:latin") === -1) return l;
  return {
    ...l,
    layout: {
      ...l.layout,
      "text-field": ["coalesce", ["get", "name:nonlatin"], ["get", "name"]],
    },
  };
}

// 道路番号(路線番号シールド)は不要という指摘があったため非表示にする
// (道路名そのもの(highway-name-*)は残す)。
const ROAD_SHIELD_LAYER_IDS = ["highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us"];

async function loadFlattenedStyle() {
  const res = await fetch("https://tiles.openfreemap.org/styles/liberty");
  const style = await res.json();
  style.layers = style.layers
    .filter((l) => l.id !== "building-3d")
    .map((l) => {
      if (l.id === "background") {
        return { ...l, paint: { ...l.paint, "background-color": BACKGROUND_COLOR } };
      }
      if (l.type === "fill" && LAND_FILL_MUTE_PATTERN.test(l.id)) {
        return { ...l, paint: { ...l.paint, "fill-color": LAND_FILL_MUTE_COLOR } };
      }
      if (ROAD_SHIELD_LAYER_IDS.includes(l.id)) {
        return { ...l, layout: { ...l.layout, visibility: "none" } };
      }
      if (l.id === "building") return { ...l, maxzoom: 24 };
      if (RAIL_LAYER_IDS.includes(l.id)) {
        const isHatching = l.id.endsWith("_hatching");
        return {
          ...l,
          paint: {
            ...l.paint,
            "line-color": "#4a4a4a",
            "line-width": isHatching
              ? scaleWidthExpression(l.paint["line-width"], 0.7)
              : ["interpolate", ["linear"], ["zoom"], 8, 0.8, 12, 1.2, 16, 1.8, 20, 2.5],
          },
        };
      }
      if (l.id === "poi_transit") {
        // 駅アイコン・駅名も少し強調する(ただし自転車道より控えめに)。
        const jL = japaneseOnlyTextField(l);
        return { ...jL, layout: { ...jL.layout, "icon-size": 0.9, "text-size": 13 } };
      }
      if (CAR_ROAD_LAYER_PATTERN.test(l.id)) return mutedCarRoadLayer(l);
      return japaneseOnlyTextField(l);
    });
  return style;
}

let map;

// 専用度合い(tier)ごとのスタイル。値が小さいほど「より専用」。
// 東京都の自転車関連情報マップ(wagmap)の分類(自転車道/自転車歩行者道の分離方法/
// 自転車専用通行帯/車道混在)を参考に段階分けした(2026-09-20)。
// tier 6,7は経路探索の対象(専用道路)には含めない参考表示レイヤー
// (ただし近距離検索では専用道路が繋がらない場合の探索対象として使う)。
// 日本の高速道路地図(緑色の路線・標識風のラベル)を意識した配色にしている
// (2026-09-21、ユーザー方針: 「サイクリングロードは日本の高速道路のように」)。
// 2026-09-22: NAVITIME風に、明るすぎる緑を避けて中間の緑に揃え、濃い緑の縁取りで
// 輪郭を出す方針に変更した。
const TIER_STYLE = {
  1: { color: "#3f9d4b", weight: 3.0, label: "完全専用(歩行者非対応)" },
  2: { color: "#3f9d4b", weight: 2.6, label: "専用・歩行者と分離" },
  3: { color: "#4fae5a", weight: 2.2, label: "専用・歩行者共用" },
  4: { color: "#6cc077", weight: 1.9, label: "専用(詳細不明)" },
  5: { color: "#3f9d4b", weight: 2.4, dashed: true, label: "分離型自転車道(車道沿い、近似)" },
  6: { color: "#e6550d", weight: 2.4, label: "(参考)自転車専用通行帯・ペイントのみ" },
  7: { color: "#636363", weight: 2, dashed: true, label: "(参考)車道混在・矢羽根等" },
  8: { color: "#252525", weight: 2, label: "一般道路(地図上には表示しない)" },
};

// 高速道路風の縁取りと標識に使う色。
const CASING_COLOR = "#1b5e2c";
const SIGN_FILL_COLOR = "#1f7a3a";
const ROUTE_RESULT_COLOR = "#1e6bff"; // 近距離検索の経路。緑の専用道路と同化しないよう青にする

// 近距離検索は「専用道路(tier1-5)を最優先、繋がらなければ自転車レーン・車道混在
// (tier6,7)、それでも繋がらなければ一般道路網タイル(tier8)もペナルティ付きで使う」
// という重み付き探索にする(表示のオン/オフとは独立)。
// 値はR5側のカスタムコスト(専用道路の定義、一般道ペナルティ)と同じ考え方。未確定・調整余地あり。
const ROUTING_PENALTY = { 6: 2.5, 7: 5.0, 8: 8.0 };
function weightForFeature(feature) {
  return ROUTING_PENALTY[feature.properties.tier] || 1.0;
}
const TILE_TIER = 8;
function tileWeightForFeature() {
  return ROUTING_PENALTY[TILE_TIER];
}

const TIER_LABEL_SHORT = {
  1: "専用道路", 2: "専用道路", 3: "専用道路", 4: "専用道路", 5: "専用道路",
  6: "自転車レーン", 7: "車道混在", 8: "一般道路",
};

// Googleマップの経路案内のように、通った順番に「専用道路 2.3km→自転車レーン
// 0.4km→一般道路 1.1km→...」と一覧表示する。タグの継ぎ目のノイズで極端に短い
// 区間(20m未満)が挟まると見づらいので、直前の区間にまとめる。
const MIN_SEGMENT_M = 20;

function mergeShortSegments(segments) {
  const merged = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && seg.distanceM < MIN_SEGMENT_M) {
      prev.distanceM += seg.distanceM;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function renderSegmentList(rawSegments) {
  const segments = mergeShortSegments(rawSegments);
  const items = segments
    .map((seg) => {
      const style = TIER_STYLE[seg.tier] || {};
      const dashClass = style.dashed ? "dashed" : "";
      return (
        `<li><span class="legend-swatch ${dashClass}" style="background:${style.color || "#999"}"></span>` +
        `${TIER_LABEL_SHORT[seg.tier] || "不明"} ${(seg.distanceM / 1000).toFixed(2)} km</li>`
      );
    })
    .join("");
  return `<ol class="segment-list">${items}</ol>`;
}

function tierMatchExpression(field, defaultValue) {
  const expr = ["match", ["get", "tier"]];
  for (const [tier, s] of Object.entries(TIER_STYLE)) {
    expr.push(Number(tier), s[field] !== undefined ? s[field] : defaultValue);
  }
  expr.push(defaultValue);
  return expr;
}

// 自転車専用道路が主役のサイトなので、高速道路のように「ズームするほど太く
// 目立つ」表現にする。低ズームでも背景の鉄道(最大2.5px程度)より確実に太くなる
// よう下限を設定している。
// 注意: MapLibreは1つの式の中でzoom("interpolate"/"step")を複数箇所・入れ子で
// 使えない("Only one zoom-based...subexpression"エラー)。
// ["match",tier,["interpolate",zoom,...],...] のようにmatchの中にinterpolateを
// 複数個ネストするのはNGなので、必ず一番外側をズームのinterpolateにし、
// 各ズーム段階の値としてtierごとのmatchを埋め込む形にする。
const WIDTH_ZOOM_STOPS = [8, 0.8, 11, 1.4, 14, 2.6, 17, 5, 20, 8];

function tierWidthExpression(defaultWeight, multiplier) {
  const m = multiplier || 1;
  const expr = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < WIDTH_ZOOM_STOPS.length; i += 2) {
    const zoom = WIDTH_ZOOM_STOPS[i];
    const factor = WIDTH_ZOOM_STOPS[i + 1];
    const matchExpr = ["match", ["get", "tier"]];
    for (const [tier, s] of Object.entries(TIER_STYLE)) {
      matchExpr.push(Number(tier), (s.weight !== undefined ? s.weight : defaultWeight) * m * factor);
    }
    matchExpr.push(defaultWeight * m * factor);
    expr.push(zoom, matchExpr);
  }
  return expr;
}

function zoomScaledWidth(baseWeight) {
  const expr = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < WIDTH_ZOOM_STOPS.length; i += 2) {
    expr.push(WIDTH_ZOOM_STOPS[i], baseWeight * WIDTH_ZOOM_STOPS[i + 1]);
  }
  return expr;
}

function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  for (const tier of [1, 2, 3, 4, 5, 6, 7]) {
    const s = TIER_STYLE[tier];
    const row = document.createElement("div");
    row.className = "legend-row";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = s.color;
    if (s.dashed) swatch.classList.add("dashed");
    row.appendChild(swatch);
    const text = document.createElement("span");
    text.textContent = s.label;
    row.appendChild(text);
    el.appendChild(row);
  }
}

let graph = null;
let fromPoint = null; // {lon, lat, marker}
let toPoint = null;
let pickMode = null; // 'from' | 'to' | null
let cyclewayGeojson = null;
let referenceGeojson = null;
let lastNearbyRouteCoords = null;
let lastPrecomputedRoute = null; // {coords, name}

const EMPTY_FC = { type: "FeatureCollection", features: [] };

// ---- 高速道路風の路線番号バッジ(NAVITIMEの「E6」「C3」のようなもの) ----

// データにrefが無いので、名称のある路線に出現順で「C1, C2, ...」を振る。
// 番号を固定したい場合は、データ生成側でproperties.refを持たせればそちらを優先する。
const refByName = new Map();
function assignRefs(geojson) {
  for (const f of geojson.features) {
    const p = f.properties || (f.properties = {});
    if (p.ref) continue;
    const n = p.name;
    if (!n) continue;
    if (!refByName.has(n)) refByName.set(n, "C" + (refByName.size + 1));
    p.ref = refByName.get(n);
  }
}

// 角丸の四角を描く(ctx.roundRectが無い古い環境でも動くよう自前で実装)。
function roundedRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// 「白い縁+緑地」の角丸バッジ画像を1回だけ登録する。テキスト幅に合わせて
// 中央部分だけ伸びるよう、stretchX/stretchY/contentを指定している。
function addSignImage() {
  if (map.hasImage("cycleway-sign")) return;
  const size = 32, r = 8;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  roundedRectPath(g, 0, 0, size, size, r);
  g.fill();
  g.fillStyle = SIGN_FILL_COLOR;
  roundedRectPath(g, 2, 2, size - 4, size - 4, r - 2);
  g.fill();
  map.addImage("cycleway-sign", g.getImageData(0, 0, size, size), {
    stretchX: [[10, 22]],
    stretchY: [[10, 22]],
    content: [10, 10, 22, 22],
  });
}

// MapLibreのline-dasharrayはデータ駆動の式(match/case)に対応していないため
// (定数配列しか指定できない)、破線が必要なtierは別レイヤーに分ける。
// 高速道路のような縁取り(casing、濃い緑で少し太いラインを下に敷く)を追加して、
// 自転車専用道路が地図上で一番目立つように強調する。
async function loadCyclewayNetwork() {
  const res = await fetch("data/cycleway_network.geojson");
  cyclewayGeojson = await res.json();
  assignRefs(cyclewayGeojson);
  map.addSource("cycleway", { type: "geojson", data: cyclewayGeojson });
  map.addLayer({
    id: "cycleway-line-casing",
    type: "line",
    source: "cycleway",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": CASING_COLOR,
      "line-width": tierWidthExpression(1.5, 1.45),
      "line-opacity": 1,
    },
  });
  map.addLayer({
    id: "cycleway-line-solid",
    type: "line",
    source: "cycleway",
    filter: ["!=", ["get", "tier"], 5],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tierMatchExpression("color", "#3f9d4b"),
      "line-width": tierWidthExpression(1.5),
    },
  });
  map.addLayer({
    id: "cycleway-line-dashed",
    type: "line",
    source: "cycleway",
    filter: ["==", ["get", "tier"], 5],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": TIER_STYLE[5].color,
      "line-width": zoomScaledWidth(TIER_STYLE[5].weight),
      "line-dasharray": [2, 1.5],
    },
  });

  addSignImage();

  // サイクリングロードの名称(例: 「多摩川サイクリングロード」)は経路に沿って表示する。
  // 白文字+緑の縁取りの文字ラベル。路線番号バッジと役割を分けるため、やや寄ったズームでだけ出す。
  map.addLayer({
    id: "cycleway-name-label",
    type: "symbol",
    source: "cycleway",
    filter: ["has", "name"],
    minzoom: 12,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
      "symbol-spacing": 300,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": CASING_COLOR,
      "text-halo-width": 3,
    },
  });

  // 路線番号バッジ(緑の角丸+白文字)。路線に沿って一定間隔で繰り返し置く。
  // 線の向きに回転せず、常に水平に表示する(NAVITIMEの「E6」「C3」と同じ見せ方)。
  map.addLayer({
    id: "cycleway-ref-badge",
    type: "symbol",
    source: "cycleway",
    filter: ["has", "ref"],
    minzoom: 10,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 500,
      "text-field": ["get", "ref"],
      "text-size": 12,
      "text-font": ["Noto Sans Bold"],
      "text-rotation-alignment": "viewport",
      "icon-rotation-alignment": "viewport",
      "icon-image": "cycleway-sign",
      "icon-text-fit": "both",
      "icon-text-fit-padding": [2, 5, 2, 5],
      "text-padding": 2,
    },
    paint: { "text-color": "#ffffff" },
  });

  buildLegend();
  maybeBuildRoutingGraph();
}

// 表示は既定で非表示のレイヤーだが、経路探索には常に使う
// (専用道路だけでは繋がらないことが多いため。チェックボックスは見た目の表示/非表示のみを制御する)。
async function loadReferenceInfrastructure() {
  const res = await fetch("data/reference_infrastructure.geojson");
  referenceGeojson = await res.json();
  map.addSource("reference", { type: "geojson", data: referenceGeojson });
  map.addLayer({
    id: "reference-line-solid",
    type: "line",
    source: "reference",
    filter: ["==", ["get", "tier"], 6],
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: { "line-color": TIER_STYLE[6].color, "line-width": TIER_STYLE[6].weight },
  });
  map.addLayer({
    id: "reference-line-dashed",
    type: "line",
    source: "reference",
    filter: ["==", ["get", "tier"], 7],
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: {
      "line-color": TIER_STYLE[7].color,
      "line-width": TIER_STYLE[7].weight,
      "line-dasharray": [1, 2],
    },
  });
  maybeBuildRoutingGraph();
}

let baseCyclewayGraph = null;
let baseReferenceGraph = null;
const loadedTileGraphs = new Map(); // "col_row" -> graph
let tileIndex = null; // docs/data/tiles/index.json

// 高速道路のIC/JCT表現を意識し、専用道路が3方向以上に分岐する地点(合流・分岐点)に
// 印を付ける(2026-09-21、ユーザー方針)。
// 接続するエッジが name を持っている場合は、その名前をpropertiesに入れて
// JCT名ラベルとして表示する(nameが無ければラベルは出ないだけで、害は無い)。
function computeJunctions(graph) {
  const features = [];
  for (let i = 0; i < graph.adjacency.length; i++) {
    const distinctNeighbors = new Set(graph.adjacency[i].map((e) => e.to));
    if (distinctNeighbors.size >= 3) {
      const [lon, lat] = graph.nodeCoords[i];
      const names = [...new Set(graph.adjacency[i].map((e) => e.name).filter(Boolean))];
      const properties = names.length ? { name: names[0] } : {};
      features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
    }
  }
  return { type: "FeatureCollection", features };
}

function addJunctionLayer(graph) {
  const data = computeJunctions(graph);
  map.addSource("cycleway-junctions", { type: "geojson", data });
  map.addLayer({
    id: "cycleway-junctions",
    type: "circle",
    source: "cycleway-junctions",
    minzoom: 12,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 15, 5, 18, 8],
      "circle-color": "#ffffff",
      "circle-stroke-color": CASING_COLOR,
      "circle-stroke-width": 2,
    },
  });
  // JCT名の緑バッジ(名前が取れた交点だけ)。
  map.addLayer({
    id: "cycleway-junction-label",
    type: "symbol",
    source: "cycleway-junctions",
    filter: ["has", "name"],
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-font": ["Noto Sans Regular"],
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "icon-image": "cycleway-sign",
      "icon-text-fit": "both",
      "icon-text-fit-padding": [2, 4, 2, 4],
      "text-optional": true,
    },
    paint: { "text-color": "#ffffff" },
  });
}

function maybeBuildRoutingGraph() {
  if (!cyclewayGeojson || !referenceGeojson) return;
  baseCyclewayGraph = CycleGraph.buildGraph(cyclewayGeojson, weightForFeature);
  baseReferenceGraph = CycleGraph.buildGraph(referenceGeojson, weightForFeature);
  rebuildCombinedGraph();
  addJunctionLayer(baseCyclewayGraph);
}

function rebuildCombinedGraph() {
  graph = CycleGraph.mergeGraphs([baseCyclewayGraph, baseReferenceGraph, ...loadedTileGraphs.values()]);
  console.log(`routing graph: ${graph.nodeCoords.length} nodes (tiles loaded: ${loadedTileGraphs.size})`);
}

async function loadTileIndex() {
  const res = await fetch("data/tiles/index.json");
  tileIndex = await res.json();
}

// 専用道路・自転車レーン等が近くに無い場合の最後の手段として、出発地・目的地の
// 間の範囲に含まれる一般道路網タイルをその都度読み込む(初期表示は軽いまま、
// 検索するたびに必要な範囲だけ動的に取得する。CLAUDE.md「設計上の未決事項」1参照)。
function findTile(lon, lat) {
  if (!tileIndex) return null;
  for (const t of tileIndex.tiles) {
    if (lon >= t.minLon && lon < t.maxLon && lat >= t.minLat && lat < t.maxLat) {
      return t;
    }
  }
  return null;
}

// 出発地・目的地を含むバウンディングボックス(マージン込み)に交差するタイルを
// すべて返す。1回の検索で読み込むデータ量が大きくなりすぎないよう、
// 合計サイズに上限(MAX_TOTAL_BYTES)を設ける。上限を超える場合は出発地・目的地
// それぞれの最寄りタイルだけに絞る(近距離検索の対象範囲として妥当なサイズに収める)。
const MAX_TOTAL_BYTES = 80_000_000; // 約80MB。GitHub PagesのCDN配信を想定
const MARGIN_DEG = 0.03;

function tilesForSearch(lon1, lat1, lon2, lat2) {
  if (!tileIndex) return { tiles: [], capped: false };
  const minLon = Math.min(lon1, lon2) - MARGIN_DEG;
  const maxLon = Math.max(lon1, lon2) + MARGIN_DEG;
  const minLat = Math.min(lat1, lat2) - MARGIN_DEG;
  const maxLat = Math.max(lat1, lat2) + MARGIN_DEG;
  const inBbox = tileIndex.tiles.filter(
    (t) => t.minLon < maxLon && t.maxLon > minLon && t.minLat < maxLat && t.maxLat > minLat
  );
  const totalBytes = inBbox.reduce((sum, t) => sum + t.sizeBytes, 0);
  if (totalBytes <= MAX_TOTAL_BYTES) {
    return { tiles: inBbox, capped: false };
  }
  const fallback = [findTile(lon1, lat1), findTile(lon2, lat2)].filter(Boolean);
  return { tiles: fallback, capped: true };
}

async function ensureTileLoaded(tileEntry) {
  const key = `${tileEntry.col}_${tileEntry.row}`;
  if (loadedTileGraphs.has(key)) return false;
  const res = await fetch(`data/tiles/${tileEntry.file}`);
  const geojson = await res.json();
  for (const f of geojson.features) f.properties.tier = TILE_TIER;
  loadedTileGraphs.set(key, CycleGraph.buildGraph(geojson, tileWeightForFeature));
  return true;
}

async function loadAttribution() {
  const res = await fetch("data/attribution.json");
  const attr = await res.json();
  document.getElementById("attribution-text").textContent =
    `${attr.attribution_text}(${attr.license})。地図タイル: OpenFreeMap © OpenMapTiles, Data from OpenStreetMap。` +
    `専用道路ネットワークは highway=cycleway と cycleway=track系をOverpass APIで抽出(2026-09-20)。` +
    `専用度合いの区分は東京都都市整備局の自転車関連情報マップの考え方を参考にした。`;
}

async function loadRoutesIndex() {
  const res = await fetch("data/routes/index.json");
  const index = await res.json();
  const select = document.getElementById("route-select");
  for (const route of index.routes) {
    const opt = document.createElement("option");
    opt.value = route.file;
    opt.textContent = `${route.name}(${route.length_km}km, 専用道路${Math.round(route.cycleway_share * 100)}%)`;
    select.appendChild(opt);
  }
  select.addEventListener("change", async () => {
    const resultDiv = document.getElementById("route-result");
    const gpxBtn = document.getElementById("btn-gpx-route");
    if (!select.value) {
      map.getSource("route-result").setData(EMPTY_FC);
      resultDiv.textContent = "";
      gpxBtn.classList.add("hidden");
      lastPrecomputedRoute = null;
      return;
    }
    const routeRes = await fetch(`data/${select.value}`);
    const routeGeojson = await routeRes.json();
    map.getSource("route-result").setData({ type: "FeatureCollection", features: [routeGeojson] });
    const coords = routeGeojson.geometry.coordinates;
    fitRouteBounds(coords);
    const p = routeGeojson.properties;
    resultDiv.innerHTML = `<span class="ok">${p.name}: 距離 ${p.length_km} km、専用道路上 ${Math.round(p.cycleway_share * 100)}%</span>`;
    // 修正: 以前は coords が未定義でGPXダウンロード時にエラーになっていた。
    lastPrecomputedRoute = { coords, name: p.name };
    gpxBtn.classList.remove("hidden");
  });
}

function setPickMode(mode) {
  pickMode = mode;
  document.getElementById("btn-set-from").classList.toggle("active", mode === "from");
  document.getElementById("btn-set-to").classList.toggle("active", mode === "to");
  // スマホ画面ではサイドバーが地図に重なるオーバーレイなので、出発地・目的地を
  // クリックで指定できるよう、指定モードに入ったら自動で閉じる。
  if (mode) closeSidebar();
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
}
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function makePinElement(kind) {
  const el = document.createElement("div");
  el.className = kind === "from" ? "pin-from" : "pin-to";
  el.textContent = kind === "from" ? "出" : "着";
  return el;
}

// GPX(GPS Exchange Format)は多くのサイコン(Garmin等)がコース/ルートとして
// 取り込める共通フォーマット。サーバー無しでブラウザ内だけで生成してダウンロードする。
function buildGpx(coords, name) {
  const points = coords.map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="cycleway-router" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

function downloadGpx(coords, name, filename) {
  const blob = new Blob([buildGpx(coords, name)], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 地名検索: OpenStreetMapの無料ジオコーダーNominatimを使う(APIキー不要)。
// 入力するたびに自動検索するが、Nominatimの利用規約は「1秒に1回まで」
// 「キー入力のたびに毎回叩くようなオートコンプリートは避ける」ことを求めているため、
// 入力が止まってから600ms経ってから1回だけ検索する(デバウンス)ことで頻度を抑える。
// 出典表記は下部の出典欄に記載済み。
async function searchPlace(query) {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=ja` +
    `&countrycodes=jp&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  return res.json();
}

function renderSearchResults(kind, results) {
  const ul = document.getElementById(`search-${kind}-results`);
  ul.innerHTML = "";
  if (!results.length) {
    ul.innerHTML = '<li class="hint">見つかりませんでした</li>';
    ul.classList.remove("hidden");
    return;
  }
  for (const r of results) {
    const li = document.createElement("li");
    li.textContent = r.display_name;
    li.addEventListener("click", () => {
      const lon = parseFloat(r.lon);
      const lat = parseFloat(r.lat);
      setPoint(kind, lon, lat);
      ul.classList.add("hidden");
      document.getElementById(`search-${kind}`).value = r.display_name.split("、")[0].split(",")[0];
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14) });
    });
    ul.appendChild(li);
  }
  ul.classList.remove("hidden");
}

const searchRequestSeq = { from: 0, to: 0 };

async function handleSearch(kind) {
  const input = document.getElementById(`search-${kind}`);
  const query = input.value.trim();
  const ul = document.getElementById(`search-${kind}-results`);
  if (query.length < 2) {
    ul.classList.add("hidden");
    return;
  }
  const seq = ++searchRequestSeq[kind];
  const results = await searchPlace(query);
  if (seq !== searchRequestSeq[kind]) return; // 検索中に次の入力があれば結果を捨てる
  renderSearchResults(kind, results);
}

const searchDebounceTimers = {};
function scheduleSearch(kind) {
  clearTimeout(searchDebounceTimers[kind]);
  searchDebounceTimers[kind] = setTimeout(() => handleSearch(kind), 600);
}

document.getElementById("btn-search-from").addEventListener("click", () => handleSearch("from"));
document.getElementById("btn-search-to").addEventListener("click", () => handleSearch("to"));
document.getElementById("search-from").addEventListener("input", () => scheduleSearch("from"));
document.getElementById("search-to").addEventListener("input", () => scheduleSearch("to"));
document.getElementById("search-from").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSearch("from");
});
document.getElementById("search-to").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSearch("to");
});

document.getElementById("menu-toggle").addEventListener("click", toggleSidebar);

document.getElementById("btn-set-from").addEventListener("click", () => setPickMode("from"));
document.getElementById("btn-set-to").addEventListener("click", () => setPickMode("to"));
document.getElementById("btn-clear").addEventListener("click", () => {
  if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
  if (toPoint && toPoint.marker) toPoint.marker.remove();
  fromPoint = null;
  toPoint = null;
  pickMode = null;
  lastNearbyRouteCoords = null;
  map.getSource("search-result").setData(EMPTY_FC);
  document.getElementById("nearby-result").textContent = "";
  document.getElementById("btn-gpx-nearby").classList.add("hidden");
});

document.getElementById("toggle-reference").addEventListener("change", (e) => {
  const visibility = e.target.checked ? "visible" : "none";
  map.setLayoutProperty("reference-line-solid", "visibility", visibility);
  map.setLayoutProperty("reference-line-dashed", "visibility", visibility);
});

document.getElementById("btn-gpx-nearby").addEventListener("click", () => {
  if (lastNearbyRouteCoords) downloadGpx(lastNearbyRouteCoords, "近距離検索ルート", "cycleway-route-nearby.gpx");
});
document.getElementById("btn-gpx-route").addEventListener("click", () => {
  if (lastPrecomputedRoute) {
    downloadGpx(lastPrecomputedRoute.coords, lastPrecomputedRoute.name, `cycleway-route-${lastPrecomputedRoute.name}.gpx`);
  }
});

// 経路(座標配列)が確実に地図上で見えるよう、その範囲にズーム・パンする。
// サイドバーは検索結果表示時に開くので、隠れる左側分の余白(padding)を
// 常に確保しておく(offsetWidthはtransformで隠れていても実サイズを返す)。
function fitRouteBounds(coords) {
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const leftPadding = document.getElementById("sidebar").offsetWidth + 40;
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: { top: 40, right: 40, bottom: 40, left: leftPadding }, maxZoom: 17 }
  );
}

async function runNearbySearch() {
  const resultDiv = document.getElementById("nearby-result");
  const gpxBtn = document.getElementById("btn-gpx-nearby");
  gpxBtn.classList.add("hidden");
  resultDiv.innerHTML = '<span class="hint">周辺の道路データを読み込み中...</span>';

  const { tiles, capped } = tilesForSearch(fromPoint.lon, fromPoint.lat, toPoint.lon, toPoint.lat);
  const loadedAny = (await Promise.all(tiles.map(ensureTileLoaded))).some(Boolean);
  if (loadedAny) rebuildCombinedGraph();

  const nearFrom = CycleGraph.nearestNode(graph, fromPoint.lon, fromPoint.lat);
  const nearTo = CycleGraph.nearestNode(graph, toPoint.lon, toPoint.lat);

  if (nearFrom.index < 0 || nearTo.index < 0) {
    resultDiv.innerHTML = '<span class="ng">周辺に道路データが見つかりませんでした。</span>';
    return;
  }

  const result = CycleGraph.shortestPath(graph, nearFrom.index, nearTo.index);
  if (!result) {
    map.getSource("search-result").setData(EMPTY_FC);
    lastNearbyRouteCoords = null;
    resultDiv.innerHTML =
      '<span class="ng">専用道路・自転車レーン・一般道をすべて使っても繋がっていません。長距離ルートの事前計算リストを確認してください。</span>';
    return;
  }

  const coords = result.path.map((idx) => graph.nodeCoords[idx]);
  map.getSource("search-result").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }],
  });
  fitRouteBounds(coords);
  lastNearbyRouteCoords = coords;
  gpxBtn.classList.remove("hidden");
  const accessM = Math.round(nearFrom.distanceM + nearTo.distanceM);

  const cappedNote = capped
    ? '<br><span class="hint">(出発地・目的地が離れているため、周辺の一般道データのみを使用しました)</span>'
    : "";
  resultDiv.innerHTML =
    `<span class="ok">距離: ${(result.distanceM / 1000).toFixed(2)} km</span>` +
    renderSegmentList(result.segments) +
    `<br>` +
    `出発地・目的地から最寄りのネットワークまで、合計約 ${accessM} m の徒歩/一般道アクセスが別途必要です</span>${cappedNote}`;
}

// 出発地・目的地の座標をセットする共通処理(地図クリック・地名検索の両方から呼ぶ)。
function setPoint(kind, lon, lat) {
  const marker = new maplibregl.Marker({ element: makePinElement(kind) }).setLngLat([lon, lat]).addTo(map);
  if (kind === "from") {
    if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
    fromPoint = { lon, lat, marker };
  } else {
    if (toPoint && toPoint.marker) toPoint.marker.remove();
    toPoint = { lon, lat, marker };
  }
  if (fromPoint && toPoint) {
    runNearbySearch().then(openSidebar);
  }
}

// 地図上の専用道路・参考レイヤーをタップしたときに、名称・専用度合い・属性・
// データ出典・OSMへのリンク・Googleストリートビューへのリンクをポップアップ表示する。
// 「どんな道路か実際に確認したい」という要望への対応(2026-09-21)。
// Googleストリートビューはリンクのみ(埋め込みAPIはキー・課金が必要なため使わない。
// リンクなら無料・キー不要でユーザーのブラウザで開ける)。
const INFO_LAYER_IDS = ["cycleway-line-solid", "cycleway-line-dashed", "reference-line-solid", "reference-line-dashed"];

function formatRoadInfoPopup(props, lngLat) {
  const tierLabel = (TIER_STYLE[props.tier] || {}).label || "不明";
  const name = props.name || "(名称不明の区間)";
  const refText = props.ref ? `[${props.ref}] ` : "";
  const attrs = [];
  if (props.surface) attrs.push(`路面: ${props.surface}`);
  if (props.foot) attrs.push(`歩行者: ${props.foot}`);
  if (props.segregated) attrs.push(`歩行者との分離: ${props.segregated}`);
  const attrsHtml = attrs.length ? `<div class="hint">${attrs.join(" / ")}</div>` : "";
  const osmUrl = `https://www.openstreetmap.org/way/${props.id}`;
  const svUrl = `https://www.google.com/maps?layer=c&cbll=${lngLat.lat},${lngLat.lng}`;
  return (
    `<div style="font-size:0.8rem;max-width:240px;">` +
    `<div style="font-weight:bold;margin-bottom:2px;">${refText}${name}</div>` +
    `<div>${tierLabel}</div>${attrsHtml}` +
    `<div style="margin-top:6px;">` +
    `<a href="${osmUrl}" target="_blank" rel="noopener">OSMで詳細を見る(way ${props.id})</a><br>` +
    `<a href="${svUrl}" target="_blank" rel="noopener">Googleストリートビューで見る</a>` +
    `</div>` +
    `<div class="hint" style="margin-top:4px;">出典: OpenStreetMap contributors(ODbL)、2026-09-20取得</div>` +
    `</div>`
  );
}

function attachRoadInfoPopups() {
  for (const layerId of INFO_LAYER_IDS) {
    map.on("click", layerId, (e) => {
      if (pickMode) return; // 出発地・目的地の指定中はポップアップを出さない
      const props = e.features[0].properties;
      new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(formatRoadInfoPopup(props, e.lngLat)).addTo(map);
    });
    map.on("mouseenter", layerId, () => {
      if (!pickMode) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function attachMapHandlers() {
  map.on("click", (e) => {
    if (!pickMode || !graph) return;
    const kind = pickMode;
    setPickMode(null);
    setPoint(kind, e.lngLat.lng, e.lngLat.lat);
  });

  map.on("load", async () => {
    // 専用道路・参考レイヤーを先に追加し、検索結果のライン(search-result/
    // route-result)は必ずその後に追加する(MapLibreは後から追加したレイヤーほど
    // 上に重なって描画されるため、経路がサイクリングロード等の下に隠れないようにする)。
    await Promise.all([
      loadCyclewayNetwork(),
      loadReferenceInfrastructure(),
      loadAttribution(),
      loadRoutesIndex(),
      loadTileIndex(),
    ]);
    attachRoadInfoPopups();

    // 近距離検索の経路は、緑の専用道路と同化しないよう青にする。
    map.addSource("search-result", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "search-result-line",
      type: "line",
      source: "search-result",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_RESULT_COLOR, "line-width": 6 },
    });
    map.addSource("route-result", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "route-result-line",
      type: "line",
      source: "route-result",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#d62728", "line-width": 4 },
    });
  });
}

async function initMap() {
  const style = await loadFlattenedStyle();
  map = new maplibregl.Map({
    container: "map",
    style,
    center: KANTO_CENTER,
    zoom: 9,
  });
  // ズームボタンは左上のmenu-toggleボタンと重なるため右下に配置する。
  map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  attachMapHandlers();
  // 画面が広い(デスクトップ相当)場合は、最初からサイドバーを開いておく。
  if (window.innerWidth > 768) openSidebar();
}

initMap();