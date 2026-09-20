// 専用道路ネットワーク(cycleway_network.geojson)からグラフを組み立て、
// ブラウザ内で最短経路探索(Dijkstra)を行うための小さなモジュール。
// 950万ノード規模の一般道路網は配信していない(CLAUDE.md「設計上の未決事項」1参照)。
// 専用道路ネットワークのみを対象にした、小規模(十万ノード程度)なグラフ探索。

const CycleGraph = (() => {
  const R_EARTH_M = 6371000;

  function haversineMeters(lon1, lat1, lon2, lat2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_M * Math.asin(Math.sqrt(a));
  }

  function nodeKey(lon, lat) {
    return `${lon.toFixed(6)},${lat.toFixed(6)}`;
  }

  // GeoJSON FeatureCollection(LineString群)からグラフを構築する。
  // 戻り値: { nodeCoords: [[lon,lat], ...], nodeIndex: Map<key,int>, adjacency: Array<Array<{to,dist}>> }
  function buildGraph(geojson) {
    const nodeIndex = new Map();
    const nodeCoords = [];
    const adjacency = [];

    function getOrCreateNode(lon, lat) {
      const key = nodeKey(lon, lat);
      let idx = nodeIndex.get(key);
      if (idx === undefined) {
        idx = nodeCoords.length;
        nodeIndex.set(key, idx);
        nodeCoords.push([lon, lat]);
        adjacency.push([]);
      }
      return idx;
    }

    for (const feature of geojson.features) {
      const coords = feature.geometry.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const [lon1, lat1] = coords[i];
        const [lon2, lat2] = coords[i + 1];
        const a = getOrCreateNode(lon1, lat1);
        const b = getOrCreateNode(lon2, lat2);
        const dist = haversineMeters(lon1, lat1, lon2, lat2);
        adjacency[a].push({ to: b, dist });
        adjacency[b].push({ to: a, dist });
      }
    }
    return { nodeCoords, nodeIndex, adjacency };
  }

  // 与えられた地点に最も近いネットワークノードを線形探索で見つける(数十万点までなら十分高速)。
  function nearestNode(graph, lon, lat) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < graph.nodeCoords.length; i++) {
      const [nlon, nlat] = graph.nodeCoords[i];
      // 度単位の粗い距離で足切りしてからhaversineで正確に計算(高速化)
      const dx = nlon - lon;
      const dy = nlat - lat;
      const roughDist2 = dx * dx + dy * dy;
      if (roughDist2 > bestDist) continue;
      const dist = haversineMeters(lon, lat, nlon, nlat);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return { index: bestIdx, distanceM: bestDist };
  }

  // シンプルな2分ヒープによる優先度付きキュー
  class MinHeap {
    constructor() {
      this.items = [];
    }
    get size() {
      return this.items.length;
    }
    push(priority, value) {
      this.items.push([priority, value]);
      let i = this.items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.items[parent][0] <= this.items[i][0]) break;
        [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
        i = parent;
      }
    }
    pop() {
      const top = this.items[0];
      const last = this.items.pop();
      if (this.items.length > 0) {
        this.items[0] = last;
        let i = 0;
        while (true) {
          const left = i * 2 + 1;
          const right = i * 2 + 2;
          let smallest = i;
          if (left < this.items.length && this.items[left][0] < this.items[smallest][0]) smallest = left;
          if (right < this.items.length && this.items[right][0] < this.items[smallest][0]) smallest = right;
          if (smallest === i) break;
          [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
          i = smallest;
        }
      }
      return top;
    }
  }

  // Dijkstra法で最短経路を求める。戻り値: 経路上のノードindex配列(見つからなければnull)。
  function shortestPath(graph, startIdx, endIdx) {
    if (startIdx < 0 || endIdx < 0) return null;
    const dist = new Float64Array(graph.nodeCoords.length).fill(Infinity);
    const prev = new Int32Array(graph.nodeCoords.length).fill(-1);
    const visited = new Uint8Array(graph.nodeCoords.length);
    dist[startIdx] = 0;
    const heap = new MinHeap();
    heap.push(0, startIdx);

    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (visited[u]) continue;
      visited[u] = 1;
      if (u === endIdx) break;
      for (const edge of graph.adjacency[u]) {
        if (visited[edge.to]) continue;
        const nd = d + edge.dist;
        if (nd < dist[edge.to]) {
          dist[edge.to] = nd;
          prev[edge.to] = u;
          heap.push(nd, edge.to);
        }
      }
    }

    if (dist[endIdx] === Infinity) return null;
    const path = [];
    let cur = endIdx;
    while (cur !== -1) {
      path.push(cur);
      cur = prev[cur];
    }
    path.reverse();
    return { path, distanceM: dist[endIdx] };
  }

  return { buildGraph, nearestNode, shortestPath, haversineMeters };
})();
