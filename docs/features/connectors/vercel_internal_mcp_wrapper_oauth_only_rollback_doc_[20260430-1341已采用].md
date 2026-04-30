# Vercel 退回 Internal MCP Wrapper OAuth-only 方案 [20260430-1341已采用]

状态：`[20260430-1341已采用]`

更新时间：2026-04-30

## 1. 目标

按用户要求，VercelMcp 从 Composio Connect Link + API broker 方案退回到旧的 oneceo internal MCP wrapper + Vercel Integration OAuth 链路。

本次只回退 Vercel：

1. Notion、Slack、Supabase、Figma 继续使用 Composio broker。
2. Vercel catalog 重新依赖 `VERCEL_INTEGRATION_*`。
3. Vercel session attach 重新注册 `backend_rpc`，由 `vercel-mcp-service` 调用 Vercel REST API。
4. Vercel profile secret 重新保存 `source=vercel_integration` 与 installation access token。
5. 不再读取 `COMPOSIO_VERCEL_TOOLKITS` 或 `COMPOSIO_VERCEL_ALLOWED_TOOLS`。

## 2. 环境变量

当前 Vercel 主链路需要：

```text
VERCEL_INTEGRATION_SLUG=
VERCEL_INTEGRATION_CLIENT_ID=
VERCEL_INTEGRATION_CLIENT_SECRET=
VERCEL_INTEGRATION_REDIRECT_URI=
```

可选：

```text
VERCEL_INTEGRATION_INSTALL_URL=
VERCEL_INTEGRATION_TOKEN_URL=
```

## 3. 代码落点

1. `apps/api/src/connectors/definitions/vercel.ts`
2. `apps/api/src/services/vercel-mcp-service.ts`
3. `apps/api/src/services/vercel-rest-client.ts`
4. `apps/api/src/services/vercel-token-refresh-service.ts`
5. `apps/api/src/services/hosted-provider-host-service.ts`
6. `apps/api/src/services/connector-registry.ts`
7. `apps/api/src/services/user-connector-service.ts`
8. `apps/api/tests/vercel-oauth-connector.test.ts`
9. `apps/api/tests/vercel-mcp-service.test.ts`

## 4. 验证

最小验证：

```bash
cd apps/api
node --import tsx --test --experimental-test-isolation=none tests/connector-registry.test.ts tests/session-connector-service.test.ts tests/hosted-provider-host-service.test.ts tests/vercel-oauth-connector.test.ts tests/vercel-mcp-service.test.ts
```

静态验证：

```bash
cd apps
pnpm --filter api type-check
pnpm --filter web check
```
