# network_merge

## 目的

2026-09-22、ユーザー方針: 自転車専用道路ネットワークのデータソースに優先順位を
設ける。

1. **手動ネットワーク**(最優先。ユーザー自身が「自転車で走りやすい」と確認した
   区間や、自治体データより新しい・正確だと分かっている区間を直接登録する)
2. **自治体が提供するネットワーク**(2番目。都道府県・市区町村のオープンデータ)
3. **OpenStreetMap**(最後の補完。従来どおり`src/osm_survey`+
   `src/export_web/export_cycleway_network.py`で取得・tier分類済みのもの)

同じ場所に複数ソースの線が重複する場合は、**優先度の低い方(主にOSM側)を
空間的に間引く**(ユーザー方針、2026-09-22)。全部重ねて二重表示はしない。

これまで`src/export_web/export_cycleway_network.py`がOSM生データから直接
`docs/data/cycleway_network.geojson`(最終成果物)を作っていたが、本タスクで
その手前に「優先順位マージ」の工程を追加する。`export_cycleway_network.py`自体は
「OSMをtier分類する」役割のまま変更せず、出力先だけ中間ファイル
(`data/interim/cycleway_network_osm.geojson`)に変更する。

## 未決事項(2026-09-22時点。今回は着手しない/保留)

- **手動ネットワークの入力方法**: GeoJSON直接編集か、地図クリックで描ける専用
  エディタUIかは保留(ユーザー方針: 「保留で大丈夫」)。したがって本タスクでは
  入力方法を決め打ちしない。設定ファイルでパスを指定するだけの、方式に依存しない
  作りにする(下記「入力」参照)。ファイルが存在しなければ単にそのレイヤーを
  空として扱う
- **自治体データの具体的な取得**: 2026-09-22時点でまだ入手していない。候補調査を
  別途実施し、取得対象・データ形式・ライセンスをユーザーに報告してから
  ダウンロードする(CLAUDE.md「data/raw/が空の場合...」のルールに従う)。
  本タスクのマージ処理自体は、自治体データが後から追加されても動くように
  複数ファイルを受け付ける設計にしておく

## 計算・処理してほしいこと(`build_priority_network.py`)

1. **各レイヤーを読み込む**(`config.yaml`の`layers`に優先順位順で定義)
   - 各レイヤーは「1個以上のGeoJSONファイル(存在しなければスキップ)」+
     「そのレイヤーに属する全フィーチャに使うtierのデフォルト値」を持つ
   - 手動・自治体レイヤーのフィーチャは、`properties.tier`があればそれを使い、
     無ければレイヤーのデフォルトtierを使う(自治体データは基本的に「専用道路」
     として登録される想定なのでtier=2をデフォルトにする。要調整)
   - OSMレイヤーは`export_cycleway_network.py`が出力した中間ファイル
     (既にtier1〜5が付与済み)をそのまま使う
2. **優先度の高いレイヤーから順に、確定済みジオメトリを蓄積するバッファ
   ポリゴンを作る**(`config.yaml`の`dedup_buffer_m`、初期値は
   `export_web/config.yaml`の`cycleway_buffer_m`(15m)を踏襲)
   - レイヤーNを処理する際、レイヤー1〜N-1までの確定フィーチャを合成した
     バッファポリゴン(`shapely.ops.unary_union`)との`difference`を取り、
     重なる部分だけを間引く(線の一部だけが重複している場合は、重複しない
     残りの部分は生かす。低優先度の線をまるごと消すのではなく、既に高優先度で
     カバーされている区間だけを削る、という「間引く」という表現に忠実な実装)
   - 座標系はプレーンな緯度経度のままでは距離計算が不正確なため、
     `export_web/config.yaml`の`metric_crs`(EPSG:32654, UTM 54N)に投影してから
     バッファ・差分演算を行い、出力時にWGS84へ戻す(`network_connectivity`と
     同じ方針)
3. **全レイヤーのフィーチャ(間引き後)を結合して1つのFeatureCollectionにする**
   - `properties.source`に`"manual"` / `"municipal:<自治体名>"` /
     `"osm"`を必ず付与し、フロントの道路情報ポップアップやデータ出典表示で
     「このデータはどこから来たか」を確認できるようにする(CLAUDE.mdの
     出典表記ルールにも対応)
   - 座標は`export_web/config.yaml`の`coordinate_precision_digits`(6桁)で
     丸めて軽量化する
4. **出力**: `docs/data/cycleway_network.geojson`(最終成果物、フロントが読む
   ファイル名は変更しない)
5. `docs/data/attribution.json`に、使用した自治体データがあればその出典・
   ライセンスを追記する(手動データはユーザー自身の一次情報なので出典表記は
   不要)

## 入力

- `data/manual/manual_network.geojson`(手動ネットワーク。存在しなければ空扱い。
  スキーマは`docs/data/highway_routes.geojson`と同様のシンプルな形を暫定案とする
  が、確定ではない)
- `data/processed/municipal/*.geojson`(自治体データを変換したもの。ファイルが
  無ければ空扱い。1ファイル1自治体を想定し、ファイル名から`source`を組み立てる)
- `data/interim/cycleway_network_osm.geojson`
  (`export_cycleway_network.py`が出力するOSM由来の中間ファイル。tier1〜5付与済み)

## 出力

- `docs/data/cycleway_network.geojson`(最終成果物)
- `docs/data/attribution.json`への自治体データ出典の追記

## パラメータ(`config.yaml`)

- `layers`: 優先順位順のレイヤー定義リスト(`name`, `paths`(glob可),
  `default_tier`, `source_prefix`)
- `dedup_buffer_m`: 重複判定バッファ距離(m)
- `metric_crs`, `coordinate_precision_digits`: `export_web/config.yaml`と同じ値を
  踏襲(重複定義を避けるため、可能ならこのファイルから読み込む)

## 確認してほしいこと

- 自治体・手動データが両方まだ無い状態でパイプラインを流したとき、既存の
  `docs/data/cycleway_network.geojson`(OSMのみ)と**完全に同じ内容**が出力される
  こと(リグレッション確認。優先順位マージを挟んでも今の見た目・経路探索結果を
  壊さないことを保証する)
- 自治体データが手に入り次第、少数の区間で実際に重複除去(間引き)が機能して
  いることを目視確認する(地図上でOSM由来の線が自治体データの区間だけ消えている
  こと)
