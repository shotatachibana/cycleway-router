"""関東地方のcycleway関連データをOverpass APIから取得し、data/raw/osm_survey/に保存する。

注意: overpass-api.de は curl のデフォルト User-Agent だと 406 を返す
(2026-09-20 確認)。必ずカスタム User-Agent を付けたリクエストを使うこと。
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def run_overpass_query(query: str, cfg: dict) -> dict:
    ov = cfg["overpass"]
    last_err = None
    for endpoint in ov["endpoints"]:
        try:
            req = urllib.request.Request(
                endpoint,
                data=query.encode("utf-8"),
                headers={"User-Agent": ov["user_agent"]},
            )
            with urllib.request.urlopen(req, timeout=ov["timeout_s"]) as resp:
                return json.loads(resp.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            print(f"  [warn] {endpoint} failed: {e}", file=sys.stderr)
            last_err = e
            time.sleep(2)
    raise RuntimeError(f"すべてのOverpassエンドポイントで失敗しました: {last_err}")


def build_independent_cycleway_query(cfg: dict) -> str:
    rel_id = cfg["region"]["osm_relation_id"]
    area_id = 3600000000 + rel_id  # Overpass area id = 3.6e9 + relation id
    tag = cfg["tags"]["independent_cycleway"]
    return f"""
[out:json][timeout:{cfg['overpass']['timeout_s']}];
area({area_id})->.searchArea;
way["{tag['key']}"="{tag['value']}"](area.searchArea);
out tags geom;
""".strip()


def build_cycleway_value_query(cfg: dict, tag_key: str) -> str:
    """cycleway(:left/:right/:both)=<value> の形式で書ける複数タグを1クエリにまとめる。

    separated_track・painted_lane・shared_lane で共通の形なので汎用化した。
    """
    rel_id = cfg["region"]["osm_relation_id"]
    area_id = 3600000000 + rel_id
    keys = cfg["tags"][tag_key]["keys"]
    value = cfg["tags"][tag_key]["value"]
    filters = "".join(f'way["{k}"="{value}"](area.searchArea);' for k in keys)
    return f"""
[out:json][timeout:{cfg['overpass']['timeout_s']}];
area({area_id})->.searchArea;
(
{filters}
);
out tags geom;
""".strip()


def build_separated_track_query(cfg: dict) -> str:
    return build_cycleway_value_query(cfg, "separated_track")


def build_prefecture_query(cfg: dict) -> str:
    # 都県ポリゴンを組み立てるにはメンバーウェイのgeometryが必要なので "out geom;" を使う
    # ("out tags geom;" では relation の members が省略される)
    rel_id = cfg["region"]["osm_relation_id"]
    area_id = 3600000000 + rel_id
    return f"""
[out:json][timeout:{cfg['overpass']['timeout_s']}];
area({area_id})->.searchArea;
relation["admin_level"="4"]["boundary"="administrative"](area.searchArea);
out geom;
""".strip()


def main():
    cfg = load_config()
    raw_dir = REPO_ROOT / cfg["output"]["raw_dir"]
    raw_dir.mkdir(parents=True, exist_ok=True)

    print("[1/3] 独立したcycleway(highway=cycleway)を取得中...")
    indep = run_overpass_query(build_independent_cycleway_query(cfg), cfg)
    out_path = REPO_ROOT / cfg["output"]["raw_json_independent"]
    out_path.write_text(json.dumps(indep, ensure_ascii=False), encoding="utf-8")
    print(f"  -> {out_path} ({len(indep.get('elements', []))} elements)")

    print("[2/3] 車道沿いの分離型自転車道(cycleway(:left/:right/:both)=track)を取得中...")
    sep = run_overpass_query(build_separated_track_query(cfg), cfg)
    out_path = REPO_ROOT / cfg["output"]["raw_json_separated"]
    out_path.write_text(json.dumps(sep, ensure_ascii=False), encoding="utf-8")
    print(f"  -> {out_path} ({len(sep.get('elements', []))} elements)")

    print("[3/5] 都県境界(admin_level=4)を取得中...")
    pref = run_overpass_query(build_prefecture_query(cfg), cfg)
    out_path = raw_dir / "kanto_prefectures.json"
    out_path.write_text(json.dumps(pref, ensure_ascii=False), encoding="utf-8")
    print(f"  -> {out_path} ({len(pref.get('elements', []))} elements)")

    print("[4/5] 参考表示用: 自転車専用通行帯(cycleway=lane系)を取得中...")
    lane = run_overpass_query(build_cycleway_value_query(cfg, "painted_lane"), cfg)
    out_path = REPO_ROOT / cfg["output"]["raw_json_painted_lane"]
    out_path.write_text(json.dumps(lane, ensure_ascii=False), encoding="utf-8")
    print(f"  -> {out_path} ({len(lane.get('elements', []))} elements)")

    print("[5/5] 参考表示用: 車道混在(cycleway=shared_lane系)を取得中...")
    shared = run_overpass_query(build_cycleway_value_query(cfg, "shared_lane"), cfg)
    out_path = REPO_ROOT / cfg["output"]["raw_json_shared_lane"]
    out_path.write_text(json.dumps(shared, ensure_ascii=False), encoding="utf-8")
    print(f"  -> {out_path} ({len(shared.get('elements', []))} elements)")

    print("完了。次は summarize.py を実行してください。")


if __name__ == "__main__":
    main()
