# Claude Code + Python + JDK21(devcontainer.jsonのfeatureで追加) + OSM加工ツールが揃った開発コンテナ。
# R5(r5py経由)もフロントエンドの確認用サーバも、すべてこのコンテナの中だけで動かす。
FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

# Claude Code機能(Node.jsの自動インストール)が追加する yarn の apt リポジトリは
# 署名鍵が取得できず `apt-get update` を失敗させることがあるため、
# 自分たちのパッケージをインストールする前に無効化しておく。
# (yarn自体は使わないので、鍵を追加し直すのではなくリポジトリ定義ごと削除する)
RUN rm -f /etc/apt/sources.list.d/yarn.list

# osmium-tool : OSM PBFの絞り込み(tags-filter等)・範囲切り出し(extract)
# gdal-bin    : ogr2ogr等。GeoJSON/シェープファイルの変換・確認用
# fonts-noto-cjk : 検証用の図(matplotlib等)で日本語ラベルを出すため
RUN apt-get update && apt-get install -y --no-install-recommends \
    osmium-tool \
    gdal-bin \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# docker-compose.ymlの claude-code-config ボリュームは /home/vscode/.claude にマウントされる。
# イメージ内にこのパスが無いまま名前付きボリュームをマウントすると、root所有で作成されて
# vscodeユーザーから書き込めなくなることがあるため、あらかじめvscode所有で作成しておく。
# (.local も同様。pip install --user の書き込み先)
RUN mkdir -p /home/vscode/.claude /home/vscode/.local \
    && chown -R vscode:vscode /home/vscode/.claude /home/vscode/.local
