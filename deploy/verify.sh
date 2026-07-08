#!/usr/bin/env bash
set -euo pipefail
HOST="${1:-http://127.0.0.1:3200}"
URL="${HOST%/}/api/health"
echo "GET $URL"
body="$(curl -fsS "$URL")"
echo "$body"
if ! echo "$body" | grep -q '"service"[[:space:]]*:[[:space:]]*"aiteacher-agent"'; then
  echo "错误: 响应中未找到 service=aiteacher-agent" >&2
  exit 1
fi
if ! echo "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  echo "错误: 健康检查未返回 ok:true" >&2
  exit 1
fi
echo "OK: 健康检查通过"
