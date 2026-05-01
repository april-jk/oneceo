# Vercel MCP `streamable_http` �����Ž��޸����� [20260425-2359���滻]

## 20260424-״̬����

���ļ��� transport/local bridge �޸�˼·����Ч�������ᵽ�� Vercel OAuth ģ����ָ Vercel Integration install flow������ָ Sign in with Vercel ��ͨ OAuth��

更新时间�?026-04-23

## 1. 背景与问�?
当前 Vercel 连接器在会话 attach / 恢复阶段会出现以下错误：

- 报错信息：`unsupported mcp transport: streamable_http`
- 典型表现：连接器已完�?OAuth，profile 也有最近授权时间，但会话内 MCP 工具不可�?- 结果状态：binding 落入 `failed` �?`pending_recover`，工具访问被阻断

这说明当前问题不是“Vercel OAuth 没成功”，而是�?
1. OAuth 完成后，平台继续触发会话 attach�?2. attach 下发给运行时�?provider transport �?`streamable_http`�?3. 当前 OSAC / runtime 主链不接�?`streamable_http`�?4. 最�?attach 失败，恢复链路也会反复命中同一�?transport 错误�?
## 2. 当前事实

结合现有代码与已采用方案，可以确认：

1. `apps/api/src/connectors/definitions/vercel.ts` 当前显式声明�?   - `runtime.type = 'remote'`
   - `runtime.transport = 'streamable_http'`
2. Vercel 当前并不是直连官�?MCP，而是先经�?oneceo 内部 Vercel MCP 包装层�?3. `apps/api/src/services/session-connector-service.ts` �?`runtimeConfig.type === 'local'` 已经稳定下发 `local_stdio`�?4. Supabase 已经在当前仓库内用“本�?stdio bridge 转发上游 `streamable_http`”的方式解决了同类问题，且方案已采用�?   - 参考文档：`docs/agent研发文档/20260405_Supabase_MCP_方案二_不改OSAC本地桥接实施文档_[20260405-1829已采用].md`
   - 参考实现：`apps/api/src/connectors/bridges/supabase-stdio-bridge.ts`

因此，Vercel 当前报错�?Supabase 当时的问题属于同一类问题：不是上游 MCP 不可用，而是运行�?transport 能力边界不匹配�?
## 3. 方案结论

本次采用�?Supabase 一致的单一路径方案�?
1. 不修�?OSAC�?2. 不要�?runtime 新增原生 `streamable_http` 支持�?3. 不把 Vercel 改成另一种协议以规避问题�?4. 保持现有 “Vercel OAuth -> oneceo internal MCP wrapper�?架构不变�?5. 仅将“运行时看到�?transport”改�?`local_stdio`，并�?sandbox 内本�?bridge 负责转发到上�?`streamable_http` 端点�?
调整后的主链路为�?
`API -> OSAC -> local_stdio(vercel bridge) -> streamable_http -> oneceo internal Vercel MCP`

这条链路�?Supabase 已采用方案保持一致，符合“最短路径修复、不中断现有架构、不引入双主链”的要求�?
## 4. 为什么不采用其他方案

### 4.1 不修�?OSAC 支持 `streamable_http`

不采用。原因：

1. 这是跨系统协议能力变更，范围明显大于本次修复目标�?2. 当前仓库已有 Supabase 成熟范式可复用，没有必要为单一连接器扩大改造面�?3. 该方向会提高恢复链路、runtime 注册、观测与回归成本�?
### 4.2 不把 Vercel 改成 `remote_sse`

不采用。原因：

1. 当前 Vercel 主架构已经收敛为 oneceo internal MCP wrapper�?2. 本次问题的直接矛盾是“runtime 不接�?`streamable_http`”，不是“Vercel 必须使用 SSE”�?3. 用户明确要求参�?Supabase 解决方案，因此应复用“本�?bridge 化”路径，而不是额外切协议�?
### 4.3 不保留双路径兼容

不采用。原因：

1. 不允许长期同时保留“直�?remote `streamable_http`”与“local bridge”两套主逻辑�?2. 双路径会�?attach、恢复、日志、问题排查全部变复杂�?3. 当前目标是收口问题，不是扩展配置面�?
## 5. 目标

