"""data/raw/osm_survey/の生データを、フロントエンド配信用の軽量GeoJSONに変換する。"""
import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def main():
    cfg = load_config()
    digits = cfg["coordinate_precision_digits"]
    raw = json.loads((REPO_ROOT / cfg["input"]["cycleway_raw"]).read_text(encoding="utf-8"))

    features = []
    for el in raw.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        coords = [[round(pt["lon"], digits), round(pt["lat"], digits)] for pt in geom]
        tags = el.get("tags", {})
        features.append({
            "type": "Feature",
            "properties": {
                "id": el["id"],
                "foot": tags.get("foot"),
                "segregated": tags.get("segregated"),
                "surface": tags.get("surface"),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    out = {"type": "FeatureCollection", "features": features}
    out_path = REPO_ROOT / cfg["output"]["cycleway_geojson"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(features)} features -> {out_path} ({out_path.stat().st_size/1e6:.2f} MB)")

    attribution = {
        "source": "OpenStreetMap contributors",
        "license": "ODbL",
        "license_url": "https://opendatacommons.org/licenses/odbl/",
        "attribution_text": "© OpenStreetMap contributors",
        "note": "highway=cycleway (independent dedicated cycleways) extracted via Overpass API, 2026-09-20",
    }
    attr_path = REPO_ROOT / cfg["output"]["attribution"]
    attr_path.write_text(json.dumps(attribution, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"-> {attr_path}")


if __name__ == "__main__":
    main()
