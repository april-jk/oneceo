# 03 第三阶段：Tool Result Envelope 与失败闭环 [20260426-0317已采用]

## 1. 阶段目标

第三阶段把所有 managed tool 的结果统一成协议中立 envelope，让成功、失败、阻断、中断、complete 都能进入下一轮模型上下文。

目标：

1. 工具失败不是日志，而是 `tool_result`；
2. connector guide blocked、deployment blocked、invalid args、OSAC provider lost 都能进入模型上下文；
3. `complete_task` 也有 terminal tool_result；
4. run event / timeline / Redis / SSE 仍从单一 projection 链路派生。

## 2. 实现范围

允许修改：

1. `AltusManagedToolExecutor` envelope；
2. `AltusManagedToolRuntime` result normalization；
3. 工具失败到 tool_result 的转换；
4. complete_task terminal result；
5. Protocol Validator 的 tool result 校验；
6. 相关测试。

不允许修改：

1. `AltusRunEventWriter.appendRunEvent(...)` 发布顺序；
2. `task_session_run_events.sequence` 来源；
3. SSE 事件名；
4. direct mode；
5. OSAC MCP 控制面；
6. deployment gate 的硬边界。

## 3. Envelope 形态

统一结果必须至少覆盖：

1. `ok`
2. `error`
3. `ask_user`
4. `complete`
5. `cancelled`
6. `deferred`

每个 envelope 必须包含：

1. `toolUseId`
2. `toolName`
3. `runId`
4. `modelRoundId`
5. `args`
6. `contentForModel`
7. `contentForUser`
8. `retryable`
9. `sideEffects`
10. `activatedSkills`

## 4. 失败映射

| 失败来源 | errorCode | retryable | 模型可见内容 |
| --- | --- | --- | --- |
| 参数不是 JSON object | `invalid_tool_arguments_json` | true | 要求模型重新生成合法 JSON |
| unsupported tool | `unsupported_tool` | false | 工具不存在，换路径 |
| sandbox missing | `sandbox_not_ready` | true | 等待或恢复 sandbox |
| OSAC provider missing | `mcp_provider_not_found` | true | 恢复 MCP provider |
| connector guide 未加载 | `connector_guide_required` | true | 先调用 `load_connector_guide` |
| deployment 未授权 | `deployment_not_allowed` | false | 继续生成交付物，不进入部署 |
| complete_task 证据不足 | `completion_blocked` | true | 补充验证或部署证据 |

## 5. Projection 关系

第三阶段最容易出现双事实源，必须明确：

1. tool_result envelope 是上下文事实；
2. `tool_call_started/completed/failed` 是运行展示与 history replay projection；
3. Redis stream 是热投影；
4. SSE 是实时投影；
5. API messages 是 compiler projection。

如果新增 ledger 写入，必须保证和 `AltusRunEventWriter` 串联为一个 DB-backed outbox / projection pipeline。

## 6. 验收条件

### 6.1 功能验收

1. shell 参数错误后，下一轮模型看到 structured error tool_result。
2. connector guide 未加载时，下一轮模型看到 `connector_guide_required`。
3. MCP provider 丢失时，下一轮模型看到 `mcp_provider_not_found`。
4. deployment 未授权时，deployment tool 不执行，模型看到 `deployment_not_allowed`。
5. complete_task 成功时写入 terminal tool_result。
6. complete_task 被 deployment gate 阻断时写入 error tool_result。

### 6.2 协议验收

1. 每个 assistant tool_use 都有对应 tool_result。
2. missing tool_result 为 0。
3. orphan tool_result 为 0。
4. duplicate tool_result 为 0。
5. 同一 model round 的 sibling tool_call 全部闭合。

### 6.3 Projection 验收

1. `tool_call_completed` 仍投影到 conversation timeline。
2. `tool_call_failed` 仍投影到 conversation timeline。
3. `tool_call_progress` 不被持久化为 history 噪声。
4. Redis/SSE 顺序与 DB sequence 一致。
5. messageKey 仍为稳定格式。

### 6.4 测试验收

至少新增：

1. invalid args -> error tool_result 测试；
2. connector guide blocked -> error tool_result 测试；
3. OSAC provider missing -> error tool_result 测试；
4. deployment gate -> error tool_result 测试；
5. complete_task terminal tool_result 测试；
6. projection 顺序不变测试；
7. protocol validator missing/orphan/duplicate 测试。

## 7. 退出条件

第三阶段完成后，必须证明：

1. 工具失败后 Altus 能自然换路径；
2. 不再靠自然语言 reminder 修补工具上下文；
3. run event、history、API projection 对同一个 tool result 的解释一致；
4. 没有引入新的 run event sequence 来源。
