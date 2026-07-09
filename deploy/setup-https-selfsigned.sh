#!/usr/bin/env bash
# 生成 Nginx 自签 HTTPS 证书（测试环境，麦克风需要 HTTPS）
set -euo pipefail

SSL_DIR="/etc/nginx/ssl"
CRT="$SSL_DIR/aiteacher.crt"
KEY="$SSL_DIR/aiteacher.key"
CN="${1:-118.24.107.252}"

sudo mkdir -p "$SSL_DIR"
if [[ -f "$CRT" && -f "$KEY" ]]; then
  echo "证书已存在: $CRT"
else
  sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CRT" \
    -subj "/CN=$CN"
  echo "已生成自签证书: $CRT"
fi

echo ""
echo "下一步："
echo "  sudo cp deploy/nginx-https-8443.conf /etc/nginx/sites-available/aiteacher-https.conf"
echo "  sudo ln -sf /etc/nginx/sites-available/aiteacher-https.conf /etc/nginx/sites-enabled/"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "  访问 https://${CN}:8443 （浏览器警告点「继续访问」）"
