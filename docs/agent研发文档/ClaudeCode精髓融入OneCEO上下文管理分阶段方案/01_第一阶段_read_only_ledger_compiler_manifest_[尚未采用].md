# 01 第一阶段：Read-only Ledger、Compiler 与 Manifest [尚未采用]

## 1. 阶段目标

第一阶段只建立可观测证据，不改变线上 managed run 行为。

目标是证明：

1. 当前 session 历史能被构造成协议中立 ledger view；
2. 当前上下文能被 compiler 编译成 OpenAI-compatible messages；
3. 当前实际 messages 与 compiler messages 的差异可解释；
4. ask_user、tool_call、tool_result、attachment、skill、MCP 的缺口能被 manifest 暴露；
5. 不写入新的上下文事实。

## 2. 实现范围

允许新增：

1. `altus-managed-context-ledger-adapter`
2. `altus-managed-turn-snapshot-service`
3. `altus-managed-context-compiler`
4. `altus-managed-context-manifest-service`
5. `altus-managed-context-reconciliation-service` dry-run 模式
6. debug endpoint 或内部诊断入口
7. fixture / unit tests

不允许修改：

1. `AltusRunCoordinator.runModelLoop` 的主流程；
2. `AltusRunEventWriter.appendRunEvent(...)` 的写入与发布顺序；
3. SSE 事件名；
4. `conversation_messages.messageKey`；
5. Redis 存储语义；
6. direct mode。

## 3. 数据来源

第一阶段 ledger 只能从现有数据派生：

| 现有数据 | read-only ledger view |
| --- | --- |
| `conversation_messages` | user_message / assistant_message / clarification_request / status_projection |
| `task_session_run_events` | assistant_tool_use / tool_result candidate / lifecycle / tool event |
| message metadata attachments | attachment_ref |
| message metadata skills | skill_selection |
| mcp snapshot / input mcpProviders | mcp_provider_snapshot |
| pending clarification memory | pending clarification diagnostic |

## 4. Manifest 最小字段

第一阶段 manifest 至少包含：

1. `sessionId`
2. `runId`
3. `ledgerCursor`
4. `loweringTarget`
5. `neutralGraphHash`
6. `apiMessageHash`
7. `stableSystemHash`
8. `toolSchemaHash`
9. `volatileContextHash`
10. `toolUseCount`
11. `toolResultCount`
12. `missingToolResultCount`
13. `orphanToolResultCount`
14. `includedAttachmentIds`
15. `includedSkillIds`
16. `includedMcpProviderIds`
17. `cacheBreakReason`

## 5. Dry-run Reconciliation

第一阶段 reconciler 只输出 preview，不写 DB。

必须能识别：

1. pending ask_user 后用户已回答，但缺少 tool_result；
2. ask_user 后用户转向新任务；
3. assistant tool_call 有 started/completed event，但 API messages 缺少 tool result；
4. orphan tool_result；
5. attachment metadata 存在但 compiler 未纳入；
6. skill metadata 存在但 snapshot 未纳入。

## 6. 验收条件

### 6.1 功能验收

1. 对指定真实 session 能生成 ledger view。
2. 对同一 session 能生成 manifest。
3. manifest 能指出 `ask_user -> 用户回答 -> tool_result` 是否闭合。
4. manifest 能列出 missing / orphan tool_result。
5. compiler 输出的 OpenAI-compatible messages 可 JSON 序列化。
6. compiler 输出不写回 DB。
7. 多次运行同一输入，manifest hash 稳定。

### 6.2 不变性验收

1. managed run 行为不变。
2. SSE 输出不变。
3. history replay 不变。
4. Redis key 不新增事实语义。
5. `AltusRunEventWriter` 不被新代码绕过。
6. direct mode 不受影响。

### 6.3 测试验收

至少新增：

1. ledger adapter 从 `conversation_messages` 构造 user / assistant / clarification entries 的测试；
2. ledger adapter 从 `task_session_run_events` 构造 tool entries 的测试；
3. manifest 缺失 tool_result 的测试；
4. manifest orphan tool_result 的测试；
5. compiler provider lowering 的测试；
6. dry-run 不写 DB 的测试。

### 6.4 真实链路验收

用一个包含重复 clarification 问题的真实 session 验证：

1. 当前实际 messages 里为什么重复问；
2. compiler view 中缺了哪个 tool_result；
3. dry-run preview 会建议生成什么 result；
4. 没有任何线上消息被改变。

## 7. 退出条件

第一阶段完成后，必须产出：

1. manifest 示例；
2. 当前实际 messages 与 compiler messages 的 diff；
3. 至少一个真实 session 诊断报告；
4. 下一阶段需要写入的最小事实列表。

只有这些证据齐全，才进入第二阶段。
