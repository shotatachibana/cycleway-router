# cycleway-router

自転車専用道路(車道から独立した自転車専用の道)だけをつなぎ合わせたネットワークで
経路検索できる、個人用のWebサービス。経路検索エンジンにはR5(Python版ラッパー: r5py)を使い、
公開用のフロントエンドはGitHub Pagesで配信する。

プロジェクト全体の方針・「専用道路」の定義・設計上の未決事項は [`CLAUDE.md`](CLAUDE.md) を参照。

## セットアップ(Dev Container)

**Docker上のDev Containerの中だけで、開発・データ処理・R5の実行・画面の確認まで完結する**構成。
ローカル(ホスト)にPython・Java・osmium等を個別インストールする必要はない。

### 前提

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)(WindowsはWSL2バックエンドを選択)
- Visual Studio Code + 拡張機能「Dev Containers」

### 手順

1. このリポジトリをGitHubに作成し、`git clone`する
2. VS Codeでフォルダを開く
3. コマンドパレット(`Ctrl+Shift+P` / `Cmd+Shift+P`)→ **Dev Containers: Reopen in Container**
4. 初回はビルドに数分かかる。`.devcontainer/` の定義により、次の環境が1つのコンテナに揃う
   - Python 3.12
   - JDK 21(R5が要求。Eclipse Temurin)
   - Claude Code
   - `osmium-tool`(OSM PBFの絞り込み・切り出し)、`gdal-bin`(`ogr2ogr`等)、日本語フォント
5. ビルド後、`requirements.txt` の依存パッケージが `postCreateCommand` で自動インストールされる
6. VS Code内蔵ターミナルで、環境が整っているか確認する
   ```bash
   java -version          # 21以上であること
   osmium --version
   python -c "import r5py; print(r5py.__version__)"
   ```
7. Claude Codeを起動してサインイン
   ```bash
   claude
   ```
   ※ すべての確認をスキップして自律実行させたい場合は `--dangerously-skip-permissions`
   フラグ付きで起動する(Bypass Permissions Mode)。コンテナはリポジトリのフォルダ以外に
   構造的にアクセスできないので、ホスト全体に対して実行させるよりは被害範囲が限定される。
   ただし、コンテナ内からはインターネットに自由にアクセスでき、`git push` の認証情報が
   使える状態でもある点には注意すること。
8. (任意)スマホ等から操作したい場合は、セッション内で `/remote-control` を入力

### 補足

- ファイルの実体はホスト側のリポジトリフォルダにあり(bind mount)、コンテナはそのフォルダ以外に
  構造的にアクセスできない
- Claude Codeの認証情報は名前付きボリュームに永続化されるので、コンテナを作り直しても再ログイン不要
- **R5はメモリを比較的多く使う**。Docker Desktop(WSL2)ではコンテナに割り当てられる
  メモリの上限がWSL2側で決まっているので、対象地域が大きく足りなくなる場合は、
  Windowsのユーザーフォルダ直下の `.wslconfig` の `memory=` を増やしてから
  `wsl --shutdown` で再起動する。まず小さい範囲(市区町村単位)で試すこと
- `git push` の認証は、Dev Containersがホスト側のGit認証情報を引き継ぐ設定が
  既定で有効なので、通常は追加設定なしで通る(通らない場合はVS Codeの案内に従う)。
  commit・pushは、ユーザーが明示的に指示した場合にのみ行う(CLAUDE.md参照)
- このリポジトリには**秘密情報(APIキー等)は不要**。もし将来 `.env` を作る場合は
  `.gitignore` 済みで、リポジトリにも、チャットへのアップロードにも含めないこと

## 使い方

### 画面(docs/)の確認

GitHub Pagesで公開する静的サイトは `docs/` に置く。公開前にコンテナ内で確認するには:

```bash
python -m http.server 8000 --directory docs
```

Dev Containerがポート8000を自動でホストに転送するので、ブラウザで
`http://localhost:8000` を開けばよい。

