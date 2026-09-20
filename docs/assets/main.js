const KANTO_CENTER = [139.6, 36.0]; // MapLibreは[lon, lat]の順

// 背景地図: MapLibre GL JS + OpenFreeMap(無料・無制限・キー不要・自己ホスト可能)。
// 2026-09-20時点の調査で、Esriの無料タイル(services.arcgisonline.com)はレガシー扱いで
// 新サービスはAPIキー登録が必要、CartoDB Positronも同様にAPIキー要求の表示が出ることを
// 確認済み。OpenFreeMapは登録・キー・レート制限が無いことを利用規約で確認した。
// 属性(道路・鉄道の太さ・色)を自分でカスタマイズできるベクトルタイルなので、
// Googleマップに近い見やすさを実現しやすい。
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: KANTO_CENTER,
  zoom: 9,
});
map.addControl(new maplibregl.NavigationControl(), "top-left");

// 専用度合い(tier)ごとのスタイル。値が小さいほど「より専用」。
// 東京都の自転車関連情報マップ(wagmap)の分類(自転車道/自転車歩行者道の分離方法/
// 自転車専用通行帯/車道混在)を参考に段階分けした(2026-09-20)。
// tier 6,7は経路探索の対象(専用道路)には含めない参考表示レイヤー
// (ただし近距離検索では専用道路が繋がらない場合の探索対象として使う)。
const TIER_STYLE = {
  1: { color: "#08306b", weight: 2.6, label: "完全専用(歩行者非対応)" },
  2: { color: "#2171b5", weight: 2.2, label: "専用・歩行者と分離" },
  3: { color: "#6baed6", weight: 1.8, label: "専用・歩行者共用" },
  4: { color: "#9ecae1", weight: 1.5, label: "専用(詳細不明)" },
  5: { color: "#984ea3", weight: 2.2, dashed: true, label: "分離型自転車道(車道沿い、近似)" },
  6: { color: "#fdae61", weight: 1.3, label: "(参考)自転車専用通行帯・ペイントのみ" },
  7: { color: "#bdbdbd", weight: 1, dashed: true, label: "(参考)車道混在・矢羽根等" },
};

// 近距離検索は「専用道路(tier1-5)を最優先、繋がらなければ自転車レーン・車道混在
// (tier6,7)もペナルティ付きで使う」という重み付き探索にする(表示のオン/オフとは独立)。
// 値はR5側のカスタムコスト(専用道路の定義、一般道ペナルティ)と同じ考え方。未確定・調整余地あり。
const ROUTING_PENALTY = { 6: 2.5, 7: 5.0 };
function weightForFeature(feature) {
  return ROUTING_PENALTY[feature.properties.tier] || 1.0;
}

const TIER_LABEL_SHORT = {
  1: "専用道路", 2: "専用道路", 3: "専用道路", 4: "専用道路", 5: "専用道路",
  6: "自転車レーン", 7: "車道混在",
};

function tierMatchExpression(field, defaultValue) {
  const expr = ["match", ["get", "tier"]];
  for (const [tier, s] of Object.entries(TIER_STYLE)) {
    expr.push(Number(tier), s[field] !== undefined ? s[field] : defaultValue);
  }
  expr.push(defaultValue);
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

const EMPTY_FC = { type: "FeatureCollection", features: [] };

// MapLibreのline-dasharrayはデータ駆動の式(match/case)に対応していないため
// (定数配列しか指定できない)、破線が必要なtierは別レイヤーに分ける。
async function loadCyclewayNetwork() {
  const res = await fetch("data/cycleway_network.geojson");
  cyclewayGeojson = await res.json();
  map.addSource("cycleway", { type: "geojson", data: cyclewayGeojson });
  map.addLayer({
    id: "cycleway-line-solid",
    type: "line",
    source: "cycleway",
    filter: ["!=", ["get", "tier"], 5],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tierMatchExpression("color", "#1f77b4"),
      "line-width": tierMatchExpression("weight", 1.5),
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
      "line-width": TIER_STYLE[5].weight,
      "line-dasharray": [2, 1.5],
    },
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

function maybeBuildRoutingGraph() {
  if (!cyclewayGeojson || !referenceGeojson) return;
  const cyclewayGraph = CycleGraph.buildGraph(cyclewayGeojson, weightForFeature);
  const referenceGraph = CycleGraph.buildGraph(referenceGeojson, weightForFeature);
  graph = CycleGraph.mergeGraphs([cyclewayGraph, referenceGraph]);
  console.log(`routing graph: ${graph.nodeCoords.length} nodes`);
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
    if (!select.value) {
      map.getSource("route-result").setData(EMPTY_FC);
      resultDiv.textContent = "";
      return;
    }
    const routeRes = await fetch(`data/${select.value}`);
    const routeGeojson = await routeRes.json();
    map.getSource("route-result").setData({ type: "FeatureCollection", features: [routeGeojson] });
    const coords = routeGeojson.geometry.coordinates;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 40 }
    );
    const p = routeGeojson.properties;
    resultDiv.innerHTML = `<span class="ok">${p.name}: 距離 ${p.length_km} km、専用道路上 ${Math.round(p.cycleway_share * 100)}%</span>`;
  });
}

