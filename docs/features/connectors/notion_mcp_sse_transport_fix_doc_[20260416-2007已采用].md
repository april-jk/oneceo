# Notion MCP 改为 Remote SSE 传输修复方案 [20260416-2007已采用]

更新时间：2026-04-16

## 1. 背景

当前线上/联调环境中，Notion connector 在会话 attach 阶段会报错：

- 前端提示：`unsupported mcp transport: streamable_http`
- 请求路径：`POST /api/task-creation/sessions/:sessionId/connectors/notion/attach`
- HTTP 状态：`400 Bad Request`

当前仓库代码中：

1. Notion connector definition 显式声明了 `transport: 'streamable_http'`
2. Slack 没有显式声明 transport，因此走 remote connector 默认值 `remote_sse`
3. 当前实际运行的 OSAC/runtime 链路仍不接受直接注册 `streamable_http`

所以问题不是“Notion OAuth 失败”，而是：

1. OAuth 成功后会自动触发 session attach
2. attach 阶段向 runtime 注册了 `streamable_http`
3. runtime 直接拒绝该 transport
4. 最终表现为 attach 400

## 2. 本次目标

本次只走一条主路径修复：

1. Notion MCP 统一改为 `remote_sse`
2. Notion 远端 URL 统一改为官方 SSE 端点
3. 删除此前围绕 `streamable_http` 的错误实现，不保留 bridge 方案
4. 清理存量错误 runtime 投影，让已 attach 的 Notion binding 重新按 SSE 恢复

本次不采用兼容性方案，不保留“双协议并存”。

## 3. 根因判断

### 3.1 直接根因

Notion 当前 definition 使用的是：

- `transport = 'streamable_http'`
- 远端地址仍指向 `https://mcp.notion.com/mcp`

而当前运行时链路对 `streamable_http` 并不支持，因此在 provider register/attach 阶段直接失败。

### 3.2 为什么 Slack 不报这个错

Slack 当前没有显式 transport，走的是 remote connector 默认 transport：

- `remote_sse`

因此 Slack 没有撞上 runtime 对 `streamable_http` 的拒绝逻辑。

### 3.3 为什么本次不采用 streamable_http bridge

虽然可以通过 sandbox 内 `local_stdio bridge` 转接上游 `streamable_http`，但这条路不符合本次修复目标：

1. 目标是最短路径修复线上 attach 失败
2. runtime 当前已经稳定接受 `remote_sse`
3. Notion 官方同时提供 SSE 端点
4. 引入 bridge 会增加额外进程、额外状态、额外日志和额外恢复复杂度
5. 仓库里已经出现了针对 bridge 的错误改动草稿，应直接删除，避免后续继续偏航

因此本次唯一方案是：直接切换到官方 SSE 端点。

## 4. 单路径方案

### 4.1 Notion connector 定义改为 remote_sse

修改文件：

1. `apps/api/src/connectors/definitions/notion.ts`

修改要求：

1. 把 Notion runtime transport 从 `streamable_http` 改为 `remote_sse`
2. Notion 默认 remote URL 改为官方 SSE 端点：
   - `https://mcp.notion.com/sse`
3. 若使用 `NOTION_MCP_REMOTE_URL`，则只允许配置 SSE 端点
4. 若环境变量仍配置为 `/mcp`，catalog 必须直接标记 unavailable，并给出明确 reason

本次不允许做以下错误做法：

1. 继续保留 `https://mcp.notion.com/mcp`
2. 只改 transport 名字，不改 URL
3. 在代码里偷偷把 `/mcp` 自动替换成 `/sse`

原因是这会掩盖真实部署配置错误。

### 4.2 删除 streamable_http bridge 错误实现

删除文件：

1. `apps/api/src/connectors/bridges/streamable-http-stdio-bridge.ts`

删除原因：

1. 该文件不是本次修复目标
2. 该实现会把 Notion 问题重新引向 `local_stdio bridge`
3. 本次方案已经明确选定 `remote_sse`
4. 继续保留该文件会让后续开发者误判当前采用方案

### 4.3 回退 connector-registry 中的 bridge 分支

修改文件：

1. `apps/api/src/services/connector-registry.ts`

删除内容：

1. `buildStreamableHttpBridgeEnvironment`
2. `buildStreamableHttpStdioBridgeCommand`
3. `bridge.upstreamTransport`
4. `bridge.mode`
5. Notion `streamable_http -> local_stdio` 的专用分支

修改后要求：

1. Notion 与 Slack 一样，统一按标准 remote MCP config materialize
2. runtime config 应直接产出：
   - `type = 'remote'`
   - `transport = 'remote_sse'`
   - `url = notion SSE endpoint`

### 4.4 清理 session-connector-service 中新增的错误语义

修改文件：

1. `apps/api/src/services/session-connector-service.ts`

删除内容：

1. `upstreamTransportName`
2. `bridgeMode`
3. 所有围绕 bridge 补进去的日志字段
4. 所有 runtime event 中新增的 `upstreamTransport` / `bridgeMode`

