# municipal_data

## 目的

CLAUDE.md「専用道路の定義」の「データソースの優先順位」(2026-09-22)に対応する、
自治体オープンデータの取得・変換タスク。事前の候補調査(log.md 2026-09-22
00:43参照)の結果、関東地方で機械可読なGIS(自転車走行空間)を公開しているのは
**東京都建設局「自転車走行空間について」**がほぼ唯一の実例だったため、まず
これを取り込む。

`src/network_merge/`が読み込む`data/processed/municipal/*.geojson`
(1自治体1ファイル)を作るのがこのタスクの役割。`network_merge`側の優先順位
マージ・重複トリム処理はこのタスクの範囲外(instruction.md参照)。

## データソース

CKAN API(`https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?
id=t000014d0000000026`)で確認。

- ライセンス: `CC-BY-4.0`(クリエイティブ・コモンズ 表示、
  https://creativecommons.org/licenses/by/4.0/deed.ja )
- リソース1: 自転車推奨ルート(シェープファイル、EPSG:4612)。218区間
  - `https://www.kensetsu.metro.tokyo.lg.jp/documents/d/kensetsu/000035730`
- リソース2: 優先整備区間(シェープファイル、EPSG:2451)。112区間
  - `https://www.kensetsu.metro.tokyo.lg.jp/content/000035729.zip`
  - CKANのメタデータ上のURLは`kensetsu.metro.tokyo.jg.jp`(jg.jpの誤植と
    思われる)になっていたが、`lg.jp`に直すと301リダイレクトで正しく取得できた

いずれもZIPのファイル名・shapefileの属性(.dbf)フィールド名がShift-JISで
エンコードされているため、Pythonの`zipfile`で展開する際は`cp437`で読んだ
バイト列を`shift_jis`で再デコードする必要がある(標準のunzipコマンドは文字化け
する)。`geopandas.read_file(..., encoding="shift_jis")`で属性を読む。

## 判明した内容と、ユーザーと合意した扱い(2026-09-22)

実際にダウンロードして中身を確認した結果、想定と異なる点があった:

- 「自転車推奨ルート」は名前の通り**推奨ルート**であり、属性`整備状況`の
  内訳は「整備済44件 / 未整備174件」。8割は未整備(車道混在のまま)
- 「優先整備区間」は属性`凡例名称`の内訳が「優先整備区間(計画中)76件 /
  平成23年度までの整備済み箇所36件」。優先整備区間は将来の整備計画であり、
  現時点では未整備
- どちらのデータセットにも、「車道から物理的に分離されているか」
  「単なる車道上のペイントレーンか」を区別する属性が無い

CLAUDE.mdの「専用道路の定義」(車道から独立した自転車専用の道のみ)に
そのまま合致するとは断定できないため、以下の方針で合意した:

1. **「整備済」系だけを取り込む**(自転車推奨ルートの`整備状況=整備済`(44件)+
   優先整備区間の`凡例名称=平成23年度までの整備済み箇所`(36件)、計80件)。
   未整備・計画中の区間は取り込まない(将来使えるようになったら再検討)
2. 車道分離型かペイントレーンかが不明なため、**tier5(分離型自転車道、近似)と
   同等の扱いにする**(tier1〜4の「完全専用」とは視覚的に区別し、過大評価しない。
   経路探索の重みはtier1〜4と同じ1.0のまま[weightForFeatureの仕様])

## 計算・処理してほしいこと

1. `fetch_tokyo.py`: 上記2つのZIPを`data/raw/municipal_tokyo/`にダウンロードする
   (既に存在する場合は再ダウンロードしない)
2. `convert_tokyo.py`:
   - ZIPを展開(ファイル名の文字コード変換に注意)
   - 各shapefileを`encoding="shift_jis"`で読み込み
   - 「整備済」系のみフィルタ
   - 座標系をEPSG:4326に変換(`geopandas.to_crs`)
   - `coordinate_precision_digits`(6桁、`export_web/config.yaml`と共通)で
     座標を丸める
   - 出力スキーマ: `{"properties": {"name": <区間番号 or 凡例名称>, "tier": 5,
     "attribution": "東京都建設局「自転車走行空間について」(CC BY 4.0)",
     "dataset": "recommended_route" or "priority_section"}, "geometry": ...}`
   - `data/processed/municipal/tokyo_kensetsukyoku.geojson`に出力
     (ファイル名の`tokyo_kensetsukyoku`部分が`network_merge`側で
     `source: "municipal:tokyo_kensetsukyoku"`として使われる)

## 入力

- `data/raw/municipal_tokyo/*.zip`(`fetch_tokyo.py`が取得)

## 出力

- `data/processed/municipal/tokyo_kensetsukyoku.geojson`

## 確認してほしいこと

- 出力件数が80件であること(44+36。重複や取りこぼしが無いか)
- `docs/data/attribution.json`・`data/datasets.txt`に東京都建設局のデータの
  出典・ライセンスを記載したか
- `docs/assets/main.js`の道路情報ポップアップ(`formatRoadInfoPopup`)が、
  OSM由来ではない区間(`props.id`が無い)でもOSMへのリンクを出さず、
  正しい出典を表示するように分岐しているか
