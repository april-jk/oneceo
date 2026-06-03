# Staging 环境配置文档

> 创建时间：2026-05-01
> 环境 ID：`49b17de3-dfae-4eef-bcca-1febf8c40556`
> 项目：`>>> oneceo <<<`（ID: `166f79b6-c19c-4254-91ea-6a8ec95ad3b3`）

## 环境架构

| 服务 | 类型 | 公网域名 | 内部域名 |
|------|------|----------|----------|
| oneceo-api | Node.js API | `oneceo-api-staging.up.railway.app` | `oneceo-api.railway.internal` |
| oneceo-web | Vite 前端 | `oneceo-web-staging.up.railway.app` | `oneceo-web.railway.internal` |
| oneceo-admin | 管理后台 | `oneceo-admin-staging.up.railway.app` | `oneceo-admin.railway.internal` |
| Postgres | 数据库 | - | `postgres.railway.internal:5432` |
| Redis | 缓存 | - | `redis.railway.internal:6379` |

## 服务配置详情

### 1. oneceo-api（主 API 服务）

**构建命令**：`pnpm --filter @oneceo/shared build && pnpm --filter api build`
**启动命令**：`pnpm --filter api start`
**监听目录**：`/apps/api/**`, `/packages/shared/**`

#### 核心配置
- `PORT` = `4000`
- `FRONTEND_URL` = `https://oneceo-web-staging.up.railway.app`（⚠️ staging 特有）
- `API_HOST` = `::`
- `RAILWAY_ENVIRONMENT` = `staging`

#### 数据库
- `DATABASE_URL` = `postgresql://postgres:***@postgres.railway.internal:5432/railway`（自动注入）
- `DATABASE_SSL` = `disable`

#### Redis
- `ONECEO_REDIS_ENABLED` = `true`
- `REDIS_URL` = `redis://default:***@redis.railway.internal:6379`（自动注入）

#### LLM 代理
- `OPENAI_API_KEY` = `__REDACTED__`
- `OPENAI_BASE_URL` = `https://llmapi.oneceo.ai/v1`
- `OPENAI_API_BASE` = `https://llmapi.oneceo.ai/v1`
- `LLM_TIMEOUT_MS` = `90000`
- `LLM_MAX_RETRIES` = `2`
- `LLM_RETRY_BASE_MS` = `800`
- `LLM_RETRY_MAX_MS` = `4000`
- `AGENT_OPENAI_API_KEY` = `__REDACTED__`
- `AGENT_OPENAI_MODEL` = `claude-haiku-4-5-20251001`

#### Altus Managed 模型
- `ALTUS_MANAGED_MODEL_LITE` = `claude-haiku-4-5-20251001`
- `ALTUS_MANAGED_MODEL_PRO` = `claude-haiku-4-5-20251001`
- `ALTUS_MANAGED_MODEL_MAX` = `claude-haiku-4-5-20251001`
- `ALTUS_MANAGED_BASE_URL_LITE` = `https://llmapi.oneceo.ai/v1`
- `ALTUS_MANAGED_BASE_URL_PRO` = `https://llmapi.oneceo.ai/v1`
- `ALTUS_MANAGED_BASE_URL_MAX` = `https://llmapi.oneceo.ai/v1`
- `ALTUS_MANAGED_API_KEY_LITE` = `__REDACTED__`
- `ALTUS_MANAGED_API_KEY_PRO` = `__REDACTED__`
- `ALTUS_MANAGED_API_KEY_MAX` = `__REDACTED__`
- `ALTUS_MANAGED_API_TYPE_LITE` = `openai`
- `ALTUS_MANAGED_API_TYPE_PRO` = `openai`
- `ALTUS_MANAGED_API_TYPE_MAX` = `openai`
- `ALTUS_MANAGED_VISION_MODEL` = `qwen3-vl-plus`

