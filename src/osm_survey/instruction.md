# osm_survey

## 目的

関東地方における、自転車専用道路(CLAUDE.mdの「『専用道路』の定義」参照)の
OSM上での整備状況を定量的に把握する。CLAUDE.mdの「設計上の未決事項」3
(「対象地域でのOSMの入力状況の定量確認」)、および2(専用道路だけのネットワークの
連結性の見立て)の前段にあたる調査タスク。

この結果を見たうえで、
- 対象地域を関東地方全体のまま扱うか、市区町村単位等に絞り込むか
- 交差点・横断区間をどこまで許容するか(横断の最大回数・長さの基準)

をユーザーと合意する。**このタスク自体はネットワーク構築や経路検索は行わず、
集計・可視化のみ行う。**

## 計算・処理してほしいこと

Overpass API(`overpass-api.de`)を使い、関東地方(OSM relation id=1803923,
`boundary=civil`, `admin_level=3`)の範囲内で、CLAUDE.mdの「専用道路の定義」に
対応する2種類の対象を取得する。

1. **独立したcycleway**: `way["highway"="cycleway"]`
   - 属性集計: `foot`(yes/no/未設定)、`segregated`(yes/no/未設定)、
     `bicycle`、`surface`、`lit` の分布
2. **車道沿いの分離型自転車道**: `cycleway=track` / `cycleway:left=track` /
   `cycleway:right=track` タグを持つ道路ウェイ
   - この場合、道路ウェイ全体ではなく「自転車道部分がある」ことの延長集計に
     とどめる(実際のネットワーク上の切り出しは次のタスクで行う)

集計内容:
- 種別ごと・属性値ごとの延長(km)とway数
- 都県別の内訳(way の代表点がどの都県に属するかで簡易集計。GeoPandasの
  空間結合を使う。関東の都県境界もOverpassまたはNominatimから取得)
- 地図上の分布を確認できるよう、種別で色分けしたGeoJSON/PNGを出力

対象地域・タグ条件は`config.yaml`に外出しし、後で対象地域を変えて再実行できる
ようにする。

## 入力

- Overpass APIから新規取得(`data/raw/`に保存。取得日・クエリ内容を
  `data/datasets.txt`に記録する)
- 取得前に、想定データ量・ライセンス(OSM/ODbL)をユーザーに報告し確認を得ること
  (`data/raw/`が空の状態からの初回取得のため。CLAUDE.md「データの扱いに関する注意」)
- Overpassへのリクエストは`curl`ではなく`User-Agent`ヘッダを付けたPython
  (`urllib`または`requests`)で行うこと。`curl`のデフォルトUser-Agentでは
  `overpass-api.de`から406 Not Acceptableで拒否されることを確認済み(2026-09-20)

## 出力

- `data/raw/osm_survey/kanto_cycleway_raw.geojson`: Overpassから取得した生データ
  (GeoJSON化したもの。gitignore対象)
- `results/tables/osm_survey_kanto_summary.csv`: 種別・属性・都県別の延長集計
- `results/figures/osm_survey_kanto_map.png`(または`.html`): 種別で色分けした
  分布図(foliumでの簡易確認用)
- `data/datasets.txt`にOverpassクエリの出典・取得日・ライセンスを追記

## 確認してほしいこと

- 関東地方全体でのcyclewayの総延長・件数が、体感(現実の整備状況)と大きく
  乖離していないか
- `foot`/`segregated`等の属性の欠損率(タグ付けが甘い場合、専用/共用の判定が
  難しくなる)
- 都県別の延長のばらつき(特定の都県にデータが偏っていないか)
- この結果をもとに、対象地域を関東地方のまま進めるか絞り込むかをユーザーに
  提案する(次のタスクへの申し送り)
