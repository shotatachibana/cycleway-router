"""data/raw/osm_survey/の生データを、フロントエンド配信用の軽量GeoJSONに変換する。

CLAUDE.mdの「専用道路の定義」に沿って、独立cycleway(highway=cycleway)と
車道沿いの分離型自転車道(cycleway(:left/:right/:both)=track)を
"専用道路ネットワーク"(cycleway_network.geojson。ブラウザ内経路探索の対象)として出力する。

あわせて、東京都の自転車通行空間マップ(wagmap、2026-09-20参照)の分類を参考に、
「専用」には含めないが地図上で参考表示したい低位カテゴリ
(自転車専用通行帯=ペイントのみの車道上レーン、車道混在=矢羽根等)を
"reference_infrastructure.geojson"として別ファイルに出力する。
こちらは経路探索には使わない(CLAUDE.mdの「専用道路の定義」は変更していない)。

tier(cycleway_network.geojson側):
  1 = 完全専用(highway=cycleway かつ foot=no。歩行者非対応)
  2 = 専用+歩行者分離(highway=cycleway かつ segregated=yes)
  3 = 専用(歩行者共用、foot=yes/designated。segregated明記なし)
  4 = 専用(属性不明。foot/segregatedタグなし)
  5 = 分離型自転車道(cycleway=track系。道路ウェイの形状を近似として使用。
      実際の自転車道部分のオフセット抽出は未対応 - instruction.md参照)

tier(reference_infrastructure.geojson側):
  6 = 自転車専用通行帯(cycleway=lane系。ペイント区分のみ、車道走行)
  7 = 車道混在(cycleway=shared_lane系。矢羽根等の表示のみ)
"""
import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def classify_independent_cycleway_tier(tags):
    foot = tags.get("foot")
    segregated = tags.get("segregated")
    if foot == "no":
        return 1
    if segregated == "yes":
        return 2
    if foot in ("yes", "designated"):
        return 3
    return 4


def load_features(path, digits, tier_fn, kind):
    raw = json.loads(path.read_text(encoding="utf-8"))
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
                "kind": kind,
                "tier": tier_fn(tags),
                "foot": tags.get("foot"),
                "segregated": tags.get("segregated"),
                "surface": tags.get("surface"),
                "name": tags.get("name"),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    return features


def write_geojson(features, out_path):
    out = {"type": "FeatureCollection", "features": features}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    tier_counts = {}
    for f in features:
        t = f["properties"]["tier"]
        tier_counts[t] = tier_counts.get(t, 0) + 1
    print(f"{len(features)} features -> {out_path} ({out_path.stat().st_size/1e6:.2f} MB)")
    print(f"tier counts: {tier_counts}")


def main():
    cfg = load_config()
    digits = cfg["coordinate_precision_digits"]

    routable_features = []
    routable_features += load_features(
        REPO_ROOT / cfg["input"]["cycleway_raw"], digits,
        classify_independent_cycleway_tier, "independent_cycleway",
    )
    routable_features += load_features(
        REPO_ROOT / cfg["input"]["separated_track_raw"], digits,
        lambda tags: 5, "separated_track",
    )
    write_geojson(routable_features, REPO_ROOT / cfg["output"]["cycleway_geojson"])

    reference_features = []
    reference_features += load_features(
        REPO_ROOT / cfg["input"]["painted_lane_raw"], digits,
        lambda tags: 6, "painted_lane",
    )
    reference_features += load_features(
        REPO_ROOT / cfg["input"]["shared_lane_raw"], digits,
        lambda tags: 7, "shared_lane",
    )
    write_geojson(reference_features, REPO_ROOT / cfg["output"]["reference_geojson"])

    attribution = {
        "source": "OpenStreetMap contributors",
        "license": "ODbL",
        "license_url": "https://opendatacommons.org/licenses/odbl/",
        "attribution_text": "© OpenStreetMap contributors",
        "note": (
            "専用道路ネットワーク(cycleway_network.geojson)は highway=cycleway と "
            "cycleway(:left/:right/:both)=track をOverpass APIで抽出(2026-09-20)。"
            "分離型自転車道(tier=5)は道路ウェイの形状を近似として使用しており、"
            "実際の自転車道部分のオフセット位置とは異なる場合がある。"
            "参考表示レイヤー(reference_infrastructure.geojson、tier=6,7)は"
            "cycleway=lane/shared_lane系。経路探索には使用していない。"
            "分類は東京都都市整備局の自転車関連情報マップ"
            "(https://www2.wagmap.jp/tokyo_tokeizu/)の考え方を参考にした。"
        ),
    }
    attr_path = REPO_ROOT / cfg["output"]["attribution"]
    attr_path.write_text(json.dumps(attribution, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"-> {attr_path}")


if __name__ == "__main__":
    main()
