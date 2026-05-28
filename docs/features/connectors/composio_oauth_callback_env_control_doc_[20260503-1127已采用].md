# Composio OAuth 回调域名环境变量控制方案 [20260503-1127已采用]

## 背景

当前 GitHub、Notion、Supabase、Slack、Figma 等 Composio 连接器使用 Composio Connect Link 完成授权。授权发起时，前端根据浏览器 `window.location.origin` 拼出 callback URL，API 再把该 URL 传给 Composio Tool Router 的 `manage_connections.callback_url` 与 Connect Link 的 `callback_url`。

这种方式在本地调试可用，但在灰度、预发、生产、代理域名、临时公网域名等环境中，callback origin 会受浏览器访问入口影响，不利于统一调试和上线切换。

## 目标

1. Composio callback 的 origin 由 API 服务端环境变量控制。
2. 前端继续负责携带连接器、设置页、目标会话等页面上下文，但不再决定 Composio callback 的最终 origin。
3. Composio 授权完成后仍回到固定连接器 callback 页面，由前端调用 API 完成授权确认和会话自动挂载。
4. Figma 补齐固定 `/figma/callback` 路由，和其他 Composio 连接器保持一致。

## 环境变量

新增：

```env
COMPOSIO_OAUTH_CALLBACK_BASE_URL=https://app.example.com
```

含义：

- 只配置 origin，不配置 path。
- 允许本地配置为 `http://oneceo.ai:3000` 或 `http://localhost:3000`。
- API 会按连接器生成固定 path：
  - GitHub: `/github/callback`
  - Notion: `/notion/callback`
  - Supabase: `/supabase/callback`
  - Slack: `/slack/callback`
  - Figma: `/figma/callback`

如果 `COMPOSIO_OAUTH_CALLBACK_BASE_URL` 未配置，API 使用 `FRONTEND_URL` 作为同一服务端 env 下的默认来源；两者都缺失时，Composio OAuth start 应失败并给出明确错误。

## 链路

1. Web 点击连接，调用 `POST /api/connectors/:connectorKey/oauth/start`，仍传入当前页面 query 作为 UI 上下文。
2. API 读取 `COMPOSIO_OAUTH_CALLBACK_BASE_URL || FRONTEND_URL`。
3. API 用服务端 base + 固定 callback path 生成最终 callback URL，并保留前端传入的非敏感 query。
4. API 追加本次 OAuth `state`，创建 Composio Tool Router session 与 Connect Link。
5. Composio 授权完成后回跳到固定 callback path。
6. Web 根据 path 和 `state` 识别连接器，调用 `POST /api/connectors/:connectorKey/oauth/callback`。
7. API 查询 Composio session/toolkits，确认 connection active 后保存 profile secret 和 metadata。

## 修改范围

- `apps/api/src/services/user-connector-service.ts`
  - 增加 Composio callback URL 解析函数。
  - Composio OAuth start 分支改用服务端 env 生成 callback URL。
- `apps/.env.example`
  - 增加 `COMPOSIO_OAUTH_CALLBACK_BASE_URL` 示例。
- `apps/web/client/src/App.tsx`
  - 增加 `/figma/callback` 用户态路由。
- `apps/web/client/src/components/ConnectorCenterPanel.tsx`
  - 增加 Figma 固定 callback path。
  - callback 识别、清理、OAuth start/complete 均纳入 Figma 固定路径。
- 测试
  - API 单元测试覆盖 env base 生成 callback URL 与 query 保留。
  - Web 单元测试覆盖 Figma 固定 callback 识别与清理。

## 验证

最小验证：

```bash
pnpm --filter api type-check
pnpm --filter web check
pnpm --filter api test -- tests/composio-oauth-callback-url.test.ts
pnpm --filter web test:opencode-direct-ui -- client/src/tests/connector-center-panel.test.ts
```

## 风险边界

- 不改变 Composio MCP URL、MCP headers、tool router session 保存结构。
- 不把 Composio API Key、MCP headers 或第三方 token 下发到 sandbox。
- 不恢复旧 token OAuth 分支。
- 不引入 per-connector callback env；统一 base 已满足调试、灰度、上线环境切换，path 仍由代码固定，减少配置错误面。
