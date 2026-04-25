# Vercel MCP 接入 OSAC Hosted Provider 链路执行文档 [20260425-2257已采用]

更新时间：2026-04-25

## 20260425-环境变量与旧链路清理更新

本轮清理后，Vercel 当前主链只保留 Integration OAuth 与 OSAC `backend_rpc` hosted provider：

1. 环境变量统一使用 `VERCEL_INTEGRATION_SLUG`、`VERCEL_INTEGRATION_CLIENT_ID`、`VERCEL_INTEGRATION_CLIENT_SECRET`、`VERCEL_INTEGRATION_REDIRECT_URI`。
2. 不再读取 `VERCEL_CONNECTOR_MODE`、`VERCEL_CONNECTOR_CLIENT_ID`、`VERCEL_CONNECTOR_CLIENT_SECRET`、`VERCEL_CONNECTOR_REDIRECT_URI`。
3. 删除 Vercel `local_stdio` bridge 与 `/api/internal/connectors/vercel/mcp` legacy route。
4. 删除 Vercel bridge 专属变量 `VERCEL_INTERNAL_MCP_URL`、`VERCEL_BRIDGE_RUNTIME_AUTH`、`VERCEL_BRIDGE_TIMEOUT_MS` 的示例与测试依赖。
5. `ONECEO_INTERNAL_TOKEN` 仍保留给其他 internal/admin 路由使用，但不再参与 Vercel MCP 主链。

## 1. 背景

Vercel MCP 旧主链路为：

```txt
API CALL_SESSION_MCP_TOOL
-> OSAC
-> sandbox 内 Vercel local_stdio bridge
-> API internal Vercel MCP HTTP endpoint
-> Vercel REST API
```

这条链路已经能工作，但它把 Vercel 的 MCP 调用拆成 sandbox bridge 与 API internal HTTP endpoint 两段，导致本地联调依赖 `VERCEL_INTERNAL_MCP_URL`、`ONECEO_API_PUBLIC_URL`、ngrok 或公网穿透，也让恢复、attach、日志排查出现 Vercel 专属分支。

当前已采用的基础方案为：

1. OSAC 增加通用 `backend_rpc` MCP provider transport。
2. API 增加 Hosted Provider Host。
3. Vercel 作为第一个 hosted provider 接入该链路。

因此，本文件不再把目标描述为 “Vercel WebSocket 补丁”，而是描述 Vercel MCP 如何使用最新 OSAC 通用控制面 RPC transport 与 API Hosted Provider Host。

## 2. 目标链路

新主链路为：

```txt
API CALL_SESSION_MCP_TOOL
-> OSAC MCP Runtime Host
-> provider.transport = backend_rpc
-> OSAC BACKEND_MCP_RPC_REQUEST
-> API Hosted Provider Host
-> Vercel Hosted Provider implementation
-> vercelMcpService.executeRpc()
-> Vercel REST API
-> API BACKEND_MCP_RPC_RESPONSE
-> OSAC MCP_TOOL_CALL_RESPONSE
```

其中：

1. OSAC 只知道 `backend_rpc` transport，不写任何 Vercel 业务分支。
2. API Hosted Provider Host 按 `backendProvider=vercel` 路由到 Vercel 实现。
3. Vercel OAuth token、refresh token、profile material 只留在 API 服务端。
4. sandbox 内不再启动 Vercel `local_stdio` bridge。
5. `CALL_SESSION_MCP_TOOL` 对上层调用方保持不变。

## 3. 当前代码事实

已存在能力：

1. OSAC WebSocket 连接与请求响应模型：
   - `apps/api/src/clients/osac-client.ts`
   - `apps/api/src/services/osac-connection-manager.ts`
   - `apps/api/src/services/osac-agent-service.ts`
2. Vercel MCP 业务逻辑：
   - `apps/api/src/services/vercel-mcp-service.ts`
   - `apps/api/src/services/vercel-rest-client.ts`
3. Vercel 旧 bridge 与 internal HTTP endpoint：
   - `apps/api/src/connectors/bridges/vercel-stdio-bridge.ts`
   - `apps/api/src/routes/internal-vercel-mcp-routes.ts`
4. OSAC 最新 `backend_rpc` transport 设计文档：
   - `docs/features/connectors/osac_backend_mcp_rpc_provider_improvement_doc_[尚未采用].md`

本轮实现后的目标事实：

1. Vercel connector runtime materialize 为 `hosted`。
2. Session attach 下发 OSAC provider transport：

