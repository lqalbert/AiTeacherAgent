#!/usr/bin/env bash
# 在服务器项目根目录执行（与 QuizWiz teacher-admin/deploy/publish-on-server.sh 同流程）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先: cp deploy/env.server.template .env && nano .env" >&2
  exit 1
fi

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only || true
fi

echo ">>> npm install"
npm install --omit=dev
npm install --prefix client

echo ">>> npm run build"
npm run build

mkdir -p data uploads

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete aiteacher-agent 2>/dev/null || true
  # 若路径不是 /home/ubuntu/AiTeacherAgent，请改 deploy/ecosystem.config.cjs 中 cwd
  pm2 start deploy/ecosystem.config.cjs
  pm2 save
  echo ">>> PM2 已启动 aiteacher-agent"
elif systemctl is-enabled aiteacher-agent >/dev/null 2>&1; then
  sudo systemctl restart aiteacher-agent
  echo ">>> systemd 已重启 aiteacher-agent"
else
  echo ">>> 未检测到 PM2/systemd，请手动: pm2 start deploy/ecosystem.config.cjs" >&2
  exit 1
fi

VERIFY_URL="${VERIFY_URL:-http://127.0.0.1:3200}"
bash deploy/verify.sh "$VERIFY_URL"