### データの流れ(予定。詳細はCLAUDE.mdの「パイプライン構成」)

```
data/raw/        OSM PBF(Geofabrik等)・自治体データを取得(gitignore対象)
  → data/interim/    「専用道路の定義」に沿って絞り込んだPBF等(gitignore対象)
  → data/processed/  自転車専用道路ネットワークなどの成果データ
  → results/         連結性の集計・検証用の図表
  → docs/data/       Webから読む軽量な配信用データ
```

各処理は `src/<タスク名>/` に置き、実装前に `src/<タスク名>/instruction.md` を書く
(詳細は [`src/README.md`](src/README.md))。データの扱い・容量制限は
[`data/README.md`](data/README.md) を参照。

## GitHub Pagesでの公開

1. GitHubのリポジトリ → Settings → Pages
2. Source: **Deploy from a branch** / Branch: `main` / Folder: `/docs`
3. `https://<ユーザー名>.github.io/cycleway-router/` で公開される

注意:
- GitHub Pagesは**静的ホスティング**であり、R5(Javaサーバ)はそこでは動かない。
  「経路検索をどこで実行するか」の方式は未決事項(CLAUDE.mdの「設計上の未決事項」1)で、
  決まるまでは `docs/` の中身は確定しない
- Publicリポジトリになる場合、`docs/data/` に置くデータのライセンス(OSMはODbL)上、
  再配布が可能か・出典表記が必要かを公開前に確認する

## フォルダ構成

```
cycleway-router/
├── .devcontainer/     # Dev Container定義(Dockerfile / docker-compose.yml / devcontainer.json)
├── CLAUDE.md          # プロジェクト全体の文脈・方針(Claude Codeが自動で読む)
├── README.md          # このファイル
├── log.md             # 生成AIとのやり取りの作業記録(新しいものが上)
├── requirements.txt   # Pythonの依存パッケージ
├── data/              # 入力・中間・成果データ(README参照)
├── src/               # 処理スクリプト(タスクごとにサブフォルダ)
├── results/           # 検証結果の図表(figures/ tables/)
├── docs/              # GitHub Pagesで公開する静的サイト
└── test/              # 簡単な検証スクリプト
```

## 現状(2026-09-20時点)

- 対象地域: 関東地方(初期調査範囲)。`highway=cycleway`等の延長・属性を集計済み
  (合計約2,847km。`src/osm_survey/`)
- 連結性分析(`src/network_connectivity/`)で、専用道路網が強く分断されている
  ことを確認(関東全体では最大連結成分が全体の2.5%程度)
- 公開方式は(A)事前計算+(C)クライアントサイドのハイブリッドに確定
  (常時稼働サーバーは持たない。詳細はCLAUDE.mdの「設計上の未決事項」1参照)
- `src/r5_custom_cost/`でConveyal R5をフォークし、専用道路優先のカスタムコスト
  (一般道は距離ペナルティ付き)を実装。開発コンテナ内でR5を実行し、長距離ルート
  (例: 品川駅⇔高崎駅、158.7km・専用道路上75%)を事前計算できることを確認済み
- `docs/`にフロントエンド(Leaflet)を実装済み: 専用道路網のみを使った近距離の
  クライアントサイド経路検索(ブラウザ内Dijkstra)と、事前計算した長距離ルートの
  選択・表示の両方が動作する(`src/export_web/`でデータを生成)
- **GitHub Pagesへの実際のデプロイ・公開設定はまだ行っていない**。ローカルでの
  動作確認(`python -m http.server`+Playwrightでのブラウザ自動操作)のみ完了

詳細な経緯は[`log.md`](log.md)、方針は[`CLAUDE.md`](CLAUDE.md)を参照。

なお、`.devcontainer/` の構成はDockerの実機でのビルドを確認できていない状態で作成した。
初回ビルドでエラーが出た場合は、エラーメッセージを `log.md` に貼って修正すること。
