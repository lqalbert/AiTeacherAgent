#!/usr/bin/env bash
# 本机执行：配置 SSH 公钥后可 rsync 增量同步（比 SFTP 快，只传变更）
# 首次需在本机终端执行一次（会提示输入 ubuntu 密码）：
#   ssh-copy-id ubuntu@118.24.107.252
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/push-from-local.sh" ubuntu@118.24.107.252
