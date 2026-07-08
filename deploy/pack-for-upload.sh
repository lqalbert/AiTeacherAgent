#!/usr/bin/env bash
# 本机执行：打成单个 tar.gz，再通过宝塔「文件」上传这一个包（比 SFTP 传整个目录快很多）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${1:-/tmp/AiTeacherAgent-deploy.tar.gz}"

echo ">>> 打包到 $OUT（不含 node_modules、data、uploads）"

tar -czf "$OUT" \
  --exclude='./node_modules' \
  --exclude='./client/node_modules' \
  --exclude='./client/dist' \
  --exclude='./data' \
  --exclude='./uploads' \
  --exclude='./.git' \
  --exclude='./.DS_Store' \
  -C "$(dirname "$ROOT")" \
  "$(basename "$ROOT")"

SIZE="$(du -h "$OUT" | cut -f1)"
echo ">>> 完成，大小: $SIZE"
echo ""
echo "下一步："
echo "  1) 宝塔 → 文件 → 上传到 /home/ubuntu/"
echo "  2) 宝塔终端执行："
echo "     cd ~ && tar -xzf AiTeacherAgent-deploy.tar.gz"
echo "     cd ~/AiTeacherAgent && bash deploy/unpack-and-deploy.sh"