#### Sandbox 引擎
- `SANDBOX_ENGINE_OPENCODE_MODEL` = `gpt-5.3-codex`
- `SANDBOX_ENGINE_OPENCODE_BASE_URL` = `https://llmapi.oneceo.ai/v1`
- `SANDBOX_ENGINE_OPENCODE_API_KEY` = `__REDACTED__`
- `SANDBOX_ENGINE_OPENCODE_API_TYPE` = `openai`
- `SANDBOX_ENGINE_CODEX_MODEL` = `gpt-5.3-codex`
- `SANDBOX_ENGINE_CODEX_BASE_URL` = `https://llmapi.oneceo.ai`
- `SANDBOX_ENGINE_CODEX_API_KEY` = `__REDACTED__`
- `SANDBOX_ENGINE_CODEX_API_TYPE` = `openai`

#### LLM Proxy
- `LLM_PROXY_UPSTREAM_BASE_URL` = `https://llmapi.oneceo.ai`
- `LLM_PROXY_UPSTREAM_API_KEY` = `__REDACTED__`
- `LLM_PROXY_UPSTREAM_API_TYPE` = `anthropic`
- `LLM_PROXY_TIMEOUT_MS` = `60000`
- `LLM_PROXY_RETRIES` = `3`
- `LLM_PROXY_RETRY_DELAY_MS` = `300`

#### OpenCode
- `OPENCODE_PROVIDER_ID` = `openai`
- `OPENCODE_BASE_URL` = `https://llmapi.oneceo.ai/v1`
- `OPENCODE_API_KEY` = `__REDACTED__`
- `OPENCODE_MODEL` = `gpt-5.3-codex`
- `OPENCODE_SERVER_HOST` = `0.0.0.0`
- `OPENCODE_SERVER_PORT` = `4096`
- `OPENCODE_PROMPT_TIMEOUT_MS` = `60000`
- `OPENCODE_TASK_WORKSPACE_ROOT` = `/opt/.altus/opencode/workspaces`

#### E2B Sandbox
- `E2B_API_KEY` = `__REDACTED__`
- `E2B_TIMEOUT_MS` = `3600000`
- `E2B_PROXY_ENABLED` = `true`
- `E2B_ARCHIVE_ENABLED` = `true`
- `E2B_ARCHIVE_JOB_INTERVAL_MS` = `600000`
- `E2B_ARCHIVE_JOB_ENABLED` = `true`
- `E2B_ARCHIVE_SCAN_LIMIT` = `500`

#### R2 存储
- `R2_BUCKET_NAME` = `oneceo-sandbox-storage`
- `R2_ACCOUNT_ID` = `1db165e7760cc66ac92c02bf6a92102b`
- `R2_ENDPOINT` = `https://1db165e7760cc66ac92c02bf6a92102b.r2.cloudflarestorage.com`
- `R2_ACCESS_KEY_ID` = `__REDACTED__`
- `R2_SECRET_ACCESS_KEY` = `__REDACTED__`
- `R2_MANAGED_IMAGE_BUCKET_NAME` = `oneceo-managed-images-prod`
- `R2_MANAGED_IMAGE_ACCOUNT_ID` = `1db165e7760cc66ac92c02bf6a92102b`
- `R2_MANAGED_IMAGE_ENDPOINT` = `https://1db165e7760cc66ac92c02bf6a92102b.r2.cloudflarestorage.com`
- `R2_MANAGED_IMAGE_ACCESS_KEY_ID` = `__REDACTED__`
- `R2_MANAGED_IMAGE_SECRET_ACCESS_KEY` = `__REDACTED__`
- `R2_MANAGED_IMAGE_SIGNED_URL_TTL_SECONDS` = `300`

#### Railway 部署
- `RAILWAY_ADMIN_TOKEN` = `__REDACTED__`
- `RAILWAY_WORKSPACE_ID` = `__REDACTED__`
- `RAILWAY_DEPLOYMENT_PROJECT_PREFIX` = `oneceo-user`
- `RAILWAY_DEPLOYMENT_SERVICE_NAME` = `app`
- `RAILWAY_DEPLOYMENT_BUILDER` = `NIXPACKS`（staging 禁止使用 `serverless`）