```json
{
  "type": "backend_rpc",
  "rpcNamespace": "mcp",
  "backendProvider": "vercel",
  "capabilities": ["initialize", "tools/list", "tools/call"]
}
```

3. API 启动时注册 Hosted Provider Host message handler。
4. Hosted Provider Host 响应 OSAC 发来的 `BACKEND_MCP_RPC_REQUEST`。
5. Vercel 主链不再依赖 `VERCEL_INTERNAL_MCP_URL` 或 `VERCEL_BRIDGE_RUNTIME_AUTH`。

## 4. API Hosted Provider Host

新增文件：

1. `apps/api/src/services/hosted-provider-host-service.ts`

职责：

1. 监听 OSAC 全局消息 `BACKEND_MCP_RPC_REQUEST`。
2. 解析 `sessionId`、`taskSessionId`、`providerId`、`connectorKey`、`backendProvider`、`method`、`params`。
3. 根据 `backendProvider` 路由到 provider implementation。
4. 首期只支持 `backendProvider=vercel`。
5. 对每个 requestId 必须回 `BACKEND_MCP_RPC_RESPONSE`。
6. 发生异常时也必须返回 `isError=true`，避免 OSAC pending 悬挂。

Vercel handler 要求：

1. 读取 `taskSessionConnectorBindingDAO.getByTaskSessionAndConnectorKey(taskSessionId, 'vercel')`。
2. 校验 binding 存在、`desiredState='attached'`、`runtimeProviderId` 与请求 `providerId` 一致。
3. 读取 `taskCreationSessionDAO.getSession(taskSessionId)` 获取真实 `userId`。
4. 使用 binding 上的 `profileId` 构造 `VercelMcpRuntimeContext`。
5. 调用 `vercelMcpService.executeRpc()`。

不允许：

1. 仅依赖 OSAC 请求中的 profileId 作为授权依据。
2. 在日志输出 Vercel token、internal token 或 runtime auth token。
3. 为 Vercel 单独新增 `VERCEL_*_REQUEST` 消息。

## 5. OSAC Connection Manager 配合

`osacConnectionManager.request()` 会先跑 bridge ready probe；但 `BACKEND_MCP_RPC_REQUEST` 发生在 OSAC attach/provider 初始化过程中，如果响应也走 `request()`，容易出现自锁或无意义 probe。

因此需要在：

1. `apps/api/src/services/osac-connection-manager.ts`

新增直接发送能力：

```ts
sendDirect(sessionId, message): boolean
```

用途：

1. Hosted Provider Host 收到 OSAC 请求后，用同一条已存在连接直接回 `BACKEND_MCP_RPC_RESPONSE`。
2. 不创建新的 pending request。
3. 不触发 `GET_SESSION_LIST` ready probe。

## 6. Vercel Runtime Materialize

修改文件：

1. `apps/api/src/services/connector-registry.ts`
2. `apps/api/src/services/session-connector-service.ts`
3. `apps/api/src/connectors/definitions/vercel.ts`

### 6.1 connector-registry

`ConnectorRuntimeConfig` 增加：

```ts
{
  type: 'hosted';
  enabled: boolean;
  provider: ConnectorKey;
  capabilities?: string[];
}
```

Vercel 分支从旧的：

```txt
type=local
command=node -e buildVercelStdioBridgeCommand()
env=VERCEL_INTERNAL_MCP_URL / ONECEO_INTERNAL_TOKEN / VERCEL_BRIDGE_RUNTIME_AUTH
```

改为：

```txt
type=hosted
provider=vercel
capabilities=initialize,tools/list,tools/call
```

### 6.2 session-connector-service

`buildProviderTransport()` 识别 `runtimeConfig.type === 'hosted'`，下发：

```ts
transport: {
  type: 'backend_rpc',
  rpcNamespace: 'mcp',
  backendProvider: runtimeConfig.provider,
  capabilities: runtimeConfig.capabilities || ['initialize', 'tools/list', 'tools/call'],
}
transportName: 'backend_rpc'
```

这样 `task_session_connector_bindings.runtime_transport` 会落为 `backend_rpc`，恢复链路后续也会按 hosted runtime 重新 attach。

### 6.3 Vercel definition

Vercel connector availability 不再依赖：

1. `ONECEO_INTERNAL_TOKEN`
2. `VERCEL_INTERNAL_MCP_URL`
3. `ONECEO_API_PUBLIC_URL`

Vercel definition 文案更新为 Hosted Provider Host。旧 internal MCP URL 只保留在 legacy route/bridge 文件中，不再作为主链 availability 条件。

