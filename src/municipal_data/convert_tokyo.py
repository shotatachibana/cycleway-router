"""data/raw/municipal_tokyo/のZIPを展開し、「整備済」系区間だけを
data/processed/municipal/tokyo_kensetsukyoku.geojsonに変換する。

判断根拠・除外基準はinstruction.md参照(未整備・計画中の区間は除外)。
"""
import zipfile
from pathlib import Path

import geopandas as gpd
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def extract_zip(zip_path, out_dir):
    """ZIP内のファイル名がShift-JISでエンコードされているため、
    標準のzipfileがcp437と誤認する分を再デコードしてから展開する。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            try:
                name = info.filename.encode("cp437").decode("shift_jis")
            except UnicodeDecodeError:
                name = info.filename
            data = z.read(info)
            out_path = out_dir / name
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(data)


def find_shp(out_dir):
    shps = list(out_dir.rglob("*.shp"))
    assert len(shps) == 1, f"{out_dir}にshpが{len(shps)}個見つかった(1個を想定)"
    return shps[0]


def round_coords(coords, digits):
    if isinstance(coords[0], (int, float)):
        return [round(c, digits) for c in coords]
    return [round_coords(c, digits) for c in coords]


def main():
    cfg = load_config()
    tokyo_cfg = cfg["tokyo"]
    digits = cfg["coordinate_precision_digits"]
    tier = cfg["default_tier"]
    attribution_text = tokyo_cfg["attribution_text"]

    features = []
    for dataset, res in tokyo_cfg["resources"].items():
        zip_path = REPO_ROOT / res["zip_path"]
        extract_dir = zip_path.with_suffix("")
        extract_zip(zip_path, extract_dir)
        shp_path = find_shp(extract_dir)

        gdf = gpd.read_file(shp_path, encoding="shift_jis")
        gdf = gdf.to_crs("EPSG:4326")
        gdf = gdf[gdf[res["status_field"]].isin(res["status_include"])]

        for _, row in gdf.iterrows():
            geom_dict = row.geometry.__geo_interface__
            geom_dict = {
                "type": geom_dict["type"],
                "coordinates": round_coords(list(geom_dict["coordinates"]), digits),
            }
            features.append({
                "type": "Feature",
                "properties": {
                    "name": row[res["name_field"]],
                    "tier": tier,
                    "attribution": attribution_text,
                    "dataset": dataset,
                },
                "geometry": geom_dict,
            })
        print(f"{dataset}: {len(gdf)}件(「{res['status_include']}」でフィルタ後)")

    out_path = REPO_ROOT / cfg["output"]["municipal_geojson"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out = {"type": "FeatureCollection", "features": features}
    import json
    out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"合計{len(features)}件 -> {out_path}")


if __name__ == "__main__":
    main()
