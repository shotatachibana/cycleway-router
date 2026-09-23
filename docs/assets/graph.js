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
  // weightFn(feature) => 距離に掛けるペナルティ係数(専用度合いが低いほど大きくする)。
  // 省略時は1.0(ペナルティなし)。エッジには物理距離distと探索用の重みweightの
  // 両方を持たせ、Dijkstraはweightを最小化しつつ実距離distを別集計できるようにする。
  // 戻り値: { nodeCoords: [[lon,lat], ...], nodeIndex: Map<key,int>,
  //          adjacency: Array<Array<{to,dist,weight,tier}>> }
  function buildGraph(geojson, weightFn) {
    const nodeIndex = new Map();
    const nodeCoords = [];
    const adjacency = [];
    const getWeight = weightFn || (() => 1.0);

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
      const geom = feature.geometry;
      // LineString/MultiLineStringの両方を受け付ける(2026-09-22。優先順位マージの
      // difference演算や、自治体データの原本が最初からMultiLineStringのことがある)。
      const lines = geom.type === "MultiLineString" ? geom.coordinates : [geom.coordinates];
      const tier = feature.properties ? feature.properties.tier : undefined;
      // 2026-09-22: 高速道路風レイヤー(サイクリングロード)の分岐点に路線名を
      // 表示するために、フィーチャのnameをエッジにも持たせる(以前は名前を
      // 引き回していなかったため、その機能を使うcycleway-junction-labelが
      // 実質的に常に空振りしていた)。
      const name = feature.properties ? feature.properties.name : undefined;
      const multiplier = getWeight(feature);
      for (const coords of lines) {
        for (let i = 0; i < coords.length - 1; i++) {
          const [lon1, lat1] = coords[i];
          const [lon2, lat2] = coords[i + 1];
          const a = getOrCreateNode(lon1, lat1);
          const b = getOrCreateNode(lon2, lat2);
          const dist = haversineMeters(lon1, lat1, lon2, lat2);
          const weight = dist * multiplier;
          adjacency[a].push({ to: b, dist, weight, tier, name });
          adjacency[b].push({ to: a, dist, weight, tier, name });
        }
      }
    }
    return { nodeCoords, nodeIndex, adjacency };
  }

  // 2つのグラフ(同じ座標丸め精度で作った前提)を1つに合体する。
  // 専用道路網+参考レイヤー(lane/shared_lane)をまとめて探索対象にするために使う。
  function mergeGraphs(graphs) {
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

    for (const g of graphs) {
      const remap = g.nodeCoords.map(([lon, lat]) => getOrCreateNode(lon, lat));
      for (let i = 0; i < g.adjacency.length; i++) {
        const from = remap[i];
        for (const edge of g.adjacency[i]) {
          adjacency[from].push({ ...edge, to: remap[edge.to] });
        }
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

  // Dijkstra法(重みweightを最小化)で最短経路を求める。
  // 戻り値: { path, distanceM(実距離の合計), weightedDistanceM, tierDistanceM(tierごとの実距離内訳) }
  function shortestPath(graph, startIdx, endIdx) {
    if (startIdx < 0 || endIdx < 0) return null;
    const weightDist = new Float64Array(graph.nodeCoords.length).fill(Infinity);
    const prev = new Int32Array(graph.nodeCoords.length).fill(-1);
    const visited = new Uint8Array(graph.nodeCoords.length);
    weightDist[startIdx] = 0;
    const heap = new MinHeap();
    heap.push(0, startIdx);

    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (visited[u]) continue;
      visited[u] = 1;
      if (u === endIdx) break;
      for (const edge of graph.adjacency[u]) {
        if (visited[edge.to]) continue;
        const nd = d + edge.weight;
        if (nd < weightDist[edge.to]) {
          weightDist[edge.to] = nd;
          prev[edge.to] = u;
          heap.push(nd, edge.to);
        }
      }
    }

    if (weightDist[endIdx] === Infinity) return null;
    const path = [];
    let cur = endIdx;
    while (cur !== -1) {
      path.push(cur);
      cur = prev[cur];
    }
    path.reverse();

    let distanceM = 0;
    const tierDistanceM = {};
    // 経路をたどった順番のまま、同じtierが連続する区間をひとまとめにする
    // (Googleマップの経路案内のように「専用道路を2.3km→一般道を1.1km→...」と
    // 表示するため。区間の順序が分かるようにする)。
    const segments = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const edge = graph.adjacency[a].find((e) => e.to === b);
      if (!edge) continue;
      distanceM += edge.dist;
      tierDistanceM[edge.tier] = (tierDistanceM[edge.tier] || 0) + edge.dist;
      const last = segments[segments.length - 1];
      if (last && last.tier === edge.tier) {
        last.distanceM += edge.dist;
        last.toIdx = i + 1; // pathのインデックス。区間の座標範囲を後から取り出せるようにする
      } else {
        segments.push({ tier: edge.tier, distanceM: edge.dist, fromIdx: i, toIdx: i + 1 });
      }
    }
    return { path, distanceM, weightedDistanceM: weightDist[endIdx], tierDistanceM, segments };
  }

  return { buildGraph, mergeGraphs, nearestNode, shortestPath, haversineMeters };
})();
