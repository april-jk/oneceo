# Slack 按 Notion 模式接入 Composio MCP 操作文档 [20260430-1228已采用]

状态：`[20260430-1228已采用]`

更新日期：2026-04-30

## 1. 目标

Slack 连接器不再使用平台自建 Slack OAuth client、Slack User OAuth token 或 `https://mcp.slack.com/mcp` 直连。主链路改为与 Notion 一致：

1. oneceo API 通过 Composio Tool Router 创建 session。
2. 用户通过 Composio Connect Link 完成 Slack 授权。
3. oneceo API 只保存服务端 broker 所需的 Composio MCP URL 与 headers 密文。
4. session attach 时注册 `api_brokered_mcp` hosted provider。
5. sandbox 内只看到 broker 后的 Slack MCP tools，不接收 Slack token、Slack app secret 或 Composio API key。

## 2. 配置项

必须配置：

```text
COMPOSIO_API_KEY=...
COMPOSIO_API_BASE_URL=https://backend.composio.dev
COMPOSIO_SLACK_TOOLKITS=slack
COMPOSIO_SLACK_ALLOWED_TOOLS=
```

说明：

- `COMPOSIO_SLACK_TOOLKITS` 默认值为 `slack`。
- `COMPOSIO_SLACK_ALLOWED_TOOLS` 为空表示不做工具 allowlist 限制。
- `COMPOSIO_API_KEY` 缺失时，Slack catalog 显示 unavailable，不能用旧 OAuth 或旧 MCP 兜底。

不再作为主链路读取：

```text
SLACK_CONNECTOR_CLIENT_ID
SLACK_CONNECTOR_CLIENT_SECRET
SLACK_CONNECTOR_REDIRECT_URI
SLACK_CONNECTOR_USER_SCOPES
SLACK_CONNECTOR_AUTHORIZE_URL
SLACK_CONNECTOR_TOKEN_URL
SLACK_MCP_REMOTE_URL
SLACK_MCP_REMOTE_HEADERS_JSON
```

这些变量仅作为 legacy 注释保留，不能驱动 Slack MCP runtime。

## 3. 用户连接流程

1. 用户在连接器中心点击 Slack 的连接按钮。
2. Web 调用 `POST /api/connectors/slack/oauth/start`，可携带 `returnToSessionId`。
3. API 创建 `connector_auth_requests`，provider 固定为 `composio`。
4. API 调用 Composio Tool Router session 与 Connect Link。
5. 浏览器跳转到 Composio/Slack 授权页。
6. 授权完成后回到 `/slack/callback` 或通用 callback。
7. Web 调用 `POST /api/connectors/slack/oauth/callback`。
8. API 查询 Composio session/toolkits，确认 Slack connection active。
9. API 写入 Slack profile：
   - `metadata.provider = "composio"`
   - `metadata.composioSessionId`
   - `metadata.composioToolkitSlugs = ["slack"]`
   - `metadata.connectionStatus = "active"`
   - `secret.source = "composio"`
   - `secret.composioMcpUrl`
   - `secret.composioMcpHeaders`

## 4. 会话挂载流程

1. 用户在 task session 中挂载 Slack。
2. API 读取已授权 Slack profile。
3. `connector-registry` 将 Slack materialize 为 hosted provider：
   - `type = "hosted"`
   - `provider = "slack"`
   - `capabilities = ["initialize", "tools/list", "tools/call"]`
4. `session-connector-service` 注册 `backend_rpc` transport，`transportName` 固定为 `api_brokered_mcp`。
5. tools/list 通过 oneceo API broker 转发到 Composio MCP。
6. binding 保存 runtime provider 与 tools snapshot。

## 5. Agent 使用规则

Agent 必须先加载连接器 guide：

```text
load_connector_guide(connectorKey=slack)
```

随后按 Composio router 工具链使用：

```text
slack__COMPOSIO_SEARCH_TOOLS
slack__COMPOSIO_GET_TOOL_SCHEMAS
slack__COMPOSIO_MULTI_EXECUTE_TOOL
```

禁止行为：

1. 不得要求用户粘贴 Slack token、bot token、app secret 或 signing secret。
2. 不得在 sandbox 安装、curl、运行 Slack MCP server。
3. 不得把 Slack 或 Composio 凭据写入 shell、环境变量或 sandbox 文件。
4. 发送或更新 Slack 消息前，必须确认目标 workspace、channel/conversation 与消息内容。

## 6. 旧 profile 处理

旧 Slack User OAuth token profile 不自动迁移，不继续驱动 runtime。

读取旧 profile 时：

1. 如果 secret 不是 `source=composio` 且没有 `composioMcpUrl`，后端将其标记为 `needs_auth`。
2. 清空旧 secret。
3. `lastError` 写入：`Slack connector now requires Composio OAuth. Reconnect Slack through Composio.`
4. 用户必须重新通过 Composio Connect Link 连接 Slack。

## 7. 最小验证

API 验证：

```bash
cd apps/api
node --import tsx --test --experimental-test-isolation=none tests/connector-registry.test.ts
node --import tsx --test --experimental-test-isolation=none tests/session-connector-service.test.ts
node --import tsx --test --experimental-test-isolation=none tests/user-connector-service.test.ts
```

Web 验证：

```bash
cd apps
pnpm --filter web check
```

手工验收：

1. 清空或断开旧 Slack profile。
2. 配置 `COMPOSIO_API_KEY` 与 `COMPOSIO_SLACK_TOOLKITS=slack`。
3. 打开连接器中心，Slack 卡片应显示可连接。
4. 点击连接并完成 Composio/Slack 授权。
5. 回到 oneceo 后 Slack profile 应为 authorized。
6. 在 task session 中 attach Slack。
7. 确认 binding runtime transport 为 `api_brokered_mcp`。
8. 启动 run 后确认可见 `slack__COMPOSIO_SEARCH_TOOLS`。
9. sandbox 中不应出现 Slack token、Slack app secret 或 Composio API key。

## 8. 代码落点

- `apps/api/src/connectors/definitions/slack.ts`
- `apps/api/src/connectors/definitions/index.ts`
- `apps/api/src/services/user-connector-service.ts`
- `apps/api/src/services/session-mcp-recovery-service.ts`
- `apps/api/src/services/altus-managed-setup-service.ts`
- `apps/api/src/services/connector-guide-service.ts`
- `apps/web/client/src/components/ConnectorCenterPanel.tsx`
- `apps/web/client/src/lib/connector-guides.ts`
- `apps/web/client/src/locales/zh.json`
- `apps/web/client/src/locales/en.json`
- `apps/.env.example`

## 9. 2026-04-30 cleanup

- Removed the old Slack direct OAuth callback path from `apps/api/src/services/user-connector-service.ts`.
- Removed obsolete Slack OAuth and Slack remote MCP env fixtures from connector tests.
- Kept the legacy Slack profile downgrade path so old token-based profiles are marked `needs_auth` and must reconnect through Composio.
