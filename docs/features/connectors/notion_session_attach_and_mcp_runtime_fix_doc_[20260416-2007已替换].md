# Notion 会话挂载失败与 MCP 工具误暴露修复文档 [20260416-2007已替换]

更新时间：2026-04-15

> 已被 `notion_mcp_sse_transport_fix_doc_[20260416-2007已采用].md` 替换，本文件仅保留历史方案记录。

## 1. 背景与现象

当前线上/测试环境出现两类连续问题：

1. Notion OAuth 完成后，前端继续调用会话挂载接口：
   - `POST /api/task-creation/sessions/:sessionId/connectors/notion/attach`
   - 返回 `400 Bad Request`
2. 随后进入会话运行阶段时，`load_connector_guide` 可以成功，但 Notion MCP 工具（如 `notion_list_pages`、`notion_list_databases`、`notion_list_workspaces`）继续失败。

这说明当前问题不是单点故障，而是同一条链路上的两个阶段同时失真：

1. 挂载阶段没有真正把 Notion provider 稳定挂到当前 session runtime。
2. 运行阶段却仍然把 Notion 视为“可用 MCP 工具源”，导致模型继续调用一组实际上不可用的工具。

## 2. 已确认的代码事实

### 2.1 OAuth 回调后会立刻触发会话挂载

前端 `apps/web/client/src/components/ConnectorCenterPanel.tsx` 中：

1. Notion 使用 connector 级 OAuth。
2. `completeConnectorOauth()` 成功后，会取 `returnToSessionId` 和 `defaultProfileId`。
3. 若满足 `attachTarget && completedProfileId && authStatus === "authorized"`，会立即调用：
   - `attachSessionConnector(sessionId, "notion", { profileId })`

因此，当前用户看到的 `400` 不是 OAuth 本身报错，而是 OAuth 成功后的 session attach 报错。

### 2.2 attach 路由会直接进入 live attach，而不是只做期望态持久化

后端 `apps/api/src/routes/task-creation-routes.ts` 中 `/sessions/:sessionId/connectors/:connectorKey/attach`：

1. 读取 `profileId`
2. 校验 session owner
3. 读取当前 session runtime 的 `orchestratorSessionId`
4. 直接调用 `sessionConnectorService.attachConnector(...)`

当前路由层不会把“OAuth 完成后的挂载”拆成“先持久化期望态，再异步恢复”，而是同步走 live attach。

### 2.3 attachConnector 失败后，binding 仍可能保留 attached 目标态

`apps/api/src/services/session-connector-service.ts` 中 `attachConnector(...)` 的当前语义：

1. 一进入 live attach，就先把 binding upsert 为：
   - `desiredState = 'attached'`
   - `runtimeStatus = 'connecting'`
   - 写入 `runtimeProviderId`
2. 如果 attach reply 返回非 connected，会更新为：
   - `runtimeStatus = 'failed'`
   - 但 `desiredState` 仍为 `attached`
3. 如果 attach reply 一度成功，但后续 `waitForRuntimeServer(...)` 发现 provider 并未稳定存在，也会：
   - 写入 `runtimeStatus = 'failed'`
   - 保留 `runtimeProviderId`
   - 未统一清空 runtime 侧投影字段

也就是说，当前代码允许出现一种中间态：

1. 路由返回 400，表示“挂载失败”
2. DB binding 仍然保持“这个 connector 目标上是 attached”
3. 部分 runtime 元数据仍可能残留

这正是后续工具误暴露的前提条件。

### 2.4 MCP 工具快照当前没有严格按 runtimeStatus=connected 过滤

`apps/api/src/services/altus-managed-setup-service.ts` 的 `captureMcpToolSnapshot(...)` 当前逻辑：

1. 只要 binding 满足：
   - `desiredState === 'attached'`
   - 且存在 `runtimeProviderId`
2. 就会把该 provider 纳入 MCP 快照
3. 不要求 `runtimeStatus === 'connected'`