function setPickMode(mode) {
  pickMode = mode;
  document.getElementById("btn-set-from").classList.toggle("active", mode === "from");
  document.getElementById("btn-set-to").classList.toggle("active", mode === "to");
}

function makePinElement(kind) {
  const el = document.createElement("div");
  el.className = kind === "from" ? "pin-from" : "pin-to";
  el.textContent = kind === "from" ? "出" : "着";
  return el;
}

document.getElementById("btn-set-from").addEventListener("click", () => setPickMode("from"));
document.getElementById("btn-set-to").addEventListener("click", () => setPickMode("to"));
document.getElementById("btn-clear").addEventListener("click", () => {
  if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
  if (toPoint && toPoint.marker) toPoint.marker.remove();
  fromPoint = null;
  toPoint = null;
  pickMode = null;
  map.getSource("search-result").setData(EMPTY_FC);
  document.getElementById("nearby-result").textContent = "";
});

document.getElementById("toggle-reference").addEventListener("change", (e) => {
  const visibility = e.target.checked ? "visible" : "none";
  map.setLayoutProperty("reference-line-solid", "visibility", visibility);
  map.setLayoutProperty("reference-line-dashed", "visibility", visibility);
});

map.on("click", (e) => {
  if (!pickMode || !graph) return;
  const { lat, lng } = e.lngLat;
  const marker = new maplibregl.Marker({ element: makePinElement(pickMode) }).setLngLat([lng, lat]).addTo(map);

  if (pickMode === "from") {
    if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
    fromPoint = { lon: lng, lat, marker };
  } else {
    if (toPoint && toPoint.marker) toPoint.marker.remove();
    toPoint = { lon: lng, lat, marker };
  }
  setPickMode(null);

  if (fromPoint && toPoint) {
    runNearbySearch();
  }
});

function runNearbySearch() {
  const resultDiv = document.getElementById("nearby-result");
  const nearFrom = CycleGraph.nearestNode(graph, fromPoint.lon, fromPoint.lat);
  const nearTo = CycleGraph.nearestNode(graph, toPoint.lon, toPoint.lat);

  if (nearFrom.index < 0 || nearTo.index < 0) {
    resultDiv.innerHTML = '<span class="ng">周辺に専用道路ネットワークが見つかりませんでした。</span>';
    return;
  }

  const result = CycleGraph.shortestPath(graph, nearFrom.index, nearTo.index);
  if (!result) {
    map.getSource("search-result").setData(EMPTY_FC);
    resultDiv.innerHTML =
      '<span class="ng">専用道路・自転車レーン等をすべて使っても繋がっていません(分断されています)。長距離ルートの事前計算リストを確認してください。</span>';
    return;
  }

  const coords = result.path.map((idx) => graph.nodeCoords[idx]);
  map.getSource("search-result").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }],
  });
  const accessM = Math.round(nearFrom.distanceM + nearTo.distanceM);

  const breakdown = Object.entries(result.tierDistanceM)
    .sort((a, b) => a[0] - b[0])
    .map(([tier, m]) => `${TIER_LABEL_SHORT[tier] || "不明"} ${(m / 1000).toFixed(2)}km`)
    .join(" + ");
  resultDiv.innerHTML =
    `<span class="ok">距離: ${(result.distanceM / 1000).toFixed(2)} km(${breakdown})<br>` +
    `出発地・目的地から最寄りのネットワークまで、合計約 ${accessM} m の徒歩/一般道アクセスが別途必要です</span>`;
}

map.on("load", async () => {
  map.addSource("search-result", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "search-result-line",
    type: "line",
    source: "search-result",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#2ca02c", "line-width": 4 },
  });
  map.addSource("route-result", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "route-result-line",
    type: "line",
    source: "route-result",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#d62728", "line-width": 4 },
  });

  await Promise.all([
    loadCyclewayNetwork(),
    loadReferenceInfrastructure(),
    loadAttribution(),
    loadRoutesIndex(),
  ]);
});
