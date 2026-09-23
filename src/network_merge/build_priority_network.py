"""複数データソース(手動→自治体→OSM、優先順位順)をマージし、
docs/data/cycleway_network.geojson(最終成果物)を作る。

優先順位の低いレイヤーが、優先順位の高いレイヤーと空間的に重なる場合は、
重なる部分だけを間引く(線全体を消すのではなく、shapelyのdifferenceで
重複区間だけを取り除く)。詳細はsrc/network_merge/instruction.md参照。
"""
import glob
import json
from pathlib import Path

import geopandas as gpd
import yaml
from shapely.geometry import GeometryCollection, LineString, MultiLineString, mapping, shape
from shapely.ops import unary_union

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"

EMPTY_LINE = LineString()


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_layer_features(layer):
    """1レイヤー分の(geometry, properties)を読み込む。
    ファイルが1つも無くてもエラーにせず空リストを返す
    (手動・自治体データがまだ無い状態でもパイプラインが動くようにするため)。"""
    features = []
    for pattern in layer["paths"]:
        for path_str in sorted(glob.glob(str(REPO_ROOT / pattern))):
            path = Path(path_str)
            data = json.loads(path.read_text(encoding="utf-8"))
            for f in data.get("features", []):
                geom = shape(f["geometry"])
                props = dict(f.get("properties") or {})
                if "tier" not in props or props["tier"] is None:
                    props["tier"] = layer["default_tier"]
                if not props.get("source"):
                    if layer["name"] == "municipal":
                        props["source"] = f"municipal:{path.stem}"
                    else:
                        props["source"] = layer["source_prefix"]
                features.append((geom, props))
    return features


def extract_lines(geom):
    """difference演算の結果、接点だけのPoint等が混ざることがあるので、
    LineString/MultiLineString成分だけを取り出す。"""
    if geom.is_empty:
        return EMPTY_LINE
    if isinstance(geom, (LineString, MultiLineString)):
        return geom
    if isinstance(geom, GeometryCollection):
        parts = []
        for g in geom.geoms:
            if isinstance(g, LineString):
                parts.append(g)
            elif isinstance(g, MultiLineString):
                parts.extend(g.geoms)
        if not parts:
            return EMPTY_LINE
        return parts[0] if len(parts) == 1 else MultiLineString(parts)
    return EMPTY_LINE


def to_crs(geoms, src_crs, dst_crs):
    gdf = gpd.GeoDataFrame(geometry=list(geoms), crs=src_crs)
    return gdf.to_crs(dst_crs).geometry.tolist()


def round_coords(coords, digits):
    if isinstance(coords[0], (int, float)):
        return [round(c, digits) for c in coords]
    return [round_coords(c, digits) for c in coords]


def feature_from_geometry(geom, props, digits):
    geom_dict = mapping(geom)
    geom_dict["coordinates"] = round_coords(geom_dict["coordinates"], digits)
    return {"type": "Feature", "properties": props, "geometry": geom_dict}


def main():
    cfg = load_config()
    digits = cfg["coordinate_precision_digits"]
    buffer_m = cfg["dedup_buffer_m"]
    metric_crs = cfg["metric_crs"]
    layers = cfg["layers"]

    covered_union_metric = None  # 優先度の高いレイヤーまでの被覆域(metric_crs)
    all_features_out = []
    municipal_sources = []

    for idx, layer in enumerate(layers):
        raw = load_layer_features(layer)
        if not raw:
            continue
        geoms_wgs84 = [g for g, _ in raw]
        props_list = [p for _, p in raw]
        is_last = idx == len(layers) - 1

        if covered_union_metric is not None:
            metric_geoms = to_crs(geoms_wgs84, "EPSG:4326", metric_crs)
            trimmed = [extract_lines(g.difference(covered_union_metric)) for g in metric_geoms]
            kept_metric, kept_props = [], []
            for g, p in zip(trimmed, props_list):
                if not g.is_empty:
                    kept_metric.append(g)
                    kept_props.append(p)
            if not kept_metric:
                continue
            kept_wgs84 = to_crs(kept_metric, metric_crs, "EPSG:4326")
        else:
            kept_metric, kept_props, kept_wgs84 = None, props_list, geoms_wgs84

        for geom, props in zip(kept_wgs84, kept_props):
            all_features_out.append(feature_from_geometry(geom, props, digits))
            if layer["name"] == "municipal":
                # フロントの出典表示にはprops.attribution(convert_*.pyが埋め込む
                # 正式な出典文言)を使う。無ければsource IDをそのまま出す。
                text = props.get("attribution") or props["source"]
                if text not in municipal_sources:
                    municipal_sources.append(text)

        if not is_last:
            if kept_metric is None:
                kept_metric = to_crs(geoms_wgs84, "EPSG:4326", metric_crs)
            layer_buffer = unary_union([g.buffer(buffer_m) for g in kept_metric])
            covered_union_metric = layer_buffer if covered_union_metric is None else unary_union(
                [covered_union_metric, layer_buffer]
            )

        print(f"layer '{layer['name']}': {len(raw)} features読み込み -> {len(kept_wgs84)} features採用")

    write_output(all_features_out, cfg, municipal_sources)


def write_output(features, cfg, municipal_sources):
    out_path = REPO_ROOT / cfg["output"]["cycleway_geojson"]
    out = {"type": "FeatureCollection", "features": features}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    tier_counts, source_counts = {}, {}
    for f in features:
        p = f["properties"]
        tier_counts[p.get("tier")] = tier_counts.get(p.get("tier"), 0) + 1
        source_counts[p.get("source")] = source_counts.get(p.get("source"), 0) + 1
    print(f"{len(features)} features -> {out_path} ({out_path.stat().st_size / 1e6:.2f} MB)")
    print(f"tier counts: {tier_counts}")
    print(f"source counts: {source_counts}")

    attr_path = REPO_ROOT / cfg["output"]["attribution"]
    attribution = json.loads(attr_path.read_text(encoding="utf-8")) if attr_path.exists() else {}
    # 現在の入力から求めた一覧で置き換える(追記だと再実行のたびに古い表記が
    # 積み上がってしまうため)。
    if municipal_sources:
        attribution["municipal_sources"] = municipal_sources
    else:
        attribution.pop("municipal_sources", None)
    attr_path.write_text(json.dumps(attribution, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"-> {attr_path} (municipal_sources更新。ライセンス表記は自治体ごとに別途要確認)")


if __name__ == "__main__":
    main()
