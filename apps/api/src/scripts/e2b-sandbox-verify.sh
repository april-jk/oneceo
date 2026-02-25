#!/usr/bin/env bash
set -euo pipefail

echo "[verify] timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -z "\${OPENAI_BASE_URL:-}" ]]; then
  echo "[verify] OPENAI_BASE_URL missing"
  exit 10
fi
if [[ -z "\${OPENAI_API_KEY:-}" ]]; then
  echo "[verify] OPENAI_API_KEY missing"
  exit 11
fi

echo "[verify] OPENAI_BASE_URL=$OPENAI_BASE_URL"

ip=""
for url in https://api.ipify.org https://icanhazip.com https://ifconfig.me/ip; do
  ip=$(curl -fsSL --max-time 10 "$url" | tr -d '\n' || true)
  if [[ -n "$ip" ]]; then break; fi
done
if [[ -z "$ip" ]]; then
  echo "[verify] public_ip lookup failed"
  exit 12
fi
echo "[verify] public_ip=$ip"

gateway_url="${OPENAI_BASE_URL%/}/models"
status=$(curl -sS -o /tmp/oneceo_gateway_models.json -w "%{http_code}" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  "$gateway_url" || true)
echo "[verify] gateway_status=$status"
if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
  echo "[verify] gateway models request failed"
  cat /tmp/oneceo_gateway_models.json || true
  exit 13
fi
echo "[verify] gateway_ok"

if curl -fsSL --max-time 5 "http://127.0.0.1:${OPENCODE_SERVER_PORT:-4096}/global/health" >/dev/null; then
  echo "[verify] opencode_health_ok"
else
  echo "[verify] opencode_health_failed"
  exit 14
fi
