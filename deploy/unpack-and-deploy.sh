#!/usr/bin/env bash
# 服务器上执行：解压部署包并构建启动（在 ~/ 目录有 tar.gz 时）
set -euo pipefail

ARCHIVE="${1:-$HOME/AiTeacherAgent-deploy.tar.gz}"
TARGET="$HOME/AiTeacherAgent"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "找不到压缩包: $ARCHIVE" >&2
  echo "用法: bash deploy/unpack-and-deploy.sh [~/AiTeacherAgent-deploy.tar.gz]" >&2
  exit 1
fi

echo ">>> 解压到 $HOME"
tar -xzf "$ARCHIVE" -C "$HOME"

if [[ ! -d "$TARGET" ]]; then
  echo "解压后未找到 $TARGET" >&2
  exit 1
fi

cd "$TARGET"
chmod +x deploy/*.sh 2>/dev/null || true

if [[ ! -f .env ]]; then
  if [[ -f deploy/env.server.template ]]; then
    cp deploy/env.server.template .env
    echo ">>> 已从模板创建 .env，请 nano .env 填写 API Key 后重新运行本脚本"
    exit 0
  fi
fi

bash deploy/publish-on-server.sh

echo ""
echo ">>> 若尚未配置 Nginx 8080，执行："
echo "    sudo cp deploy/nginx-ip-8080.conf /etc/nginx/sites-available/aiteacher.conf"
echo "    sudo ln -sf /etc/nginx/sites-available/aiteacher.conf /etc/nginx/sites-enabled/"
echo "    sudo nginx -t && sudo systemctl reload nginx"
echo ">>> 访问: http://118.24.107.252:8080"