修改后要求：

1. `transportName` 只表示真实下发给 runtime 的 transport
2. Notion attach 过程中记录的 transport 必须稳定为 `remote_sse`
3. 不再出现“上游 transport 是 A，runtime transport 是 B”的双语义字段

### 4.5 清理存量 Notion binding 的错误 runtime 投影

本次修复不仅改代码，还必须处理已经写入 DB 的错误状态。

涉及表：

1. `task_session_connector_bindings`

涉及 DAO：

1. `apps/api/src/db/dao/task-session-connector-binding.dao.ts`
2. `apps/api/src/services/session-mcp-recovery-service.ts`

清理策略：

对 `connector_key = 'notion'` 的 binding：

1. 若 `desired_state = 'attached'`
   - `runtime_status = 'pending_recover'`
   - `runtime_provider_id = null`
   - `runtime_attached_tools_json = []`
   - `runtime_transport = 'remote_sse'`
   - `recovery_queued_at = now`
   - `recovery_started_at = null`
   - `recovery_completed_at = null`
   - `last_error = 'notion_remote_sse_migration_pending_recover'`
2. 若 `desired_state != 'attached'`
   - `runtime_status = 'detached'`
   - `runtime_provider_id = null`
   - `runtime_attached_tools_json = []`
   - `runtime_transport = 'remote_sse'`
   - 清空 recovery 字段

这样旧 session 会自动走现有恢复链路重新 attach，不会继续残留 `streamable_http`。

### 4.6 更新 sandbox bootstrap 行为

修改文件：

1. `apps/api/src/services/sandbox-agent-provision-service.ts`

要求：

1. session bootstrap 使用 `connectorRegistry.materializeRuntimeConfig()` 时，Notion 应直接生成 SSE remote config
2. 新 sandbox 启动后的 OpenCode MCP 配置与 attach 路由使用同一套 runtime config
3. 不允许出现：
   - attach 走 SSE
   - bootstrap 仍走 streamable_http

## 5. 影响范围

预计影响文件：

1. `docs/features/connectors/notion_mcp_sse_transport_fix_doc_[20260416-2007已采用].md`
2. `apps/api/src/connectors/definitions/notion.ts`
3. `apps/api/src/services/connector-registry.ts`
4. `apps/api/src/services/session-connector-service.ts`
5. `apps/api/src/services/sandbox-agent-provision-service.ts`
6. `apps/api/src/services/session-mcp-recovery-service.ts`
7. `apps/api/src/connectors/bridges/streamable-http-stdio-bridge.ts`（删除）
8. 相关测试文件

## 6. 测试方案

### 6.1 单元测试

修改/新增：

1. `apps/api/tests/connector-registry.test.ts`
   - Notion runtime config 应为 `remote_sse`
   - Notion URL 应为 `https://mcp.notion.com/sse`
   - 若 env 配成 `/mcp`，catalog 应 unavailable
2. `apps/api/tests/session-connector-service.test.ts`
   - Notion `buildProviderTransport()` 应返回 `remote_sse`
   - 删除对 `local_stdio bridge`、`upstreamTransportName`、`bridgeMode` 的断言
3. 若已有 attach 测试覆盖 Notion，会话 binding 的 `runtimeTransport` 应断言为 `remote_sse`

### 6.2 联调验证

验证路径：

1. 新建 session
2. 完成 Notion OAuth
3. 自动触发 attach
4. 检查 attach 接口响应
5. 检查 DB binding 状态
6. 发起需要 Notion MCP 工具的任务

验收标准：

1. attach 不再返回 `unsupported mcp transport: streamable_http`
2. binding 中 `runtime_transport = remote_sse`
3. runtime status 最终为 `connected`
4. run 中可真实看到 Notion MCP tools
5. sandbox 恢复后 Notion 仍可按 SSE 正常恢复

## 7. 文档状态管理

本次方案已进入代码实现阶段，当前状态为：

- `[20260416-2007已采用]`

同步要求：

1. 旧文档 `notion_session_attach_and_mcp_runtime_fix_doc_[20260416-2007已替换].md`
   已标记为“已替换”
2. 主目录仅保留当前采用方案与带状态标记的旧方案

## 8. 非目标

本次不做以下扩展：

1. 不引入 Notion `streamable_http` 与 `remote_sse` 双协议共存
2. 不引入新的本地 bridge 进程
3. 不重构整个 connector 生命周期模型
4. 不改 Slack、GitHub、Supabase 的产品行为
5. 不对 OSAC 增加 `streamable_http` 原生支持

## 9. 结论

本次问题的最短路径修复不是“继续适配 `streamable_http`”，而是：

1. 让 Notion connector 直接切换到官方 SSE 端点
2. 让 runtime transport 与当前 OSAC 能力边界一致
3. 删除已经偏离方向的 bridge 草稿代码
4. 清理旧 binding 的错误 runtime 投影

只有这样，才能把问题真正收口为：

- Notion = `remote_sse`
- Slack = `remote_sse`
- runtime 不再收到 `streamable_http`
