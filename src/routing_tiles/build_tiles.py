"""一般道路網(data/interim/osm_pbf/kanto_roads_filtered.osm.pbf)を地理タイルに分割し、
docs/data/tiles/ に出力する。近距離検索の実用性向上のため、専用道路・自転車レーン・
車道混在だけでは足りない場合に、出発地・目的地周辺の一般道をブラウザが動的に
読み込んで経路探索に使えるようにする(instruction.md参照)。
"""
import json
import math
from pathlib import Path

import osmium
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


class TileBuilder(osmium.SimpleHandler):
    def __init__(self, cfg):
        super().__init__()
        self.cfg = cfg
        self.bounds = cfg["bounds"]
        self.tile_size = cfg["tile_size_deg"]
        self.digits = cfg["coordinate_precision_digits"]
        self.exclude = set(cfg["exclude_highway"])
        self.tiles = {}  # (col, row) -> list of features
        self.n_ways = 0
        self.n_skipped = 0

    def tile_index(self, lon, lat):
        col = math.floor((lon - self.bounds["min_lon"]) / self.tile_size)
        row = math.floor((lat - self.bounds["min_lat"]) / self.tile_size)
        return col, row

    def way(self, w):
        highway = w.tags.get("highway")
        if not highway or highway in self.exclude:
            return
        if len(w.nodes) < 2:
            return
        try:
            coords = [[round(n.lon, self.digits), round(n.lat, self.digits)] for n in w.nodes]
        except osmium.InvalidLocationError:
            self.n_skipped += 1
            return

        self.n_ways += 1
        feature = {
            "type": "Feature",
            "properties": {"id": w.id, "highway": highway},
            "geometry": {"type": "LineString", "coordinates": coords},
        }
        touched_tiles = {self.tile_index(lon, lat) for lon, lat in coords}
        for tile_key in touched_tiles:
            self.tiles.setdefault(tile_key, []).append(feature)


def main():
    cfg = load_config()
    tiles_dir = REPO_ROOT / cfg["output"]["tiles_dir"]
    tiles_dir.mkdir(parents=True, exist_ok=True)

    print("PBFを読み込んでタイルに分割中...")
    builder = TileBuilder(cfg)
    builder.apply_file(REPO_ROOT / cfg["input"]["roads_pbf"], locations=True)
    print(f"対象way数: {builder.n_ways} (スキップ: {builder.n_skipped}), タイル数: {len(builder.tiles)}")

    index = {"tile_size_deg": cfg["tile_size_deg"], "tiles": []}
    for (col, row), features in builder.tiles.items():
        out = {"type": "FeatureCollection", "features": features}
        filename = f"{col}_{row}.geojson"
        out_path = tiles_dir / filename
        out_path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        min_lon = cfg["bounds"]["min_lon"] + col * cfg["tile_size_deg"]
        min_lat = cfg["bounds"]["min_lat"] + row * cfg["tile_size_deg"]
        index["tiles"].append({
            "col": col,
            "row": row,
            "minLon": round(min_lon, 4),
            "minLat": round(min_lat, 4),
            "maxLon": round(min_lon + cfg["tile_size_deg"], 4),
            "maxLat": round(min_lat + cfg["tile_size_deg"], 4),
            "file": filename,
            "sizeBytes": out_path.stat().st_size,
            "nFeatures": len(features),
        })

    index_path = REPO_ROOT / cfg["output"]["index_file"]
    index_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    sizes = [t["sizeBytes"] for t in index["tiles"]]
    total_mb = sum(sizes) / 1e6
    print(f"-> {len(index['tiles'])} タイル、合計 {total_mb:.1f} MB")
    print(f"   最大タイル: {max(sizes)/1e6:.2f} MB, 中央値: {sorted(sizes)[len(sizes)//2]/1e6:.2f} MB")
    print(f"-> {index_path}")


if __name__ == "__main__":
    main()
