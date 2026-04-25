# OSAC 后端托管 MCP RPC Provider 改进方案 [20260425-2240已采用]

更新时间：2026-04-25

## 1. 背景

当前部分 MCP provider 的真实执行能力并不适合放在 sandbox 内部。例如 Vercel 连接器需要使用 API 后端持有的 OAuth/profile/项目归属信息，如果继续让 sandbox 内的 `local_stdio` bridge 回连 API internal endpoint，会带来以下问题：

1. sandbox 需要知道 API internal MCP 地址，联调时依赖 `VERCEL_INTERNAL_MCP_URL`、`ONECEO_API_PUBLIC_URL`、ngrok 或其他公网穿透。
2. provider 的鉴权、租户归属、profile 恢复逻辑被拆到 sandbox bridge 与 API 两侧，主链路容易分叉。
3. 该模式只能解决某个 provider 的临时连通问题，后续新增 GitHub、Supabase、云厂商、内部业务系统等后端托管型 MCP provider 时会重复造 bridge。

因此，本方案把目标定义为 OSAC 的通用能力扩展：新增一种后端托管型 MCP transport，使 OSAC 通过既有 WebSocket 控制面把 MCP JSON-RPC 请求反向交给 API 执行。Vercel 只是首个落地 provider，不是该能力的唯一目标。

本文件只描述 OSAC 侧改进方案。当前状态为 `[20260425-2240已采用]`，已进入 OSAC 代码实现阶段。

## 2. 设计目标

目标不是给 Vercel 增加一个补丁 bridge，而是在 OSAC MCP Runtime Host 内增加可复用的 `backend_rpc` transport。

必须满足：

1. transport 语义与 provider 类型解耦，任何 API 后端可托管的 MCP provider 都可以使用 `backend_rpc`。
2. OSAC 不持有 provider 上游密钥，不直接访问 Vercel REST API 或其他第三方 REST API。
3. OSAC 不再为后端托管型 provider 启动 `local_stdio` 子进程，也不通过 sandbox 内 HTTP/SSE 回连 API。
4. `REGISTER_MCP_PROVIDER`、`ATTACH_MCP_PROVIDER_TO_SESSION`、`LIST_SESSION_MCP_TOOLS`、`CALL_SESSION_MCP_TOOL` 的外层控制语义保持稳定。
5. API 调用方仍只感知 OSAC MCP provider，不需要知道 provider 在 sandbox、本地进程、远端 SSE 还是 API 后端执行。
6. 新增能力必须纳入 OSAC 现有 WebSocket 生命周期、断线清理、状态上报和 artifact 发布链路。

## 3. 当前 Go 代码基线

当前 OSAC Go 源码位于 `apps/OSAC_client`。本方案基于以下实际代码结构设计：

1. `apps/OSAC_client/internal/protocol/protocol.go`
   - `Message` 使用 `type`、`payload`、`requestId` 三段式 envelope。
   - `MCPProviderTransport` 当前包含 `type`、`command`、`url`、`headers`、`env`。
   - `RegisterMCPProviderPayload` 已有 `providerId`、`taskSessionId`、`connectorKey`、`providerLabel`、`transport`。
2. `apps/OSAC_client/internal/mcp/mcp.go`
   - `Registry` 管理 provider 与 session attachment。
   - `providerClient` 抽象已覆盖 `ListTools`、`CallTool`、`Close`。
   - 现有 client 实现为 `stdioClient` 和 `sseClient`。
   - `ensureClientLocked` 只识别 `local_stdio` 与 `remote_sse`，其他 transport 会返回 `unsupported mcp transport`。
3. `apps/OSAC_client/internal/server/server.go`
   - WebSocket handler 的 switch 已处理 MCP provider 生命周期消息。
   - `handleAttachMCPProvider` 会在 attach 阶段调用 `mcpRegistry.AttachProvider`，进而刷新 tools。
   - `handleListSessionMCPTools` 当前只读取 registry 内缓存 tools。
   - `handleCallSessionMCPTool` 当前同步调用 `mcpRegistry.CallSessionTool`。
   - server 层当前没有 `BACKEND_MCP_RPC_RESPONSE` 分发，也没有 backend RPC pending map。

