"""config.yamlのroutesに列挙した道路名を、OSMのname完全一致で抽出し、
docs/data/highway_routes.geojson(高速道路風に見せるサイクリングロードの
明示登録ファイル)を作る。

「どの道路をサイクリングロードとして扱うか」はユーザーが個別に判断し、
ジオメトリの抽出作業だけをOSMを活用して楽にする、という役割分担
(instruction.md参照)。tier・長さ等の「これは高速道路っぽくすべきか」の
推測は一切しない。

2026-09-22追記: name完全一致だけだと、同じ実在の道路でも交差点ごとに
way が分割されており、途中の区間が無名(または表記ゆれの別名)のために
拾えず、地図上で途切れて見える問題があった(例: 多摩川サイクリングロードは
name一致78wayだが、実際に座標が繋がっている無名の接続区間が155way分ある)。
これに対応するため、name一致したwayを起点に、**座標が一致する(=OSM上で
物理的に繋がっている)wayを芋づる式にたどって含める**(connect_tolerance_m
以内の端点は同じ地点とみなす)。それでも繋がらない箇所は、OSMにデータが
無い(未整備 or 単に地図に無い)本当の空白である可能性が高いので、警告として
報告するだけにとどめ、座標を捏造してつなぐことはしない。
"""
import json
from pathlib import Path

import networkx as nx
import pyproj
import yaml
from scipy.spatial import cKDTree
from shapely.geometry import LineString
from shapely.ops import transform

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_ways(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("elements", [])


def round_coords(coords, digits):
    return [[round(lon, digits), round(lat, digits)] for lon, lat in coords]


def build_connectivity(ways, metric_crs, connect_tolerance_m):
    """ways(Overpass要素のリスト)から、「物理的に繋がっているway群」の
    グループ分け(way id -> component id)を作る。頂点座標の完全一致で繋がって
    いるwayはそのまま同じグループ、末端どうしがconnect_tolerance_m以内なら
    仮想的に繋がっているとみなす(network_connectivity/analyze.pyと同じ手法)。
    """
    project = pyproj.Transformer.from_crs("EPSG:4326", metric_crs, always_xy=True).transform

    node_id_of = {}
    coords_of_node = []

    def node_id(xy):
        key = (round(xy[0], 2), round(xy[1], 2))
        if key not in node_id_of:
            node_id_of[key] = len(coords_of_node)
            coords_of_node.append(key)
        return node_id_of[key]

    G = nx.Graph()
    way_first_node = {}
    for way in ways:
        geom = way.get("geometry")
        if not geom or len(geom) < 2:
            continue
        line_m = transform(project, LineString([(pt["lon"], pt["lat"]) for pt in geom]))
        pts = list(line_m.coords)
        nodes = [node_id(p) for p in pts]
        way_first_node[way["id"]] = nodes[0]
        for a, b in zip(nodes[:-1], nodes[1:]):
            G.add_edge(a, b)

    if connect_tolerance_m > 0:
        dangling = [n for n in G.nodes if G.degree(n) == 1]
        if len(dangling) >= 2:
            pts = [coords_of_node[n] for n in dangling]
            tree = cKDTree(pts)
            for i, j in tree.query_pairs(r=connect_tolerance_m):
                G.add_edge(dangling[i], dangling[j])

    comp_of_node = {}
    for i, comp in enumerate(nx.connected_components(G)):
        for n in comp:
            comp_of_node[n] = i

    return {way_id: comp_of_node[first_node] for way_id, first_node in way_first_node.items()}


def main():
    cfg = load_config()
    digits = cfg["coordinate_precision_digits"]
    connect_tolerance_m = cfg.get("connect_tolerance_m", 30)
    metric_crs = cfg.get("metric_crs", "EPSG:32654")

    ways = load_ways(REPO_ROOT / cfg["input"]["cycleway_raw"]) + load_ways(
        REPO_ROOT / cfg["input"]["separated_track_raw"]
    )
    ways_by_id = {w["id"]: w for w in ways if w.get("geometry") and len(w["geometry"]) >= 2}
    component_of_way = build_connectivity(list(ways_by_id.values()), metric_crs, connect_tolerance_m)

    features = []
    for route in cfg["routes"] or []:
        target_names = {route["name"], *route.get("aliases", [])}
        named_ways = [w for w in ways_by_id.values() if w.get("tags", {}).get("name") in target_names]

        if not named_ways:
            print(f"警告: 「{route['name']}」に完全一致するOSM wayが見つかりませんでした")
            continue

        target_components = {component_of_way[w["id"]] for w in named_ways}
        all_ways = [w for w in ways_by_id.values() if component_of_way[w["id"]] in target_components]

        lines = [
            round_coords([[pt["lon"], pt["lat"]] for pt in w["geometry"]], digits) for w in all_ways
        ]
        geometry = (
            {"type": "LineString", "coordinates": lines[0]}
            if len(lines) == 1
            else {"type": "MultiLineString", "coordinates": lines}
        )
        features.append({
            "type": "Feature",
            "properties": {"name": route["name"]},
            "geometry": geometry,
        })
        extra = len(all_ways) - len(named_ways)
        n_gaps = len(target_components) - 1
        print(
            f"「{route['name']}」: name一致{len(named_ways)}way + 接続区間{extra}way "
            f"= 合計{len(all_ways)}way -> 登録"
        )
        if n_gaps > 0:
            print(
                f"  注意: {n_gaps}箇所、{connect_tolerance_m}m以内でも繋がらない空白が残っています。"
                f"地図で該当箇所を確認し、(1)OSM側の表記ゆれならaliasesに追加、"
                f"(2)OSMに該当区間が無ければOSMを編集して追加、のいずれかで対応してください"
                f"(instruction.md参照)。"
            )

    out_path = REPO_ROOT / cfg["output"]["highway_routes_geojson"]
    out = {"type": "FeatureCollection", "features": features}
    out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"合計{len(features)}路線 -> {out_path}")


if __name__ == "__main__":
    main()