本方案的目标是：

1. Vercel attach 不再�?runtime 下发 `streamable_http`�?2. Vercel attach / recovery �?runtime 侧统一表现�?`local_stdio`�?3. 连接器完�?OAuth 后，attach 能稳定进�?`connected`�?4. `pending_recover` 状态的 Vercel binding 在恢复时不再重复撞上 transport 错误�?5. 在会话中真实执行至少一�?Vercel MCP tool 调用成功�?
验收标准�?
1. attach 响应不再包含 `unsupported mcp transport: streamable_http`
2. `task_session_connector_bindings.runtime_transport = local_stdio`
3. `runtime_status` 最终进�?`connected`
4. session MCP tools 可列出且至少一�?`tools/call` 成功

## 6. 代码改造范�?
## 6.1 新增 Vercel 本地 stdio bridge

新增文件�?
1. `apps/api/src/connectors/bridges/vercel-stdio-bridge.ts`

职责�?
1. 通过 `stdin/stdout` 暴露 MCP JSON-RPC 能力�?2. 接收运行时发来的 `initialize`、`tools/list`、`tools/call` 等请求�?3. �?HTTP 方式把这些请求转发到 oneceo internal Vercel MCP endpoint�?4. 对上�?`streamable_http` 响应做标�?MCP 回写�?5. 负责错误透传、超时控制、必要的会话头维护�?
环境变量建议�?
1. `VERCEL_INTERNAL_MCP_URL`
2. `VERCEL_BRIDGE_RUNTIME_AUTH`
3. `VERCEL_INTERNAL_TOKEN`
4. `VERCEL_BRIDGE_TIMEOUT_MS`
5. `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（如当前环境需要代理）

实现要求�?
1. 参�?`supabase-stdio-bridge.ts` 的实现结构，不重新发明一套桥接模式�?2. bridge 只做协议转发与必要状态维护，不承接业务逻辑�?3. 敏感信息输出前必须脱敏�?4. 上游失败时必须返回可诊断错误，禁止吞错或泛化成无上下文报错�?
## 6.2 调整 connector-registry，将 Vercel 物化�?`local`

修改文件�?
1. `apps/api/src/services/connector-registry.ts`

改造要求：

1. 参�?Supabase 分支，为 Vercel 新增 `buildVercelStdioBridgeCommand` �?bridge env 组装逻辑�?2. `materializeRuntimeConfig()` �?`connectorKey === 'vercel'` 时返回：
   - `type = 'local'`
   - `command = ['node', '-e', buildVercelStdioBridgeCommand()]`
   - `environment = { ... }`
3. �?registry 负责把当�?session / user / profile 所需的内部认证信息注�?bridge 环境�?4. 其他连接器行为保持不变�?
约束�?
1. 不保�?Vercel 现有 direct remote `streamable_http` 主路径�?2. 不引入按环境切回 remote 的自动分支�?
## 6.3 会话 attach 层统一复用现有 `local_stdio` 逻辑

涉及文件�?
1. `apps/api/src/services/session-connector-service.ts`

要求�?
1. 不再�?Vercel attach �?remote `streamable_http` 语义�?2. 直接复用现有 `runtimeConfig.type === 'local' -> local_stdio` 分支�?3. attach、恢复、调试日志中记录�?transport 必须�?runtime 真正收到的一致，�?`local_stdio`�?
说明�?
1. 这一层原则上不新�?Vercel 专属补丁逻辑�?2. Vercel �?transport 修复应主要在 registry 物化阶段完成，attach 层只消费统一后的 runtime config�?
## 6.4 同步更新 Vercel connector 定义说明

涉及文件�?
1. `apps/api/src/connectors/definitions/vercel.ts`
2. 如有必要，再同步 `apps/web/client/src/lib/connector-guides.ts`

要求�?
1. 文案上明确“Vercel 通过平台内部 MCP 包装层接入，并由平台本地 bridge 提供�?runtime”�?2. 避免后续开发者误以为 Vercel 仍应直接�?remote `streamable_http` 注册�?runtime�?3. 不改变用户侧 OAuth 心智，不暴露不必要的底层 transport 细节�?
## 6.5 恢复链路保持闭环，不绕过现有状态机

涉及范围�?
1. `session-mcp-recovery-service`
2. attach 触发恢复的相关入�?
要求�?
1. 不新增绕过恢复表和恢复任务的“临时直连”实现�?2. `pending_recover` �?Vercel binding 在下次恢复时，应按新 `local_stdio bridge` 方案重新 attach�?3. 恢复完成后，状态投影与工具快照必须回到现有闭环�?
## 7. 详细执行步骤

阶段 A：bridge 落地

1. 新增 `vercel-stdio-bridge.ts`
2. 参�?Supabase bridge 完成 HTTP 转发、超时、错误透传、必要会话头维护

阶段 B：registry 物化切换

1. �?`connector-registry.ts` 增加 Vercel local bridge 分支
2. 去掉 Vercel attach 继续�?remote `streamable_http` 的主路径

阶段 C：会话与恢复验证

1. 通过现有 attach 接口重新连接 Vercel
2. 验证 `pending_recover -> connected`
3. 验证 `tools/list` 与至少一�?`tools/call`

阶段 D：文档与观测同步

1. 更新 Vercel 相关设计文档状态与引用
2. 增加 bridge 相关调试日志
3. 确保日志中不出现明文 token

## 8. 测试方案

需要新增或调整的测试：

1. `apps/api/tests/connector-registry.test.ts`
   - 断言 Vercel runtime config 被物化为 `type=local`
   - 断言 command 指向 Vercel bridge
   - 断言 env 注入符合预期
2. `apps/api/tests/session-connector-service.test.ts`
   - 断言 Vercel attach transport �?`local_stdio`
3. 新增 `apps/api/tests/vercel-stdio-bridge.test.ts`
   - 断言请求可正确转发到 internal MCP URL
   - 断言上游错误可透传
   - 断言必要会话头或请求上下文被正确保留
4. 恢复链路联调
   - 断言原本 `pending_recover` �?Vercel binding 能恢复到 `connected`

联调验收路径�?
1. 创建或复用已�?Vercel profile
2. 完成 OAuth
3. 触发 attach
4. 检�?binding �?`runtime_transport`
5. 在会话内触发真实 Vercel 工具调用

## 9. 风险与应�?
风险 1：bridge 进程异常退�?
1. 现象：provider attach 后短时间断开
2. 应对：attach 时重新拉�?bridge，并把失败语义透传给恢复链�?
风险 2：internal MCP 对非初始化请求存在会话头要求

1. 现象：`initialize` 成功，但后续 `tools/list` / `tools/call` �?4xx
2. 应对：参�?Supabase bridge，在 bridge 内维护并复用上游返回的会话标�?
风险 3：内部认证头注入不完�?
1. 现象：bridge 可访�?URL，但上游返回鉴权失败
2. 应对：由 registry 统一负责 env 注入，避免把认证组装散落到多�?
## 10. 非目�?
本次不做�?
1. 不修�?OSAC 协议�?transport 枚举
2. 不改 Vercel OAuth 模型
3. 不改 oneceo internal MCP wrapper 的业务语�?4. 不新增“失败后自动换另一�?transport”的兜底逻辑
5. 不绕开现有恢复链路、状态表、工具快照机�?
## 11. 结论

当前 `unsupported mcp transport: streamable_http` 的正确修复方向，不是继续�?runtime 直接�?`streamable_http`，而是复用 Supabase 已验证的方案，把 Vercel runtime 主链收口为：

`local_stdio bridge -> 上游 streamable_http`

这样可以在不�?OSAC、不�?Vercel OAuth 架构、不引入双主链的前提下，直接解决 attach 与恢复阶段的 transport 不兼容问题�?
## 12. 评审占位

1. 当前状态：`[20260424-0008已采用]`
2. 已根据本方案进入代码实现阶段�?3. 后续若方案被替换、暂停或废弃，需要继续同步更新文档状态与相关引用�?