因此，最短路径不是重写 MCP Runtime Host，而是在现有 `providerClient` 抽象下新增一个由 server WebSocket broker 驱动的 `backendRPCClient`。

## 4. 目标链路

通用目标链路为：

```txt
API -> OSAC: REGISTER_MCP_PROVIDER transport.type=backend_rpc
API -> OSAC: ATTACH_MCP_PROVIDER_TO_SESSION
OSAC -> API: BACKEND_MCP_RPC_REQUEST method=initialize
API -> OSAC: BACKEND_MCP_RPC_RESPONSE
OSAC -> API: MCP_PROVIDER_STATUS

API -> OSAC: LIST_SESSION_MCP_TOOLS / CALL_SESSION_MCP_TOOL
OSAC -> API: BACKEND_MCP_RPC_REQUEST method=tools/list 或 tools/call
API -> OSAC: BACKEND_MCP_RPC_RESPONSE
OSAC -> API: SESSION_MCP_TOOLS_RESPONSE / MCP_TOOL_CALL_RESPONSE
```

Vercel 落地后对应链路为：

```txt
API CALL_SESSION_MCP_TOOL
-> OSAC backend_rpc provider
-> API backend MCP RPC handler
-> Vercel MCP service
-> Vercel REST API
```

该链路移除的是 Vercel 专用 `local_stdio` bridge，不移除 OSAC 的通用 MCP provider 管理能力。

## 5. Provider 注册协议

`backend_rpc` provider 使用通用 payload，不在 OSAC 里写死 Vercel：

```json
{
  "type": "REGISTER_MCP_PROVIDER",
  "requestId": "register_provider_xxx",
  "payload": {
    "providerId": "provider--task-session--profile",
    "taskSessionId": "task-session-id",
    "connectorKey": "vercel",
    "providerLabel": "Vercel",
    "transport": {
      "type": "backend_rpc",
      "rpcNamespace": "mcp",
      "backendProvider": "vercel",
      "capabilities": ["initialize", "tools/list", "tools/call"]
    },
    "overwrite": true
  }
}
```

字段语义：

1. `transport.type` 固定为 `backend_rpc`。
2. `connectorKey` 继续表示 oneceo 连接器标识，用于状态归属、日志和恢复。
3. `transport.backendProvider` 表示 API 侧实际执行的 provider key，例如 `vercel`、`github`、`supabase`。如果缺省，API 可按 `connectorKey` 解析。
4. `transport.rpcNamespace` 预留给后续非 MCP RPC 能力隔离，本方案只允许 `mcp`。
5. `transport.capabilities` 用于声明该 provider 支持的 MCP 方法集合，首期只要求 `initialize`、`tools/list`、`tools/call`。

OSAC 行为要求：

1. 注册 provider 状态为 `registered`，不启动子进程。
2. 不校验第三方 provider token，不持久化第三方密钥。
3. transport 元信息保存在 registry 内存状态中，便于后续 attach、list、call 复用。
4. 如果 `transport.type=backend_rpc` 但缺少 `connectorKey` 与 `backendProvider`，注册应失败并上报 `failed_to_register`。

## 6. Go 侧扩展点

### 6.1 protocol.go

需要新增协议结构，而不是散落使用 `map[string]any`：

