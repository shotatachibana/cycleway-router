const KANTO_CENTER = [139.6, 36.0]; // MapLibreは[lon, lat]の順

// 2026-09-22、ユーザー方針: 「鉄道とサイクリングロードだけ以外の強調表示は
// 大きくズームアウトした時には無くなるように。最もズームアウトした時に残る
// のはサイクリングロードだけにしてほしい」。初期表示(zoom 9、関東全体)を
// 基準に、ズームアウトするほど段階的に強調表示を消すためのしきい値。
// 2026-09-22追記: 「もう少しズームアウトの早い段階でサイクリングロードだけ
// 残るように」との指摘を受け、しきい値を7/4から9/7に引き上げた(初期表示から
// 少しズームアウトしただけで専用道路ネットワークが消え、そこからさらに
// 少し戻すだけで鉄道も消えるようにした)。
// 2026-09-22さらに追記: それでも「サイクリングロード以外の自転車道(専用道路
// ネットワーク)の強調が消えるタイミングをもう少し早く」との指摘を受け、
// 専用道路ネットワーク側のしきい値だけ9→10にさらに引き上げた(鉄道側は
// 対象外なので7のまま)。
// 2026-09-23さらに追記: 「5kmぐらいのズーム時にはもう表示されなくなって
// いてほしい」との指摘を受け、10→11にさらに引き上げた。地図左下の
// スケールバー(#map-scale、maxWidth: 100px)の表示をPlaywrightで実測したところ、
// 緯度36°付近では zoom 9.5〜10.4あたりが「5 km」表示、zoom 11では既に
// 「3 km」表示になっていたため、11ならスケールバーが「5 km」を示す範囲では
// 確実に非表示になる。
// zoom 11未満: 専用道路ネットワーク(cycleway-line-solid、reference-line-*)が消える。
// zoom 7未満: 鉄道の強調配色(loadFlattenedStyle内のRAIL_LAYER_IDS分岐)も消える。
// 登録済みサイクリングロード(highway-route-*)はどちらの定義にも使わないため、
// ズームを問わず常時表示され続ける。
const CYCLEWAY_EMPHASIS_MIN_ZOOM = 11;
const RAIL_EMPHASIS_MIN_ZOOM = 7;

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
// 地図を見にくくしないための鉄道の描画方針から一歩進めて、Googleマップに近い
// 配色にする(2026-09-22、ユーザー方針)。
// Googleマップの鉄道は大まかに3種類の見た目で描き分けられている:
//   ・新幹線: 白地に濃い青の縞
//   ・JR在来線・私鉄の重軌道(liberty styleの「major_rail」区分): 白地に黒の縞
//   ・地下鉄・路面電車等の軽軌道(liberty styleの「transit_rail」区分): 細い黒の実線
// 「縞」はMapLibreのline-dasharrayが単色しか扱えないため、
// 「下に色付きの実線」+「上に白い破線」を重ねる2枚のレイヤーで表現する
// (前回、線路の名前を緑バッジ画像に当てはめる方式(icon-text-fit)で地図全体が
// 描画不能になった反省を踏まえ、今回は画像を一切使わず、確実に動くdasharrayの
// みで実装している)。
const RAIL_MAJOR_IDS = ["road_major_rail", "bridge_major_rail", "tunnel_major_rail"];
const RAIL_MAJOR_HATCH_IDS = ["road_major_rail_hatching", "bridge_major_rail_hatching", "tunnel_major_rail_hatching"];
const RAIL_TRANSIT_IDS = ["road_transit_rail", "bridge_transit_rail", "tunnel_transit_rail"];
const RAIL_TRANSIT_HATCH_IDS = ["road_transit_rail_hatching", "bridge_transit_rail_hatching", "tunnel_transit_rail_hatching"];
const RAIL_LAYER_IDS = [...RAIL_MAJOR_IDS, ...RAIL_MAJOR_HATCH_IDS, ...RAIL_TRANSIT_IDS, ...RAIL_TRANSIT_HATCH_IDS];

// 2026-09-22: 「鉄道の線と文字はGoogleマップの線と同じぐらい細く、色ももう
// 少し黒を抑えて」との指摘を受け、駅名ラベル(RAIL_JR_COLOR、station-labelの
// text-colorとして使用)を#222222(ほぼ黒)から一段階明るい濃灰色に変更した。
// 実際の線の色(loadFlattenedStyle内のRAIL_LAYER_IDS分岐で使用)も同様に
// #4a4a4a→RAIL_LINE_COLORへ明るくした。
const RAIL_JR_COLOR = "#5f5f5f";
const RAIL_LINE_COLOR = "#8a8a8a";
const RAIL_SHINKANSEN_COLOR = "#0a3d91";
const RAIL_PRIVATE_COLOR = "#4a4a4a";
const RAIL_STRIPE_COLOR = "#ffffff";

// 低ズームでも見える太さを確保しつつ、自転車道より目立たないよう抑えた太さ。
const RAIL_WIDTH_ZOOM_STOPS = [8, 0.8, 12, 1.3, 16, 2.0, 20, 3.0];
function railWidthExpression(factor) {
  const expr = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < RAIL_WIDTH_ZOOM_STOPS.length; i += 2) {
    expr.push(RAIL_WIDTH_ZOOM_STOPS[i], RAIL_WIDTH_ZOOM_STOPS[i + 1] * factor);
  }
  return expr;
}

// 新幹線かどうかの判定。2026-09-22、map.querySourceFeatures()で実データを確認した
// ところ、OpenFreeMap(OpenMapTiles標準スキーマ)の「transportation」ソースレイヤーの
// 線フィーチャには、class/subclass/brunnel/layer/service以外のプロパティが一切無く
// (nameはおろかnetwork/operator等も含まれない)、下のnameプロパティによる判定は
// 常にfalseになる=新幹線の青縞は実際には一度も描画されないことが確定した
// (同じ理由で、JR在来線と私鉄重軌道もこのレイヤーだけでは区別不可能。isMajor分岐側の
// コメント参照)。この関数・SHINKANSEN_FILTER自体は削除せず残す(表示ロジックの
// 分岐先はそのまま使えるため)が、新幹線を実際に描き分けるには、多摩川サイクリング
// ロード等と同様にdata/highway_routes.geojson方式で新幹線の線形を別途手動登録
// する必要がある(未着手。関東内なら東海道・東北・上越・北陸の4路線程度で
// 現実的な範囲)。
function nameContains(keyword) {
  return ["case", ["has", "name"], ["in", keyword, ["get", "name"]], false];
}
const SHINKANSEN_FILTER = ["any", nameContains("新幹線"), nameContains("Shinkansen"), nameContains("shinkansen")];

// 1つの元レイヤー(liberty styleのfilter/source/source-layer/minzoom等を
// そのまま引き継ぐ)から、Googleマップ風の見た目を作るための1〜4枚のレイヤーを
// 生成する。plain arrayを返し、呼び出し側でflatMapにより展開する。
// 2026-09-22時点では未使用(どこからも呼ばれていない、buildRailLayers(で検索して
// 確認できる)。実際の鉄道の色付けはloadFlattenedStyle内のRAIL_LAYER_IDS分岐
// (単色のみ、JR/私鉄/新幹線の描き分け無し)で行っている。このJR/新幹線分けの
// 実装(RAIL_JR_COLOR等)は、新幹線判定が実際には機能しないこと(SHINKANSEN_FILTER
// 付近のコメント参照)が分かった時点で保留になった名残。
function buildRailLayers(originalLayer) {
  const id = originalLayer.id;
  const isMajor = RAIL_MAJOR_IDS.includes(id) || RAIL_MAJOR_HATCH_IDS.includes(id);
  const isHatching = id.endsWith("_hatching");
  const base = {
    type: "line",
    source: originalLayer.source,
    "source-layer": originalLayer["source-layer"],
    minzoom: originalLayer.minzoom,
    maxzoom: originalLayer.maxzoom,
    layout: { ...originalLayer.layout, "line-cap": "butt", "line-join": "round" },
  };

  if (isHatching) {
    // トンネル区間のハッチング装飾は、路線の種別を縞で描き分けるとうるさくなる
    // ため、単色のみ(JR/私鉄系統は黒寄り、地下鉄等はやや薄い黒)で簡潔にする。
    return [
      {
        ...base,
        id,
        filter: originalLayer.filter,
        paint: {
          "line-color": isMajor ? RAIL_JR_COLOR : RAIL_PRIVATE_COLOR,
          "line-width": railWidthExpression(isMajor ? 0.9 : 0.5),
        },
      },
    ];
  }

  if (!isMajor) {
    // 地下鉄・路面電車等: 細い黒の実線のみ(私鉄も含め、現状のタイルからは
    // JR以外の重軌道と軽軌道を確実に区別できないため、ここに寄せている)。
    return [
      {
        ...base,
        id,
        filter: originalLayer.filter,
        paint: {
          "line-color": RAIL_PRIVATE_COLOR,
          "line-width": railWidthExpression(0.7),
        },
      },
    ];
  }

  // 在来線(JR・私鉄の重軌道)と新幹線を、名前で振り分けて別レイヤーにする。
  const jrFilter = originalLayer.filter
    ? ["all", originalLayer.filter, ["!", SHINKANSEN_FILTER]]
    : ["!", SHINKANSEN_FILTER];
  const shinkansenFilter = originalLayer.filter
    ? ["all", originalLayer.filter, SHINKANSEN_FILTER]
    : SHINKANSEN_FILTER;
  const widthFactor = 1.3;
  const width = railWidthExpression(widthFactor);

  const groups = [
    { suffix: "jr", filter: jrFilter, color: RAIL_JR_COLOR },
    { suffix: "shinkansen", filter: shinkansenFilter, color: RAIL_SHINKANSEN_COLOR },
  ];
  const layers = [];
  for (const g of groups) {
    layers.push({
      ...base,
      id: `${id}_${g.suffix}_base`,
      filter: g.filter,
      paint: { "line-color": g.color, "line-width": width },
    });
    layers.push({
      ...base,
      id: `${id}_${g.suffix}_stripe`,
      filter: g.filter,
      paint: {
        "line-color": RAIL_STRIPE_COLOR,
        "line-width": width,
        "line-dasharray": [1.4, 1.4],
      },
    });
  }
  return layers;
}

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

