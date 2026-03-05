#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_DIR="${ROOT_DIR}/apps/admin_management"
STATE_DIR="/tmp/oneceo-mac-admin"

ADMIN_API_PORT="${ADMIN_MANAGEMENT_PORT:-9310}"
ADMIN_WEB_PORT="${ADMIN_MANAGEMENT_WEB_PORT:-${VITE_DEV_PORT:-5174}}"

API_PID_FILE="${STATE_DIR}/admin-api.pid"
WEB_PID_FILE="${STATE_DIR}/admin-web.pid"

pid_is_alive() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

kill_with_wait() {
  local pid="$1"
  local name="$2"

  if ! pid_is_alive "${pid}"; then
    return 0
  fi

  kill "${pid}" >/dev/null 2>&1 || true
  for _ in {1..10}; do
    if ! pid_is_alive "${pid}"; then
      echo "[OK] Stopped ${name} (pid=${pid})."
      return 0
    fi
    sleep 1
  done

  kill -9 "${pid}" >/dev/null 2>&1 || true
  if ! pid_is_alive "${pid}"; then
    echo "[OK] Force-stopped ${name} (pid=${pid})."
  else
    echo "[WARN] Failed to stop ${name} (pid=${pid})."
  fi
}

stop_from_pid_file() {
  local file="$1"
  local name="$2"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "${file}")"
  if [[ -n "${pid}" ]]; then
    kill_with_wait "${pid}" "${name}"
  fi
  rm -f "${file}"
}

stop_port_if_matches_admin_dir() {
  local port="$1"
  local name="$2"
  local pids
  pids="$(lsof -t -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "${pids}" ]] && return 0

  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    local cmd
    cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ "${cmd}" == *"${ADMIN_DIR}"* || "${cmd}" == *"${ROOT_DIR}"* ]]; then
      kill_with_wait "${pid}" "${name}"
    else
      echo "[INFO] Port ${port} is used by non-admin process (pid=${pid}), skipped."
    fi
  done <<< "${pids}"
}

stop_from_pid_file "${API_PID_FILE}" "Admin API"
stop_from_pid_file "${WEB_PID_FILE}" "Admin Web"

# Fallback: stop listeners on admin default ports when process belongs to this repo.
stop_port_if_matches_admin_dir "${ADMIN_API_PORT}" "Admin API"
stop_port_if_matches_admin_dir "${ADMIN_WEB_PORT}" "Admin Web"

echo "[DONE] stop-admin-mac completed."
