#!/usr/bin/env bash
# 兼容入口：与 deploy/push-from-local.sh 相同
exec "$(cd "$(dirname "$0")/.." && pwd)/deploy/push-from-local.sh" "$@"
