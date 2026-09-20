const KANTO_CENTER = [36.0, 139.6];

// 道路網を目立たせたいので、背景は淡い配色のタイルを使う
// (標準のOSMタイルは色・情報量が多く、専用道路の色分けが埋もれてしまうため)
// 注: CartoDB Positronは現在APIキーが無いと"API KEY REQUIRED"の透かしが入るため
// 不採用(2026-09-20に実機確認)。Esri World Light Gray Base(無料・キー不要)を使う。
const map = L.map("map").setView(KANTO_CENTER, 9);
L.tileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  {
    attribution:
      'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 16,
  }
).addTo(map);
// 地名・道路番号などのラベルは別レイヤー(Reference、背景透過)なので重ねて表示する
L.tileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 16 }
).addTo(map);

// 専用度合い(tier)ごとのスタイル。値が小さいほど「より専用」。
// 東京都の自転車関連情報マップ(wagmap)の分類(自転車道/自転車歩行者道の分離方法/
// 自転車専用通行帯/車道混在)を参考に段階分けした(2026-09-20)。
// tier 5 (分離型自転車道)は道路ウェイの形状を近似として使っているため破線で区別する。
// tier 6,7は経路探索の対象(専用道路)には含めない参考表示レイヤー。
const TIER_STYLE = {
  1: { color: "#08306b", weight: 2.6, opacity: 0.9, label: "完全専用(歩行者非対応)" },
  2: { color: "#2171b5", weight: 2.2, opacity: 0.85, label: "専用・歩行者と分離" },
  3: { color: "#6baed6", weight: 1.8, opacity: 0.8, label: "専用・歩行者共用" },
  4: { color: "#9ecae1", weight: 1.5, opacity: 0.7, label: "専用(詳細不明)" },
  5: { color: "#984ea3", weight: 2.2, opacity: 0.8, dashArray: "4,3", label: "分離型自転車道(車道沿い、近似)" },
  6: { color: "#fdae61", weight: 1.3, opacity: 0.6, label: "(参考)自転車専用通行帯・ペイントのみ" },
  7: { color: "#bdbdbd", weight: 1, opacity: 0.5, dashArray: "1,3", label: "(参考)車道混在・矢羽根等" },
};

function styleForFeature(feature) {
  const tier = feature.properties.tier;
  return TIER_STYLE[tier] || TIER_STYLE[4];
}

const cyclewayLayer = L.layerGroup().addTo(map);
const referenceLayer = L.layerGroup().addTo(map);
const searchLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

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
    if (s.dashArray) swatch.classList.add("dashed");
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

function geojsonToLatLngs(coords) {
  return coords.map(([lon, lat]) => [lat, lon]);
}

async function loadCyclewayNetwork() {
  const res = await fetch("data/cycleway_network.geojson");
  const geojson = await res.json();
  L.geoJSON(geojson, { style: styleForFeature }).addTo(cyclewayLayer);
  buildLegend();
  graph = CycleGraph.buildGraph(geojson);
  console.log(`cycleway graph: ${graph.nodeCoords.length} nodes`);
}

// 経路探索には使わない参考表示レイヤー(自転車専用通行帯・車道混在)。
// 情報量が多いためデフォルトは非表示にし、チェックボックスで切り替える。
async function loadReferenceInfrastructure() {
  const res = await fetch("data/reference_infrastructure.geojson");
  const geojson = await res.json();
  L.geoJSON(geojson, { style: styleForFeature }).addTo(referenceLayer);
  map.removeLayer(referenceLayer);
}

async function loadAttribution() {
  const res = await fetch("data/attribution.json");
  const attr = await res.json();
  document.getElementById("attribution-text").textContent =
    `${attr.attribution_text}(${attr.license})。地図タイル: © OpenStreetMap contributors, Tiles © Esri。` +
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
    routeLayer.clearLayers();
    const resultDiv = document.getElementById("route-result");
    if (!select.value) {
      resultDiv.textContent = "";
      return;
    }
    const routeRes = await fetch(`data/${select.value}`);
    const routeGeojson = await routeRes.json();
    const layer = L.geoJSON(routeGeojson, { style: { color: "#d62728", weight: 4 } }).addTo(routeLayer);
    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    const p = routeGeojson.properties;
    resultDiv.innerHTML = `<span class="ok">${p.name}: 距離 ${p.length_km} km、専用道路上 ${Math.round(p.cycleway_share * 100)}%</span>`;
  });
}

function setPickMode(mode) {
  pickMode = mode;
  document.getElementById("btn-set-from").classList.toggle("active", mode === "from");
  document.getElementById("btn-set-to").classList.toggle("active", mode === "to");
}

document.getElementById("btn-set-from").addEventListener("click", () => setPickMode("from"));
document.getElementById("btn-set-to").addEventListener("click", () => setPickMode("to"));
document.getElementById("btn-clear").addEventListener("click", () => {
  fromPoint = null;
  toPoint = null;
  pickMode = null;
  searchLayer.clearLayers();
  document.getElementById("nearby-result").textContent = "";
});

map.on("click", (e) => {
  if (!pickMode || !graph) return;
  const { lat, lng } = e.latlng;
  const marker = L.marker([lat, lng], {
    icon: L.divIcon({ className: pickMode === "from" ? "pin-from" : "pin-to", html: pickMode === "from" ? "出" : "着" }),
  }).addTo(searchLayer);

  if (pickMode === "from") {
    if (fromPoint && fromPoint.marker) searchLayer.removeLayer(fromPoint.marker);
    fromPoint = { lon: lng, lat, marker };
  } else {
    if (toPoint && toPoint.marker) searchLayer.removeLayer(toPoint.marker);
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
  routeLayer.clearLayers();
  if (!result) {
    resultDiv.innerHTML =
      '<span class="ng">専用道路ネットワークだけでは繋がっていません(分断されています)。長距離ルートの事前計算リストを確認してください。</span>';
    return;
  }

  const latlngs = result.path.map((idx) => {
    const [lon, lat] = graph.nodeCoords[idx];
    return [lat, lon];
  });
  L.polyline(latlngs, { color: "#2ca02c", weight: 4 }).addTo(searchLayer);
  const accessM = Math.round(nearFrom.distanceM + nearTo.distanceM);
  resultDiv.innerHTML =
    `<span class="ok">専用道路ネットワーク上の距離: ${(result.distanceM / 1000).toFixed(2)} km` +
    `(出発地・目的地から最寄りの専用道路まで、合計約 ${accessM} m の徒歩/一般道アクセスが別途必要です)</span>`;
}

document.getElementById("toggle-reference").addEventListener("change", (e) => {
  if (e.target.checked) {
    map.addLayer(referenceLayer);
  } else {
    map.removeLayer(referenceLayer);
  }
});

(async function init() {
  await Promise.all([
    loadCyclewayNetwork(),
    loadReferenceInfrastructure(),
    loadAttribution(),
    loadRoutesIndex(),
  ]);
})();
