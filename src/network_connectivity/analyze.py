"""独立cycleway(highway=cycleway)ネットワークの連結性を、複数のスナップ許容誤差で分析する。

手法(instruction.md参照):
1. 各wayの頂点列から、頂点=ノード・隣接頂点間=エッジのグラフを作る
   (完全一致する座標は同一ノードとして扱う。OSMノード共有に相当)
2. このグラフでの次数1のノード(末端=どこにも接続していない端点)を抽出する
3. 末端どうしの距離がスナップ許容誤差以内なら「横断で繋がりうる」とみなし、
   許容誤差ごとに連結成分を再計算する
"""
import json
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import networkx as nx
import pandas as pd
import yaml
from scipy.spatial import cKDTree
from shapely.geometry import LineString
from shapely.ops import transform
import pyproj

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_ways_metric(path: Path, metric_crs: str):
    data = json.loads(path.read_text(encoding="utf-8"))
    project = pyproj.Transformer.from_crs("EPSG:4326", metric_crs, always_xy=True).transform
    ways = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        line = LineString([(pt["lon"], pt["lat"]) for pt in geom])
        line_m = transform(project, line)
        ways.append({"osm_id": el["id"], "geometry_m": line_m, "geometry_deg": line})
    return ways


def build_base_graph(ways):
    """頂点の完全一致(丸め誤差mm単位)でノードを共有する基礎グラフを作る。"""
    node_id_of = {}
    coords_of_node = []

    def get_node_id(xy):
        key = (round(xy[0], 3), round(xy[1], 3))
        if key not in node_id_of:
            node_id_of[key] = len(coords_of_node)
            coords_of_node.append(key)
        return node_id_of[key]

    G = nx.Graph()
    for way in ways:
        coords = list(way["geometry_m"].coords)
        for a, b in zip(coords[:-1], coords[1:]):
            na, nb = get_node_id(a), get_node_id(b)
            d = ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
            if G.has_edge(na, nb):
                continue
            G.add_edge(na, nb, length_m=d, osm_id=way["osm_id"])
    return G, coords_of_node


def merge_with_tolerance(G: nx.Graph, coords_of_node: list, tol_m: float) -> nx.Graph:
    """次数1の端点どうしがtol_m以内なら仮想エッジで繋いだグラフを返す。"""
    if tol_m <= 0:
        return G
    dangling = [n for n in G.nodes if G.degree(n) == 1]
    if len(dangling) < 2:
        return G
    pts = [coords_of_node[n] for n in dangling]
    tree = cKDTree(pts)
    pairs = tree.query_pairs(r=tol_m)
    G2 = G.copy()
    for i, j in pairs:
        G2.add_edge(dangling[i], dangling[j], length_m=0.0, virtual=True)
    return G2


def component_lengths(G: nx.Graph) -> list[float]:
    lengths = []
    for comp in nx.connected_components(G):
        sub = G.subgraph(comp)
        total = sum(
            d["length_m"] for _, _, d in sub.edges(data=True) if not d.get("virtual")
        )
        lengths.append(total / 1000.0)  # km
    return sorted(lengths, reverse=True)


def main():
    cfg = load_config()
    ways = load_ways_metric(REPO_ROOT / cfg["input"]["independent_cycleway_json"], cfg["metric_crs"])
    print(f"読み込んだway数: {len(ways)}")

    G0, coords_of_node = build_base_graph(ways)
    print(f"基礎グラフ: ノード数={G0.number_of_nodes()}, エッジ数={G0.number_of_edges()}")
    n_dangling = sum(1 for n in G0.nodes if G0.degree(n) == 1)
    print(f"次数1の端点数: {n_dangling}")

    summary_rows = []
    top10_rows = []
    for tol in cfg["snap_tolerances_m"]:
        Gt = merge_with_tolerance(G0, coords_of_node, tol)
        lengths = component_lengths(Gt)
        total_km = sum(lengths)
        n_components = len(lengths)
        largest_km = lengths[0] if lengths else 0.0
        summary_rows.append({
            "tolerance_m": tol,
            "n_components": n_components,
            "total_length_km": total_km,
            "largest_component_km": largest_km,
            "largest_component_share": largest_km / total_km if total_km else 0.0,
        })
        for rank, km in enumerate(lengths[:10], start=1):
            top10_rows.append({"tolerance_m": tol, "rank": rank, "length_km": km})
        print(f"[許容誤差{tol}m] 成分数={n_components}, 最大成分={largest_km:.1f}km "
              f"({largest_km/total_km*100:.1f}% of {total_km:.1f}km)")

    summary_df = pd.DataFrame(summary_rows)
    summary_path = REPO_ROOT / cfg["output"]["summary_table"]
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_df.to_csv(summary_path, index=False, encoding="utf-8-sig")
    print(f"-> {summary_path}")

    top10_df = pd.DataFrame(top10_rows)
    top10_path = REPO_ROOT / cfg["output"]["top10_table"]
    top10_df.to_csv(top10_path, index=False, encoding="utf-8-sig")
    print(f"-> {top10_path}")

    build_component_maps(ways, G0, coords_of_node, cfg)


def build_component_maps(ways, G0, coords_of_node, cfg):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.family"] = "Noto Sans CJK JP"

    # way単位でどのノードに属するかを引けるように、頂点座標→node_idの逆引きを作る
    node_of_coord = {}
    for nid, xy in enumerate(coords_of_node):
        node_of_coord[xy] = nid

    for tol in cfg["output"]["map_tolerances_m"]:
        Gt = merge_with_tolerance(G0, coords_of_node, tol)
        comp_of_node = {}
        for comp_id, comp in enumerate(
            sorted(nx.connected_components(Gt), key=lambda c: -len(c))
        ):
            for n in comp:
                comp_of_node[n] = comp_id

        rows = []
        for way in ways:
            coords = list(way["geometry_m"].coords)
            start_key = (round(coords[0][0], 3), round(coords[0][1], 3))
            nid = node_of_coord.get(start_key)
            comp_id = comp_of_node.get(nid, -1)
            rows.append({"geometry": way["geometry_deg"], "comp_id": comp_id})
        gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")

        fig, ax = plt.subplots(figsize=(9, 9))
        gdf[gdf["comp_id"] >= 3].plot(ax=ax, color="#cccccc", linewidth=0.4)
        colors = ["#1f77b4", "#d62728", "#2ca02c"]
        for rank in range(3):
            sub = gdf[gdf["comp_id"] == rank]
            if len(sub):
                sub.plot(ax=ax, color=colors[rank], linewidth=1.0, label=f"最大成分{rank+1}位")
        ax.set_title(f"連結成分(スナップ許容誤差{tol}m)。色=上位3成分、灰=それ以外")
        ax.set_axis_off()
        ax.legend(loc="lower left")
        out_path = REPO_ROOT / f"{cfg['output']['map_prefix']}{tol}m.png"
        fig.savefig(out_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        print(f"-> {out_path}")


if __name__ == "__main__":
    main()