这意味着：

1. 一个 attach 已失败的 binding
2. 只要残留了 `runtimeProviderId` 或 `runtimeAttachedToolsJson`
3. 仍然可能被 Altus 当作“本轮 run 可调用的 MCP provider”

### 2.5 Altus prompt 也会把 attached 视为可用连接器

`apps/api/src/services/altus-managed-prompt-service.ts` 中 `formatConnectors(...)`：

1. 仅按 `item.attached` 过滤连接器
2. 没有把 `runtimeStatus` 纳入“是否可实际调用”的判断

这会进一步放大误导：

1. prompt 告诉模型 Notion 已 attached
2. MCP 工具快照又暴露了工具名
3. 模型自然会继续尝试调用 Notion 工具

### 2.6 Notion 远端传输协议当前无法按连接器显式声明

当前 `apps/api/src/connectors/definitions/types.ts` 与 `apps/api/src/services/session-connector-service.ts` 的组合有一个结构性缺口：

1. connector definition 只能表达 `runtime.type = remote`
2. `buildProviderTransport(...)` 对所有 remote connector 一律下发：
   - `transport.type = 'remote_sse'`
3. 但 `apps/api/src/services/osac-agent-service.ts` 已经支持：
   - `remote_sse`
   - `streamable_http`

因此，当前代码里“Notion 应该使用哪种远端 MCP 传输协议”是不可配置的。

这会导致一个高概率问题：

1. 如果 Notion 官方 MCP 端点实际需要 `streamable_http`
2. 当前 attach 就会以错误协议注册 provider
3. 直接表现为 attach 阶段 400，或 provider attach failed

这一点是当前“挂载失败”的高概率根因，需要在实现阶段用真实 runtime 日志做一次最终确认，但从代码结构上看，这已经是明显缺口。

## 3. 根因结论

本次问题需要拆成“已确认根因”和“高概率根因”两层。

### 3.1 已确认根因：失败挂载状态污染了后续 MCP 工具视图

这是可以直接从代码确认的：

1. attach 失败后，binding 仍可能保留 `desiredState='attached'`
2. `captureMcpToolSnapshot(...)` 没有按 `runtimeStatus='connected'` 严格过滤
3. prompt 侧也把 attached 直接描述为可用连接器

所以，“挂载失败”与“工具仍被调用”在当前代码里是可以同时成立的，而且正是当前实现自然会出现的状态漂移。

### 3.2 高概率根因：Notion provider 的 live attach 本身失败

从用户提供现象和当前代码结构判断，当前 live attach 失败的高概率来源有两类：

1. Notion 远端 MCP 传输协议与当前固定 `remote_sse` 不匹配
2. attach 成功回复后 provider 未稳定驻留，`waitForRuntimeServer(...)` 失败

两者都会触发：

1. attach 路由返回 400
2. binding 进入 `failed`
3. 但 session 仍可能残留 attached 目标态与 runtime 投影

## 4. 修复目标

本次修复只采用一条主路径，不做补丁式兼容分支：

1. 会话挂载结果与 MCP 工具可见性必须完全一致。
2. 任何 `runtimeStatus !== connected` 的连接器都不能再被暴露成可调用 MCP 工具。
3. Notion 远端传输协议必须从“代码硬编码”改为“连接器定义显式声明”。
4. attach 失败时必须留下可观察、可定位、可回放的错误语义。

## 5. 单路径修改方案

### 5.1 先修正 MCP 工具暴露边界，彻底阻断“挂载失败但工具仍可调”

修改文件：

1. `apps/api/src/services/altus-managed-setup-service.ts`
2. `apps/api/src/services/altus-managed-prompt-service.ts`

修改要求：

1. `captureMcpToolSnapshot(...)` 只允许纳入同时满足以下条件的 binding：
   - `desiredState === 'attached'`
   - `runtimeStatus === 'connected'`
   - 存在有效 `runtimeProviderId`