#### GitHub 部署
- `GITHUB_DEPLOYMENT_OWNER` = `__REDACTED__`
- `GITHUB_DEPLOYMENT_APP_ID` = `__REDACTED__`
- `GITHUB_DEPLOYMENT_INSTALLATION_ID` = `__REDACTED__`
- `GITHUB_DEPLOYMENT_APP_PRIVATE_KEY` = `__REDACTED__`
- `GITHUB_DEPLOYMENT_REPO_PREFIX` = `oneceo-deploy`
- `GITHUB_DEPLOYMENT_BRANCH` = `main`

#### 连接器
- `CONNECTOR_SECRET_KEY` = `__REDACTED__`
- `ONECEO_INTERNAL_TOKEN` = `__SET_ME__`
- `COMPOSIO_API_KEY` = `__REDACTED__`

#### Vercel 连接器
- `VERCEL_INTEGRATION_SLUG` = `__REDACTED__`
- `VERCEL_INTEGRATION_CLIENT_ID` = `__REDACTED__`
- `VERCEL_INTEGRATION_CLIENT_SECRET` = `__REDACTED__`
- `VERCEL_INTEGRATION_REDIRECT_URI` = `__REDACTED__`

#### 用户认证
- `APP_AUTH_SMTP_HOST` = `smtp.feishu.cn`
- `APP_AUTH_SMTP_PORT` = `465`
- `APP_AUTH_SMTP_SECURE` = `true`
- `APP_AUTH_SMTP_USERNAME` = `__REDACTED__`
- `APP_AUTH_SMTP_PASSWORD` = `__REDACTED__`
- `APP_AUTH_SMTP_FROM_EMAIL` = `__REDACTED__`
- `APP_AUTH_SMTP_FROM_NAME` = `OneCEO`
- `APP_AUTH_REGISTER_CODE_TTL_SECONDS` = `600`
- `APP_AUTH_REGISTER_CODE_RESEND_COOLDOWN_SECONDS` = `60`

#### Umami 分析
- `UMAMI_ENABLED` = `false`
- `UMAMI_HOST_URL` = `__REDACTED__`
- `UMAMI_USERNAME` = `__REDACTED__`
- `UMAMI_PASSWORD` = `__REDACTED__`
- `UMAMI_PLATFORM_TEAM_ID` = `__REDACTED__`
- `UMAMI_DEPLOYMENT_TEAM_ID` = `__REDACTED__`

#### 网络代理
- `ONECEO_PROXY_ENABLED` = `true`

#### OSAC 配置
- `OSAC_EXECUTION_ENABLED` = `true`
- `OSAC_EXECUTION_MODE` = `opencode_remote`
- `OSAC_CONNECTION_MODE` = `kvm-tcp-relay`
- `OSAC_COMMAND_TIMEOUT_MS` = `900000`
- `OSAC_COMMAND_POLL_MS` = `2000`
- `OSAC_COMMAND_IDLE_MS` = `60000`
- `OSAC_CONNECT_RETRIES` = `6`
- `OSAC_CONNECT_RETRY_DELAY_MS` = `3000`

#### Cloudflare TURN
- `CLOUDFLARE_TURN_KEY_API_TOKEN` = `__REDACTED__`
- `CLOUDFLARE_TURN_KEY_ID` = `__REDACTED__`
- `NEKO_ICE_SERVERS_JSON` = `[{"urls":["stun:stun.l.google.com:19302"]}]`

---

### 2. oneceo-web（前端服务）

**构建命令**：`pnpm --filter web build`
**启动命令**：`pnpm --filter web start`
**监听目录**：`/apps/web/**`

#### 环境变量
- `ONECEO_API_URL` = `http://oneceo-api.railway.internal:4000`（自动注入）
- `VITE_ANALYTICS_HOST` = `https://analytics.oneceo.ai`
- `VITE_ANALYTICS_WEBSITE_ID` = `dev`
- `WEB_BFF_API_TARGET` = `http://oneceo-api.railway.internal:4000`（自动注入）
- `RAILWAY_ENVIRONMENT` = `staging`