// 自動車道の「高速道路っぽさ」は色よりも、白い縁取り+濃い本線という
// 二重線構造そのものが原因なので、縁取り(casing)は描画を消し、本線だけの
// 単線にする(自転車道の二重線=高速道路風は維持したまま、自動車道だけ普通の
// 道路に見えるようにする、2026-09-22)。
function mutedCarRoadLayer(l) {
  const isCasing = l.id.includes("casing");
  if (isCasing) {
    return { ...l, layout: { ...l.layout, visibility: "none" } };
  }
  return {
    ...l,
    paint: {
      ...l.paint,
      "line-color": CAR_ROAD_COLOR.fill,
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

// loadStationIcon()がスプライトのURLを組み立てるのに使う(loadFlattenedStyle内で
// 実際のstyle.spriteの値をセットする)。
let spriteBaseUrl = null;

async function loadFlattenedStyle() {
  const res = await fetch("https://tiles.openfreemap.org/styles/liberty");
  const style = await res.json();
  spriteBaseUrl = style.sprite;
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
          // 2026-09-22: 「鉄道とサイクリングロード以外の強調表示は大きく
          // ズームアウトした時には無くなるように、最もズームアウトした時に
          // 残るのはサイクリングロードだけに」というユーザー方針を受けた
          // ズーム連動カスケード。専用道路ネットワーク(cycleway-line-solid等、
          // CYCLEWAY_EMPHASIS_MIN_ZOOM)より低いズームまで残し、登録済み
          // サイクリングロード(highway-route-*、ズーム制限無し)より先に消す。
          minzoom: Math.max(l.minzoom || 0, RAIL_EMPHASIS_MIN_ZOOM),
          // 2026-09-22: 「鉄道の線はGoogleマップと同じぐらい細く、色も
          // もう少し黒を抑えて」との指摘を受け、幅(概ね半分程度)・色(#4a4a4a→
          // より明るいRAIL_LINE_COLOR)ともに控えめにした。
          paint: {
            ...l.paint,
            "line-color": RAIL_LINE_COLOR,
            "line-width": isHatching
              ? scaleWidthExpression(l.paint["line-width"], 0.5)
              : ["interpolate", ["linear"], ["zoom"], 8, 0.4, 12, 0.6, 16, 1.0, 20, 1.4],
          },
        };
      }
      if (l.id === "poi_transit") {
        // このレイヤーはclass in [airport, bus, rail]を描画する(バス停・空港・
        // 一部の鉄道POI)。前回icon-sizeを一律で拡大したところ、数が圧倒的に
        // 多いバス停ばかりが目立ってしまった(ユーザー指摘)ため、これは
        // 元のまま(japaneseOnlyTextFieldのみ適用)にする。実際の駅の強調は
        // 下で追加するstation-dot/station-label(別レイヤー)で行う。
        return japaneseOnlyTextField(l);
      }
      if (CAR_ROAD_LAYER_PATTERN.test(l.id)) return mutedCarRoadLayer(l);
      return japaneseOnlyTextField(l);
    });

  // 2026-09-22: 当初、駅の面(OpenMapTilesの"landuse"レイヤー、class ===
  // "railway")をズームインした時に透明度の高い赤で表示していたが、実データを
  // 確認したところこれはOSMのlanduse=railway(駅・操車場を含む線路敷地全体、
  // 品川駅で見ると駅前後の線路群を含む巨大なポリゴン)であり、ユーザーが
  // 意図した「駅舎(建物)のポリゴン」とは別物だった。OpenMapTilesの
  // "building"レイヤーはrender_height/render_min_height/colourしか持たず、
  // OSMのbuilding=train_station等の種別情報が配信ベクトルタイルに含まれて
  // いないため、配信データだけでは駅舎の建物だけを正確に選び出せないと判明。
  // ユーザーと相談の結果、今回はこの赤面表示自体をやめ、駅の強調は下記の
  // アイコン+ラベル(station-dot/station-label)のみにする方針にした
  // (駅舎ポリゴンの正確な表示が必要になれば、OSMのbuilding=train_stationを
  // Overpass APIで個別に取得する新規データパイプラインとして再検討する)。

  // 2026-09-22: 実際の駅(OpenMapTilesの"poi"レイヤー、class === "railway")は
  // poi_transitのfilter(class in [airport,bus,rail])に一致せず、実は一度も
  // 描画されていなかったと判明(queryRenderedFeaturesで実データを確認済み。
  // "rail"というクラス値は実データには存在しない)。当初はスプライトの
  // 駅ピクトグラム(icon-image: "railway")を使っていたが、「もう少し丸っぽい
  // アイコンに、色も駅名と同じ灰色に」との指摘を受けて単純な円(circle
  // レイヤー)に一度差し替えた。その後「やっぱり丸ではなく元のアイコンに
  // 戻したいが、色は今の灰色のままで」との指摘を受け、駅ピクトグラムに
  // 戻しつつ灰色に着色し直す必要が生じた。スプライトのアイコンはSDF
  // (icon-colorで塗り替え可能な形式)ではなく固定色のPNGなので、icon-color
  // では塗り替えられない。そのため、スプライト画像から"railway"アイコンの
  // 矩形をcanvasで切り出し、globalCompositeOperation="source-in"でアイコンの
  // 不透明部分(アルファ)だけを残してRAIL_JR_COLORで塗りつぶした画像を生成し、
  // map.addImage()で"station-icon"として登録する(loadStationIcon、
  // map.on("load")内から呼ぶ)。このレイヤー自体はアイコンの読み込みを待たずに
  // 追加してよい(画像が後から登録されても、そのタイミングで再描画される)。
  style.layers.push(
    {
      id: "station-dot",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      filter: ["==", ["get", "class"], "railway"],
      layout: {
        "icon-image": "station-icon",
        // 2026-09-22: 「アイコン小さすぎる」との指摘を受け拡大(0.3/0.45/0.7→
        // 0.45/0.65/1.0)。
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.45, 14, 0.65, 18, 1.0],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: "station-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      filter: ["==", ["get", "class"], "railway"],
      minzoom: 12,
      layout: {
        "text-field": ["coalesce", ["get", "name:nonlatin"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        // 2026-09-22: 「文字ももう少し小さく」との指摘で13→11に縮小。
        "text-size": 11,
        // 2026-09-22: 「駅名は駅アイコンの左側に付くように」との指摘を受け、
        // 右側(text-anchor: "left" + 正のoffset)から左側(text-anchor: "right" +
        // 負のoffset)に変更した。
        "text-anchor": "right",
        // station-dotのicon-sizeの伸びに追随して広げる(アイコンとラベルが
        // ズームインするほど大きく離れて重ならないようにする)。2026-09-22:
        // アイコンの拡大・白バッファ追加に合わせて広げ直した(-0.7/-1.0/-1.4→
        // -1.0/-1.35/-1.95)。
        "text-offset": ["interpolate", ["linear"], ["zoom"], 10, ["literal", [-1.0, 0]], 14, ["literal", [-1.35, 0]], 18, ["literal", [-1.95, 0]]],
      },
      paint: {
        "text-color": RAIL_JR_COLOR,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    }
  );
  return style;
}

// スプライト画像は外部オリジン(tiles.openfreemap.org)のため、canvasで
// ピクセル操作するにはCORS許可が必要(実機確認済み、Access-Control-Allow-Origin: *)。
function loadCrossOriginImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// スプライトの"railway"アイコン(駅ピクトグラム)を、station-dotレイヤーで使う
// 灰色(RAIL_JR_COLOR)に塗り替えて"station-icon"として登録する。詳細な経緯は
// station-dotレイヤー定義(loadFlattenedStyle内)のコメント参照。
// 実装上の注意: 当初globalCompositeOperation="source-in"(不透明部分だけを
// 塗りつぶす)で塗り替えようとしたが、実機確認したところこのアイコンは
// 透明背景の輪郭(シルエット)ではなく、正方形バッジ全体が不透明(青地に白の
// 電車ピクトグラム)だったため、source-inでは単なる灰色の正方形になって
// しまい、ピクトグラムの模様が消えてしまった。そのため、ピクセルごとの
// 輝度を見て「暗い部分(青地)→RAIL_JR_COLOR」「明るい部分(白い模様)→白」の
// 2色に塗り分ける方式にした(しきい値0.85は実際のアイコンの色(地の青の輝度
// 約0.56、模様の白は1.0)から、地と模様がはっきり分かれるように選んだ)。
const STATION_ICON_LUMINANCE_THRESHOLD = 0.85;
// 2026-09-22: 「駅名(station-label)と同じようにアイコンにも白いバッファを」
// との指摘を受け追加。アイコン自体は透明部分の無い不透明な正方形バッジ
// (上記コメント参照)なので、text-haloのような縁取りではなく、周囲に
// 白い余白(パディング)を追加する形で実装する(icon-sizeで一緒に拡大される)。
const STATION_ICON_HALO_PADDING = 3;
async function loadStationIcon() {
  if (!spriteBaseUrl || map.hasImage("station-icon")) return;
  try {
    const [sprite, image] = await Promise.all([
      fetch(`${spriteBaseUrl}.json`).then((r) => r.json()),
      loadCrossOriginImage(`${spriteBaseUrl}.png`),
    ]);
    const icon = sprite.railway;
    if (!icon) return;
    const canvas = document.createElement("canvas");
    canvas.width = icon.width;
    canvas.height = icon.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, icon.x, icon.y, icon.width, icon.height, 0, 0, icon.width, icon.height);
    const imageData = ctx.getImageData(0, 0, icon.width, icon.height);
    const [dr, dg, db] = [0x5f, 0x5f, 0x5f]; // RAIL_JR_COLOR (#5f5f5f)
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const isSymbol = luminance >= STATION_ICON_LUMINANCE_THRESHOLD;
      data[i] = isSymbol ? 255 : dr;
      data[i + 1] = isSymbol ? 255 : dg;
      data[i + 2] = isSymbol ? 255 : db;
    }
    ctx.putImageData(imageData, 0, 0);
    const pad = STATION_ICON_HALO_PADDING;
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = icon.width + pad * 2;
    haloCanvas.height = icon.height + pad * 2;
    const haloCtx = haloCanvas.getContext("2d");
    haloCtx.fillStyle = "#ffffff";
    haloCtx.fillRect(0, 0, haloCanvas.width, haloCanvas.height);
    haloCtx.drawImage(canvas, pad, pad);
    map.addImage("station-icon", haloCtx.getImageData(0, 0, haloCanvas.width, haloCanvas.height));
  } catch (e) {
    console.warn("駅アイコンの読み込みに失敗しました", e);
  }
}

let map;

// 専用度合い(tier)ごとのスタイル。値が小さいほど「より専用」。
// 東京都の自転車関連情報マップ(wagmap)の分類(自転車道/自転車歩行者道の分離方法/
// 自転車専用通行帯/車道混在)を参考に段階分けした(2026-09-20)。
// tier 6,7は経路探索の対象(専用道路)には含めない参考表示レイヤー
// (ただし近距離検索では専用道路が繋がらない場合の探索対象として使う)。
// 2026-09-22: 「高速道路風(緑の縁取り+太字バッジ)」はdata/highway_routes.geojsonに
// 個別登録した「サイクリングロード」だけの表現にした。当初はそれ以外(tier1〜4、
// OSM・自治体データから自動分類した「普通の自転車道」)を青系にしたが、
// 「色分けは不要、灰色で十分」というユーザー方針により、いったん単一のグレー
// (旧GRAY_COLOR)にしていた。同日中に「灰色より青色の方が良いかも」との
// 指摘を受け、近距離検索の結果(ROUTE_RESULT_COLOR、鮮やかな#4285f4)や
// 登録済みサイクリングロード(緑)とはっきり区別できる、彩度を抑えた
// スティールブルーに変更した(NETWORK_COLOR)。tierによる違いは太さ(weight)
// のみで表現する。
// 2026-09-22追記: tier5(分離型自転車道、車道沿いの近似データ)専用の破線・
// 名前ラベル表示もやめ、他のtierと同じ実線・単色にした(「名前の表示は要らない、
// 点線にしなくてもいい」との指摘)。
const NETWORK_COLOR = "#4d6d94";
// 2026-09-22: 「高速道路(登録済みサイクリングロード)以外は太さも細く」という
// 指摘を受け、tier1〜7全体の太さを縮小した(highway-route-*は別途
// tierWidthExpressionのdefaultWeight引数で決まる独立した太さなので影響しない)。
const TIER_STYLE = {
  1: { color: NETWORK_COLOR, weight: 1.6, label: "完全専用(歩行者非対応)" },
  2: { color: NETWORK_COLOR, weight: 1.4, label: "専用・歩行者と分離" },
  3: { color: NETWORK_COLOR, weight: 1.2, label: "専用・歩行者共用" },
  4: { color: NETWORK_COLOR, weight: 1.0, label: "専用(詳細不明)" },
  5: { color: NETWORK_COLOR, weight: 1.3, label: "分離型自転車道(車道沿い、近似)" },
  6: { color: "#e6550d", weight: 1.3, label: "(参考)自転車専用通行帯・ペイントのみ" },
  7: { color: "#636363", weight: 1.1, dashed: true, label: "(参考)車道混在・矢羽根等" },
  8: { color: "#252525", weight: 2, label: "一般道路(地図上には表示しない)" },
};

