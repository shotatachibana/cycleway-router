"""東京都建設局「自転車走行空間について」のシェープファイル(ZIP)を取得する。

data/raw/はGit管理対象外のため、再実行して復元できるようにこのスクリプトに
URLを記録している。詳細はinstruction.md参照。
"""
from pathlib import Path

import requests
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"

# CKANカタログのCloudFront/WAFが素のrequestsのUser-Agentを弾くため、
# 一般的なブラウザのUser-Agentを付与する。
HEADERS = {"User-Agent": "Mozilla/5.0"}


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def main():
    cfg = load_config()["tokyo"]
    for name, res in cfg["resources"].items():
        out_path = REPO_ROOT / res["zip_path"]
        if out_path.exists():
            print(f"{name}: 既に存在するためスキップ ({out_path})")
            continue
        out_path.parent.mkdir(parents=True, exist_ok=True)
        resp = requests.get(res["url"], headers=HEADERS, timeout=30)
        resp.raise_for_status()
        out_path.write_bytes(resp.content)
        print(f"{name}: {len(resp.content)} bytes -> {out_path}")


if __name__ == "__main__":
    main()
