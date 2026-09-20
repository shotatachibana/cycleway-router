"""data/raw/osm_survey/ の生データを集計し、results/ に出力する。

- 種別(独立cycleway / 車道沿い分離型track)・属性別の延長集計
- 都県別の延長集計(都県境界はOverpassのrelation geometryから概略ポリゴンを組み立てて空間結合)
- 目視確認用の地図(results/figures/osm_survey_kanto_map.html)
"""
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
import yaml
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"

# 日本の道路延長集計に一般的なJGD2011平面直角座標系ではなく、関東地方全体をまたぐため
# 距離計算は正距円筒ではなくUTM 54N(EPSG:6690系のUTM相当)を使う
METRIC_CRS = "EPSG:32654"  # UTM zone 54N


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_ways_as_gdf(path: Path, kind: str) -> gpd.GeoDataFrame:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        line = LineString([(pt["lon"], pt["lat"]) for pt in geom])
        tags = el.get("tags", {})
        rows.append({"osm_id": el["id"], "kind": kind, "geometry": line, **tags})
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def build_prefecture_polygons(path: Path) -> gpd.GeoDataFrame:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for el in data.get("elements", []):
        name = el.get("tags", {}).get("name")
        outer_lines = [
            LineString([(pt["lon"], pt["lat"]) for pt in m["geometry"]])
            for m in el.get("members", [])
            if m.get("type") == "way" and m.get("role") == "outer" and m.get("geometry")
        ]
        if not outer_lines:
            continue
        merged = unary_union(outer_lines)
        polygons = list(polygonize(merged))
        if not polygons:
            continue
        poly = max(polygons, key=lambda p: p.area) if len(polygons) == 1 else unary_union(polygons)
        rows.append({"prefecture": name, "geometry": poly})
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def summarize_attributes(gdf: gpd.GeoDataFrame, attrs: list[str]) -> pd.DataFrame:
    gdf_m = gdf.to_crs(METRIC_CRS)
    gdf_m["length_km"] = gdf_m.geometry.length / 1000.0
    records = []
    for kind, sub in gdf_m.groupby("kind"):
        records.append(
            {"kind": kind, "attribute": "_total_", "value": "_all_",
             "way_count": len(sub), "length_km": sub["length_km"].sum()}
        )
        for attr in attrs:
            if attr not in sub.columns:
                continue
            for value, g in sub.groupby(sub[attr].fillna("(未設定)")):
                records.append(
                    {"kind": kind, "attribute": attr, "value": value,
                     "way_count": len(g), "length_km": g["length_km"].sum()}
                )
    return pd.DataFrame(records)


def summarize_by_prefecture(gdf: gpd.GeoDataFrame, prefectures: gpd.GeoDataFrame) -> pd.DataFrame:
    gdf_pt = gdf.copy()
    gdf_pt["geometry"] = gdf_pt.geometry.representative_point()
    joined = gpd.sjoin(gdf_pt, prefectures, how="left", predicate="within")
    joined = joined.drop(columns="geometry").merge(
        gdf[["osm_id"]].assign(length_km=gdf.to_crs(METRIC_CRS).geometry.length / 1000.0),
        on="osm_id",
    )
    out = (
        joined.groupby(["kind", "prefecture"], dropna=False)
        .agg(way_count=("osm_id", "count"), length_km=("length_km", "sum"))
        .reset_index()
    )
    return out


def build_map(gdf: gpd.GeoDataFrame, prefectures: gpd.GeoDataFrame, out_path: Path):
    # タイルサーバー(OSM公式・CARTO等)は利用規約やAPIキーの制約でブロックされやすいため、
    # ここでは背景タイルなしの静的な図(都県境界を薄く重ねる)にする。
    # 本番のdocs/フロントエンドで使うタイルは別途CLAUDE.mdの技術スタック節で検討する
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.family"] = "Noto Sans CJK JP"

    fig, ax = plt.subplots(figsize=(9, 9))
    prefectures.boundary.plot(ax=ax, color="#999999", linewidth=0.8)
    colors = {"independent_cycleway": "#1f77b4", "separated_track": "#d62728"}
    for kind, sub in gdf.groupby("kind"):
        sub.plot(ax=ax, color=colors.get(kind, "#333333"), linewidth=0.6, label=kind)
    # 東京都は伊豆諸島・小笠原諸島(遠方の島嶼部)を含み図が間延びするため、
    # サイクリングデータの分布(=関東の本土部分)を基準に表示範囲を絞る
    minx, miny, maxx, maxy = gdf.total_bounds
    pad_x, pad_y = (maxx - minx) * 0.05, (maxy - miny) * 0.05
    ax.set_xlim(minx - pad_x, maxx + pad_x)
    ax.set_ylim(miny - pad_y, maxy + pad_y)
    ax.set_title("関東地方の自転車専用道路(青)・車道沿い分離型自転車道(赤)")
    ax.set_axis_off()
    ax.legend(loc="lower left")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def main():
    cfg = load_config()
    raw_indep = REPO_ROOT / cfg["output"]["raw_json_independent"]
    raw_sep = REPO_ROOT / cfg["output"]["raw_json_separated"]
    raw_pref = Path(REPO_ROOT / cfg["output"]["raw_dir"]) / "kanto_prefectures.json"

    print("生データを読み込み中...")
    gdf_indep = load_ways_as_gdf(raw_indep, "independent_cycleway")
    gdf_sep = load_ways_as_gdf(raw_sep, "separated_track")
    gdf = pd.concat([gdf_indep, gdf_sep], ignore_index=True)
    gdf = gpd.GeoDataFrame(gdf, crs="EPSG:4326")
    print(f"  independent_cycleway: {len(gdf_indep)} ways, separated_track: {len(gdf_sep)} ways")

    print("属性別に集計中...")
    attr_table = summarize_attributes(gdf, cfg["attributes_to_summarize"])
    table_path = REPO_ROOT / cfg["output"]["table"]
    table_path.parent.mkdir(parents=True, exist_ok=True)
    attr_table.to_csv(table_path, index=False, encoding="utf-8-sig")
    print(f"  -> {table_path}")

    print("都県境界を組み立てて空間結合中...")
    prefectures = build_prefecture_polygons(raw_pref)
    pref_table = summarize_by_prefecture(gdf, prefectures)
    pref_table_path = REPO_ROOT / cfg["output"]["table_by_prefecture"]
    pref_table.to_csv(pref_table_path, index=False, encoding="utf-8-sig")
    print(f"  -> {pref_table_path}")

    print("地図を作成中...")
    map_path = REPO_ROOT / cfg["output"]["map_png"]
    build_map(gdf, prefectures, map_path)
    print(f"  -> {map_path}")

    print("\n=== 概要 ===")
    print(attr_table[attr_table["attribute"] == "_total_"].to_string(index=False))


if __name__ == "__main__":
    main()
