#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1) 目录配置（已改成当前项目目录）
DIR1="${ROOT_DIR}/apps/api"
DIR2="${ROOT_DIR}/apps/admin_management"
DIR3="${ROOT_DIR}/apps/web"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd npm

for dir in "$DIR1" "$DIR2" "$DIR3"; do
  if [[ ! -d "$dir" ]]; then
    echo "[ERROR] Missing directory: $dir" >&2
    exit 1
  fi
done

start_with_tmux() {
  # 2) 如果已存在 npm 窗口，先删掉（可选）
  if tmux list-windows -F '#W' | grep -qx 'npm'; then
    tmux kill-window -t npm
  fi

  # 3) 新建 npm window + 3 panes
  tmux new-window -n npm
  tmux send-keys -t npm.0 "cd \"$DIR1\" && npm run dev" C-m

  tmux split-window -h -t npm.0
  tmux send-keys -t npm.1 "cd \"$DIR2\" && npm run dev" C-m

  tmux split-window -v -t npm.1
  tmux send-keys -t npm.2 "cd \"$DIR3\" && npm run dev" C-m

  # 4) 调整成均匀布局并切到该窗口
  tmux select-layout -t npm tiled
  tmux select-window -t npm
}

start_plain() {
  local pids=()

  echo "[INFO] tmux unavailable or not active; starting services in plain shell mode."
  echo "[INFO] Press Ctrl+C to stop all three services."

  (
    cd "$DIR1"
    npm run dev
  ) &
  pids+=($!)

  (
    cd "$DIR2"
    npm run dev
  ) &
  pids+=($!)

  (
    cd "$DIR3"
    npm run dev
  ) &
  pids+=($!)

  cleanup() {
    for pid in "${pids[@]}"; do
      kill "$pid" >/dev/null 2>&1 || true
    done
  }

  trap cleanup INT TERM EXIT
  wait
}

if command -v tmux >/dev/null 2>&1 && [[ -n "${TMUX:-}" ]]; then
  start_with_tmux
else
  start_plain
fi