```go
type BackendMCPRPCRequestPayload struct {
    SessionID       string         `json:"sessionId,omitempty"`
    TaskSessionID   string         `json:"taskSessionId,omitempty"`
    ProviderID      string         `json:"providerId"`
    ConnectorKey    string         `json:"connectorKey,omitempty"`
    BackendProvider string         `json:"backendProvider,omitempty"`
    Method          string         `json:"method"`
    Params          map[string]any `json:"params,omitempty"`
}

type BackendMCPRPCResponsePayload struct {
    SessionID       string `json:"sessionId,omitempty"`
    TaskSessionID   string `json:"taskSessionId,omitempty"`
    ProviderID      string `json:"providerId"`
    ConnectorKey    string `json:"connectorKey,omitempty"`
    BackendProvider string `json:"backendProvider,omitempty"`
    Method          string `json:"method,omitempty"`
    Result          any    `json:"result,omitempty"`
    Error           any    `json:"error,omitempty"`
    IsError         bool   `json:"isError"`
}
```

`MCPProviderTransport` 需要补充通用字段：

```go
RPCNamespace    string   `json:"rpcNamespace,omitempty"`
BackendProvider string   `json:"backendProvider,omitempty"`
Capabilities    []string `json:"capabilities,omitempty"`
```

### 6.2 mcp.go

沿用现有 `providerClient` 抽象，新增 `backendRPCClient`，不重构 `Registry` 的主模型。

建议新增接口：

```go
type BackendRPCInvoker interface {
    InvokeBackendMCPRPC(ctx context.Context, request BackendRPCRequest) (BackendRPCResponse, error)
}
```

`Registry` 初始化时接收 invoker：

```go
func NewRegistry(invoker BackendRPCInvoker) *Registry
```

`ensureClientLocked` 新增分支：

```go
case "backend_rpc":
    client, err = newBackendRPCClient(provider.ProviderID, provider.Transport, r.backendRPCInvoker)
```

`backendRPCClient` 的 `ListTools`、`CallTool` 与 `initialize` 都通过 invoker 发起 `BACKEND_MCP_RPC_REQUEST`。这样 `mcp` 包继续关心 MCP provider 行为，WebSocket 写入和 pending 分发仍由 server 包负责。

### 6.3 server.go

server 层新增 backend RPC broker：

1. `Server` 持有 backend RPC pending map 与递增序列。
2. WebSocket message switch 新增 `BACKEND_MCP_RPC_RESPONSE`。
3. 当前连接关闭时，清理该连接相关 pending，并让等待中的 MCP 调用返回明确错误。
4. `sendMessage` 需要支持可选 requestId，保证 `CALL_SESSION_MCP_TOOL` 与 `MCP_TOOL_CALL_RESPONSE`、`LIST_SESSION_MCP_TOOLS` 与 `SESSION_MCP_TOOLS_RESPONSE` 可被 API 侧准确关联。

建议形态：

```go
type backendRPCPending struct {
    RequestID  string
    ProviderID string
    Method     string
    StartedAt  time.Time
    ReplyCh    chan protocol.BackendMCPRPCResponsePayload
}
```

broker 只负责发送、等待、超时、分发，不包含任何 Vercel 业务逻辑。

## 7. Backend RPC 请求与响应

OSAC 发起请求：

```json
{
  "type": "BACKEND_MCP_RPC_REQUEST",
  "requestId": "backend_mcp_rpc_000001",
  "payload": {
    "sessionId": "orchestrator-session-id",
    "taskSessionId": "task-session-id",
    "providerId": "provider--task-session--profile",
    "connectorKey": "vercel",
    "backendProvider": "vercel",
    "method": "tools/call",
    "params": {
      "name": "vercel_list_projects",
      "arguments": {}
    }
  }
}
```

API 返回响应：

```json
{
  "type": "BACKEND_MCP_RPC_RESPONSE",
  "requestId": "backend_mcp_rpc_000001",
  "payload": {
    "sessionId": "orchestrator-session-id",
    "taskSessionId": "task-session-id",
    "providerId": "provider--task-session--profile",
    "connectorKey": "vercel",
    "backendProvider": "vercel",
    "method": "tools/call",
    "result": {
      "content": []
    },
    "isError": false
  }
}
```

错误响应：

