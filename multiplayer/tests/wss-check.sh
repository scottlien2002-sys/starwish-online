#!/usr/bin/env bash
# 產生暫時自簽憑證（只用於本機測試，不提交到 Git），並以 wss:// 實際連線測試
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" >/dev/null 2>&1
NODE_EXTRA_CA_CERTS="$tmp/cert.pem" node "$here/wss-check.ts" "$tmp"
rm -rf "$tmp"
