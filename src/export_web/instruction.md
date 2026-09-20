# export_web

## 目的

CLAUDE.mdのパイプライン構成[4] export_webに対応。CLAUDE.mdの「設計上の未決事項」1
(2026-09-20 追記3: サーバーを持たない(A)+(C)ハイブリッド方式)で確定した内容を
`docs/`(GitHub Pages配信物)に反映する。

- (C) クライアントサイド用: 専用道路ネットワークを軽量GeoJSONとして`docs/data/`に置く
- (A) 事前計算用: `src/r5_custom_cost/`でR5を手動実行して得た長距離ルートの結果を
  GeoJSON化し、メタデータ(距離・専用道路比率・説明)とともに`docs/data/routes/`に置く

## 計算・処理してほしいこと

1. **cyclewayネットワークの変換**(`export_cycleway_network.py`):
   - 入力: `data/raw/osm_survey/kanto_independent_cycleway.json`
     (Overpass生データ。`src/osm_survey/`で取得済み)
   - 出力: `docs/data/cycleway_network.geojson`
   - 座標は小数点以下6桁程度に丸め、不要なタグは削って軽量化する
   - 出典表記(`© OpenStreetMap contributors`、ODbL)をプロパティまたは
     別途`docs/data/attribution.json`に記録する
2. **事前計算ルートの変換**(`export_precomputed_route.py`):
   - 入力: R5の`/plan`エンドポイントが返すJSON
     (例: `data/interim/r5_kanto/plan_shinagawa_takasaki2.json`)
   - 出力: `docs/data/routes/<slug>.geojson`(1本のLineStringにまとめる)+
     `docs/data/routes/index.json`への追記(name, slug, 距離km, 専用道路比率,
     出発地/目的地の代表座標, 作成日)
   - 専用道路比率は`highway=cycleway`網との空間突合(バッファ15m)で計算する
     (`src/network_connectivity/`と同様の手法)
   - 新しいルートを追加するたびに、この2本目のスクリプトを実行する運用にする
     (`docs/data/routes/index.json`は追記型)

パラメータ(バッファ距離・座標丸め桁数等)は`config.yaml`に外出しする。

## 入力

- `data/raw/osm_survey/kanto_independent_cycleway.json`
- R5の`/plan`出力(`data/interim/r5_kanto/plan_*.json`。手動でR5を動かして生成)

## 出力

- `docs/data/cycleway_network.geojson`
- `docs/data/routes/<slug>.geojson`
- `docs/data/routes/index.json`
- `docs/data/attribution.json`(出典表記)

## 確認してほしいこと

- `docs/data/cycleway_network.geojson`のファイルサイズが妥当か(目安: 数MB程度)
- フロントエンド(`src/frontend`ではなく`docs/`直下に実装)から正しく読み込めるか