```json
{
  "type": "BACKEND_MCP_RPC_RESPONSE",
  "requestId": "backend_mcp_rpc_000001",
  "payload": {
    "providerId": "provider--task-session--profile",
    "connectorKey": "vercel",
    "backendProvider": "vercel",
    "method": "tools/call",
    "error": {
      "code": "backend_provider_auth_failed",
      "message": "backend provider auth failed"
    },
    "isError": true
  }
}
```

要求：

1. `requestId` 是唯一匹配键，response 未命中 pending 时只记录日志，不创建新调用。
2. `providerId`、`method` 不匹配 pending 记录时视为协议错误。
3. OSAC 不解析 provider 业务错误，只把 API 返回的 MCP result/error 转换为现有工具响应。

## 8. Initialize 策略

`backend_rpc` provider 应在 attach 阶段初始化：

1. `REGISTER_MCP_PROVIDER` 只登记 provider 元信息。
2. `ATTACH_MCP_PROVIDER_TO_SESSION` 调用 `Registry.AttachProvider`。
3. `AttachProvider` 通过 `refreshToolsLocked` 触发 `ensureClientLocked`。
4. `backendRPCClient` 首次创建时执行 `initialize`。
5. initialize 成功后执行 `tools/list`，并将 tools 写入 `provider.Discovered`。
6. attach 成功后上报 `MCP_PROVIDER_STATUS status=connected` 与 tools 快照。
7. initialize 或 tools/list 失败后上报 `failed_to_attach`，错误必须保留 API 返回的 code/message。

这样保持当前 OSAC attach 阶段刷新 tools 的行为，不为 `backend_rpc` 开辟另一条特殊状态机。

## 9. Tools List 流程

当前 `handleListSessionMCPTools` 只读 registry 缓存。首期保持该行为：

1. attach 成功时通过 `tools/list` 刷新工具列表。
2. 后续 `LIST_SESSION_MCP_TOOLS` 返回 registry 中的 `provider.Discovered` 快照。
3. 如果后续需要强制刷新，可在 API 层先发重新 attach 或新增显式 `REFRESH_SESSION_MCP_TOOLS`，本方案不引入额外控制消息。

该策略避免每次 list 都触发后端 RPC，同时符合当前 OSAC 的实现模型。

## 10. Tools Call 流程

当 OSAC 收到 `CALL_SESSION_MCP_TOOL`：

1. `server.go` 解析 payload，并保留外层 `requestId`。
2. `mcp.Registry.CallSessionTool` 校验 provider 是否存在、是否 attach 到 session、tool 是否在 enabledTools 中。
3. provider transport 为 `backend_rpc` 时，`backendRPCClient.CallTool` 通过 broker 发起 `BACKEND_MCP_RPC_REQUEST method=tools/call`。
4. API 返回后，OSAC 转换为 `MCP_TOOL_CALL_RESPONSE`。
5. `MCP_TOOL_CALL_RESPONSE` 应带回原 `CALL_SESSION_MCP_TOOL.requestId`。

响应示例：

```json
{
  "type": "MCP_TOOL_CALL_RESPONSE",
  "requestId": "call_session_mcp_tool_xxx",
  "payload": {
    "sessionId": "orchestrator-session-id",
    "providerId": "provider--task-session--profile",
    "toolName": "vercel_list_projects",
    "result": {
      "content": []
    },
    "isError": false
  }
}
```

对 API 调用方而言，外层 `CALL_SESSION_MCP_TOOL` 请求与响应仍是 OSAC MCP 工具调用，不暴露 provider 内部 transport 差异。

## 11. 错误与超时

新增配置建议放入 `config.Config`：

```txt
OSAC_BACKEND_MCP_RPC_TIMEOUT_MS=60000
```

默认值为 60000ms。该超时用于单次 backend MCP RPC 请求，不替代 WebSocket idle timeout。

OSAC 必须处理：

1. API 返回 `isError=true`。
2. backend RPC 等待超时。
3. WebSocket 连接关闭。
4. response 的 `requestId` 未命中 pending。
5. response 命中的 pending 与 `providerId` 或 `method` 不一致。
6. provider 被 detach/remove 时仍有 pending 调用。