2. 对 `runtimeStatus !== connected` 的 binding：
   - 不生成 MCP provider snapshot
   - 不暴露工具名
3. prompt 里的 connector 描述必须显式包含 runtime 状态，至少区分：
   - connected
   - pending_recover / recovering
   - failed
4. prompt 不再把“attached”直接等价为“可调用”

预期结果：

1. 即使 attach 失败，也不会再出现模型继续调用 Notion MCP 工具的假象
2. 用户看到的“工具失败”会收敛成“当前连接器未完成可调用挂载”

### 5.2 修正 attach 失败后的 binding 清理语义，避免残留脏 runtime 投影

修改文件：

1. `apps/api/src/services/session-connector-service.ts`

修改要求：

1. 对所有 attach 失败出口统一收敛：
   - 明确区分“目标态 attached”与“runtime live provider 不存在”
2. 当 live attach 未成功稳定完成时，必须清理：
   - `runtimeProviderId`
   - `runtimeAttachedToolsJson`
   - `recoveryCompletedAt`
3. 如果失败属于“runtime 未就绪 / 可恢复”，写入：
   - `runtimeStatus = 'pending_recover'`
4. 如果失败属于“provider attach 真实失败”，写入：
   - `runtimeStatus = 'failed'`
   - 但不能再保留会误导快照层的 live provider 投影

这里的关键不是把失败伪装成成功，而是把“目标态”和“live 可调用态”彻底拆开：

1. `desiredState='attached'` 只表示“用户希望它挂着”
2. `runtimeProviderId + runtimeAttachedToolsJson` 只允许代表“当前真的可调用”

### 5.3 给 remote connector 增加显式 transport 定义，补上 Notion 协议表达能力

修改文件：

1. `apps/api/src/connectors/definitions/types.ts`
2. `apps/api/src/connectors/definitions/notion.ts`
3. `apps/api/src/services/connector-registry.ts`
4. `apps/api/src/services/session-connector-service.ts`

修改要求：

1. 在 connector definition 的 runtime 定义中新增显式 transport 字段，例如：
   - `remote_sse`
   - `streamable_http`
2. `buildProviderTransport(...)` 不再对所有 remote connector 硬编码 `remote_sse`
3. Notion 按真实上游协议声明 transport
4. attach runtime event 和 debug log 要把 transport 明确打出来，便于确认线上行为

本次问题对应的最短路径是：

1. 先把 Notion transport 变成可显式声明
2. 再把 Notion definition 调整为真实协议

如果联调确认官方 `https://mcp.notion.com/mcp` 需要 `streamable_http`，则直接以该协议落地，不保留兼容分支。

### 5.4 让 attach 接口的错误语义可定位，而不是只返回泛化 400

修改文件：

1. `apps/api/src/routes/task-creation-routes.ts`
2. `apps/api/src/services/session-connector-service.ts`
3. `apps/api/src/db/dao/task-session-run.dao.ts`（如需补充 runtime event 字段，不改表结构则只补事件内容）

修改要求：

1. attach 失败时，响应中至少要能区分：
   - profile 无效
   - OAuth 未完成
   - runtime 未就绪
   - provider register/attach failed
   - provider attach 成功回复但未稳定驻留
2. 统一写入 connector runtime events，至少覆盖：
   - `provider_register_requested`
   - `provider_register_failed`
   - `provider_attach_failed`
   - `provider_attach_live_missing`
3. 前端提示不再只显示“挂载失败”，而是显示实际失败语义

这样做的目的不是增加额外方案，而是让这条单路径在联调时可以被验证，而不是继续盲猜。

## 6. 受影响文件清单

本次修复预计会落到以下文件：

1. `apps/api/src/services/session-connector-service.ts`
2. `apps/api/src/services/altus-managed-setup-service.ts`
3. `apps/api/src/services/altus-managed-prompt-service.ts`
4. `apps/api/src/connectors/definitions/types.ts`
5. `apps/api/src/connectors/definitions/notion.ts`
6. `apps/api/src/services/connector-registry.ts`
7. `apps/api/src/routes/task-creation-routes.ts`
8. 相关测试文件

