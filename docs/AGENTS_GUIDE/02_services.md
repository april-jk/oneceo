# 02 服务启动

以下内容以当前代码和配置文件为准。

## 用户端 Web

- 目录：`apps/web`
- 启动：`pnpm dev`
- 默认端口：`http://localhost:3000`
- 配置来源：`apps/web/vite.config.ts`

## 主平台 API

- 目录：`apps/api`
- 启动：`pnpm dev`
- 默认端口：`http://localhost:4000`
- 入口：`apps/api/src/index.ts`
- 环境变量加载：优先从 `apps/.env` 或上级 `.env` 读取，见 `apps/api/src/config/env.ts`

## 管理后台

- 目录：`apps/admin_management`
- 启动：`npm run dev`
- Web 默认端口：`http://localhost:5174`
- API 默认端口：`http://127.0.0.1:9310`
- Web host 优先读取 `ADMIN_MANAGEMENT_WEB_HOST`，未配置时回退到 `ADMIN_MANAGEMENT_BIND_HOST`，最终默认 `0.0.0.0`
- 配置来源：
  - `apps/admin_management/web/vite.config.ts`
  - `apps/admin_management/server/config.ts`

## 常用验证命令

- API 类型检查：`pnpm --filter api type-check`
- Web 类型检查：`pnpm --filter web check`
- 管理后台类型检查：`npm --prefix apps/admin_management run type-check`
- API 单测：`pnpm --filter api test`
- 直通模式测试：`pnpm --filter api test:opencode-direct`
- Web 相关测试：`pnpm --filter web test:opencode-direct-ui`

## 环境与依赖提醒

- `apps/api` 和 `apps/admin_management` 都会尝试从仓库上层或 `apps/.env` 读取配置，不要只看当前工作目录。
- 需要正式联调时，通常还会依赖：
  - PostgreSQL
  - Redis
  - E2B API Key
  - 连接器 OAuth 配置
  - LLM Proxy / 上游模型配置

## 启动顺序建议

1. 先确认 `apps/.env` 与数据库、Redis、E2B 等外部依赖可用。
2. 启动 `apps/api`。
3. 启动 `apps/web`。
4. 如需后台管理或技能/工件管理，再启动 `apps/admin_management`。