要求：

1. 不做 HTTP fallback。
2. 不自动切回 `local_stdio`。
3. 不吞掉错误。
4. 每个 pending 必须最终收到 response、超时或因连接关闭被清理。
5. 错误返回必须能让 API 区分 `backend_mcp_rpc_timeout`、`backend_mcp_rpc_disconnected`、`backend_mcp_rpc_protocol_error` 与后端 provider 业务错误。

## 12. 状态上报

继续使用现有 `MCP_PROVIDER_STATUS`：

```json
{
  "type": "MCP_PROVIDER_STATUS",
  "payload": {
    "sessionId": "orchestrator-session-id",
    "providerId": "provider--task-session--profile",
    "status": "connected",
    "transport": "backend_rpc",
    "tools": []
  }
}
```

状态要求：

1. register 成功后上报 `registered`。
2. attach 成功后上报 `connected`。
3. attach 失败后上报 `failed_to_attach`。
4. call 失败时不强制移除 provider，但应更新 `LastError`，必要时置为 `failed`。
5. detach/remove 后清理 provider attachment 与该 provider 相关 pending。

## 13. 可扩展性边界

`backend_rpc` 的可扩展性来自协议和执行边界，不来自在 OSAC 里堆 provider 分支。

允许扩展：

1. 新 provider 通过不同 `connectorKey`、`backendProvider` 接入，例如 `github`、`supabase`、`cloudflare`。
2. API 侧根据 `backendProvider` 路由到不同后端 MCP service。
3. provider tools schema 由 API 返回，OSAC 只做标准化转换与 enabledTools 过滤。
4. 后续可在 `transport.capabilities` 中声明更多 MCP 方法，但首期只实现 `initialize`、`tools/list`、`tools/call`。

禁止扩展：

1. 禁止在 OSAC 内写 `if connectorKey == "vercel"` 形式的 provider 业务分支。
2. 禁止在 OSAC 内保存第三方 OAuth token 或 profile secret。
3. 禁止为每个 provider 单独新增 bridge 消息类型，例如 `VERCEL_*_REQUEST`。
4. 禁止为 `backend_rpc` 增加 HTTP fallback 或 local_stdio fallback。

## 14. API 配合点

虽然本文件聚焦 OSAC，但该能力需要 API 同步支持通用 backend MCP RPC handler：

1. API 注册 `BACKEND_MCP_RPC_REQUEST` handler。
2. handler 按 `backendProvider` 或 `connectorKey` 路由到对应后端 MCP service。
3. handler 必须按原 `requestId` 回 `BACKEND_MCP_RPC_RESPONSE`。
4. handler 返回统一 MCP JSON-RPC 语义的 `result` 或 `error`。
5. provider materialize、session attach、sandbox 恢复链路都下发 `transport.type=backend_rpc`。
6. 对 Vercel，API 不应再要求 MCP 工具调用配置 `VERCEL_INTERNAL_MCP_URL`。

Vercel 首期落地时，API 可把 `backendProvider=vercel` 路由到现有 Vercel MCP service；后续 provider 不需要修改 OSAC 二进制，只需要 API 侧 materialize 对应 provider 配置。

## 15. 不做事项

本次不做：

1. 不重构全部 MCP provider 管理模型。
2. 不新增 HTTP fallback。
3. 不让 OSAC 直接访问 Vercel REST API 或其他第三方 REST API。
4. 不把任何第三方 OAuth token 下发到 sandbox。
5. 不保留同一 provider 的 `local_stdio bridge` 与 `backend_rpc` 双主链。
6. 不修改 `local_stdio` 与 `remote_sse` 的既有行为。
7. 不新增 provider 专属 RPC 消息类型。

## 16. 发布要求

该改动需要修改 OSAC agent 源码并重新编译 Linux 二进制，例如：

```txt
osac-linux-amd64
```

发布流程必须走当前仓库约定的 R2 artifact 链路，不回退到手工分发。发布后，sandbox 启动与恢复必须下载支持 `backend_rpc` 的新 OSAC 版本。

