#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_DIR="${ROOT_DIR}/apps/admin_management"
STATE_DIR="/tmp/oneceo-mac-admin"
ADMIN_ENV_FILE="${ROOT_DIR}/apps/.env"

ADMIN_API_PORT="${ADMIN_MANAGEMENT_PORT:-9310}"
ADMIN_WEB_PORT="${ADMIN_MANAGEMENT_WEB_PORT:-${VITE_DEV_PORT:-5174}}"

API_PID_FILE="${STATE_DIR}/admin-api.pid"
WEB_PID_FILE="${STATE_DIR}/admin-web.pid"
API_LOG_FILE="${STATE_DIR}/admin-api.log"
WEB_LOG_FILE="${STATE_DIR}/admin-web.log"

mkdir -p "${STATE_DIR}"

if [[ ! -d "${ADMIN_DIR}" ]]; then
  echo "[ERROR] Missing admin directory: ${ADMIN_DIR}"
  exit 1
fi

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

read_env_file_value() {
  local key="$1"
  local file="$2"
  if [[ ! -f "${file}" ]]; then
    return 1
  fi
  local line
  line="$(grep -E "^${key}=" "${file}" | tail -n 1 || true)"
  [[ -z "${line}" ]] && return 1
  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  echo "${value}"
  return 0
}

resolve_env_value() {
  local key="$1"
  local fallback="${2:-}"
  if [[ -n "${!key:-}" ]]; then
    echo "${!key}"
    return 0
  fi
  if read_env_file_value "${key}" "${ADMIN_ENV_FILE}"; then
    return 0
  fi
  echo "${fallback}"
  return 0
}

start_admin_api() {
  if [[ -f "${API_PID_FILE}" ]]; then
    local old_pid
    old_pid="$(cat "${API_PID_FILE}")"
    if [[ -n "${old_pid}" ]] && pid_is_alive "${old_pid}"; then
      echo "[INFO] Admin API already running (pid=${old_pid})."
      return 0
    fi
  fi

  if port_is_listening "${ADMIN_API_PORT}"; then
    echo "[INFO] Port ${ADMIN_API_PORT} already in use; skipping Admin API start."
    return 0
  fi

  : > "${API_LOG_FILE}"
  (
    cd "${ADMIN_DIR}"
    nohup npm run dev:api >> "${API_LOG_FILE}" 2>&1 &
    echo $! > "${API_PID_FILE}"
  )
  local pid
  pid="$(cat "${API_PID_FILE}")"
  echo "[INFO] Starting Admin API (pid=${pid})..."
  wait_http_ok "http://localhost:${ADMIN_API_PORT}/health" "Admin API" 45
  echo "[OK] Admin API ready at http://localhost:${ADMIN_API_PORT}"
}

start_admin_web() {
  if [[ -f "${WEB_PID_FILE}" ]]; then
    local old_pid
    old_pid="$(cat "${WEB_PID_FILE}")"
    if [[ -n "${old_pid}" ]] && pid_is_alive "${old_pid}"; then
      echo "[INFO] Admin Web already running (pid=${old_pid})."
      return 0
    fi
  fi

  if port_is_listening "${ADMIN_WEB_PORT}"; then
    echo "[INFO] Port ${ADMIN_WEB_PORT} already in use; skipping Admin Web start."
    return 0
  fi

  : > "${WEB_LOG_FILE}"
  (
    cd "${ADMIN_DIR}"
    nohup npm run dev:web >> "${WEB_LOG_FILE}" 2>&1 &
    echo $! > "${WEB_PID_FILE}"
  )
  local pid
  pid="$(cat "${WEB_PID_FILE}")"
  echo "[INFO] Starting Admin Web (pid=${pid})..."
  wait_http_ok "http://localhost:${ADMIN_WEB_PORT}" "Admin Web" 45
  echo "[OK] Admin Web ready at http://localhost:${ADMIN_WEB_PORT}"
}

require_cmd npm
require_cmd curl
require_cmd lsof

if [[ ! -d "${ADMIN_DIR}/node_modules" ]]; then
  echo "[INFO] admin_management/node_modules missing, running npm install..."
  (cd "${ADMIN_DIR}" && npm install)
fi

start_admin_api
start_admin_web

TARGET_ONECEO_API_URL="$(resolve_env_value "ONECEO_API_URL" "http://192.168.10.128:4000")"
TARGET_KVM_ORCHESTRATOR_URL="$(resolve_env_value "KVM_ORCHESTRATOR_URL" "http://192.168.10.128:8500")"
TARGET_ADMIN_CORS_ORIGIN="$(resolve_env_value "ADMIN_MANAGEMENT_CORS_ORIGIN" "http://localhost:${ADMIN_WEB_PORT}")"

echo ""
echo "[DONE] Admin management services are running."
echo "       Admin API: http://localhost:${ADMIN_API_PORT}"
echo "       Admin Web: http://localhost:${ADMIN_WEB_PORT}"
echo "       Target ONECEO API: ${TARGET_ONECEO_API_URL}"
echo "       Target KVM Orchestrator: ${TARGET_KVM_ORCHESTRATOR_URL}"
echo "       CORS Origin: ${TARGET_ADMIN_CORS_ORIGIN}"
echo "       Logs: ${API_LOG_FILE}, ${WEB_LOG_FILE}"
echo "       Stop command: ./stop-admin-mac.sh"