// 高速道路風(縁取り+塗り+バッジ)に使う色。緑はdata/highway_routes.geojsonに
// 個別登録した「サイクリングロード」専用の色として予約する(2026-09-22)。
const CASING_COLOR = "#1b5e2c"; // 縁取り(濃い緑)
const HIGHWAY_LINE_COLOR = "#3f9d4b"; // 塗り(中間の緑。旧tier1-2のデフォルト色を流用)
// 近距離検索の経路。Googleマップの経路表示と同じ青系にする(2026-09-22、
// ユーザー指摘: 「添付した画像と同じ青色で」。以前はマゼンタだったが、
// 灰色のネットワーク本体・緑の高速道路風レイヤーどちらとも被らないため
// 青のままで問題ない。長距離の事前計算ルートは別途赤 #d62728 を使っている)。
const ROUTE_RESULT_COLOR = "#4285f4";

// 「高速道路風」の縁取り・名前バッジは、OSMのtier/name/長さから推測する方式
// (ヒューリスティック)をやめ、data/highway_routes.geojsonに明示登録した区間
// だけに適用する方式にした(2026-09-22)。理由: tier+name+長さの条件では、
// 交差点の断片が本線と同じname属性を引き継いでいて長さも100m以上あるような
// OSMデータの継ぎ目を排除しきれなかった。自治体・NAVITIME等の外部データを
// 変換して登録できる形にもなるため、こちらの方が正確。詳細はloadHighwayRoutes参照。

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
      if (seg.toIdx !== undefined) prev.toIdx = seg.toIdx; // 座標範囲(地図上の白丸用)も一緒に伸ばす
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// 自転車の平均的な巡航速度の目安(km/h)。Googleマップの所要時間表示に似せて、
// 距離から概算の所要時間を出す(信号待ち・休憩等は考慮しない単純計算、
// 2026-09-22追加)。
const AVERAGE_CYCLING_SPEED_KMH = 15;
function formatDuration(distanceM) {
  const totalMin = Math.round((distanceM / 1000 / AVERAGE_CYCLING_SPEED_KMH) * 60);
  // 区間一覧の短い区間(例: 交差点の継ぎ目)では0分になりうるため、
  // 「0分」と出さず1分未満として表示する(2026-09-22)。
  if (totalMin < 1) return "1分未満";
  if (totalMin < 60) return `${totalMin}分`;
  return `${Math.floor(totalMin / 60)}時間${totalMin % 60}分`;
}

// 区間一覧の各行に付けるアイコン(2026-09-22、「各道路の選択する感じは良いが
// 何かアイコンが欲しい」との指摘で追加)。tier1〜6(専用道路・自転車レーン)は
// 自転車アイコン、tier7〜8(車道混在・一般道路)は道路アイコン。色は呼び出し側で
// currentColorとして区間の色(TIER_STYLE)に合わせる。Feather Iconsの
// "bike"パスを使用(MIT License)。
const BIKE_SEGMENT_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"></circle>' +
  '<circle cx="18.5" cy="17.5" r="3.5"></circle><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 17.5V14l-3-3 4-3 2 3h3"></path></svg>';
const ROAD_SEGMENT_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 4 21M15 3l5 18M12 8v2M12 14v2M12 20v1"></path></svg>';
function segmentIcon(tier) {
  return tier <= 6 ? BIKE_SEGMENT_ICON : ROAD_SEGMENT_ICON;
}

// segmentsは合流済み(mergeShortSegments適用後)のものを渡すこと。各<li>に
// data-seg-idxを持たせ、クリックしたときにlastNearbySegments[idx]の座標を
// 地図上でハイライトできるようにする(2026-09-22、Googleマップの経路パネルで
// 各ステップをクリックすると地図上の該当箇所が分かるのを模した)。
function renderSegmentList(segments) {
  const items = segments
    .map((seg, i) => {
      const style = TIER_STYLE[seg.tier] || {};
      const dashClass = style.dashed ? "dashed" : "";
      const color = style.color || "#999";
      return (
        `<li data-seg-idx="${i}">` +
        `<span class="segment-icon" style="color:${color}">${segmentIcon(seg.tier)}</span>` +
        // dashedの場合はCSS側でborder-top: currentColorを使うため、colorも指定する。
        `<span class="legend-swatch ${dashClass}" style="background:${color};color:${color}"></span>` +
        // Googleマップの経路案内ステップのように、道路名称(種別)の下に
        // 所要時間・距離を小さく添える2行構成にする(2026-09-22)。
        `<span class="segment-text">` +
        `<span class="segment-label">${TIER_LABEL_SHORT[seg.tier] || "不明"}</span>` +
        `<span class="segment-meta">${formatDuration(seg.distanceM)}(${(seg.distanceM / 1000).toFixed(2)} km)</span>` +
        `</span></li>`
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

// tier1〜5は色を分けない(NETWORK_COLOR一色)方針にしたため、凡例では代わりに
// 線の太さ(weight)の違いをスウォッチの高さ/破線幅に反映して区別できるようにする
// (2026-09-22、ユーザー方針: 「色は付けないでほしい、灰色で。凡例はうまく表現して」。
// 同日中に灰色→青系に変更したが、色を分けない方針自体は変わっていない)。
function weightToLegendPx(weight) {
  return Math.max(2, Math.round(weight * 2.2));
}

function addLegendRow(el, { color, dashed, px, label }) {
  const row = document.createElement("div");
  row.className = "legend-row";
  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  if (dashed) {
    swatch.classList.add("dashed");
    swatch.style.color = color; // border-top: currentColorで参照する
    swatch.style.borderTopWidth = `${px}px`;
  } else {
    swatch.style.background = color;
    swatch.style.height = `${px}px`;
  }
  row.appendChild(swatch);
  const text = document.createElement("span");
  text.textContent = label;
  row.appendChild(text);
  el.appendChild(row);
}

// 2026-09-22: サイドバー内から地図上の常時表示パネルに移した(ユーザー方針:
// 「凡例はメニューに要らない、地図上に表示して」。位置は最初左下→右上と
// 変更したが、同日中に右上をカテゴリタグ(#category-chips)に譲ったため
// 再度左下に変更した)。合わせて、登録済みサイクリングロード(高速道路風の緑)の
// 凡例も追加した(常時見える場所になったため、緑の意味も説明が要ると判断)。
// 2026-09-23: 「表示オプション(自転車レーン・車道混在の表示切替)に合わせて
// 凡例も変わるようにしてほしい」との指摘を受け、#toggle-referenceが
// オフの間はtier6・7(参考レイヤー)の行を凡例から外すようにした。
// toggle-referenceのchangeイベントからも呼び直す。
// 2026-09-23further追記: 「凡例内の(登録済み)(歩行者非対応)(参考)等の
// 補足カッコ書きは消してほしい、代わりに各項目の簡潔な説明はメニュー内に
// 書いておいてほしい」との指摘を受け、地図上の凡例(ここ)はTIER_STYLE.labelを
// そのまま使わず、カッコ書きを省いた短い名前(LEGEND_LABEL)を使うように
// した。カッコ書きで説明していた内容は、サイドバーの「表示オプション」
// セクション(index.html)にdl要素として書き出した。TIER_STYLE.labelは道路
// クリック時のポップアップ(attachRoadInfoPopups)で引き続き使うため変更しない。
const LEGEND_LABEL = {
  1: "完全専用",
  2: "専用・歩行者と分離",
  3: "専用・歩行者共用",
  4: "専用",
  5: "分離型自転車道",
  6: "自転車専用通行帯・ペイントのみ",
  7: "車道混在・矢羽根等",
};
function buildLegend() {
  const el = document.getElementById("map-legend");
  el.innerHTML = "";
  addLegendRow(el, { color: HIGHWAY_LINE_COLOR, px: 4, label: "サイクリングロード" });
  const showReference = document.getElementById("toggle-reference").checked;
  for (const tier of [1, 2, 3, 4, 5, 6, 7]) {
    if ((tier === 6 || tier === 7) && !showReference) continue;
    const s = TIER_STYLE[tier];
    addLegendRow(el, { color: s.color, dashed: s.dashed, px: weightToLegendPx(s.weight), label: LEGEND_LABEL[tier] });
  }
}

let graph = null;
let fromPoint = null; // {lon, lat, marker}
let toPoint = null;
let cyclewayGeojson = null;
let referenceGeojson = null;
// GPXダウンロード対象の座標・名称。近距離検索(runNearbySearch)・事前計算済み
// 長距離ルート(showPrecomputedRouteInPanel)のどちらも、結果を#directions-panel
// 内の同じ#nearby-result/#btn-gpx-nearbyに表示するようになった(2026-09-22)ため、
// 2つに分かれていたlastNearbyRouteCoords/lastPrecomputedRouteを1組にまとめた。
let lastNearbyRouteCoords = null;
let lastNearbyRouteName = "近距離検索ルート";
// 経路パネルの区間一覧(renderSegmentList)をクリックしたとき、地図上のどの
// 部分に該当するか分かるようにするための、区間ごとの座標(2026-09-22)。
let lastNearbySegments = [];
// 事前計算済み長距離ルートを表示中かどうか(2026-09-22)。表示中に地図クリックや
// 地名検索で新しい出発地・目的地を指定したら、この状態を解除して
// route-resultレイヤー・#route-selectをリセットする(setPoint参照)。
let precomputedRouteActive = false;

const EMPTY_FC = { type: "FeatureCollection", features: [] };

// ---- 高速道路風の名前ラベル(以前はNAVITIMEのE6・C3のような緑の角丸バッジを
// icon-text-fitで作っていたが、名前の長さによって描画が壊れる不具合があったため
// 廃止し、太字+縁取りテキストに変更した。2026-09-22) ----

// MapLibreのline-dasharrayはデータ駆動の式(match/case)に対応していないため
// (定数配列しか指定できない)、破線が必要なtierは別レイヤーに分ける。
// 2026-09-22: OSM由来の区間の長さ(lengthM)から見た目を調整する仕組み
// (短い断片を細く・薄くする)を一度入れたが、「サイクリングロードとして
// 高速道路風に見せるかどうかはOSMの推測に頼らず、data/highway_routes.geojsonへの
// 個別登録だけで決める」というユーザー方針により撤回した。cycleway-line-solid
// (OSM+自治体データ由来、tier1〜4)は元々「高速道路風」に見せる対象ではなく、
// あくまで通常の自転車道整備状況の表示なので、断片の長さで見た目を変える必要は無い。
async function loadCyclewayNetwork() {
  const res = await fetch("data/cycleway_network.geojson");
  cyclewayGeojson = await res.json();
  map.addSource("cycleway", { type: "geojson", data: cyclewayGeojson });
  // 2026-09-22: tier5(分離型自転車道、車道沿いの近似データ)だけ破線+名前
  // ラベルの別レイヤーにしていたが、「名前は要らない、点線にしなくてもいい」
  // との指摘を受けてやめ、他のtierと同じ1枚の実線レイヤーに統合した。
  map.addLayer({
    id: "cycleway-line-solid",
    type: "line",
    source: "cycleway",
    minzoom: CYCLEWAY_EMPHASIS_MIN_ZOOM,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tierMatchExpression("color", NETWORK_COLOR),
      "line-width": tierWidthExpression(1.5),
    },
  });

  buildLegend();
  maybeBuildRoutingGraph();
}

// 高速道路風の縁取り・名前バッジは、OSMのtier/name/長さから推測するのではなく、
// data/highway_routes.geojsonに明示登録された区間だけに適用する(2026-09-22)。
// スキーマ: {"type":"FeatureCollection","features":[{"type":"Feature",
// "properties":{"name":"○○サイクリングロード"},"geometry":{...LineString/
// MultiLineString...}}]}。OSMのway ID等は不要なので、自治体やNAVITIME等の
// 外部データを緯度経度の並びに変換できれば、そのまま登録できる。
// ファイルが存在しない/空でも地図は壊れず、単に強調表示が出ないだけにする。
// 取得したgeojsonはhighwayRoutesGeojsonにも保持しておく。カテゴリタグ
// (#category-chips、2026-09-22)で「サイクリングロード」を選んだ際に、
// 登録済みルート名を検索候補として出すために使う(onCategoryChipClick参照)。
let highwayRoutesGeojson = EMPTY_FC;
async function loadHighwayRoutes() {
  let geojson = EMPTY_FC;
  try {
    const res = await fetch("data/highway_routes.geojson");
    if (res.ok) geojson = await res.json();
  } catch (e) {
    console.warn("highway_routes.geojsonの読み込みに失敗しました", e);
  }
  highwayRoutesGeojson = geojson;
  map.addSource("highway-routes", { type: "geojson", data: geojson });
  // 縁取り(casing、濃い緑)+塗り(中間の緑)を、cycleway-line-solid(青、tier1〜4の
  // 通常表示)より確実に上に重ねて描画する。呼び出し元(attachMapHandlers)で
  // loadCyclewayNetwork()の完了を待ってからこの関数を呼ぶようにしているため、
  // 素のmap.addLayer(常に最前面に追加される)で順序が保証される。
  map.addLayer({
    id: "highway-route-casing",
    type: "line",
    source: "highway-routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": CASING_COLOR,
      "line-width": tierWidthExpression(1.5, 1.45),
      "line-opacity": 1,
    },
  });
  map.addLayer({
    id: "highway-route-line",
    type: "line",
    source: "highway-routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": HIGHWAY_LINE_COLOR,
      "line-width": tierWidthExpression(1.5),
    },
  });
  // 2026-09-21に高速道路のIC/JCT表現を意識した分岐点マーカー
  // (highway-route-junctions、白丸)を導入していたが、2026-09-22の指摘
  // 「交差点の点マーカーは高速道路風(登録済みサイクリングロード)の方だけ
  // 残してほしい」で一度は通常のtier1〜5ネットワーク側から削除してこちらに
  // 限定し、さらに同日中の「白丸は要らない」との指摘で完全に廃止した。
  // 名称は下のhighway-route-badge(ライン沿いに一定間隔で表示するバッジ)
  // だけで十分伝わる。
  map.addLayer({
    id: "highway-route-badge",
    type: "symbol",
    source: "highway-routes",
    minzoom: 11,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 400,
      "text-field": ["get", "name"],
      "text-size": 13,
      "text-font": ["Noto Sans Bold"],
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": CASING_COLOR,
      "text-halo-width": 2.5,
    },
  });
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
    minzoom: CYCLEWAY_EMPHASIS_MIN_ZOOM,
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: { "line-color": TIER_STYLE[6].color, "line-width": TIER_STYLE[6].weight },
  });
  map.addLayer({
    id: "reference-line-dashed",
    type: "line",
    source: "reference",
    filter: ["==", ["get", "tier"], 7],
    minzoom: CYCLEWAY_EMPHASIS_MIN_ZOOM,
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

function maybeBuildRoutingGraph() {
  if (!cyclewayGeojson || !referenceGeojson) return;
  baseCyclewayGraph = CycleGraph.buildGraph(cyclewayGeojson, weightForFeature);
  baseReferenceGraph = CycleGraph.buildGraph(referenceGeojson, weightForFeature);
  rebuildCombinedGraph();
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
  const municipalText = (attr.municipal_sources || []).length
    ? ` 自治体データ出典: ${attr.municipal_sources.join("、")}。`
    : "";
  document.getElementById("attribution-text").textContent =
    `${attr.attribution_text}(${attr.license})。地図タイル: OpenFreeMap © OpenMapTiles, Data from OpenStreetMap。` +
    `専用道路ネットワークは highway=cycleway と cycleway=track系をOverpass APIで抽出(2026-09-20)。` +
    `専用度合いの区分は東京都都市整備局の自転車関連情報マップの考え方を参考にした。${municipalText}`;
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
    if (!select.value) {
      map.getSource("route-result").setData(EMPTY_FC);
      precomputedRouteActive = false;
      return;
    }
    const routeRes = await fetch(`data/${select.value}`);
    const routeGeojson = await routeRes.json();
    const entry = index.routes.find((r) => r.file === select.value);
    showPrecomputedRouteInPanel(routeGeojson, entry);
    // 2026-09-22: #route-select自体はサイドバー内にあり、サイドバーが開いている間は
    // #directions-panelに.dimmed-by-menuが付いてサイドバーの下に隠れる(見た目上
    // 暗くなる)仕様のため、選んでもサイドバーの裏で結果が更新されるだけで
    // ユーザーからは「反映されていない」ように見えていた(実際にはデータは
    // 正しく反映されていた)。選択した時点でサイドバーを閉じ、結果が見える
    // ようにする。
    closeSidebar();
  });
}

