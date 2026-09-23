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
     (例: `data/interim/r5_kanto/plan_shinagawa_takasaki3.json`)
   - 出力: `docs/data/routes/<slug>.geojson`(区間ごとに分けた複数LineStringの
     FeatureCollection。各Featureの`properties`に`tier`(1=専用道路/8=一般道路)・
     `distanceM`を持たせ、近距離検索の結果(`docs/assets/main.js`の
     `renderSegmentList`)と全く同じ形式で「どの道路を通るか」の内訳を
     表示できるようにする。2026-09-22変更、経緯はlog.md参照)+
     `docs/data/routes/index.json`への追記(name, slug, 距離km, 専用道路比率,
     出発地/目的地の代表座標, 作成日)
   - **2026-09-22変更**: 専用道路比率は、以前は`highway=cycleway`網との空間突合
     (バッファ15m)という近似計算だったが、R5が実際の経路選択に使った分類
     (`JapanCycleCostSupplier`の`perceivedLengthMultipler()`、専用道路=1.0倍・
     一般道=5.0倍)をそのまま`/plan`のレスポンスに含めるよう
     `src/r5_custom_cost/java/PointToPointRouterServer.java`の`fillFeature()`を
     改修し(`feature.addProperty("dedicated", bikeFactor <= 1.0001)`)、そちらを
     正とするように変更した(経路選択の根拠とdisplayの根拠が一致し、より正確なため)。
     隣接する同分類の区間はまとめ、20m未満の短い断片は前の区間に吸収する
     (近距離検索の`MIN_SEGMENT_M`と同じ考え方)
   - 新しいルートを追加するたびに、この2本目のスクリプトを実行する運用にする
     (`docs/data/routes/index.json`は追記型)。R5サーバーの再ビルド・再起動が
     必要な場合の手順は`src/r5_custom_cost/instruction.md`参照

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
