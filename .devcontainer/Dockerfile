# Claude Code(ネイティブ版) + Python + JDK21(devcontainer.jsonのfeatureで追加) + OSM加工ツールが揃った開発コンテナ。
# R5(r5py経由)もフロントエンドの確認用サーバも、すべてこのコンテナの中だけで動かす。
FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

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
# (.local も同様。Claude Code本体と pip install --user の書き込み先)
RUN mkdir -p /home/vscode/.claude /home/vscode/.local \
    && chown -R vscode:vscode /home/vscode/.claude /home/vscode/.local

# Claude Code(ネイティブ版)をvscodeユーザー権限で導入する。
# ホーム配下に入るので、自動アップデートもvscode権限で動く。
USER vscode
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/vscode/.local/bin:${PATH}"