# Vercel 按 Notion 模式接入 Composio MCP 操作文档 [20260430-1314已采用_20260430-1341已替换]

状态：`[20260430-1314已采用_20260430-1341已替换]`

更新时间：2026-04-30

## 1. 目标

VercelMcp 不再作为 oneceo 自建 Vercel Integration OAuth + internal MCP wrapper 的主链路。主链路改为与 Notion 一致：

1. oneceo API 通过 Composio Tool Router 创建 session。
2. 用户通过 Composio Connect Link 完成 Vercel 授权。
3. oneceo API 只保存服务端 broker 所需的 Composio MCP URL 与 headers 密文。
4. session attach 时注册 `api_brokered_mcp` hosted provider。
5. sandbox 内只看到 broker 后的 Vercel MCP router tools，不接收 Vercel token、Integration token 或 Composio API key。

## 2. 配置项

```text
COMPOSIO_API_KEY=...
COMPOSIO_API_BASE_URL=https://backend.composio.dev
COMPOSIO_VERCEL_TOOLKITS=vercel
COMPOSIO_VERCEL_ALLOWED_TOOLS=
```

说明：

1. `COMPOSIO_VERCEL_TOOLKITS` 默认值为 `vercel`。
2. `COMPOSIO_VERCEL_ALLOWED_TOOLS` 为空表示不做工具 allowlist 限制。
3. `COMPOSIO_API_KEY` 缺失时，Vercel catalog 显示 unavailable，不允许回退到旧 Vercel Integration 或 internal MCP wrapper。

以下变量只作为 legacy 注释保留，不再作为 Vercel 主链路读取：

```text
VERCEL_INTEGRATION_SLUG
VERCEL_INTEGRATION_CLIENT_ID
VERCEL_INTEGRATION_CLIENT_SECRET
VERCEL_INTEGRATION_REDIRECT_URI
VERCEL_INTEGRATION_INSTALL_URL
VERCEL_INTEGRATION_TOKEN_URL
VERCEL_INTERNAL_MCP_URL
VERCEL_MCP_REMOTE_HEADERS_JSON
```

## 3. 运行链路

1. 用户在连接器中心点击 Vercel 连接。
2. API 进入通用 `catalogItem.composio.provider === "composio"` 分支。
3. API 创建 `connector_auth_requests`，provider 固定为 `composio`。
4. API 调用 Composio Connect Link，并把 pending session/MCP 信息写入 profile。
5. 用户授权后回到 oneceo callback。
6. API 确认 Composio session/toolkits，profile 标记为 `authorized`。
7. task session attach Vercel 后，runtime transport 为 `api_brokered_mcp`。
8. OSAC 通过 backend RPC 调用 `hosted-provider-host-service`，再由 `composio-connector-service` 转发到 Composio MCP。

## 4. 旧 profile 处理

旧 Vercel Integration profile 不做兼容迁移：

1. 如果 metadata 不是 `provider=composio`，或 secret 不是 `source=composio` 且缺少 `composioMcpUrl`，读取时标记为 `needs_auth`。
2. 清空旧 secret。
3. `lastError` 写入：`Vercel connector now requires Composio OAuth. Reconnect Vercel through Composio.`
4. 用户必须重新通过 Composio Connect Link 授权。

## 5. Agent 使用规则

Agent 必须先加载连接器 guide：

```text
load_connector_guide(connectorKey=vercel)
```

随后按 Composio router 工具链使用：

```text
vercel__COMPOSIO_SEARCH_TOOLS
vercel__COMPOSIO_GET_TOOL_SCHEMAS
vercel__COMPOSIO_MULTI_EXECUTE_TOOL
```

禁止行为：

1. 不得要求用户粘贴 Vercel token、Integration token、team token 或 Composio credential。
2. 不得在 sandbox 安装、curl、运行 Vercel MCP server。
3. 不得把 Vercel 或 Composio 凭据写入 shell、环境变量或 sandbox 文件。
4. 部署、域名、环境变量等生产影响操作前必须明确目标 project、team 和 environment。

## 6. 代码落点

1. `apps/api/src/connectors/definitions/vercel.ts`
2. `apps/api/src/connectors/definitions/index.ts`
3. `apps/api/src/services/connector-registry.ts`
4. `apps/api/src/services/hosted-provider-host-service.ts`
5. `apps/api/src/services/session-mcp-recovery-service.ts`
6. `apps/api/src/services/altus-managed-setup-service.ts`
7. `apps/api/src/services/user-connector-service.ts`
8. `apps/api/src/services/connector-guide-service.ts`
9. `apps/web/client/src/lib/connector-guides.ts`
10. `apps/web/client/src/locales/en.json`
11. `apps/web/client/src/locales/zh.json`
12. `apps/.env.example`

## 7. 最小验证

```bash
cd apps/api
node --import tsx --test --experimental-test-isolation=none tests/connector-registry.test.ts tests/session-connector-service.test.ts tests/hosted-provider-host-service.test.ts tests/vercel-oauth-connector.test.ts
```

```bash
cd apps
pnpm --filter api type-check
pnpm --filter web check
```