// 事前計算済み長距離ルート(#route-select)を選んだときも、近距離検索と同じ
// #directions-panel(出発地・目的地欄+結果表示、#nearby-result/#btn-gpx-nearby)に
// 表示する(2026-09-22、ユーザー要望: 「長距離ルートを選択した時も検索ブロックに
// 経路検索結果が表示されるように、出発地と目的地も入れて」)。近距離検索の
// グラフ探索とは別物なので、fromPoint/toPointの実座標(ルートの両端)を保持する
// だけにとどめ、setPoint()は使わない(setPointは呼ぶと近距離検索を自動で開始
// してしまうため)。経路の線はsearch-result(近距離検索用、青)ではなく既存の
// route-result(赤)に描画し、事前計算ルートであることが見た目でも分かるようにする。
// 2026-09-22追記: 「どこの道路を通るのか各道路を追えるようにしてほしい」という
// 要望を受け、R5側(src/r5_custom_cost/java/PointToPointRouterServer.java)を
// 改修して専用道路/一般道路の区間ごとにFeatureを分けるようにした
// (src/export_web/export_precomputed_route.py参照)。そのためroutGeojsonは
// もう単一のLineString Featureではなく、近距離検索の結果と同じ{tier,distanceM}
// 付きのFeatureCollectionになっており、renderSegmentList/mergeShortSegmentsを
// そのまま再利用できる。
function showPrecomputedRouteInPanel(routeGeojson, entry) {
  if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
  if (toPoint && toPoint.marker) toPoint.marker.remove();
  map.getSource("search-result").setData(EMPTY_FC);
  map.getSource("search-result-junctions").setData(EMPTY_FC);
  map.getSource("search-result-highlight").setData(EMPTY_FC);

  const segments = routeGeojson.features.map((f) => ({
    tier: f.properties.tier,
    distanceM: f.properties.distanceM,
    coords: f.geometry.coordinates,
  }));
  const allCoords = segments.flatMap((seg) => seg.coords);
  const [fromLon, fromLat] = allCoords[0];
  const [toLon, toLat] = allCoords[allCoords.length - 1];
  const fromMarker = new maplibregl.Marker({ element: makePinElement("from") }).setLngLat([fromLon, fromLat]).addTo(map);
  const toMarker = new maplibregl.Marker({ element: makePinElement("to"), anchor: "bottom" }).setLngLat([toLon, toLat]).addTo(
    map
  );
  fromPoint = { lon: fromLon, lat: fromLat, marker: fromMarker };
  toPoint = { lon: toLon, lat: toLat, marker: toMarker };

  document.getElementById("search-from").value = (entry && entry.from_name) || "出発地";
  document.getElementById("search-to").value = (entry && entry.to_name) || (entry && entry.name) || "目的地";
  revealOriginRow();

  map.getSource("route-result").setData(routeGeojson);
  precomputedRouteActive = true;

  const resultDiv = document.getElementById("nearby-result");
  const gpxBtn = document.getElementById("btn-gpx-nearby");
  resultDiv.classList.remove("hidden");
  const segmentTotalM = segments.reduce((sum, seg) => sum + seg.distanceM, 0);
  const lengthKm = entry ? entry.length_km : segmentTotalM / 1000;
  const distanceM = lengthKm * 1000;
  const cyclewayShare = entry ? entry.cycleway_share : 0;
  resultDiv.innerHTML =
    `<div class="route-summary">` +
    `<span class="route-summary-time">${formatDuration(distanceM)}</span>` +
    `<span class="route-summary-distance">(${lengthKm.toFixed(2)} km)</span>` +
    `</div>` +
    renderSegmentList(segments) +
    `<div class="hint">事前計算済みの長距離ルートです(専用道路上 ${Math.round(cyclewayShare * 100)}%)。開発コンテナ内でR5(専用道路優先のカスタムコスト付き)を使ってあらかじめ計算しています。</div>`;
  lastNearbySegments = segments;
  lastNearbyRouteCoords = allCoords;
  lastNearbyRouteName = (entry && entry.name) || "長距離ルート";
  // GPXダウンロードボタンは2026-09-23時点で一時非表示(ユーザー方針)。
  // gpxBtn.classList.remove("hidden");

  fitRouteBounds(allCoords);
}

// 2026-09-22: 「① 地図で出発地を指定」のような明示ボタンをやめ、Googleマップ
// 同様に「目的地が無ければ目的地、あれば出発地」を自動的に地図クリックの対象に
// する。両方揃っていればクリックしても何もしない(入れ替え・クリアで
// やり直してもらう)。
function nextPickKind() {
  if (!toPoint) return "to";
  if (!fromPoint) return "from";
  return null;
}

