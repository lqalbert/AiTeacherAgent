#!/usr/bin/env bash
# 本机执行：rsync 代码到服务器并运行 publish-on-server.sh（QuizWiz 在服务器上 git pull，本机项目可 rsync）
set -euo pipefail

TARGET="${1:-ubuntu@118.24.107.252}"
REMOTE_DIR="${2:-/home/ubuntu/AiTeacherAgent}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> 同步到 $TARGET:$REMOTE_DIR"
ssh -o StrictHostKeyChecking=accept-new "$TARGET" "mkdir -p '$REMOTE_DIR'"

rsync -avz --delete \
  --exclude node_modules \
  --exclude client/node_modules \
  --exclude client/dist \
  --exclude data \
  --exclude uploads \
  --exclude .git \
  "$ROOT/" "$TARGET:$REMOTE_DIR/"

if [[ -f "$ROOT/.env" ]]; then
  rsync -avz "$ROOT/.env" "$TARGET:$REMOTE_DIR/.env"
fi

ssh "$TARGET" "chmod +x '$REMOTE_DIR/deploy/'*.sh && cd '$REMOTE_DIR' && bash deploy/publish-on-server.sh"

echo ""
echo ">>> 访问: http://118.24.107.252:8080 （需已配置 deploy/nginx-ip-8080.conf）"
echo ">>> 或直接: http://118.24.107.252:3200 （需安全组放行 3200）"
