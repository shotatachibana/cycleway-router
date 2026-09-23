"""R5の/planエンドポイントの出力を、事前計算ルートとしてdocs/data/routes/に登録する。

各Featureの区間(専用道路/一般道路)は、R5がJapanCycleCostSupplierで実際の経路選択に
使った分類(fillFeature()が付与する"dedicated"プロパティ)をそのまま使う。近距離検索
(docs/assets/main.jsのrenderSegmentList)と同じ{tier, distanceM}形式のFeatureCollection
にすることで、事前計算ルートも「どの道路を通るか」の内訳を同じUIで表示できる。

使い方:
    python export_precomputed_route.py <plan_result.json> \
        --slug shinagawa-takasaki \
        --name "品川駅 → 高崎駅" \
        --from-name 品川駅 --to-name 高崎駅
"""
import argparse
import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"

TIER_DEDICATED = 1
TIER_GENERAL = 8
MIN_SEGMENT_M = 20  # docs/assets/main.jsのMIN_SEGMENT_Mと同じ考え方


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def extend_coords(coords, new_pts):
    """coordsの末尾とnew_ptsの先頭が同じ地点なら重複させずにつなげる。"""
    if coords and new_pts and coords[-1] == new_pts[0]:
        coords.extend(new_pts[1:])
    else:
        coords.extend(new_pts)


def build_tier_segments(plan_features):
    """R5のfillFeature()が返す(累積距離つきの)エッジ列から、tier(専用道路/一般道路)
    ごとにまとめた区間のリストを作る。各区間は{tier, distanceM, coords}。
    """
    raw = []  # (tier, distanceM, coords)
    prev_cum_m = 0.0
    for f in plan_features:
        geom = f.get("geometry")
        if not geom or geom.get("type") != "LineString":
            continue
        props = f["properties"]
        cum_m = float(props["distance"])  # R5側はstate.distance/1000(=メートル)の累積値
        length_m = cum_m - prev_cum_m
        prev_cum_m = cum_m
        if length_m <= 0:
            continue
        tier = TIER_DEDICATED if props.get("dedicated") else TIER_GENERAL
        raw.append((tier, length_m, list(geom["coordinates"])))

    # 隣接する同tierの区間をまとめる
    grouped = []
    for tier, length_m, coords in raw:
        if grouped and grouped[-1][0] == tier:
            g_tier, g_len, g_coords = grouped[-1]
            extend_coords(g_coords, coords)
            grouped[-1] = (g_tier, g_len + length_m, g_coords)
        else:
            grouped.append((tier, length_m, coords))

    # 20m未満の短い断片(交差点の継ぎ目等のノイズ)は直前の区間に吸収する
    merged = []
    for tier, length_m, coords in grouped:
        if merged and length_m < MIN_SEGMENT_M:
            m_tier, m_len, m_coords = merged[-1]
            extend_coords(m_coords, coords)
            merged[-1] = (m_tier, m_len + length_m, m_coords)
        else:
            merged.append((tier, length_m, coords))
    return merged


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
    if not all("dedicated" in f["properties"] for f in features if f.get("geometry")):
        raise SystemExit(
            "plan resultに'dedicated'プロパティがありません。"
            "src/r5_custom_cost/java/PointToPointRouterServer.javaのfillFeature()改修を"
            "適用したR5(gradle shadowJarで再ビルド)で計算し直したJSONを渡してください。"
        )

    segments = build_tier_segments(features)
    total_m = sum(s[1] for s in segments)
    dedicated_m = sum(s[1] for s in segments if s[0] == TIER_DEDICATED)
    share = dedicated_m / total_m if total_m else 0.0
    length_km = total_m / 1000.0

    digits = cfg["coordinate_precision_digits"]
    out_features = []
    for tier, length_m, coords in segments:
        rounded = [[round(x, digits), round(y, digits)] for x, y in coords]
        out_features.append({
            "type": "Feature",
            "properties": {"tier": tier, "distanceM": round(length_m, 1)},
            "geometry": {"type": "LineString", "coordinates": rounded},
        })

    route_geojson = {"type": "FeatureCollection", "features": out_features}

    routes_dir = REPO_ROOT / cfg["output"]["routes_dir"]
    routes_dir.mkdir(parents=True, exist_ok=True)
    route_path = routes_dir / f"{args.slug}.geojson"
    route_path.write_text(json.dumps(route_geojson, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"-> {route_path} ({length_km:.1f}km, cycleway_share={share*100:.1f}%, {len(out_features)} segments)")

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