// カテゴリタグ(#category-chips)は、画面が広い(デスクトップ相当)時は検索
// ブロック(#directions-panel)の右横に、画面が狭い(スマホ相当)時はその直下に
// 来るようにする(2026-09-22、ユーザー要望: 「画面右上ではなく検索ブロックの
// 右横に。画面が小さくなる時は検索ブロックの下に来る仕様は残して」。以前は
// デスクトップ時は画面右上に固定していた)。#directions-panelは検索候補・
// 結果表示で高さ・幅が動的に変わるため、固定pxではなくgetBoundingClientRect()を
// 都度読んで追従させる(呼び出し元: リサイズ時・パネルのResizeObserver)。
// 2026-09-22追記: 「右横の上下位置は検索ブロックのちょうど真ん中に」との
// 指摘を受け、右横表示時はパネルの高さの中央にチップ自体の高さの半分を
// 引いた位置に合わせるようにした。
// 2026-09-23追記: 「検索候補・検索結果が表示されると一緒に動いてしまうのは
// ダメ、最初の検索ブロックの真ん中に固定されているように」との指摘を受け、
// 中央揃えの基準を#directions-panel(検索候補・結果表示を含む、伸び縮みする)
// から#directions-toprowに変更したが、それでも出発地の行が現れて
// directions-modeに入るとtoprow自体の高さが変わってしまい、チップが動くと
// 再度指摘を受けた。「一切動かないように」との要望のため、toprowの高さでは
// なく、常に36px・常にtoprowの上端に張り付いている#btn-directions-mode
// (経路検索ボタン。menu-toggleと違いサイドバー開閉で非表示になることも無い)
// 自身の矩形を基準にする。これなら出発地の行の有無・検索候補や結果表示の
// 有無のどちらにも一切影響されない。左右位置(パネルの右横)は従来通り
// パネル自体の右端を基準にする(パネルの横幅は変わらないため問題ない)。
function updateCategoryChipsPosition() {
  const panel = document.getElementById("directions-panel");
  const anchor = document.getElementById("btn-directions-mode");
  const chips = document.getElementById("category-chips");
  const panelRect = panel.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const beside = window.innerWidth > 768;
  chips.classList.remove("hidden");
  if (beside) {
    const chipsHeight = chips.getBoundingClientRect().height;
    chips.style.top = `${anchorRect.top + anchorRect.height / 2 - chipsHeight / 2}px`;
    chips.style.left = `${panelRect.right + 8}px`;
  } else {
    chips.style.top = `${panelRect.bottom + 8}px`;
    chips.style.left = `${panelRect.left}px`;
  }
  chips.style.right = "auto";
  chips.style.justifyContent = "flex-start";
}
new ResizeObserver(() => updateCategoryChipsPosition()).observe(document.getElementById("directions-panel"));

// Googleマップ風のメニュー開閉(2026-09-22)。開いている間は「☰」ボタンを消して
// パネル右上に「×」を出し、背景の地図を薄暗くする(#sidebar-backdrop)。
// 2026-09-22追記: 以前はメニューが開くと#directions-panel(検索バー)を
// サイドバーの右隣に押しやったり、モバイル幅では隠したりしていたが、
// 「検索バーが移動する必要はなく、右のカテゴリタグ(#category-chips)も
// あわせて全部地図と同じように暗く表示されるだけでいい」との指摘を受け、
// 位置操作をやめて.dimmed-by-menuクラスを付け外すだけにした(CSSでz-indexを
// #sidebar-backdropより下げ、地図と同じく覆われて暗くなる・クリックできなく
// なるようにする。style.css参照)。
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("menu-toggle").style.display = "none";
  document.getElementById("sidebar-close").style.display = "block";
  document.getElementById("sidebar-backdrop").classList.add("visible");
  document.getElementById("directions-panel").classList.add("dimmed-by-menu");
  document.getElementById("category-chips").classList.add("dimmed-by-menu");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("menu-toggle").style.display = "";
  document.getElementById("sidebar-close").style.display = "none";
  document.getElementById("sidebar-backdrop").classList.remove("visible");
  document.getElementById("directions-panel").classList.remove("dimmed-by-menu");
  document.getElementById("category-chips").classList.remove("dimmed-by-menu");
}
function toggleSidebar() {
  if (document.getElementById("sidebar").classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

// 2026-09-22: 色付き丸の中に「出」「着」と日本語を表示する方式をやめ、
// Googleマップ同様に出発地=シンプルな丸、目的地=先端がとがったピン、に
// 変更した(ユーザー指摘: 「色のついた丸に日本語で出・目と表示するのは
// やめてください」)。ピンは先端が実際の地点を指すようにanchor:"bottom"を
// 使う(呼び出し側のnew maplibregl.Markerで指定する)。
function makePinElement(kind) {
  const el = document.createElement("div");
  el.className = kind === "from" ? "pin-from" : "pin-to";
  if (kind !== "from") {
    // pin-to(水滴型ピン)は円の頭(.pin-to-head)と下向きの先端(.pin-to-point)を
    // 別要素として重ねて作る(style.css参照、2026-09-23)。
    const head = document.createElement("div");
    head.className = "pin-to-head";
    const point = document.createElement("div");
    point.className = "pin-to-point";
    el.appendChild(head);
    el.appendChild(point);
  }
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
    `&countrycodes=jp&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  return res.json();
}

// 検索候補・選択確定後の入力欄には、Googleマップのように「名称、住所」の形式で
// 表示する(2026-09-22、以前は display_name の先頭要素だけ(名称のみ)を入れて
// いたが、「確定したら名称と住所が入っている状態にしてほしい」との指摘で変更)。
// Nominatimのaddressdetails(構造化フィールド)から、日本の住所らしい並び
// (都道府県→市区町村→町域→丁目、郵便番号は先頭に〒付き)を組み立てる。
function formatPlaceLabel(r) {
  const addr = r.address || {};
  const name = r.name || r.display_name.split(",")[0];
  // suburb/quarter/neighbourhoodは同じ地域を異なる粒度で指すことが多く、
  // 全部並べると「北千束北千束一丁目」のように重複するため、最も詳細な
  // 1つだけを使う。
  const locality = addr.neighbourhood || addr.quarter || addr.suburb;
  const localityParts = [addr.state, addr.city || addr.town || addr.village || addr.county, locality, addr.road].filter(
    (part) => part && part !== name
  );
  const addressLine = (addr.postcode ? `〒${addr.postcode} ` : "") + localityParts.join("");
  return addressLine ? `${name}、${addressLine}` : r.display_name;
}

// 地図クリックで出発地・目的地を指定した場合も、地名検索で選んだときと同じく
// 入力欄に名称・住所を表示する(2026-09-22、ユーザー指摘: 「地図をクリックして
// 選んだ際にも、ちゃんと検索ボックスには名称と住所が入るように」)。Nominatimの
// 逆ジオコーディングを使う(APIキー不要、地名検索と同じ利用規約に従う)。
async function reverseGeocode(lon, lat) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ja` +
    `&addressdetails=1&lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return formatPlaceLabel(data);
}

// 2026-09-22: 「検索候補の左端を、検索を入力する部分の左端と揃えてほしい」との
// 指摘を受け追加。検索候補(.search-results)はパネル全幅の兄弟要素(区切り線を
// 全幅にするための構成、上記参照)なので、その分入力欄(アイコン+gapの分だけ
// 右にずれている)とは元々左端が揃わない。実測して差分をpadding-leftとして
// 与えることで、行間の余白(メニュー開閉によるインセットの変化・目的地欄の
// アイコン表示/非表示の変化のどちらにも自動対応する)。
// 2026-09-23追記: 「左側が寂しいので、文字列の左に何かしらのアイコンを」との
// 指摘を受け、候補の左に地図ピンアイコン(.search-result-icon、liの中で
// position:absoluteでテキストより左のpadding-left領域に描画する)を追加した。
// このアイコンがはみ出さないよう、padding-leftの下限をSEARCH_RESULT_ICON_GUTTER
// で確保する(この値を下回る狭いインセットの場合のみ、文字列側が数px右に
// ずれてアイコン分の余白を優先する)。
const SEARCH_RESULT_ICON_GUTTER = 26;
function alignSearchResultsToInput(kind) {
  const ul = document.getElementById(`search-${kind}-results`);
  const input = document.getElementById(`search-${kind}`);
  const ulRect = ul.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  const inputTextInset = parseFloat(getComputedStyle(input).paddingLeft) || 0;
  const inset = Math.max(0, inputRect.left - ulRect.left + inputTextInset);
  ul.style.paddingLeft = `${Math.max(SEARCH_RESULT_ICON_GUTTER, inset)}px`;
}

// 地図ピンのアイコン(Feather Iconsの"map-pin"、MIT License)。地名検索候補
// (renderSearchResults)で使う。カテゴリ候補(renderCategorySuggestions、
// 現状は登録済みサイクリングロードのみ)は道路なのでBIKE_SEGMENT_ICONを流用する。
const SEARCH_RESULT_PIN_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
  '<circle cx="12" cy="10" r="3"></circle></svg>';

// 出発地候補の「現在地」用アイコン(現在地に戻るボタンのLOCATE_ICON_SVGと
// 同じクロスヘア型だが、他の候補アイコンと大きさを揃えるため14pxにする)。
const SEARCH_CURRENT_LOCATION_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>';

function renderSearchResults(kind, results) {
  const ul = document.getElementById(`search-${kind}-results`);
  ul.innerHTML = "";
  if (!results.length) {
    ul.innerHTML = '<li class="hint">見つかりませんでした</li>';
    ul.classList.remove("hidden");
    alignSearchResultsToInput(kind);
    return;
  }
  for (const r of results) {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="search-result-icon">${SEARCH_RESULT_PIN_ICON}</span>` +
      `<span class="search-result-text"></span>`;
    li.querySelector(".search-result-text").textContent = formatPlaceLabel(r);
    li.addEventListener("click", () => {
      const lon = parseFloat(r.lon);
      const lat = parseFloat(r.lat);
      setPoint(kind, lon, lat, formatPlaceLabel(r));
      ul.classList.add("hidden");
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14) });
    });
    ul.appendChild(li);
  }
  ul.classList.remove("hidden");
  alignSearchResultsToInput(kind);
}

const searchRequestSeq = { from: 0, to: 0 };

async function handleSearch(kind) {
  const input = document.getElementById(`search-${kind}`);
  const query = input.value.trim();
  const ul = document.getElementById(`search-${kind}-results`);
  if (query.length < 2) {
    // 出発地欄を打ってから消して空に戻した場合も、フォーカス時と同じく
    // 「現在地」候補を出し直す(2026-09-23)。
    if (kind === "from" && query.length === 0) {
      renderCurrentLocationSuggestion();
    } else {
      ul.classList.add("hidden");
    }
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

// 出発地・目的地の入力欄をユーザーが直接編集した(選び直そうとしている)場合、
// 対応する地点と古い経路検索結果を無効化する(2026-09-23、ユーザー指摘:
// 「目的地を削除しても前の経路検索結果が表示されたままになる」)。setPointが
// input.valueに直接代入する場合(地図クリック・候補選択・逆ジオコーディング等)は
// "input"イベントが発火しないため、ここは実際にユーザーがキー入力した場合にのみ
// 反応する。
function clearRouteResultDisplay() {
  map.getSource("search-result").setData(EMPTY_FC);
  map.getSource("search-result-junctions").setData(EMPTY_FC);
  map.getSource("search-result-highlight").setData(EMPTY_FC);
  lastNearbyRouteCoords = null;
  lastNearbySegments = [];
  document.getElementById("nearby-result").classList.add("hidden");
  document.getElementById("nearby-result").textContent = "";
  document.getElementById("btn-gpx-nearby").classList.add("hidden");
  if (precomputedRouteActive) {
    precomputedRouteActive = false;
    map.getSource("route-result").setData(EMPTY_FC);
    document.getElementById("route-select").value = "";
  }
}

function invalidatePointOnEdit(kind) {
  const point = kind === "from" ? fromPoint : toPoint;
  if (!point) return;
  if (point.marker) point.marker.remove();
  if (kind === "from") {
    fromPoint = null;
  } else {
    toPoint = null;
  }
  clearRouteResultDisplay();
}

document.getElementById("search-from").addEventListener("input", () => {
  invalidatePointOnEdit("from");
  scheduleSearch("from");
});
document.getElementById("search-to").addEventListener("input", () => {
  invalidatePointOnEdit("to");
  scheduleSearch("to");
});
document.getElementById("search-from").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSearch("from");
});
document.getElementById("search-to").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSearch("to");
});