## 7. 旧 HTTP Endpoint 定位

以下文件本轮不删除：

1. `apps/api/src/connectors/bridges/vercel-stdio-bridge.ts`
2. `apps/api/src/routes/internal-vercel-mcp-routes.ts`

定位调整：

1. 它们不再是 Vercel session MCP tool 主链。
2. 如仍需保留，可作为历史兼容或调试入口。
3. 后续清理要另起文档，避免把 transport 迁移与接口删除混成一次变更。

## 8. 安全与授权

Vercel hosted provider 执行前必须满足：

1. task session 存在并能解析真实 `userId`。
2. Vercel binding 属于该 task session。
3. binding 已 attached。
4. binding.runtimeProviderId 等于 OSAC 请求 providerId。
5. binding.profileId 非空。
6. `vercelMcpService.loadAuthorizedProfile()` 继续验证 profile 属于 user、connectorKey 为 `vercel`、authStatus 为 `authorized`。

这保证 OSAC 请求只作为控制面调用，不成为授权来源。

## 9. 实施清单

已实施项：

1. OSAC 支持 `backend_rpc` transport。
2. API 新增 `hosted-provider-host-service.ts`。
3. API 启动入口注册 `hostedProviderHostService.initialize()`。
4. `osacConnectionManager` 增加 `sendDirect()`。
5. Vercel runtime materialize 为 hosted provider。
6. Session attach 下发 `backend_rpc` transport。
7. Vercel connector definition 移除 internal MCP URL availability 依赖。

待实测项：

1. 使用最新 OSAC Linux 二进制启动 sandbox。
2. 重新 attach Vercel profile。
3. 确认 runtime transport 为 `backend_rpc`。
4. 调用 `vercel_get_auth_context`。
5. 调用 `vercel_list_projects`。
6. 检查 sandbox 内没有 `vercel-stdio-bridge` 进程。
7. 检查后端没有 `VERCEL_BRIDGE_UPSTREAM_REQUEST` 作为主链日志。

## 10. 验收标准

1. Vercel attach 成功后 provider status 中 `transport=backend_rpc`。
2. `task_session_connector_bindings.runtime_transport=backend_rpc`。
3. OSAC 日志出现 `BACKEND_MCP_RPC_REQUEST method=initialize/tools/list/tools/call`。
4. API 返回匹配的 `BACKEND_MCP_RPC_RESPONSE`。
5. `LIST_SESSION_MCP_TOOLS` 能列出 Vercel tools。
6. `CALL_SESSION_MCP_TOOL vercel_get_auth_context` 成功。
7. `CALL_SESSION_MCP_TOOL vercel_list_projects` 成功。
8. Vercel token 不出现在 OSAC payload、sandbox env 或日志中。
9. sandbox 内不再启动 Vercel `local_stdio` bridge。

## 11. 测试计划

API 静态验证：

1. `pnpm --filter api type-check`

OSAC 验证：

1. `go test ./...`
2. 使用 WSL 编译 Linux amd64 二进制。

真实链路验证：

1. 上传最新 OSAC 二进制到 sandbox。
2. 启动 sandbox 后确认 OSAC 版本支持 `backend_rpc`。
3. 通过用户态 Playwright 或 API 调用 attach Vercel connector。
4. 执行 Vercel 只读工具。
5. 检查 runtime 状态、OSAC 消息、后端日志、sandbox 进程。

## 12. 风险与处理

风险 1：API response 走 `request()` 导致 attach 阶段自锁。

处理：Hosted Provider Host 使用 `sendDirect()` 回包。

风险 2：OSAC 请求缺少 taskSessionId。

处理：API 可从标准 providerId `task_session:<id>:connector:<key>:profile:<id>` 推导；但主路径仍要求 attach 下发 taskSessionId。

风险 3：旧 Vercel bridge 文件仍存在，误以为仍是主链。

处理：文档明确旧 bridge/internal route 非主链；代码 materialize 不再引用 `buildVercelStdioBridgeCommand()`。

风险 4：旧 sandbox 内 OSAC 不支持 `backend_rpc`。

处理：必须上传并使用本轮 WSL 编译的新 OSAC Linux 二进制，不能继续使用 v1.1.3。

## 13. 结论

Vercel MCP 应作为 API Hosted Provider Host 的首个 provider，通过 OSAC `backend_rpc` transport 完成 MCP `initialize`、`tools/list`、`tools/call`。该链路把 Vercel 业务执行和 token 使用稳定收敛到 API 服务端，同时让 OSAC 保持 provider 无关的通用控制面 RPC transport。
