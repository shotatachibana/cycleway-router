# r5_custom_cost

## 目的

CLAUDE.mdの「設計上の未決事項」1(2026-09-20 追記2: 自宅PCサーバー方式(B'))・
「専用道路の定義」の(iii)方式(専用道路クラスタ間を一般道で長さ上限・
ペナルティつきで接続)を実装する。R5をソースからフォークし、専用道路を低コスト・
一般道を高コストとして扱うカスタムコストロジックを組み込む。

## 事前調査で分かったこと(`src/r5_custom_cost/r5-src/`にクローン済み。gitignore対象)

- R5には`LaDotBikeCostSupplier`(LA市交通局向け)という前例があり、
  `EdgeTraversalTimes.setEdgePair(edgeIndex, way)`(`streets/EdgeTraversalTimes.java`)
  が、OSMの各Way(道路の区間)を読み込む際に呼ばれ、`SingleModeTraversalTimes.Supplier`
  インターフェース(`perceivedLengthMultipler()`: 距離に掛ける係数、
  `turnTimeSeconds()`: 右左折・交差点のペナルティ)を実装したオブジェクトを
  各エッジに割り当てる仕組みになっている(`streets/StreetLayer.java:1219-1226`)
- LA市の実装(`LaDotCostTags.java`)は、Annual Average Daily Traffic(AADT)や
  勾配など、**事前に外部データを使ってOSMのPBFに独自タグとして注入したもの**を
  読んでいる。今回はそのような外部データ(交通量統計等)は無いので、**標準の
  OSMタグ(`highway`, `cycleway`, `cycleway:left/right/both`)だけを見る、
  もっと単純な実装**にする
- `StreetLayer.loadFromOsm()`はway読み込み中に例外が起きると、その時点で
  `edgeStore.edgeTraversalTimes`を`null`にして機能全体を無効化してしまう
  (LA方式は「必須タグが無ければ例外」という設計のため)。今回の実装は常に
  存在する`highway`タグ等だけを見るので、この問題は起きない想定だが、
  念のため全てのタグアクセスでnullを許容する実装にする
- **「一般道の長さに厳密な上限をかける」機能はR5にネイティブには無い**
  (公式ドキュメント調査で確認済み)。今回は「一般道に強い倍率ペナルティを
  掛けることで、最短経路探索が自然に一般道の使用を最小化する」という
  **ソフトな実現**にとどめる。経路が計算された後、その経路に含まれる一般道の
  合計距離を別途集計し、「大きすぎる場合は警告表示する」という形で疑似的な
  上限チェックを行う(検索アルゴリズム自体には組み込まない)
- 徒歩・押し歩きアクセス区間の扱いは対象外(今回はBICYCLEモードのみ)

## 計算・処理してほしいこと

1. `com.conveyal.r5.streets`パッケージに`JapanCycleCostTags.java`を新規作成する。
   Wayから次を読み取る:
   - `highway`タグの値
   - `is_dedicated_cycleway`: `highway=cycleway`かどうか
   - `is_separated_track`: `cycleway`/`cycleway:left`/`cycleway:right`/
     `cycleway:both`のいずれかが`track`かどうか
2. `JapanCycleCostSupplier.java`を新規作成し、`SingleModeTraversalTimes.Supplier`を
   実装する:
   - `perceivedLengthMultipler()`:
     - `is_dedicated_cycleway`または`is_separated_track` → 1.0(専用道路は
       そのままの距離で評価)
     - それ以外(一般道) → `config`で指定する一般道ペナルティ係数
       (初期値は要ユーザー合意。「専用道路の定義」に記載したとおり、次に
       ユーザーと具体的な数値を相談する)
   - `turnTimeSeconds()`: 今回は0固定(信号・交差点ペナルティは将来の拡張)
3. `EdgeTraversalTimes.java`の`setEdgePair()`を改修し、BICYCLEモードには
   `JapanCycleCostTags`/`JapanCycleCostSupplier`を使うようにする(WALKモードは
   変更しない。今回対象外のため)
4. gradleでビルドし、コンパイルが通ることを確認する
5. 既存の`data/interim/osm_pbf/kanto_roads_filtered.osm.pbf`
   (`src/road_network/`で作成済み。residential/service/track等を含む一般道+
   cycleway)を使って、`R5Main point --build`でネットワークを構築できるか、
   小規模な経路検索(devcontainer内、品川駅・高崎駅近辺の座標)が通るかを確認する

## 入力

- `src/r5_custom_cost/r5-src/`(conveyal/r5のクローン。gitignore対象)
- `data/interim/osm_pbf/kanto_roads_filtered.osm.pbf`(`src/road_network/`で作成済み)

## 出力

`src/r5_custom_cost/r5-src/`自体はconveyal/r5のクローンなのでgitignore対象
(コミットしない)。**自作した差分はリポジトリに残すため、別途コピー・パッチとして
保存する**:

- `src/r5_custom_cost/java/JapanCycleCostTags.java`(新規)
- `src/r5_custom_cost/java/JapanCycleCostSupplier.java`(新規)
- `src/r5_custom_cost/java/EdgeTraversalTimes.java`(改修後の全文コピー)
- `src/r5_custom_cost/java/PointToPointRouterServer.java`(改修後の全文コピー。
  `/plan`の`distanceLimitMeters`を100km→400kmに変更)
- `src/r5_custom_cost/patch/japan_cycle_cost.patch`(`r5-src/`に対する差分。
  `git apply`で再現できる)
- ビルドしたjar(`data/interim/`または`src/r5_custom_cost/r5-src/build/`。
  gitignore対象。63MB程度あり、コミットしない)

**再現手順**(新しいdevcontainerや別マシンで再度作業する場合。patchに新規ファイル2つ
分も含まれているので`git apply`だけで再現できる):
```bash
git clone https://github.com/conveyal/r5.git src/r5_custom_cost/r5-src
cd src/r5_custom_cost/r5-src
git apply ../patch/japan_cycle_cost.patch
gradle shadowJar -x test   # gradleが無ければ https://gradle.org/releases/ から導入
```
- 動作確認ログ・スクリーンショット等があれば`results/`配下

## 確認してほしいこと

- 一般道ペナルティ係数の初期値をユーザーと合意する(次のタスクで相談)
- コンパイル・小規模な経路検索が通るか
- 「専用道路優先」の意図通りに経路が変わっているか(専用道路がある区間では
  そちらを通り、無い区間だけ一般道を使うか)を目視確認する