// カテゴリタグ(#category-chips、Googleマップのレストラン・ホテル等のタグを
// 模したもの)で選んだ状態は、ユーザーが検索欄を手動で書き換えたら見た目上も
// 解除する(2026-09-22)。
function clearCategoryChipsActive() {
  document.querySelectorAll(".category-chip.active").forEach((btn) => btn.classList.remove("active"));
}
document.getElementById("search-from").addEventListener("input", clearCategoryChipsActive);
document.getElementById("search-to").addEventListener("input", clearCategoryChipsActive);

// カテゴリタグ「サイクリングロード」用: 通常のNominatim検索ではなく、
// data/highway_routes.geojsonに登録済みのルート名を検索候補として出す
// (2026-09-22、ユーザー要望: 「検索候補にはサイクリングロードが出てくる
// ようなイメージ」)。setPointは1点しか扱えないため、選んだルートのだいたい
// 中間の座標を出発地/目的地として使いつつ、地図はルート全体が見えるよう
// fitBoundsする。
function highwayRouteAllCoords(feature) {
  const geom = feature.geometry;
  if (geom.type === "LineString") return geom.coordinates;
  if (geom.type === "MultiLineString") return geom.coordinates.flat();
  return [];
}

function renderCategorySuggestions(kind, category) {
  const ul = document.getElementById(`search-${kind}-results`);
  ul.innerHTML = "";
  const features = category === "cycling-road" ? highwayRoutesGeojson.features || [] : [];
  if (!features.length) {
    ul.innerHTML = '<li class="hint">登録済みのサイクリングロードが見つかりませんでした</li>';
    ul.classList.remove("hidden");
    alignSearchResultsToInput(kind);
    return;
  }
  for (const feature of features) {
    const coords = highwayRouteAllCoords(feature);
    if (!coords.length) continue;
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="search-result-icon">${BIKE_SEGMENT_ICON}</span>` +
      `<span class="search-result-text"></span>`;
    li.querySelector(".search-result-text").textContent = feature.properties.name || "(名称未設定)";
    li.addEventListener("click", () => {
      const [lon, lat] = coords[Math.floor(coords.length / 2)];
      setPoint(kind, lon, lat, feature.properties.name);
      clearCategoryChipsActive();
      ul.classList.add("hidden");
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 60, maxZoom: 15 }
      );
    });
    ul.appendChild(li);
  }
  ul.classList.remove("hidden");
  alignSearchResultsToInput(kind);
}

// カテゴリタグをクリックすると、目的地が未指定なら目的地欄、目的地は決まって
// いて出発地が未指定なら出発地欄(nextPickKindと同じ判定基準)に、そのカテゴリ
// 名を自動入力し、該当する候補を並べる(2026-09-22、Googleマップで「レストラン」
// 等をタップすると検索欄に入り候補が並ぶ挙動を模した)。両方決まっている場合は
// 目的地欄を上書きする(地図クリックが無効になるのと同じ理由で、これ以上
// 自動で決める先が無いため)。
// 2026-09-23: 「タグを一回押すとずっと押されたままになり、検索候補も残り
// 続ける。サイクリングロードが選択されるかどうかに関わらず、もう一度タグを
// 押したら検索ブロックも元に戻るようにしてほしい」との指摘を受け、トグル式に
// した。有効化した際にどちらの欄(出発地/目的地)に自動入力したかを
// button.dataset.pickKindに記録しておき、もう一度押されたら、その欄が
// まだチップ由来の文字列のままなら空欄に戻し、候補一覧も閉じる(ユーザーが
// その後に手で書き換えていた場合は上書きしない)。
function onCategoryChipClick(button) {
  const category = button.dataset.category;
  const label = button.dataset.label;
  if (button.classList.contains("active")) {
    const kind = button.dataset.pickKind;
    button.classList.remove("active");
    delete button.dataset.pickKind;
    if (kind) {
      const input = document.getElementById(`search-${kind}`);
      if (input.value === label) input.value = "";
      document.getElementById(`search-${kind}-results`).classList.add("hidden");
    }
    return;
  }
  const kind = nextPickKind() || "to";
  clearCategoryChipsActive();
  button.classList.add("active");
  button.dataset.pickKind = kind;
  document.getElementById(`search-${kind}`).value = label;
  renderCategorySuggestions(kind, category);
}

document.querySelectorAll(".category-chip").forEach((btn) => {
  btn.addEventListener("click", () => onCategoryChipClick(btn));
});

document.getElementById("menu-toggle").addEventListener("click", toggleSidebar);
document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
document.getElementById("sidebar-backdrop").addEventListener("click", closeSidebar);
window.addEventListener("resize", updateCategoryChipsPosition);

// 「経路検索」ボタン(2026-09-22新設、同日中にトグル式へ変更)。押すと検索欄が
// フラット→枠+グレー背景に切り替わり、出発地の行もすぐ表示される
// (revealOriginRowが両方まとめて行う)。既に経路検索モード中にもう一度押すと、
// 今度は逆に全て初期状態(idle・入力内容も空)に戻す。以前は専用の×ボタン
// (#directions-clear)で「戻る」を担っていたが、「×ボタンを廃止して、経路検索
// アイコンをもう一度押すと戻る形に」との指摘を受けて統合した。
document.getElementById("btn-directions-mode").addEventListener("click", () => {
  const panel = document.getElementById("directions-panel");
  if (!panel.classList.contains("directions-mode")) {
    revealOriginRow();
    return;
  }
  if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
  if (toPoint && toPoint.marker) toPoint.marker.remove();
  fromPoint = null;
  toPoint = null;
  lastNearbyRouteCoords = null;
  lastNearbySegments = [];
  map.getSource("search-result").setData(EMPTY_FC);
  map.getSource("search-result-junctions").setData(EMPTY_FC);
  map.getSource("search-result-highlight").setData(EMPTY_FC);
  // 事前計算済み長距離ルートを表示中だった場合は、そちらもリセットする
  // (2026-09-22、近距離検索・長距離ルートを同じパネルで表示するようになったため)。
  if (precomputedRouteActive) {
    precomputedRouteActive = false;
    map.getSource("route-result").setData(EMPTY_FC);
    document.getElementById("route-select").value = "";
  }
  document.getElementById("search-from").value = "";
  document.getElementById("search-to").value = "";
  document.getElementById("nearby-result").classList.add("hidden");
  document.getElementById("nearby-result").textContent = "";
  document.getElementById("btn-gpx-nearby").classList.add("hidden");
  document.getElementById("from-row").classList.add("hidden");
  document.getElementById("btn-swap-points").classList.add("hidden");
  // 経路検索モードの見た目(枠+グレー背景)も解除し、フラットなidle状態に戻す。
  panel.classList.remove("directions-mode");
  document.getElementById("btn-directions-mode").classList.remove("active");
  clearCategoryChipsActive();
});

// 出発地・目的地(座標・マーカー・入力欄の文字)を入れ替える。入力欄の文字は
// 事前に読んでおいたものをそのままsetPointに渡す(setPointに任せると、
// 既に分かっている名称・住所があるのに逆ジオコーディングをやり直してしまうため)。
document.getElementById("btn-swap-points").addEventListener("click", () => {
  if (!fromPoint && !toPoint) return;
  const oldFrom = fromPoint;
  const oldTo = toPoint;
  const oldFromLabel = document.getElementById("search-from").value;
  const oldToLabel = document.getElementById("search-to").value;
  if (oldFrom && oldFrom.marker) oldFrom.marker.remove();
  if (oldTo && oldTo.marker) oldTo.marker.remove();
  fromPoint = null;
  toPoint = null;
  if (oldTo) setPoint("from", oldTo.lon, oldTo.lat, oldToLabel);
  if (oldFrom) setPoint("to", oldFrom.lon, oldFrom.lat, oldFromLabel);
});

document.getElementById("toggle-reference").addEventListener("change", (e) => {
  const visibility = e.target.checked ? "visible" : "none";
  map.setLayoutProperty("reference-line-solid", "visibility", visibility);
  map.setLayoutProperty("reference-line-dashed", "visibility", visibility);
  buildLegend();
});

// 近距離検索・事前計算済み長距離ルートのどちらも同じ#directions-panel内に
// 表示するようになった(2026-09-22)ため、GPXダウンロードボタンも1つに統一した
// (lastNearbyRouteCoords/lastNearbyRouteNameはどちらの結果が最後に表示された
// かに応じて更新される。runNearbySearch/showPrecomputedRouteInPanel参照)。
document.getElementById("btn-gpx-nearby").addEventListener("click", () => {
  if (lastNearbyRouteCoords) {
    downloadGpx(lastNearbyRouteCoords, lastNearbyRouteName, `cycleway-route-${lastNearbyRouteName}.gpx`);
  }
});

// 経路(座標配列)が確実に地図上で見えるよう、その範囲にズーム・パンする。
// 近距離検索の結果は#directions-panel(常時表示)に出るので、隠れる左上分の
// 余白(padding)を常に確保しておく(2026-09-22、以前はサイドバー基準だったが、
// 近距離検索結果はもうサイドバーを自動で開かなくなったため変更した)。
function fitRouteBounds(coords) {
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const leftPadding = document.getElementById("directions-panel").offsetWidth + 40;
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: { top: 40, right: 40, bottom: 40, left: leftPadding }, maxZoom: 17 }
  );
}

// 区間一覧(#nearby-result内、renderSegmentListが作るli)をクリックしたとき、
// 地図上のその区間をオレンジで強調しつつその範囲にズーム・パンする
// (2026-09-22、Googleマップの経路案内ステップをクリックすると地図上のその
// 場所が分かる挙動を模した)。#nearby-resultはrunNearbySearchのたびに
// innerHTMLごと差し替わるので、要素ごとにリスナーを付け直すのではなく
// イベント委譲(常設の1つのリスナー)で対応する。
// 2026-09-23追記: 「その道路が強調されている間は、どの道路をクリックしたのか
// わかるように」との指摘を受け、クリックしたliに.selectedを付ける(他のliからは
// 外す)。地図上のオレンジ強調(search-result-highlight)と対応関係が視覚的に
// わかるようにする。
document.getElementById("nearby-result").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-seg-idx]");
  if (!li) return;
  const seg = lastNearbySegments[Number(li.dataset.segIdx)];
  if (!seg) return;
  document.querySelectorAll(".segment-list li.selected").forEach((el) => el.classList.remove("selected"));
  li.classList.add("selected");
  map.getSource("search-result-highlight").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: seg.coords } }],
  });
  fitRouteBounds(seg.coords);
});

async function runNearbySearch() {
  const resultDiv = document.getElementById("nearby-result");
  const gpxBtn = document.getElementById("btn-gpx-nearby");
  gpxBtn.classList.add("hidden");
  resultDiv.classList.remove("hidden");
  resultDiv.innerHTML = '<span class="hint">周辺の道路データを読み込み中...</span>';
  lastNearbySegments = [];
  map.getSource("search-result-highlight").setData(EMPTY_FC);

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
    map.getSource("search-result-junctions").setData(EMPTY_FC);
    lastNearbyRouteCoords = null;
    resultDiv.innerHTML =
      '<span class="ng">専用道路・自転車レーン・一般道をすべて使っても繋がっていません。長距離ルートの事前計算リストを確認してください。</span>';
    return;
  }

  const coords = result.path.map((idx) => graph.nodeCoords[idx]);
  // 一般道路・専用道路等が切り替わる区間ごとにフィーチャを分ける(色は
  // 全区間同じ青のまま。クリックしたときに区間種別・距離をポップアップ表示
  // できるようにするため)。短い断片(MIN_SEGMENT_M未満)は前の区間にまとめる
  // (テキストのセグメント一覧と同じ基準)。
  const mergedSegments = mergeShortSegments(result.segments);
  const lineFeatures = [];
  const junctionFeatures = [];
  mergedSegments.forEach((seg, i) => {
    const segCoords = result.path.slice(seg.fromIdx, seg.toIdx + 1).map((idx) => graph.nodeCoords[idx]);
    lineFeatures.push({
      type: "Feature",
      properties: { tier: seg.tier, distanceM: Math.round(seg.distanceM) },
      geometry: { type: "LineString", coordinates: segCoords },
    });
    if (i < mergedSegments.length - 1) {
      // 高速道路のJCT表現を意識した、区間の切り替わり地点の白丸(2026-09-22)。
      junctionFeatures.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: segCoords[segCoords.length - 1] },
      });
    }
  });
  map.getSource("search-result").setData({ type: "FeatureCollection", features: lineFeatures });
  map.getSource("search-result-junctions").setData({ type: "FeatureCollection", features: junctionFeatures });
  fitRouteBounds(coords);
  lastNearbyRouteCoords = coords;
  lastNearbyRouteName = "近距離検索ルート";
  // 区間一覧(下でrenderSegmentListが作るli)をクリックしたときに地図上へ
  // ハイライトできるよう、区間ごとの座標をlineFeaturesと同じ順序で保持しておく。
  lastNearbySegments = mergedSegments.map((seg, i) => ({
    tier: seg.tier,
    distanceM: seg.distanceM,
    coords: lineFeatures[i].geometry.coordinates,
  }));
  // GPXダウンロードボタンは2026-09-23時点で一時非表示(ユーザー方針)。
  // gpxBtn.classList.remove("hidden");
  const accessM = Math.round(nearFrom.distanceM + nearTo.distanceM);

  const cappedNote = capped
    ? '<div class="hint">(出発地・目的地が離れているため、周辺の一般道データのみを使用しました)</div>'
    : "";
  // Googleマップの経路パネル(所要時間を大きく・距離をその横に小さく)を模した
  // 見出しをまず表示し、その下にルート(区間内訳)を表示する(2026-09-22、
  // ユーザー指摘: 「所要時間と所要距離の表示を大きめに初めに置いて、その下に
  // ルートが表示されるように」)。
  resultDiv.innerHTML =
    `<div class="route-summary">` +
    `<span class="route-summary-time">${formatDuration(result.distanceM)}</span>` +
    `<span class="route-summary-distance">(${(result.distanceM / 1000).toFixed(2)} km)</span>` +
    `</div>` +
    renderSegmentList(mergedSegments) +
    `<div class="hint">出発地・目的地から最寄りのネットワークまで、合計約 ${accessM} m の徒歩/一般道アクセスが別途必要です</div>` +
    cappedNote;
}

// 出発地・目的地・入れ替えボタンの表示/非表示をまとめる(2026-09-22)。
// 最初は目的地の行だけを見せ、目的地が決まったら出発地の行を出す、という
// Googleマップ風の段階的な見せ方にする。
// 2026-09-22追記: 経路検索モード(#btn-directions-mode)にも入れる。検索欄が
// 枠・背景無しのフラットな見た目(idle状態)から、枠+グレー背景の見た目に
// 切り替わる(CSS側の#directions-panel.directions-mode参照)。目的地が
// 決まった時点(setPoint内から呼ばれる)でも、明示的にボタンを押した時点
// (#btn-directions-modeのクリックハンドラ)でも、どちらでもこの関数を通る。
function revealOriginRow() {
  document.getElementById("from-row").classList.remove("hidden");
  document.getElementById("btn-swap-points").classList.remove("hidden");
  document.getElementById("directions-panel").classList.add("directions-mode");
  document.getElementById("btn-directions-mode").classList.add("active");
  // 現在地から自動セットされている場合は、それが分かるように表示する
  // (実際の緯度経度ではなく"現在地"というラベルにする)。
  if (fromPoint && fromPoint.isCurrentLocation) {
    document.getElementById("search-from").value = "現在地";
  }
}

// 逆ジオコーディングの結果が古い指定を上書きしないようにする(2026-09-22、
// searchRequestSeqと同じ考え方)。
const reverseGeocodeSeq = { from: 0, to: 0 };

// 出発地・目的地の座標をセットする共通処理(地図クリック・地名検索の両方から呼ぶ)。
// labelを渡した場合(地名検索・入れ替えで既に文字列が分かっている場合)はそれを
// そのまま入力欄に使う。省略した場合(主に地図クリック)は逆ジオコーディングで
// 名称・住所を取得して入力欄を埋める(2026-09-22)。
function setPoint(kind, lon, lat, label) {
  // 事前計算済み長距離ルートを表示中に、地図クリック・地名検索・カテゴリタグ等で
  // 新しい出発地・目的地を指定したら、その表示を解除する(2026-09-22)。
  // route-select自体は変更イベントを発火させないよう直接valueを操作する。
  if (precomputedRouteActive) {
    precomputedRouteActive = false;
    map.getSource("route-result").setData(EMPTY_FC);
    document.getElementById("route-select").value = "";
  }
  // pin-to(水滴型ピン)は先端が実際の地点を指すようanchor:"bottom"にする。
  // pin-from(丸)は左右対称なのでデフォルトのcenterのままでよい。
  const marker = new maplibregl.Marker({ element: makePinElement(kind), anchor: kind === "to" ? "bottom" : "center" })
    .setLngLat([lon, lat])
    .addTo(map);
  if (kind === "from") {
    if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
    fromPoint = { lon, lat, marker };
  } else {
    if (toPoint && toPoint.marker) toPoint.marker.remove();
    toPoint = { lon, lat, marker };
    revealOriginRow(); // 目的地が決まったら出発地の入力へ自動的に移行する
  }
  if (fromPoint && toPoint) {
    runNearbySearch();
  }

  const input = document.getElementById(`search-${kind}`);
  const seq = ++reverseGeocodeSeq[kind];
  if (label) {
    input.value = label;
    return;
  }
  input.value = "住所を取得中...";
  reverseGeocode(lon, lat)
    .then((resolvedLabel) => {
      if (seq !== reverseGeocodeSeq[kind]) return; // 取得中に次の指定があれば古い結果は捨てる
      input.value = resolvedLabel;
    })
    .catch(() => {
      if (seq !== reverseGeocodeSeq[kind]) return;
      input.value = "";
    });
}

// Googleマップ同様、現在地を取得できれば出発地として自動的に使う(2026-09-22)。
// 「地図上部の検索バーで目的地を選ぶと、現在地からのルートを勝手に検索できる
// はず」というユーザー方針に対応。許可されない・取得できない場合は黙って諦め、
// 従来通り「①地図で出発地を指定」や出発地検索で手動指定してもらう。
// 現在地マーカーはpin-from(緑の丸に「出」)ではなく、Googleマップの青い点を
// 模した.current-location-dotにする。
// 2026-09-23: 出発地の検索候補(#search-from-results)から手動で「現在地」を
// 選んだ場合(useCurrentLocationAsOrigin)と、ページ読み込み時に自動で試す
// 場合(tryUseCurrentLocationAsOrigin)の両方から使う共通処理として切り出した。
function placeCurrentLocationAsOrigin(lon, lat, { showInInput } = {}) {
  if (precomputedRouteActive) {
    precomputedRouteActive = false;
    map.getSource("route-result").setData(EMPTY_FC);
    document.getElementById("route-select").value = "";
  }
  if (fromPoint && fromPoint.marker) fromPoint.marker.remove();
  const el = document.createElement("div");
  el.className = "current-location-dot";
  const marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  fromPoint = { lon, lat, marker, isCurrentLocation: true };
  if (showInInput) document.getElementById("search-from").value = "現在地";
  if (toPoint) runNearbySearch();
}

function tryUseCurrentLocationAsOrigin() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (fromPoint) return; // 既に出発地が指定されていれば上書きしない
      // 目的地が既に決まっていて出発地の行が表示済みなら、入力欄にも
      // "現在地"と表示する(まだなら、目的地が決まった時点でrevealOriginRowが行う)。
      const showInInput = !document.getElementById("from-row").classList.contains("hidden");
      placeCurrentLocationAsOrigin(pos.coords.longitude, pos.coords.latitude, { showInInput });
    },
    (err) => {
      console.warn("現在地を取得できませんでした(許可されていない可能性があります)", err);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

// 2026-09-23: 「目的地を選択し終えた後、出発地を入力する場面で、Googleマップの
// ように現在地が候補として選べるように」との指摘を受け追加。出発地欄
// (#search-from)が空の状態でフォーカスされたとき、候補一覧に「現在地」を
// 1件だけ表示する(renderCurrentLocationSuggestion、下記のfocusイベントと
// handleSearchの空文字分岐から呼ぶ)。選ぶとその場で位置情報を取得する
// (ページ読み込み時の自動取得とは別に、明示的に選んだ時点の最新位置を使う
// ため、maximumAgeを0にして毎回取り直す)。
function useCurrentLocationAsOrigin() {
  if (!navigator.geolocation) return;
  document.getElementById("search-from").value = "現在地を取得中...";
  document.getElementById("search-from-results").classList.add("hidden");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      placeCurrentLocationAsOrigin(pos.coords.longitude, pos.coords.latitude, { showInInput: true });
    },
    (err) => {
      console.warn("現在地を取得できませんでした(許可されていない可能性があります)", err);
      document.getElementById("search-from").value = "";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
  );
}

function renderCurrentLocationSuggestion() {
  if (!navigator.geolocation) return;
  const ul = document.getElementById("search-from-results");
  ul.innerHTML = "";
  const li = document.createElement("li");
  li.innerHTML =
    `<span class="search-result-icon">${SEARCH_CURRENT_LOCATION_ICON}</span>` +
    `<span class="search-result-text">現在地</span>`;
  li.addEventListener("click", useCurrentLocationAsOrigin);
  ul.appendChild(li);
  ul.classList.remove("hidden");
  alignSearchResultsToInput("from");
}
document.getElementById("search-from").addEventListener("focus", () => {
  if (document.getElementById("search-from").value.trim()) return;
  renderCurrentLocationSuggestion();
});

// 現在地に戻る(地図を現在地へ再センタリングする)ボタン(2026-09-22、
// ユーザー指摘: 「現在地に戻れるボタンを右下のズームの上あたりに」)。
// 出発地・目的地の指定(fromPoint/toPoint)とは無関係な、地図ナビゲーション用の
// 機能として独立させる(クリックしても経路検索の状態は変えない)。
let currentLocationMarker = null;
const LOCATE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>';

function goToCurrentLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { longitude: lon, latitude: lat } = pos.coords;
      // 出発地が既に「現在地」として自動セットされている場合は、そのマーカーを
      // 使い回す(別に自分専用の点を出すと、同じ場所に青い点が2つ重なって
      // しまうため)。
      if (fromPoint && fromPoint.isCurrentLocation) {
        fromPoint.lon = lon;
        fromPoint.lat = lat;
        fromPoint.marker.setLngLat([lon, lat]);
      } else if (currentLocationMarker) {
        currentLocationMarker.setLngLat([lon, lat]);
      } else {
        const el = document.createElement("div");
        el.className = "current-location-dot";
        currentLocationMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
      }
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15) });
    },
    (err) => {
      console.warn("現在地を取得できませんでした(許可されていない可能性があります)", err);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// MapLibreのコントロール(ズームボタンと同じ見た目・配置の仕組み)として実装する
// ことで、手動のpx計算なしに「ズームの上」へ自然に積み上がるようにする。
class LocateControl {
  onAdd() {
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "maplibregl-ctrl-locate";
    button.setAttribute("aria-label", "現在地に戻る");
    button.title = "現在地に戻る";
    button.innerHTML = LOCATE_ICON_SVG;
    button.addEventListener("click", goToCurrentLocation);
    this._container.appendChild(button);
    return this._container;
  }
  onRemove() {
    this._container.remove();
  }
}

// 地図上の専用道路・参考レイヤーをタップしたときに、名称・専用度合い・属性・
// データ出典・OSMへのリンク・Googleストリートビューへのリンクをポップアップ表示する。
// 「どんな道路か実際に確認したい」という要望への対応(2026-09-21)。
// Googleストリートビューはリンクのみ(埋め込みAPIはキー・課金が必要なため使わない。
// リンクなら無料・キー不要でユーザーのブラウザで開ける)。
const INFO_LAYER_IDS = ["cycleway-line-solid", "reference-line-solid", "reference-line-dashed"];

// props.source(2026-09-22追加。network_mergeが付与)で出典を分岐する。
// OSM由来(source==="osm")以外はprops.idがOSMのway IDではないので、
// OSMへのリンクは出さず、convert_*.pyが埋め込んだprops.attributionを表示する。
function formatRoadInfoPopup(props, lngLat) {
  const tierLabel = (TIER_STYLE[props.tier] || {}).label || "不明";
  const name = props.name || "(名称不明の区間)";
  const attrs = [];
  if (props.surface) attrs.push(`路面: ${props.surface}`);
  if (props.foot) attrs.push(`歩行者: ${props.foot}`);
  if (props.segregated) attrs.push(`歩行者との分離: ${props.segregated}`);
  const attrsHtml = attrs.length ? `<div class="hint">${attrs.join(" / ")}</div>` : "";
  const svUrl = `https://www.google.com/maps?layer=c&cbll=${lngLat.lat},${lngLat.lng}`;
  const isOsm = !props.source || props.source === "osm";
  const sourceHtml = isOsm
    ? `<a href="https://www.openstreetmap.org/way/${props.id}" target="_blank" rel="noopener">OSMで詳細を見る(way ${props.id})</a><br>` +
      `<div class="hint" style="margin-top:4px;">出典: OpenStreetMap contributors(ODbL)、2026-09-20取得</div>`
    : `<div class="hint" style="margin-top:4px;">出典: ${props.attribution || props.source}</div>`;
  return (
    `<div style="font-size:0.8rem;max-width:240px;">` +
    `<div style="font-weight:bold;margin-bottom:2px;">${name}</div>` +
    `<div>${tierLabel}</div>${attrsHtml}` +
    `<div style="margin-top:6px;">` +
    `<a href="${svUrl}" target="_blank" rel="noopener">Googleストリートビューで見る</a><br>` +
    `${sourceHtml}` +
    `</div>` +
    `</div>`
  );
}

// 2026-09-22: 以前は出発地・目的地の指定待ち中(nextPickKind()が真)は
// ポップアップを出さない仕様にしていたが、ページ読み込み直後は目的地・出発地の
// どちらも未指定で常に指定待ち状態のため、実質「道路をクリックしても詳細が
// 一切出ない」バグになっていた(ユーザー指摘)。道路の詳細確認はいつでも
// できてほしい機能のため、指定待ちかどうかに関わらず常にポップアップを出す
// ように変更し、優先順位を「地点指定」より上にした(地点指定側
// (attachMapHandlersの汎用clickハンドラ)で、このレイヤーに当たるクリックは
// 除外することで役割を分担する)。
function attachRoadInfoPopups() {
  for (const layerId of INFO_LAYER_IDS) {
    map.on("click", layerId, (e) => {
      const props = e.features[0].properties;
      new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(formatRoadInfoPopup(props, e.lngLat)).addTo(map);
    });
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function attachMapHandlers() {
  // 2026-09-22: 明示的な「地図で指定」ボタンをやめ、Googleマップ同様に
  // 「目的地が無ければ目的地、あれば出発地」を自動でクリック対象にする。
  // 2026-09-22追記: 道路情報ポップアップ(attachRoadInfoPopups、INFO_LAYER_IDS)を
  // 優先するため、クリック地点がそのレイヤーに当たる場合は地点指定をしない
  // (クリックしたのがネットワークの線そのものかどうかをqueryRenderedFeaturesで
  // 判定。地点指定はDijkstra側で最寄りノードに自動スナップするため、線の
  // 少し外側をクリックしても支障は無い)。
  map.on("click", (e) => {
    const kind = nextPickKind();
    if (!kind || !graph) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: INFO_LAYER_IDS });
    if (hits.length > 0) return;
    setPoint(kind, e.lngLat.lng, e.lngLat.lat);
  });

  map.on("load", async () => {
    // 現在地が取得できれば出発地として自動セットする(データ読み込みとは
    // 無関係なので並行して呼ぶだけで、待ち合わせはしない)。
    tryUseCurrentLocationAsOrigin();

    // 専用道路・参考レイヤーを先に追加し、検索結果のライン(search-result/
    // route-result)は必ずその後に追加する(MapLibreは後から追加したレイヤーほど
    // 上に重なって描画されるため、経路がサイクリングロード等の下に隠れないようにする)。
    await Promise.all([
      // loadHighwayRoutesの色付き線をcycleway-line-solidより確実に上に重ねる
      // ため、cycleway-line-solidが追加され終わってからhighway-routesを読む
      // (詳細はloadHighwayRoutes冒頭のコメント参照)。
      loadCyclewayNetwork().then(() => loadHighwayRoutes()),
      loadReferenceInfrastructure(),
      loadAttribution(),
      loadRoutesIndex(),
      loadTileIndex(),
      loadStationIcon(),
    ]);
    attachRoadInfoPopups();

    // 近距離検索の経路は、Googleマップと同じ青にする(灰色のネットワーク本体・
    // 緑の高速道路風レイヤーと被らない)。tierごとに区間分けしたフィーチャの
    // 集まりだが、色は全区間このROUTE_RESULT_COLORで統一する(tierによる
    // 色分けはしない。区間ごとのproperties.tier/distanceMはクリック時の
    // ポップアップ表示にだけ使う)。
    map.addSource("search-result", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "search-result-line",
      type: "line",
      source: "search-result",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_RESULT_COLOR, "line-width": 6 },
    });
    // 区間一覧(#nearby-result内のli)をクリックしたとき、地図上の該当箇所を
    // 示すためのハイライト(2026-09-22、Googleマップの経路案内ステップをクリック
    // すると地図上のその区間が強調される挙動を模した)。search-result-lineより
    // 太く・目立つ色にして上に重ねる。
    map.addSource("search-result-highlight", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "search-result-highlight",
      type: "line",
      source: "search-result-highlight",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f9ab00", "line-width": 10, "line-opacity": 0.9 },
    });
    // 区間の切り替わり地点(一般道路⇄専用道路等)に、高速道路風レイヤーと同じ
    // 白丸を置く(2026-09-22、ユーザー方針)。
    map.addSource("search-result-junctions", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "search-result-junctions",
      type: "circle",
      source: "search-result-junctions",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 15, 5, 18, 8],
        "circle-color": "#ffffff",
        "circle-stroke-color": ROUTE_RESULT_COLOR,
        "circle-stroke-width": 2,
      },
    });
    map.on("click", "search-result-line", (e) => {
      const props = e.features[0].properties;
      const tierLabel = TIER_LABEL_SHORT[props.tier] || "不明";
      const distanceKm = (props.distanceM / 1000).toFixed(2);
      new maplibregl.Popup({ maxWidth: "220px" })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-size:0.8rem;"><div style="font-weight:bold;">${tierLabel}</div><div>${distanceKm} km</div></div>`
        )
        .addTo(map);
    });
    map.on("mouseenter", "search-result-line", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "search-result-line", () => {
      map.getCanvas().style.cursor = "";
    });

    map.addSource("route-result", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "route-result-line",
      type: "line",
      source: "route-result",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#d62728", "line-width": 4 },
    });

    // 2026-09-22: #route-select(loadRoutesIndex内)はindex.jsonという小さい
    // ファイルの取得が終わり次第、他のデータ(専用道路ネットワーク等、数MB規模)の
    // 読み込みを待たずに操作可能になっていた。一方この上のmap.addSource("route-result",
    // ...)はPromise.all完了後(=大きいデータの読み込みも終わった後)まで実行され
    // ないため、その間にユーザーが選択すると showPrecomputedRouteInPanel内の
    // map.getSource("route-result")がundefinedになり例外で処理が止まっていた
    // (「長距離ルートを選択しても結果に反映されない」不具合の原因)。route-result
    // ソースが実際に用意できたこの時点でdisabledを解除することで、選択可能に
    // なった時点では確実に描画先が存在するようにする。
    document.getElementById("route-select").disabled = false;
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
  // 現在地ボタンはその上に並べる(2026-09-22)。bottom-rightは先に追加した
  // コントロールほど外側(画面端)に来るため、ズームを先に追加してから
  // 現在地ボタンを追加する。
  map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  map.addControl(new LocateControl(), "bottom-right");
  // 地図と連動するスケールバー(2026-09-22、ユーザー要望: 「地図の右下、
  // ズームとかのボタンの左辺りに」)。maplibregl.ScaleControlは通常
  // bottom-right/bottom-left等の隅コンテナに縦積みされる(ズームボタンの
  // 上や下)だけで、「ボタンの横」には置けない。距離の計算自体は
  // ScaleControlにそのまま任せつつ、生成されたDOM要素だけを自前の
  // 固定位置div(#map-scale)に付け替えることで、ズームボタン列の左に
  // 横並びさせている(要素を移動しても、地図のmove/zoomイベントへの
  // 内部バインドはそのまま働き続ける)。
  const scaleControl = new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" });
  map.addControl(scaleControl, "bottom-right");
  const scaleEl = document.querySelector(".maplibregl-ctrl-scale");
  if (scaleEl) {
    const wrapper = document.getElementById("map-scale");
    wrapper.appendChild(scaleEl);
  }
  attachMapHandlers();
  // 画面が広い(デスクトップ相当)場合は、最初からサイドバーを開いておく。
  if (window.innerWidth > 768) openSidebar();
  // openSidebar()はデスクトップの時しか呼ばれず、その中でしか
  // updateCategoryChipsPosition()が実行されないため、モバイル幅での初期表示
  // (#category-chipsを検索ブロックの下に移動させる)のために明示的に呼ぶ
  // (2026-09-22)。
  updateCategoryChipsPosition();
}

initMap();