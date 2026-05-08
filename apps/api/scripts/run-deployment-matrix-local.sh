#!/usr/bin/env bash
set -euo pipefail

API_BASE="${ONECEO_E2E_API_BASE:-http://127.0.0.1:${PORT:-4000}}"

echo "[e2e:local] API_BASE=${API_BASE}"
echo "[e2e:local] disable proxy for localhost e2e traffic"

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset http_proxy https_proxy all_proxy
export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"
export no_proxy="${no_proxy:-127.0.0.1,localhost}"
export ONECEO_PROXY_ENABLED=false

if ! curl -fsS --max-time 8 "${API_BASE}/health" >/dev/null; then
  echo "[e2e:local] health precheck failed: ${API_BASE}/health"
  echo "[e2e:local] please ensure apps/api dev server is running and reachable from current environment"
  exit 1
fi

echo "[e2e:local] health precheck passed"
exec node --import tsx tests/e2e/deployment-prompt-strength-matrix.e2e.ts
