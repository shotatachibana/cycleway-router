# highway_routes

## 目的

CLAUDE.mdの「専用道路の定義」に、2026-09-22の方針転換を追記する前提の
タスク。ユーザー方針(2026-09-22):

- 「高速道路風(縁取り+太字の名前バッジ)に見せる**サイクリングロード**」は、
  OSMのtier・name・長さからの推測(ヒューリスティック)には一切頼らず、
  **ユーザーが道路名を個別に指定する**方式に統一する
- それ以外(自転車道が整備された一般の車道等)は、従来どおりOSM・自治体データ
  から自動的に取得・分類してよい(`docs/data/cycleway_network.geojson`。
  tier1〜5、通常の色分け表示で、高速道路風の見た目にはしない)
- ジオメトリの作り方は、**ユーザーがOSM活用によるジオメトリ抽出作業を楽にする
  ことを了承**したため、「名前を指定→OSMの`name`タグ完全一致で抽出」を採用する
  (2026-09-22確認)。選ぶ(どの名前を対象にするか)のは人間、抽出作業だけ
  OSMを流用する、という役割分担

このタスクは`data/highway_routes.geojson`(実体は`docs/data/highway_routes.geojson`。
フロントが直接読む)を作る/更新するための変換スクリプトを用意する。

## 計算・処理してほしいこと

1. `config.yaml`に、対象の道路名を列挙する(`routes: [{name: "...",
   aliases: ["...", ...]}, ...]`)。`aliases`は「OSM上で表記ゆれ・迂回路等の
   別名で登録されている場合」に追加する任意項目(無ければ`name`のみで完全一致)
2. `extract_named_routes.py`:
   - `data/raw/osm_survey/kanto_independent_cycleway.json`
     (highway=cycleway)と`data/raw/osm_survey/kanto_separated_track.json`
     (cycleway=track系)の両方から、`tags.name`が`name`または`aliases`の
     いずれかに**完全一致**するwayを集める(部分一致はしない。無関係な道路を
     誤って拾わないため)
   - **2026-09-22追加(接続区間の芋づる式抽出)**: name一致だけだと、実際には
     繋がっている道なのに交差点ごとのway分割で無名・別名の区間が挟まり
     途切れて見える問題があった(例: 多摩川サイクリングロードはname一致78way
     だが、実際に座標が繋がっている接続区間が156way分ある)。これに対応する
     ため、`data/raw/osm_survey/`の2ファイル全体で座標ベースの連結成分分析
     (`network_connectivity`と同じ手法。頂点座標の完全一致+
     `connect_tolerance_m`以内の端点統合)を行い、name一致したwayと**同じ
     連結成分に属する他のway(無名・別名でも)は自動的に含める**。
     ジオメトリの座標を捏造して繋ぐことはしない(実在するwayを辿るだけ)
   - それでも同じ連結成分にならない(=`connect_tolerance_m`より大きい空白が
     残る)場合は、その箇所数を警告として出力する。対応方法は3つ:
     (a) 表記ゆれが原因なら`aliases`に別名を追加する、
     (b) OSMに該当区間のwayが存在するが名前が無いだけなら、そのwayをOSM上で
     見つけて`aliases`に追加するか、OSM自体を編集して`name`タグを付ける、
     (c) OSMに該当区間のwayが存在しない(未整備・未マッピング)場合は、
     実際にその場所を確認したうえでOSMにway自体を追加する(ユーザーが現地に
     行く用事がある場合はこれが最も正確。MEMO.md「多摩川に行きたい」参照)。
     現時点では、座標を手打ちで補うマニュアル区間の仕組みは用意していない
     (実在しない座標を作ることになりがちで、実際の道の形と合わなくなる
     リスクがあるため。必要になれば改めて検討する)
   - 該当wayが1件も無い場合は、その`routes`エントリをスキップして警告を出す
     (静かに無視しない。ユーザーが名前を間違えた・OSMに無い場合に気づけるように)
   - 集めたway群(name一致+接続区間)を1つのMultiLineString(またはway数が
     1件ならLineString)にまとめ、`{"properties": {"name": <name>},
     "geometry": ...}`という`docs/data/highway_routes.geojson`のスキーマに
     合わせて出力する
   - 座標は`coordinate_precision_digits`(6桁、他スクリプトと共通)で丸める
   - **`config.yaml`の`routes`一覧から毎回全体を再生成する**(追記ではなく
     置き換え。config.yamlが正)
3. 出力は`docs/data/highway_routes.geojson`を上書きする

## 入力

- `data/raw/osm_survey/kanto_independent_cycleway.json`
- `data/raw/osm_survey/kanto_separated_track.json`
- `src/highway_routes/config.yaml`(道路名一覧。ユーザーが追記していく)

## 出力

- `docs/data/highway_routes.geojson`

## 確認してほしいこと

- 指定した道路名がOSM上に実在し、意図した区間だけが抽出されているか
  (地図で目視確認。無関係な道路が紛れ込んでいないか)
- 該当が見つからなかった名前が警告として出るか
- `docs/assets/main.js`側の高速道路風レイヤー(`highway-route-casing`/
  `highway-route-badge`)がこのファイルだけを見ていて、
  `cycleway_network.geojson`側のtier・長さ等を一切参照していないこと
  (2026-09-22時点で確認済み。今後リグレッションさせないこと)
