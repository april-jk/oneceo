#!/usr/bin/env bash
set -euo pipefail

# One-click Railway setup + deploy for oneceo monorepo services:
# - api
# - web
# - admin-management

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[ERROR] pnpm 未安装，请先安装 pnpm。"
  exit 1
fi

RAILWAY_CMD=(pnpm dlx @railway/cli@latest)

log() {
  printf '[railway-script] %s\n' "$1"
}

run_railway() {
  "${RAILWAY_CMD[@]}" "$@"
}

ensure_login() {
  if run_railway whoami >/dev/null 2>&1; then
    log "Railway 登录状态正常。"
    return
  fi

  log "检测到未登录 Railway，准备执行 railway login。"
  run_railway login
}

ensure_project_linked() {
  if run_railway status >/dev/null 2>&1; then
    log "当前目录已绑定 Railway 项目。"
    return
  fi

  if [[ -n "${RAILWAY_PROJECT_ID:-}" ]]; then
    log "使用 RAILWAY_PROJECT_ID 自动绑定项目: ${RAILWAY_PROJECT_ID}"
    run_railway link "$RAILWAY_PROJECT_ID"
    return
  fi

  echo "[ERROR] 当前目录未绑定 Railway 项目。"
  echo "请先执行以下任一方式："
  echo "1) 手动执行: pnpm dlx @railway/cli@latest link"
  echo "2) 或设置环境变量 RAILWAY_PROJECT_ID 后重试"
  exit 1
}

ensure_service() {
  local service_name="$1"

  if run_railway service link "$service_name" >/dev/null 2>&1; then
    log "服务已存在: ${service_name}"
    return
  fi

  log "服务不存在，准备创建: ${service_name}"
  run_railway add --service "$service_name" >/dev/null
  run_railway service link "$service_name" >/dev/null
}

set_service_commands() {
  local service_name="$1"
  shift
  log "写入服务构建/启动变量: ${service_name}"
  run_railway variable set --service "$service_name" --skip-deploys "$@" >/dev/null
}

show_service_commands() {
  local service_name="$1"
  log "当前服务关键变量: ${service_name}"
  run_railway variable list --service "$service_name" -k | \
    grep -E '^(RAILPACK_(INSTALL|BUILD|START)_(CMD|COMMAND)|RAILPACK_SPA_OUTPUT_DIR)=' || true
}

deploy_service() {
  local service_name="$1"
  log "开始部署服务: ${service_name}"
  run_railway up . --service "$service_name" --detach
}

main() {
  local deploy_now="${DEPLOY_NOW:-true}"

  ensure_login
  ensure_project_linked

  ensure_service "api"
  ensure_service "web"
  ensure_service "admin-management"

  # API service (monorepo root deploy + workspace-aware commands)
  set_service_commands "api" \
    "RAILPACK_INSTALL_COMMAND=pnpm install --frozen-lockfile" \
    "RAILPACK_BUILD_COMMAND=pnpm --filter @oneceo/shared build && pnpm --filter api build" \
    "RAILPACK_START_COMMAND=pnpm --filter api start" \
    "RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile" \
    "RAILPACK_BUILD_CMD=pnpm --filter @oneceo/shared build && pnpm --filter api build" \
    "RAILPACK_START_CMD=pnpm --filter api start"
  show_service_commands "api"

  # Web service
  set_service_commands "web" \
    "RAILPACK_INSTALL_COMMAND=pnpm install --frozen-lockfile" \
    "RAILPACK_BUILD_COMMAND=pnpm --filter web build" \
    "RAILPACK_START_COMMAND=pnpm --filter web start" \
    "RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile" \
    "RAILPACK_BUILD_CMD=pnpm --filter web build" \
    "RAILPACK_START_CMD=pnpm --filter web start"
  show_service_commands "web"

  # Admin management service
  set_service_commands "admin-management" \
    "RAILPACK_INSTALL_COMMAND=pnpm install --frozen-lockfile" \
    "RAILPACK_BUILD_COMMAND=pnpm --filter oneceo-admin-management build" \
    "RAILPACK_START_COMMAND=pnpm --filter oneceo-admin-management start" \
    "RAILPACK_INSTALL_CMD=pnpm install --frozen-lockfile" \
    "RAILPACK_BUILD_CMD=pnpm --filter oneceo-admin-management build" \
    "RAILPACK_START_CMD=pnpm --filter oneceo-admin-management start"
  show_service_commands "admin-management"

  if [[ "$deploy_now" == "true" ]]; then
    deploy_service "api"
    deploy_service "web"
    deploy_service "admin-management"
  else
    log "已完成服务配置，按 DEPLOY_NOW=false 跳过部署。"
  fi

  echo
  echo "完成：三端服务已统一配置。"
  echo "服务名：api / web / admin-management"
  echo
  echo "建议后续在 Railway 中补充每个服务的业务环境变量（如 DATABASE_URL、FRONTEND_URL、ONECEO_API_URL 等）。"
}

main "$@"