基于 v1.1.3 交付文档，当前编译命令基线为：

```bash
PATH=/opt/homebrew/bin:$PATH GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o dist/osac-linux-amd64_<new-version> ./cmd/osac
```

Debug 构建基线为：

```bash
PATH=/opt/homebrew/bin:$PATH GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags debug -o dist/osac-linux-amd64_<new-version>_debug ./cmd/osac
```

本方案建议发布为 v1.1.3 之后的新正式版本，例如 `v1.1.4` 或按现有发布规范确定的下一版本号；不能覆盖 `dist/osac-linux-amd64_v1.1.3`。

## 17. 验收标准

通用验收：

1. `REGISTER_MCP_PROVIDER transport.type=backend_rpc` 成功后不启动子进程。
2. provider status 中 `transport=backend_rpc`。
3. attach 阶段触发 `initialize` 与 `tools/list` backend RPC。
4. `LIST_SESSION_MCP_TOOLS` 能返回 attach 阶段发现的 tools。
5. `CALL_SESSION_MCP_TOOL` 能触发 `tools/call` backend RPC，并返回 `MCP_TOOL_CALL_RESPONSE`。
6. OSAC 日志能看到 `BACKEND_MCP_RPC_REQUEST` 与匹配的 `BACKEND_MCP_RPC_RESPONSE`。
7. WebSocket 断开、provider detach/remove、backend RPC timeout 都不会遗留 pending。
8. 旧 OSAC 遇到 `backend_rpc` 时不会被误用到正式链路。

Vercel 首期验收：

1. Vercel provider 注册后不启动 `vercel-stdio-bridge`。
2. Vercel tools 能通过 `backend_rpc` 列出。
3. `vercel_get_auth_context` 成功。
4. `vercel_list_projects` 成功。
5. 后端不再出现 `VERCEL_BRIDGE_UPSTREAM_REQUEST` 作为 session tool 主链路日志。
6. sandbox 内没有 Vercel bridge 进程。

## 18. 测试计划

OSAC 单元测试：

1. `MCPProviderTransport` 可反序列化 `backend_rpc` 扩展字段。
2. `RegisterProvider backend_rpc` 不启动 `stdioClient` 或 `sseClient`。
3. `ensureClientLocked backend_rpc` 创建 `backendRPCClient`。
4. `backendRPCClient` initialize 成功后 provider 可进入 attach 成功流程。
5. backend RPC response 可按 `requestId` 命中 pending。
6. backend RPC timeout 会清理 pending 并返回明确错误。

OSAC 集成测试：

1. `ATTACH_MCP_PROVIDER_TO_SESSION` 触发 `initialize` 与 `tools/list`。
2. `CALL_SESSION_MCP_TOOL` 触发 `tools/call`。
3. API 返回 `isError=true` 时，OSAC 返回 `MCP_TOOL_CALL_RESPONSE isError=true`。
4. detach/remove provider 后 pending 被清理。
5. WebSocket 断开后 pending 全部失败返回。

真实链路测试：

1. 使用 Vercel profile attach 到 task session。
2. 确认 provider transport 为 `backend_rpc`。
3. 调用 `vercel_get_auth_context`。
4. 调用 `vercel_list_projects`。
5. 检查 sandbox 内没有 Vercel bridge 进程。

## 19. 结论

OSAC 的最短改进路径是新增通用 `backend_rpc` MCP provider transport，并把它接入现有 `providerClient`、`Registry`、WebSocket message broker 与 `MCP_PROVIDER_STATUS` 机制。

该能力的核心价值是让 OSAC 只承担 MCP 调用转发、状态管理、工具列表标准化与 session attachment 校验，provider 的鉴权和真实业务调用统一留在 API 后端。Vercel 是首个适配对象，但方案必须保持 provider 无关，避免未来每接一个后端托管型 MCP provider 都新增一套 sandbox bridge。
