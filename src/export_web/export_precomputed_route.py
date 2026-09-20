"""R5の/planエンドポイントの出力を、事前計算ルートとしてdocs/data/routes/に登録する。

使い方:
    python export_precomputed_route.py <plan_result.json> \
        --slug shinagawa-takasaki \
        --name "品川駅 → 高崎駅" \
        --from-name 品川駅 --to-name 高崎駅
"""
import argparse
import json
from pathlib import Path

import geopandas as gpd
import yaml
from shapely.geometry import LineString
from shapely.ops import unary_union, transform
import pyproj

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def merge_plan_to_linestring(plan_features):
    coords = []
    for f in plan_features:
        geom = f.get("geometry")
        if not geom or geom.get("type") != "LineString":
            continue
        pts = geom["coordinates"]
        if coords and coords[-1] == pts[0]:
            coords.extend(pts[1:])
        else:
            coords.extend(pts)
    return LineString(coords)


def cycleway_share(route_line, cfg):
    project = pyproj.Transformer.from_crs("EPSG:4326", cfg["metric_crs"], always_xy=True).transform
    cyc_raw = json.loads((REPO_ROOT / cfg["input"]["cycleway_raw"]).read_text(encoding="utf-8"))
    cyc_lines = []
    for el in cyc_raw.get("elements", []):
        geom = el.get("geometry")
        if not geom:
            continue
        cyc_lines.append(transform(project, LineString([(p["lon"], p["lat"]) for p in geom])))
    buffered = unary_union(cyc_lines).buffer(cfg["cycleway_buffer_m"])
    route_m = transform(project, route_line)
    on_cycleway = route_m.intersection(buffered).length
    return on_cycleway / route_m.length, route_m.length / 1000.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plan_result", type=Path)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--from-name", required=True)
    parser.add_argument("--to-name", required=True)
    parser.add_argument("--created", default="2026-09-20")
    args = parser.parse_args()

    cfg = load_config()
    plan = json.loads(args.plan_result.read_text(encoding="utf-8"))
    features = plan.get("data", {}).get("features", [])
    if plan.get("errors") or not features:
        raise SystemExit(f"plan result has no route: errors={plan.get('errors')}")

    route_line = merge_plan_to_linestring(features)
    share, length_km = cycleway_share(route_line, cfg)

    digits = cfg["coordinate_precision_digits"]
    coords = [[round(x, digits), round(y, digits)] for x, y in route_line.coords]

    route_geojson = {
        "type": "Feature",
        "properties": {
            "slug": args.slug,
            "name": args.name,
            "length_km": round(length_km, 1),
            "cycleway_share": round(share, 3),
        },
        "geometry": {"type": "LineString", "coordinates": coords},
    }
    routes_dir = REPO_ROOT / cfg["output"]["routes_dir"]
    routes_dir.mkdir(parents=True, exist_ok=True)
    route_path = routes_dir / f"{args.slug}.geojson"
    route_path.write_text(json.dumps(route_geojson, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"-> {route_path} ({length_km:.1f}km, cycleway_share={share*100:.1f}%)")

    index_path = REPO_ROOT / cfg["output"]["routes_index"]
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"routes": []}
    index["routes"] = [r for r in index["routes"] if r["slug"] != args.slug]
    index["routes"].append({
        "slug": args.slug,
        "name": args.name,
        "from_name": args.from_name,
        "to_name": args.to_name,
        "length_km": round(length_km, 1),
        "cycleway_share": round(share, 3),
        "file": f"routes/{args.slug}.geojson",
        "created": args.created,
        "note": "専用道路優先+一般道を長さペナルティ付きで接続するR5カスタムコストで、開発コンテナ内で事前計算。R5は常時稼働サーバーとしては使っていない(CLAUDE.md参照)",
    })
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"-> {index_path} ({len(index['routes'])} routes)")


if __name__ == "__main__":
    main()
