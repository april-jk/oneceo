#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="/tmp/oneceo-mac"
API_PID_FILE="${STATE_DIR}/api.pid"
WEB_PID_FILE="${STATE_DIR}/web.pid"
API_LOG_FILE="${STATE_DIR}/api.log"
WEB_LOG_FILE="${STATE_DIR}/web.log"

mkdir -p "${STATE_DIR}"
cd "${ROOT_DIR}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[WARN] This script is optimized for macOS."
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Missing required command: $1"
    exit 1
  fi
}

pid_is_alive() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

port_is_listening() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

wait_http_ok() {
  local url="$1"
  local name="$2"
  local timeout="${3:-30}"
  local i=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    i=$((i + 1))
    if (( i >= timeout )); then
      echo "[ERROR] ${name} failed to become ready within ${timeout}s."
      return 1
    fi
    sleep 1
  done
  return 0
}

ensure_pnpm() {
  require_cmd node
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  require_cmd corepack
  echo "[INFO] pnpm not found, activating via corepack..."
  corepack enable
  corepack prepare pnpm@10.4.1 --activate
}

start_api() {
  if [[ -f "${API_PID_FILE}" ]]; then
    local old_pid
    old_pid="$(cat "${API_PID_FILE}")"
    if [[ -n "${old_pid}" ]] && pid_is_alive "${old_pid}"; then
      echo "[INFO] API already running (pid=${old_pid})."
      return 0
    fi
  fi

  if port_is_listening 4000; then
    echo "[INFO] Port 4000 already in use; skipping API start."
    return 0
  fi

  : > "${API_LOG_FILE}"
  nohup pnpm --filter api dev >> "${API_LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${API_PID_FILE}"
  echo "[INFO] Starting API (pid=${pid})..."
  wait_http_ok "http://localhost:4000/health" "API" 45
  echo "[OK] API ready at http://localhost:4000"
}

start_web() {
  if [[ -f "${WEB_PID_FILE}" ]]; then
    local old_pid
    old_pid="$(cat "${WEB_PID_FILE}")"
    if [[ -n "${old_pid}" ]] && pid_is_alive "${old_pid}"; then
      echo "[INFO] Web already running (pid=${old_pid})."
      return 0
    fi
  fi

  if port_is_listening 3000; then
    echo "[INFO] Port 3000 already in use; skipping Web start."
    return 0
  fi

  : > "${WEB_LOG_FILE}"
  nohup pnpm --filter web dev >> "${WEB_LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${WEB_PID_FILE}"
  echo "[INFO] Starting Web (pid=${pid})..."
  wait_http_ok "http://localhost:3000" "Web" 45
  echo "[OK] Web ready at http://localhost:3000"
}

ensure_pnpm

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "[INFO] node_modules missing, running pnpm install..."
  pnpm install
fi

start_api
start_web

echo ""
echo "[DONE] Services are running."
echo "       API: http://localhost:4000"
echo "       Web: http://localhost:3000"
echo "       Logs: ${API_LOG_FILE}, ${WEB_LOG_FILE}"
echo "       Stop command: ./stop-mac.sh"