## 7. 测试与验收

### 7.1 必做回归

1. Notion OAuth 成功后，回调自动 attach 当前 session，接口返回 200。
2. 若 sandbox 未就绪，session connector 状态应为：
   - `desiredState='attached'`
   - `runtimeStatus='pending_recover'`
   - 不暴露 Notion MCP tools
3. 若 provider attach 真实失败，session connector 状态应为：
   - `desiredState='attached'`
   - `runtimeStatus='failed'`
   - 不暴露 Notion MCP tools
4. 只有当 provider 真正 connected 后，run 才能看到 `notion_list_pages` 等工具。
5. `load_connector_guide` 成功但 provider 未 connected 时，后续不再出现 Notion MCP 工具调用。

### 7.2 代码级测试补充

建议新增/更新测试：

1. `apps/api/tests/session-connector-service.test.ts`
   - remote connector transport 按 definition 显式下发
   - attach 失败后清空 live provider 投影
2. `apps/api/tests/altus-managed-setup-service.test.ts`
   - failed/pending_recover binding 不进入 MCP tool snapshot
3. `apps/api/tests/altus-managed-tool-runtime.test.ts`
   - 没有 connected provider 时，不应出现对应 MCP 工具调用入口
4. `apps/api/tests/connector-routes.test.ts`
   - Notion OAuth callback 后 attach 成功/失败语义回归

### 7.3 真实联调验收

按用户当前复现场景验收：

1. 打开一个新 session
2. 完成 Notion OAuth
3. 自动触发 attach
4. 观察 attach 返回值、binding 状态、runtime event
5. 立即发起一次需要 Notion 工具的任务

验收标准只有一条：

1. attach 成功时，Notion 工具真实可调
2. attach 未成功时，Notion 工具完全不暴露

禁止再出现“挂载失败但模型仍尝试调用 Notion 工具”的中间态。

## 8. 非目标

本次不做以下扩展：

1. 不重构整个 connector 生命周期模型
2. 不引入新的降级分支或兜底协议
3. 不同时改 Slack / GitHub / Supabase 的产品交互
4. 不把本次问题扩展成全量连接器平台重构

## 9. 结论

本次问题的核心不是单纯的 Notion OAuth，而是“session attach 失败语义”和“Altus MCP 工具暴露语义”已经发生了分叉。

单路径修复顺序应当是：

1. 先堵住 failed/pending connector 被当成可调用工具的问题
2. 再补齐 Notion remote transport 的显式协议声明
3. 最后用真实联调确认 attach 失败的具体上游原因并收口到同一套错误语义

在这条路径下，两个现象会一起消失：

1. 会话挂载失败可被明确定位
2. 工具调用失败不再因为脏快照和误暴露被反复放大

## 10. 2026-04-16 实施补充

本次线上复现已经进一步确认：当前实际运行的 OSAC/runtime 链路仍会拒绝直接注册
`streamable_http` transport，前端报错即为：

- `unsupported mcp transport: streamable_http`

因此，本方案在“不回退 Notion 上游协议事实”的前提下，最终实现收口调整为：

1. Notion connector definition 仍显式声明上游 remote transport 是 `streamable_http`
2. API 在 materialize runtime config 时，不再把该 transport 直接下发给 OSAC
3. 改为通过 sandbox 内本地 `local_stdio` bridge 代理上游 `streamable_http`
4. OSAC 只接收其当前稳定支持的 `local_stdio`
5. OpenCode sandbox bootstrap 与 session attach 共用同一套 bridge runtime config，避免两条链路再出现 transport 偏差

这次补充不引入兼容分支，也不把 Notion 伪装成 `remote_sse`。
唯一落地方式就是：

- `Notion upstream = streamable_http`
- `OneCEO runtime registration = local_stdio bridge`