---

### 3. oneceo-admin（管理后台）

**构建命令**：`pnpm --filter oneceo-admin-management build`
**启动命令**：`pnpm --filter oneceo-admin-management start`
**监听目录**：`/apps/admin_management/**`

#### 环境变量
- `ONECEO_API_URL` = `http://oneceo-api.railway.internal:4000`（自动注入）
- `ONECEO_INTERNAL_TOKEN` = `__SET_ME__`
- `ADMIN_MANAGEMENT_CORS_ORIGIN` = `https://oneceo-admin-staging.up.railway.app`（⚠️ staging 特有）
- `ADMIN_MANAGEMENT_CORS_ORIGINS` = `https://oneceo-admin-staging.up.railway.app`（⚠️ staging 特有）
- `ADMIN_MANAGEMENT_THEME` = `rose-pine`
- `ADMIN_MANAGEMENT_THEME_MODE` = `light`
- `ONECEO_PROXY_ENABLED` = `false`
- `RAILWAY_ENVIRONMENT` = `staging`

---

### 4. Postgres（数据库）

**镜像**：`ghcr.io/railwayapp-templates/postgres-ssl:18`
**数据目录**：`/var/lib/postgresql/data`

#### 自动注入变量
- `DATABASE_URL` = `postgresql://postgres:***@postgres.railway.internal:5432/railway`
- `DATABASE_PUBLIC_URL` = `postgresql://postgres:***@switchyard.proxy.rlwy.net:32539/railway`
- `POSTGRES_DB` = `railway`
- `POSTGRES_USER` = `postgres`
- `POSTGRES_PASSWORD` = `***`
- `PGDATA` = `/var/lib/postgresql/data/pgdata`

---

### 5. Redis（缓存）

**镜像**：`redis:8.2.1`
**数据目录**：`/data`

#### 自动注入变量
- `REDIS_URL` = `redis://default:***@redis.railway.internal:6379`

---

## Staging 与 Develop 的差异

| 变量 | Develop | Staging |
|------|---------|---------|
| `FRONTEND_URL` (api) | `https://dev.oneceo.ai` | `https://oneceo-web-staging.up.railway.app` |
| `ADMIN_MANAGEMENT_CORS_ORIGIN` (admin) | `https://oneceo-admin-develop-ddavd3233.up.railway.app` | `https://oneceo-admin-staging.up.railway.app` |
| `ADMIN_MANAGEMENT_CORS_ORIGINS` (admin) | `https://oneceo-admin-develop-ddavd3233.up.railway.app` | `https://oneceo-admin-staging.up.railway.app` |
| `RAILWAY_PUBLIC_DOMAIN` (api) | `oneceo-api-develop.up.railway.app` | `oneceo-api-staging.up.railway.app` |
| `RAILWAY_PUBLIC_DOMAIN` (web) | `oneceo-web-develop.up.railway.app` | `oneceo-web-staging.up.railway.app` |
| `RAILWAY_PUBLIC_DOMAIN` (admin) | `oneceo-admin-develop-ddavd3233.up.railway.app` | `oneceo-admin-staging.up.railway.app` |
| `DATABASE_URL` | develop 的 Postgres | staging 的 Postgres（独立实例） |
| `REDIS_URL` | develop 的 Redis | staging 的 Redis（独立实例） |

## 部署分支

staging 环境当前跟踪 `task-creation-agent` 分支。如需更改：

```bash
railway service --branch task-creation-agent -e staging -s oneceo-api
railway service --branch task-creation-agent -e staging -s oneceo-web
railway service --branch task-creation-agent -e staging -s oneceo-admin
```

## 常用命令

```bash
# 链接到 staging 环境
railway environment link staging

# 查看 staging 变量
railway variable list -e staging -s oneceo-api

# 设置变量
railway variable set KEY=VALUE -e staging -s oneceo-api

# 触发部署
railway up -e staging -s oneceo-api

# 查看日志
railway logs -e staging -s oneceo-api
```
