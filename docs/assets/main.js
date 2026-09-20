const KANTO_CENTER = [36.0, 139.6];

const map = L.map("map").setView(KANTO_CENTER, 9);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

const cyclewayLayer = L.layerGroup().addTo(map);
const searchLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

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
  L.geoJSON(geojson, {
    style: { color: "#1f77b4", weight: 1.5, opacity: 0.6 },
  }).addTo(cyclewayLayer);
  graph = CycleGraph.buildGraph(geojson);
  console.log(`cycleway graph: ${graph.nodeCoords.length} nodes`);
}

async function loadAttribution() {
  const res = await fetch("data/attribution.json");
  const attr = await res.json();
  document.getElementById("attribution-text").textContent =
    `${attr.attribution_text}(${attr.license})。専用道路ネットワークは highway=cycleway をOverpass APIで抽出(2026-09-20)。`;
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

(async function init() {
  await Promise.all([loadCyclewayNetwork(), loadAttribution(), loadRoutesIndex()]);
})();
