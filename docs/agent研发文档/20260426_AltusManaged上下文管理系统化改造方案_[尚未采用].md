# 20260426 Altus Managed 上下文管理系统化改造方案 [尚未采用]

## 1. 背景

这次问题不能继续按“补充信息追问不流畅”单点处理。当前暴露出的现象有两类：

1. **人机感重**：用户已经在同一上下文里回答了上一轮问题，Altus 仍像无状态表单一样继续追问，典型例子是“管理后台系统 -> 网页应用 -> 仍然要求确认目标和风险边界”。
2. **缓存命中不稳定**：memory、skills、MCP guide、运行态、当前时间、澄清状态等动态内容分散拼进 prompt，容易让稳定前缀每轮变化，导致 prompt cache 命中率下降，进而增加计费。

根因不是某一个关键词没有匹配，而是 Altus managed 目前缺少统一的“上下文账本 -> API 投影”边界。不同模块各自把历史、澄清、skills、MCP、附件、memory、运行态拼成自然语言片段，模型看到的上下文顺序和人实际对话顺序不稳定。

本方案先不写代码，只明确系统性改造方案，待审核通过后再进入实现。

## 2. 参考范围

本轮参考代码目录：

`/Users/watson/codingProj/oneceo/referance/claudecode_src`

重点读取的 ClaudeCode 文件：

| 文件 | 关注点 |
| --- | --- |
| `query.ts` | 主循环如何维护消息流、compact 后视图、工具结果、mid-turn queued command、memory/skill prefetch |
| `utils/messages.ts` | `normalizeMessagesForAPI`、附件重排、tool_use/tool_result 配对修复、compact boundary 后投影 |
| `utils/attachments.ts` | 附件、粘贴图片、queued command、skills、MCP instruction delta、memory、diagnostics 的统一附件模型 |
| `utils/api.ts` | stable system prompt、dynamic boundary、tool schema cache、`prependUserContext` / `appendSystemContext` |
| `services/api/claude.ts` | API 调用前消息规范化、工具 schema 组装、prompt cache 相关控制 |
| `services/api/promptCacheBreakDetection.ts` | 通过 cache read / cache creation token 反推缓存失效原因 |
| `skills/loadSkillsDir.ts`、`commands.ts` | skills 多来源加载、动态发现、去重、MCP skills 注入 |
| `remote/sdkMessageAdapter.ts` | remote / SDK 消息如何把 tool_result、compact_boundary 转成可回放消息 |

## 3. ClaudeCode 的上下文管理结论

ClaudeCode 值得借鉴的不是某个 prompt 文案，而是这几个工程原则。

### 3.1 保存 typed message stream，不直接保存“拼好的 prompt”

ClaudeCode 内部保留的是结构化消息流：

1. user message
2. assistant message
3. tool_use
4. tool_result
5. attachment
6. compact boundary
7. local command / queued command
8. system informational message

真正调用 API 前才通过 `normalizeMessagesForAPI` 做投影。这样可以保证：

1. UI 回放、历史恢复、API 请求不是三套语义；
2. 工具结果不会因为历史重放而丢掉配对关系；
3. 附件和动态上下文可以移动位置，但原始事件不被破坏。

### 3.2 工具调用和工具结果是一等上下文，不是普通文本

ClaudeCode 对工具链路有强约束：

1. assistant 的 `tool_use` 后面必须有 user 角色的 `tool_result`；
2. 中断、fallback、异常时会补 synthetic tool_result，避免下一轮 API 看到断裂上下文；
3. resume / remote 场景下会修复 orphan tool_result 和重复 tool_use id；
4. 工具结果过大时走 tool result budget，而不是任由工具输出污染后续上下文。

这个原则对 Altus 很关键：managed run 现在既有普通工具，也有 MCP 工具、部署工具、`ask_user`、`complete_task`。如果这些被揉成普通自然语言历史，模型就很容易忘记“我刚问了什么、用户答了什么、哪个工具还没闭环”。

### 3.3 附件是独立上下文块，不塞进用户原话

ClaudeCode 的附件体系覆盖：

1. @mentioned files；
2. pasted images；
3. queued command；
4. MCP resources；
5. skills listing / dynamic skill；
6. IDE selection；
7. diagnostics；
8. todo / plan reminders；
9. token usage / budget；
10. teammate mailbox。

这些内容会先变成 attachment message，再在 API 投影时按规则重排。附件可以靠近用户输入，但不会改写用户原话本身。

对 OneCEO 来说，上传附件、截图、skills、connector guide、memory 都应该进入统一 attachment / context block 管道，而不是分别拼到 `content`、metadata、system prompt 或 runtime prompt。

### 3.4 稳定前缀和动态状态要分离

ClaudeCode 明确区分：

1. 稳定 system prompt；
2. 动态 system context；
3. user context；
4. per-turn attachments；
5. per-request tool schema overlay。

它还通过 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`、tool schema cache、beta header latch、cache break detection 等机制减少缓存前缀抖动。

对 Altus 来说，以下内容不应该进入稳定 system prompt：

1. 当前时间；
2. 当前 pending clarification；
3. 当前 connector guide 内容；
4. 当前 active skill body；
5. 当前 memory context；
6. 当前部署状态；
7. 当前 todo gate；
8. 当前 run state。

这些应放入靠近当前轮的 volatile context block。

### 3.5 compact / collapse 是读时投影，不破坏完整历史

ClaudeCode 会在 API 调用前取 compact boundary 之后的消息，或者通过 microcompact / auto compact / context collapse 形成可发送视图。完整历史和 API 视图是两回事。

OneCEO 也应该区分：

1. DB / Redis 中的真实 run event；
2. 前端 history/replay 视图；
3. 模型 API 请求视图；
4. compact 后 summary 视图。

不能让“为了省 token 的裁剪”反向破坏真实历史。

## 4. OneCEO 当前上下文问题拆解

当前 Altus managed 相关入口主要在：

1. `apps/api/src/services/altus-managed-input-service.ts`
2. `apps/api/src/services/altus-managed-run-entry-service.ts`
3. `apps/api/src/services/altus-managed-setup-service.ts`
4. `apps/api/src/services/altus-run-coordinator.ts`
5. `apps/api/src/services/altus-managed-prompt-service.ts`
6. `apps/api/src/services/altus-managed-tool-runtime.ts`
7. `apps/api/src/services/altus-run-event-writer.ts`

当前主要问题：

1. `buildConversationMessages`、intent profile、coordinator、prompt service 都在处理上下文，但没有统一投影模型；
2. pending clarification 的问题和用户回答不一定在 API 上下文里相邻；
3. `ask_user` 的语义主要靠问题文本和 run state 反推，不够结构化；
4. memory、skill catalog、active skill、connector guide、runtime state 混在 prompt 组装链路里；
5. 上传附件一部分写入 metadata，一部分追加到用户 content，一部分在 setup 阶段再解释；
6. MCP guide 既是工具前置条件，也是 prompt 指令，缺少“已加载 / 未加载 / 本轮 delta”的统一上下文表达；
7. 没有缓存命中观测，无法确认修改是否真的降低 cache break。

## 5. 目标

### 5.1 产品目标

1. Altus 多轮对话要像人在读完整上下文，而不是每轮重新开表单；
2. 用户短回答、委托回答、咨询型转向、新话题切换都要被稳定理解；
3. 工具执行、附件、skills、MCP、memory 不应造成对话语义断裂；
4. 回复应减少“我还需要先确认这一点”这类机械重复；
5. 前端 history/replay 和模型上下文语义一致。

### 5.2 成本目标

1. 稳定 system prompt 在同一 session 内尽量不变；
2. 工具 schema 和 MCP tool list 尽量稳定，动态变化通过 delta / attachment 表达；
3. 当前时间、运行态、澄清态、memory、active skill 不污染 cacheable prefix；
4. 增加 cache read / creation token 观测，能定位 cache break 原因。

### 5.3 工程目标

1. 建立统一 `AltusManagedContextLedger` 和 `AltusManagedContextProjection`；
2. 所有 API-bound messages 都从 projection service 生成；
3. 所有动态上下文进入 typed context block；
4. tool_call / tool_result / ask_user / complete_task 形成结构化事件；
5. compact / budget / attachment 重排变成独立策略层；
6. 现有前端协议尽量保持不变，先修后端上下文组织。

## 6. 非目标

1. 不在本轮重写 Altus managed runner；
2. 不替换现有 run status / lifecycle / Redis 状态；
3. 不改变前端消息渲染协议；
4. 不让 LLM 直接修改 DB 状态；
5. 不引入新依赖；
6. 不把所有能力都改成 ClaudeCode 克隆版；
7. 不为了缓存牺牲安全确认和权限边界。

## 7. 总体方案

建议新增一条明确边界：

```text
DB / Redis / metadata / run events
  -> AltusManagedContextLedger
  -> AltusManagedContextProjection
  -> API-bound messages + stable system prompt + volatile turn context
  -> LLM
  -> structured tool events
  -> reducer / runtime / event writer
```

### 7.1 Context Ledger

Context Ledger 是运行事实层，不是 prompt 文本。它只收集结构化事实：

| 类型 | 来源 | 说明 |
| --- | --- | --- |
| `user_message` | conversation messages | 用户真实输入 |
| `assistant_message` | managed assistant text | Altus 可见回复 |
| `tool_call` | model tool call | 工具名、参数、toolUseId |
| `tool_result` | runtime result | 成功、失败、附件、摘要 |
| `clarification_request` | ask_user / policy | 问题、clarificationType、options |
| `clarification_answer` | user_response | 用户回答与上一问关联 |
| `attachment` | upload / image / file | 文件、图片、引用、sandbox path |
| `skill_listing` | session skill state | 可用 skill 小索引 |
| `active_skill` | selected / auto-attached skill | 当前已激活 skill body |
| `mcp_tool_snapshot` | run entry | MCP 工具快照 |
| `mcp_instruction_delta` | connector guide | 本轮新增/变更 guide |
| `memory_context` | Altus memory | 用户/项目/session memory |
| `runtime_state` | run state | sandbox、部署、todo、budget |
| `compact_boundary` | context budget | summary 与后续保留消息边界 |

要求：

1. Ledger entry 必须有稳定 id、type、source、createdAt、visibility；
2. 用户原话不可被附件、状态提示、系统说明改写；
3. 任何进入模型的动态内容都能追溯到 ledger entry；
4. 前端可继续使用现有消息投影，但模型上下文不再直接依赖前端展示格式。

### 7.2 Context Projection

Context Projection 负责把 Ledger 变成模型请求。

投影输出分四段：

1. `stableSystemPrompt`
2. `toolSchemas`
3. `messages`
4. `volatileTurnContext`

核心排序规则：

1. stable system prompt 永远在最前，且同一 session 内尽量不变；
2. volatile context 放在最新用户消息之前或作为最新用户消息的前置 meta block；
3. 最新用户消息必须保持最后一个 human intent；
4. pending clarification 必须投影为相邻的“问题 -> 用户回答”；
5. tool_call 后必须紧跟对应 tool_result；
6. attachment 可上浮到关联用户消息之前，但不能跨过 assistant 或 tool_result 边界；
7. compact summary 只能替代 API 视图中的旧消息，不能删除 Ledger。

### 7.3 Context Block Registry

所有动态上下文通过 registry 注册，禁止到处手写 prompt 拼接。

建议首批 block：

| block | cache 属性 | 注入位置 |
| --- | --- | --- |
| `core_system` | stable | system prompt |
| `platform_contract` | stable | system prompt |
| `tool_contract` | stable | system prompt |
| `task_memory` | volatile | turn context |
| `skill_catalog_delta` | volatile | turn context / attachment |
| `active_skill_body` | volatile | turn context |
| `mcp_instruction_delta` | volatile | turn context / attachment |
| `attachment_context` | volatile | message attachment |
| `clarification_state` | volatile | before latest user |
| `runtime_state` | volatile | before latest user |
| `deployment_state` | volatile | before latest user |
| `todo_state` | volatile | before latest user |
| `budget_state` | volatile | before latest user |

每个 block 要声明：

1. `id`
2. `kind`
3. `cachePolicy: stable | volatile | delta`
4. `ordering`
5. `maxTokens`
6. `dedupeKey`
7. `sourceEntryIds`

## 8. 关键链路设计

### 8.1 多轮对话

多轮对话不能只取最近 N 条自然语言。需要按 turn 组织：

```text
Human turn
  user_message
  attachments
  clarification_answer?

Assistant turn
  assistant text
  tool_call*
  tool_result*
  clarification_request?
  completion?
```

如果上一轮是 `ask_user`，下一条 `user_response` 必须优先被解释为该 ask_user 的回答，除非 LLM transition 明确判定为新话题。

### 8.2 补充信息

`ask_user` 不再只是文本提示，而是结构化工具事件：

```ts
type AskUserContext = {
  question: string;
  clarificationType:
    | 'artifact_type'
    | 'tech_stack'
    | 'scope_boundary'
    | 'integration_target'
    | 'acceptance_requirement'
    | 'risk_confirmation';
  options?: string[];
  reason?: string;
  capabilityId?: string;
};
```

用户回答进入 projection 时形成：

```text
assistant/tool: ask_user(question, clarificationType)
user: answer
```

这样模型看到的是自然连续的对话，而不是一段孤立的“需要补充信息”状态。

### 8.3 工具调用

所有工具调用进入 Ledger：

1. `tool_call_started`
2. `tool_call_completed`
3. `tool_call_failed`
4. `tool_result_summary`
5. `tool_result_payload_ref`

投影时：

1. 小结果可直接进入 tool_result；
2. 大结果写入引用，正文按预算摘要；
3. 失败结果也必须进入 tool_result，不能只写日志；
4. orphan tool_call / tool_result 在 API 前必须被检测并拒绝或修复。

### 8.4 中途插入用户输入

当 run 正在工具调用或长循环中，用户可能插入新消息。参考 ClaudeCode queued command，OneCEO 应把它作为 `queued_user_command`：

1. 不直接打断当前工具写入；
2. 不丢在下一轮普通历史末尾；
3. 在当前工具结果之后、下一次模型调用之前注入；
4. 明确标记来源为用户插入，不是系统提醒；
5. 如果是取消/暂停类命令，先走 run interrupt policy。

### 8.5 附件和图片

附件应统一成 attachment entries：

1. 上传文件保留 `fileId`、`sandboxPath`、`displayName`、`mimeType`、`size`；
2. 图片保留 vision block 或 image object 引用；
3. 大文件默认只注入摘要和引用，模型需要时再通过工具读取；
4. 用户原文只保留用户说的话，不追加长附件清单；
5. replay/history 通过同一 entry 渲染附件，不另建隐藏逻辑。

### 8.6 Skills

skills 拆成三类上下文：

1. `skill_catalog_delta`：小索引，只告诉模型有哪些 skill 可用；
2. `active_skill_body`：用户显式选择或系统已激活的 skill 正文；
3. `skill_resource_ref`：skill 资源索引，正文按需通过 `load_skill_resource` 获取。

规则：

1. 同一 session 内已发送过的 skill catalog 不重复全量发送；
2. skill 正文不要进 stable system prompt；
3. MCP skills 和平台 skills 使用同一 catalog/delta 机制；
4. skill 版本用 `skillId + revisionId` 做 dedupeKey；
5. 自动加载 skill 的事实写入 Ledger，避免恢复后丢失。

### 8.7 MCP 和 Connector Guide

MCP 需要分开管理三件事：

1. tool schema：运行入口快照；
2. connector guide：如何正确使用工具；
3. runtime loaded state：模型是否已经加载 guide。

设计：

1. `mcp_tool_snapshot` 在 run entry 固定，减少工具 schema 每轮抖动；
2. connector guide 作为 `mcp_instruction_delta` 注入 volatile context；
3. `load_connector_guide` 是结构化工具事件，成功后写入 Ledger；
4. 如果工具调用需要 guide 但未加载，runtime 返回结构化 tool_result，下一轮模型据此加载；
5. guide 内容不进入 stable system prompt。

### 8.8 Memory

memory 拆成：

1. user memory；
2. project memory；
3. session memory；
4. run-local memory delta。

规则：

1. memory 不进入 stable system prompt；
2. memory context 作为 volatile turn context；
3. 只注入与当前 task 相关的 memory 摘要；
4. memory 更新在 run 结束或明确 flush 点发生；
5. memory 注入需要记录 source 和 token size，便于排查 cache/cost。

### 8.9 Prompt Cache

缓存策略要可测：

1. stable system prompt 加 hash；
2. tool schemas 加 hash；
3. volatile turn context 加 hash；
4. 每次 API 调用记录 `cache_read_input_tokens`、`cache_creation_input_tokens`；
5. 如果 cache read 明显下降，记录变化原因：
   - system prompt changed
   - tool schema changed
   - model changed
   - MCP tools changed
   - active skill changed
   - memory context changed
   - compact happened
   - TTL likely expired

验收不是“感觉省钱”，而是能看到同类多轮会话 stable hash 不变，cache read 比例稳定。

### 8.10 Context Budget

上下文预算按层处理：

1. stable system prompt：最小化，不放动态内容；
2. tool schema：固定快照，MCP 多时按 deferred/delta 策略；
3. recent turns：优先保留用户意图、assistant 决策、工具摘要；
4. tool results：按工具族预算，超出写引用；
5. attachments：大文件只注入引用；
6. compact：生成 summary entry，不删除真实历史；
7. cache：compact 后重置 cache baseline，避免误报。

## 9. 拟新增模块

### 9.1 `altus-managed-context-ledger-service`

职责：

1. 从 conversation messages、run events、metadata、Redis state 读取事实；
2. 输出统一 Ledger entry 列表；
3. 不生成 prompt 文案；
4. 不调用 LLM；
5. 不修改状态。

### 9.2 `altus-managed-context-projection-service`

职责：

1. 接收 Ledger entries；
2. 按 projection policy 生成 API messages；
3. 保证 tool_use/tool_result 配对；
4. 保证 pending clarification adjacency；
5. 生成 stable / volatile block hashes；
6. 输出调试快照。

### 9.3 `altus-managed-context-block-registry`

职责：

1. 管理 memory、skills、MCP、attachments、runtime state 等 block；
2. 每个 block 声明 cachePolicy、ordering、maxTokens、dedupeKey；
3. 禁止业务模块绕过 registry 拼 prompt。

### 9.4 `altus-managed-cache-observer`

职责：

1. 记录每次模型调用的 cache usage；
2. 对比前后 stable hash / tool hash / volatile hash；
3. 输出 cache break reason；
4. 支持后台诊断，不直接展示给普通用户。

## 10. 实施步骤

### 第 0 步：处理当前工作树

当前工作树已有上一轮代码改动。方案审核通过前，不继续扩大代码修改。

审核通过后需要先决定这些未提交代码的处理方式：

1. 若与本方案一致，整理后纳入第一阶段实现；
2. 若只是实验补丁，回滚或移到单独实验提交；
3. 实现提交必须以本方案为依据，不能继续堆局部补丁。

### 第 1 步：只做只读投影和快照测试

1. 新增 Ledger / Projection 类型；
2. 从现有 history/run state 读取上下文；
3. 生成 projection debug JSON；
4. 不改变真实模型请求；
5. 增加 golden tests 覆盖典型会话。

验收：

1. 能看到“问题 -> 用户回答”相邻；
2. 能看到 attachments / skills / MCP / memory 分层；
3. 能输出 stable / volatile hash。

### 第 2 步：接入模型请求但保持前端协议不变

1. `AltusRunCoordinator` 改为只调用 projection service 获取 messages；
2. `AltusManagedPromptService` 只负责 stable prompt 和 block renderer；
3. memory、skills、MCP guide 迁入 volatile blocks；
4. 保持现有 `clarification_request` 和 SSE 事件不变。

验收：

1. 原有 coordinator 测试通过；
2. 澄清问题不重复；
3. 用户回答短语能衔接上一问；
4. stable system hash 在连续轮次不变。

### 第 3 步：工具结果和附件预算

1. 对 tool_result 做按工具族预算；
2. 大结果写引用；
3. 附件不再追加进用户自然语言；
4. 图片、文件、skill resource 统一 entry 化；
5. 检测 orphan tool_call / tool_result。

验收：

1. write_file / shell / MCP / deployment 工具结果都能回放；
2. 大输出不会撑爆下一轮上下文；
3. 附件恢复后仍能被模型引用。

### 第 4 步：MCP / Skills delta 化

1. MCP tool snapshot 固定；
2. connector guide 改为 delta block；
3. skill catalog 去重；
4. active skill body 只在需要时注入；
5. skill resource 按需加载。

验收：

1. 重连 MCP 不导致 stable prompt 改变；
2. 同一 session 不重复注入完整 skill catalog；
3. 已加载 guide 的状态可恢复。

### 第 5 步：缓存观测

1. 记录每次 API 调用 cache usage；
2. 记录 stable / tool / volatile hash；
3. 检测 cache break；
4. 后台诊断可查看 cache break reason。

验收：

1. 能解释一次 cache miss 是 prompt 变了、工具变了、compact 了，还是 TTL；
2. 相同会话多轮 stable hash 不变；
3. 典型 managed run cache read 占比有可观测基线。

## 11. 回归测试矩阵

### 11.1 澄清与多轮

1. “帮我做一个管理后台系统” -> 问交付类型 -> “网页应用” -> 不重复问同一问题；
2. “先帮我想想” -> 切 advisory，不进入执行；
3. “方案” / “交付方案” -> 结合上一轮语境理解，不机械追问；
4. “你推荐就行” -> 允许委托给默认，但风险能力仍需要确认；
5. 用户换话题 -> 清理旧 pending。

### 11.2 工具和中途输入

1. shell 执行中用户插入“先停一下”；
2. tool_call 已发出但被中断；
3. tool_result 超大；
4. MCP 工具要求先加载 guide；
5. complete_task 附件返回。

### 11.3 附件

1. 文本文件上传；
2. 图片上传并触发 vision 模型；
3. 大文件只注入引用；
4. 多轮后附件仍可引用；
5. history reload 后附件上下文不丢失。

### 11.4 Skills

1. 首轮 skill catalog 注入；
2. 同一 session 第二轮不重复注入；
3. active skill body 注入；
4. skill resource 按需加载；
5. MCP skill 与平台 skill 去重。

### 11.5 MCP

1. run entry 固定 MCP snapshot；
2. connector guide 未加载时阻断并提示 load；
3. guide 加载后同一工具可继续；
4. MCP reconnect 不破坏 stable prompt；
5. session recovery 后 guide 状态仍可判断。

### 11.6 Cache

1. 连续两轮 stable system hash 一致；
2. 当前时间变化不影响 stable hash；
3. memory 变化只影响 volatile hash；
4. skill catalog delta 不重复扩大 prompt；
5. compact 后 cache baseline 重置。

## 12. 风险

### 12.1 一次性重构过大

控制：

1. 第一阶段只读投影，不接入真实模型请求；
2. 每阶段都有 golden tests；
3. 不动前端协议。

### 12.2 Projection 与真实历史不一致

控制：

1. Ledger entry 必须带 source ids；
2. debug snapshot 可回查每个 block 来源；
3. 禁止 projection 直接改 DB。

### 12.3 为缓存牺牲模型理解

控制：

1. stable prompt 最小化，但 volatile context 仍保留完整当前轮必要信息；
2. 当前用户消息保持最后；
3. 动态上下文放在用户消息前，不丢失语义。

### 12.4 Reducer 又退化成关键词系统

控制：

1. reducer 只读结构化事件、状态、capability metadata；
2. 自然语言理解交给 LLM transition；
3. 测试覆盖短回答、委托、咨询、新话题。

## 13. 审核决策点

需要确认以下方案边界：

1. 是否同意新增 `Context Ledger + Projection` 作为 Altus managed 唯一 API 上下文出口；
2. 是否同意 stable prompt 只放稳定平台契约，memory/skills/MCP/runtime 全部转 volatile blocks；
3. 是否同意第一阶段先做只读 projection debug，不立即切真实请求；
4. 是否同意现有未提交代码在方案通过后重新整理，避免补丁式实现继续混入主方案；
5. 是否同意新增 cache observer，把缓存命中率作为验收指标之一。

## 14. 结论

建议采用这套系统化上下文管理方案，而不是继续修单个补充信息分支。

核心判断：

1. 人机感问题来自上下文语义断裂；
2. 计费问题来自稳定前缀和动态状态混杂；
3. ClaudeCode 的可借鉴点是“typed history + read-time projection + stable/volatile split + tool pairing + attachment/delta context”；
4. OneCEO 应先建上下文边界，再修澄清、人味、缓存命中这些表层症状。

## 15. ClaudeCode 深入补充分析

本节是对 `/Users/watson/codingProj/oneceo/referance/claudecode_src` 的二次深入阅读结论。第一次方案已经确认了“typed history + projection”的方向，这次进一步补齐工程细节：ClaudeCode 的上下文管理不是一个 prompt 拼接器，而是一套围绕 API 协议、工具执行、恢复、压缩、缓存稳定性共同工作的上下文工程。

### 15.1 上下文不是 messages 数组，而是多层状态

ClaudeCode 同时维护几类状态：

1. **Transcript message chain**：持久化 JSONL 里的 user / assistant / attachment / system 消息。
2. **ToolUseContext**：当前轮工具执行上下文，包含 tools、MCP clients、readFileState、loadedNestedMemoryPaths、dynamicSkillDirTriggers、contentReplacementState、renderedSystemPrompt、messages 等。
3. **API projection view**：每次请求前从完整 messages 生成的 API-bound messages。
4. **Compact / collapse view**：compact boundary 后的可发送视图，不等于完整历史。
5. **Cache tracking state**：system hash、tool schema hash、cache_control hash、beta headers、model、effort、extra body、cache read baseline。

这说明 OneCEO 不能继续把“最近消息数组”当作上下文本身。最近消息只是可视化切片，不是模型协议事实。Altus managed 需要把上下文分成：

1. 真实事件账本；
2. 当前运行态；
3. API 投影视图；
4. 前端回放视图；
5. 缓存观测视图。

### 15.2 Transcript 的核心是可恢复拓扑，不是单纯按时间排序

ClaudeCode 的 transcript 写入有几个关键点：

1. `progress` 不是 transcript message，不参与 parentUuid 链，避免恢复时把真实会话链叉开。
2. tool_result 会记录 `sourceToolAssistantUUID`，写入时 parentUuid 可以指向产生该 tool_use 的 assistant message，而不是简单接在上一条消息后。
3. compact boundary 会截断恢复链，但保留 logical parent，避免 compact 后新消息又接回旧消息。
4. sidechain / subagent 有独立 transcript，避免子任务消息污染主线程链。
5. content replacement 决策会独立持久化，resume 后能复现同样的 tool result preview。

更关键的是读取侧也不是简单从最后一条向前捞：

1. `buildConversationChain` 会按 parentUuid 重建链；
2. `recoverOrphanedParallelToolResults` 会恢复并发工具调用时被单链遍历遗漏的 sibling assistant / tool_result；
3. `checkResumeConsistency` 会记录 resume 后 messageCount 与原始检查点是否一致；
4. 对外 transcript 会移除内部 REPL 包装，让模型恢复时看到的是原生工具调用历史。

对应到 Altus managed：仅靠 `conversation_messages.created_at` 排序不够。我们至少需要在 ledger entry 中保留：

1. `entryId`；
2. `parentEntryId`；
3. `sourceAssistantEntryId`；
4. `toolUseId`；
5. `runId` / `sessionId`；
6. `sidechain` 或 `executionScope`；
7. `projectionVisibility`。

否则一旦出现并发工具、暂停恢复、失败重试、历史 reload，就会出现“前端看起来有上下文，模型请求里上下文断裂”的情况。

### 15.3 `ask_user` 必须按工具协议闭环

这次问题最直接的工程解释是：

1. 模型通过 `ask_user` 产生了补充信息问题；
2. 平台把 UI 状态切成“需要补充信息”；
3. 用户回答“网页应用”；
4. 如果下一次 API 请求只把“网页应用”当普通 user message，而没有把它投影为上一轮 `ask_user.tool_use_id` 的 `tool_result`，模型协议上就不是“用户回答了我的工具问题”，而是“用户又发了一条短消息”。

ClaudeCode 的原则是 assistant 的 `tool_use` 后必须有 user 角色的 `tool_result`。中断、fallback、异常、未知工具、权限拒绝也会合成 synthetic tool_result，避免下一轮 API 看到断裂上下文。

因此 Altus managed 的澄清机制应该调整为：

1. `ask_user` tool call 写入 `tool_call` entry，保存 `toolUseId`、问题、options、clarificationType；
2. UI 展示“需要补充信息”只是该 entry 的一种渲染；
3. 用户下一句先进入 `clarification_answer` entry，并关联 `toolUseId`；
4. API 投影时生成：

```text
assistant: tool_use(id=ask_user_x, name=ask_user, input={ question, options })
user: tool_result(tool_use_id=ask_user_x, content={ answer: "网页应用" })
```

5. 如果用户不是回答，而是改需求、委托默认、只要方案、暂停任务，也仍然要给原 ask_user 一个结构化 tool_result，例如 `answer_kind=redirect|delegate|advisory|cancel`，再追加新的真实 user intent。

这样模型会自然理解“上一问已经被回答”，而不是重复发起同一澄清。

### 15.4 API 投影层承担协议修复和拒绝，不承担业务理解

ClaudeCode 的 `normalizeMessagesForAPI` 做的是 API 协议投影：

1. attachment 上浮，但不能跨过 assistant 或 tool_result；
2. display-only / virtual message 不进 API；
3. 连续 user message 会合并；
4. assistant 同一 message id 的流式片段会合并；
5. tool_result 会 hoist 到 user content 前面，满足 API 要求；
6. 不可用 tool_reference 会被剥离；
7. 超限媒体会被剥离或触发恢复；
8. 最后 `ensureToolResultPairing` 检查 missing / orphan / duplicate tool_use 和 tool_result。

这给 OneCEO 的启发是：后端 policy/reducer 不应该硬编码“用户说方案就一定如何”的语义规则，但必须有硬的 API 协议守卫。

硬守卫只负责：

1. role alternation 是否合法；
2. assistant tool_use 是否有对应 user tool_result；
3. tool_use_id 是否重复；
4. orphan tool_result 是否存在；
5. attachment 是否有可解析来源；
6. projection 是否从 ledger 可追溯；
7. 危险能力是否需要用户层确认。

它不负责判断“方案”是什么意思。这个语义判断应由 LLM transition 裁决，裁决结果通过工具或结构化输出写回 ledger。也就是说，硬边界不是死板业务规则，而是协议完整性和安全能力边界。

### 15.5 工具执行结果是上下文协议，不是日志

ClaudeCode 的工具执行链路有几个稳定原则：

1. 工具不存在、Zod 校验失败、工具自校验失败、权限拒绝、运行异常、用户中断，都会生成 user message + tool_result；
2. tool_result 带 `sourceToolAssistantUUID`；
3. MCP 工具会等 PostToolUse hooks 有机会更新输出后，再生成最终 tool_result；
4. progress message 是 UI 状态，不等于模型上下文；
5. contextModifier 只在明确安全的顺序点应用；
6. 并发安全工具可以并行，但上下文变更要在批次结束后按顺序合并；
7. 非并发工具串行执行；
8. StreamingToolExecutor 在 tool_use 流式到达时即可执行工具，但最终结果仍按 tool_use 顺序输出。

这比 OneCEO 现在的“run event + conversation message + SSE”更严格。Altus managed 的工具层应改成：

1. 每个 model tool_call 都生成 ledger `tool_call`；
2. 每个 runtime outcome 都生成 ledger `tool_result`；
3. 失败也必须是 `tool_result`，不能只写 `tool_call_failed` event；
4. 前端可以把它渲染成错误、进度、补充信息、部署状态，但 API projection 必须仍然看到完整工具闭环；
5. tool_result 的详细正文和给模型的摘要可以不同，但都要挂在同一 `toolUseId` 下。

### 15.6 中途插入用户输入不是“直接追加消息”这么简单

ClaudeCode 对 mid-turn 用户输入和后台任务通知的处理是：

1. 用户或任务插入的信息先进入 queue；
2. query 循环在工具回合后 drain queued commands；
3. drain 后变成 `queued_command` attachment；
4. 对 slash command、task notification、subagent notification 有不同路由；
5. 如果用户中断工具，StreamingToolExecutor 会为未完成 tool_use 生成 synthetic tool_result；
6. 对 `interruptBehavior=cancel` 的工具才取消，对 `block` 工具则等待。

OneCEO 的对应要求：

1. 用户在 Altus 运行中追加消息时，不应无条件开一个新 run；
2. 如果存在未闭合 `ask_user`，优先按 answer/redirect/delegate/cancel 分类；
3. 如果存在正在执行的 cancellable 工具，用户消息可以触发取消并生成 tool_result；
4. 如果工具不可取消，则用户消息进入 pending attachment / queued user intent；
5. 下一次模型调用必须看到“为什么中断、哪个工具被取消、用户新意图是什么”。

这能减少“用户已经说了，但 agent 像没听见”的人机感。

### 15.7 附件、memory、skills、MCP 都是 typed attachment，不是用户原文拼接

ClaudeCode 的 attachment 管道有三类来源：

1. 用户输入直接触发：@mentioned files、MCP resources、agent mention、turn-0 skill discovery；
2. 线程安全附件：queued command、date change、deferred tools delta、agent listing delta、MCP instructions delta、nested memory、dynamic skill、skill listing、plan mode、todo reminders；
3. 主线程附件：IDE selection、diagnostics、LSP、async hook responses、token usage、budget、plan reminders。

重要细节：

1. user input attachments 先算，因为它们会影响 nested memory triggers；
2. thread attachments 和 main-thread attachments 并行计算；
3. attachment 失败只丢该 attachment，不阻断整个请求；
4. attachment message 最终再由 `normalizeAttachmentForAPI` 变成 user meta content；
5. queued command 仍保留 source_uuid、origin、isMeta、imagePasteIds。

对应到 OneCEO：

1. 上传文件、图片、选中的 skill、connector guide、memory、sandbox 状态都应该是 typed context block；
2. 用户原文只保存用户说的话，不再追加“[Attached: xxx]”这类人工拼接；
3. API projection 负责把 attachment 放到合适位置；
4. history/replay 也从同一 entry 渲染，不另造一套上下文。

### 15.8 skills 的关键是去重、作用域和恢复

ClaudeCode 对 skills 的处理不是每轮塞完整列表：

1. `sentSkillNames` 按 agentId 维护，主线程和 subagent 不共享去重集合；
2. resume 时如果 transcript 已经有 skill_listing，会 `suppressNextSkillListing`，避免每次恢复重新注入完整列表；
3. skill search 开启时，turn-0 只保证 bundled + MCP 小集合，长尾 user/project/plugin skills 走 discovery；
4. compact 不重置 sentSkillNames，因为 compact 后重复注入完整 catalog 成本很高；
5. invoked skills 会在 post-compact attachment 中恢复，但有 token budget 和按最近使用排序。

OneCEO 不应该每轮把全部 skill catalog、active skill body、MCP skill 都拼进 prompt。更稳妥的做法：

1. `skill_catalog_delta`：只宣布新增/移除；
2. `active_skill_body`：只注入本轮实际需要或用户明确选择的 skill；
3. `invoked_skill_snapshot`：compact 后恢复已调用 skill 的最小必要内容；
4. `sessionSkillState`：跨 run / resume 保存 sent / invoked / suppressed 状态；
5. `sourceType + skillId + revisionId` 仍是恢复和同步 sandbox 的硬标识。

### 15.9 MCP 的关键是 delta，而不是每轮重建 guide

ClaudeCode 对 MCP 有两条缓存友好的路径：

1. deferred tools：大工具池通过 ToolSearch 和 `tool_reference` 按需发现，已发现工具从 message history 或 compact boundary 恢复；
2. MCP instructions：连接后的 server instructions 通过 `mcp_instructions_delta` attachment 宣布，按 server name diff，不每轮进 system prompt。

它还把 tool schema base 缓存在 session scope，只把 `defer_loading`、`cache_control` 作为 per-request overlay，避免中途 feature flag 或 MCP reconnect 改动整个工具 schema block。

OneCEO 的 MCP / connector guide 应拆成：

1. `mcp_tool_snapshot`：run entry 时的工具快照；
2. `mcp_tool_delta`：本轮新增/移除的工具；
3. `mcp_instruction_delta`：本轮新增/移除的 guide；
4. `mcp_discovered_tools`：通过工具搜索或 guide 加载已经发现的工具；
5. `mcp_guide_loaded_state`：某个能力是否已加载 guide；
6. `mcp_tool_result`：工具调用真实结果。

这样 MCP 变化不会污染 stable prompt，也不会让模型每轮重新读一大段 connector guide。

### 15.10 tool result budget 是缓存稳定机制，不只是省 token

ClaudeCode 的 tool result budget 有几个关键设计：

1. 按 API 级 user message 分组，而不是按内部 messages 数组分组，因为 normalize 会合并连续 user messages；
2. 每个 `tool_use_id` 的 replacement 决策一旦发生就冻结；
3. replaced 的结果保存精确 replacement 字符串，resume 后直接复用，不重新生成；
4. seen 但未 replaced 的结果以后也不能再 replaced，否则会改变已缓存前缀；
5. replacement state 可 clone 给 cache-sharing fork；
6. per-tool 大结果持久化和 per-message aggregate budget 是两层机制；
7. 空 tool_result 会注入短文本，避免模型把空结果误判成 turn boundary。

这说明 OneCEO 的“上下文预算”不能只是把历史裁短。必须保存预算决策：

1. `toolUseId -> visiblePayloadKind`；
2. `toolUseId -> replacementText`；
3. `toolUseId -> artifactRef`；
4. `seenToolResultIds`；
5. `budgetPolicyVersion`。

否则同一个会话恢复后，同一个工具结果一会儿完整、一会儿摘要，既影响模型理解，也会破坏 prompt cache。

### 15.11 compact 是重建能力上下文，不只是总结旧聊天

ClaudeCode compact 后会追加：

1. compact boundary；
2. summary user message；
3. kept messages；
4. 最近读取文件的 attachment；
5. async agent attachment；
6. plan file attachment；
7. plan mode attachment；
8. invoked skills attachment；
9. deferred tools delta；
10. agent listing delta；
11. MCP instructions delta；
12. session start hook messages。

它还会：

1. 清理 readFileState / loadedNestedMemoryPaths；
2. 不重置 sentSkillNames，避免重复注入 catalog；
3. 在 boundary metadata 保存 compact 前已发现工具；
4. 通知 cache break detector compact 发生；
5. 重写 session metadata 到 transcript tail，方便 resume picker。

OneCEO 如果未来做 Altus managed compact，不能只生成“之前我们聊了什么”的 summary。summary 只能覆盖自然语言历史，compact 后必须恢复执行能力上下文：

1. 已加载的 connector guide；
2. 已选择或已调用 skills；
3. 仍可引用的附件；
4. 最近重要工具结果引用；
5. pending clarification；
6. sandbox / deployment / todo 状态；
7. MCP discovered tools；
8. cache baseline。

### 15.12 prompt cache 是工程可观测对象

ClaudeCode 不是只“希望缓存命中”，而是记录并解释 cache break：

1. system hash；
2. tools hash；
3. cache_control hash；
4. per-tool schema hash；
5. model；
6. fast mode；
7. global cache strategy；
8. beta headers；
9. auto mode；
10. overage；
11. cached microcompact；
12. effort；
13. extra body；
14. cache read tokens；
15. cache creation tokens；
16. TTL 可能性。

它还通过 sticky-on latch 避免 beta header 中途开关导致缓存 key 抖动。

OneCEO 的 cache observer 应至少记录：

1. stable system hash；
2. tool schema hash；
3. volatile context hash；
4. attachment delta hash；
5. model / provider / effort；
6. cache read / creation tokens；
7. compact / replacement / MCP delta 事件；
8. cache break reason。

否则后续无法证明“上下文组织改造真的降低计费”。

## 16. 对 OneCEO 方案的修正

基于二次深入阅读，原方案需要进一步收紧以下设计点。

### 16.1 `补充信息` 不再作为普通用户轮次处理

新的硬要求：

1. 如果上一轮是 `ask_user` tool_use，用户回复必须先关联该 `toolUseId`；
2. API projection 必须生成对应 tool_result；
3. 只有当用户明显开启新话题时，才在 tool_result 中标记 `answer_kind=redirect`，并追加新 user intent；
4. 不允许丢掉原 ask_user 的 tool_use/tool_result 配对；
5. UI 的“需要补充信息”只是渲染，不是 API 上下文事实。

这点是修复当前“网页应用 -> 仍继续追问”的主路径。

### 16.2 Context Ledger 需要保存 API 协议字段

原方案只写了 `tool_call` / `tool_result`，现在需要补充字段：

1. `toolUseId`；
2. `toolName`；
3. `assistantMessageId`；
4. `sourceAssistantEntryId`；
5. `parentEntryId`；
6. `apiRole`；
7. `apiContentBlocks` 或可重建 payload；
8. `isMeta`；
9. `isVisibleInTranscriptOnly`；
10. `projectionGroupId`；
11. `contentReplacementRecord`；
12. `compactBoundaryId`；
13. `origin`。

没有这些字段，后续 projection 只能靠自然语言和时间排序猜测，还是会回到补丁式修复。

### 16.3 Projection Guard 是协议守卫，不是业务规则系统

Projection Guard 只做这些事：

1. 构造 API-bound messages；
2. 校验 role alternation；
3. 校验 tool_use/tool_result pairing；
4. 校验 duplicate / orphan；
5. 校验 attachment ref；
6. 校验 token budget；
7. 记录 projection snapshot。

它不判断“用户是不是要方案”。这类自然语言语义交给 LLM transition 裁决。Guard 的失败也不应该直接变成用户层“需要补充信息”，而应该进入内部错误或结构化恢复路径。

### 16.4 LLM transition 裁决后必须通过工具写状态

为了保留泛化能力，可以让 LLM 判断：

1. 用户是在回答补充信息；
2. 用户是在委托默认；
3. 用户是在改成咨询；
4. 用户是在切换新任务；
5. 用户是在要求暂停或取消；
6. 用户是否同意某个用户层确认。

但 LLM 不能直接改 DB。它必须调用受控工具，例如：

1. `resolve_clarification_answer`；
2. `mark_user_delegated_default`；
3. `switch_to_advisory_mode`；
4. `start_new_intent`；
5. `request_user_confirmation`；
6. `record_capability_confirmation`。

后端 reducer 只校验工具参数是否符合状态机和安全能力边界，不写死自然语言含义。

### 16.5 缓存稳定性需要成为验收条件

每次 API projection 都应产出 debug snapshot：

1. `stableSystemHash`；
2. `toolSchemaHash`；
3. `volatileContextHash`；
4. `apiMessageHash`；
5. `toolPairingSummary`；
6. `attachmentSummary`；
7. `cacheReadTokens`；
8. `cacheCreationTokens`；
9. `cacheBreakReason`。

验收时不能只看“这次回复像人了”，还要看相同 session 连续多轮 stable hash 是否稳定。

### 16.6 第一步实现应先做 projection debug，而不是替换 runner

更稳妥的落地顺序修正为：

1. 先从现有 DB / run events 构建 read-only ledger；
2. 对真实 managed session 生成 projection debug；
3. 对比当前实际发给 LLM 的 messages；
4. 用 golden case 固化 `ask_user -> user answer -> tool_result`；
5. 加 Projection Guard；
6. 再把真实 API 请求切到 projection；
7. 最后迁移 memory / skills / MCP / attachments / budget。

这样可以先证明“上下文断在哪里”，再切主链，避免继续做局部补丁。

## 17. ClaudeCode 核心思想吸收度审查

本节不是继续列文件细节，而是检查当前方案是否真正吸收 ClaudeCode 的核心思想。结论：主干方向已经吸收，但需要把几个“实现时不能妥协”的原则明确成设计约束，否则后续代码仍可能退化成新的 prompt 拼接器。

### 17.1 已吸收的核心思想

| ClaudeCode 核心思想 | 方案是否覆盖 | OneCEO 对应设计 |
| --- | --- | --- |
| 上下文不是 prompt，而是可恢复的 typed event graph | 已覆盖 | `Context Ledger + Projection` |
| API messages 是读时投影，不是数据库原始形态 | 已覆盖 | `AltusManagedContextProjection` |
| tool_use / tool_result 是多轮状态主轴 | 已覆盖并强化 | `ask_user` 回复投影为 `tool_result` |
| 附件、memory、skills、MCP guide 是 typed context block | 已覆盖 | attachment / skill / MCP delta blocks |
| stable prompt 与 volatile context 分离 | 已覆盖 | stable system + volatile turn context |
| compact 不删除历史，只重建 API view | 已覆盖 | compact boundary + summary + preserved capability blocks |
| tool result budget 是缓存稳定机制 | 已覆盖 | replacement state + toolUseId 级预算决策 |
| MCP / skills 用 delta 降低前缀抖动 | 已覆盖 | `mcp_instruction_delta` / `skill_catalog_delta` |
| cache break 需要可观测和可解释 | 已覆盖 | cache observer + stable/tool/volatile hash |
| LLM 做语义裁决，后端做协议和安全守卫 | 已覆盖 | LLM transition tools + Projection Guard |

### 17.2 需要进一步显式化的核心思想

下面这些在前文已经部分出现，但还不够硬。实现时必须作为设计约束。

#### 17.2.1 每个 turn 需要冻结上下文快照

ClaudeCode 在 REPL 里每轮开始时重新读取最新 tools / MCP clients / app state，再构造 `ToolUseContext`，并把当轮 `renderedSystemPrompt` 挂到 context 上。这样做的核心目的不是“取最新值”，而是：

1. 本轮模型请求、工具执行、权限判断使用同一份 turn context；
2. MCP 中途连接、权限状态变化、skill 加载变化不会随机污染本轮请求；
3. subagent / fork 可以复用父线程已经渲染的 system prompt，避免重新渲染导致 cache prefix 变化；
4. 工具执行时需要刷新 tool pool，也必须通过明确的 `refreshTools` 边界。

OneCEO 需要补充一个 `AltusManagedTurnContextSnapshot`：

1. `turnId`；
2. `stableSystemPromptVersion`；
3. `renderedStableSystemHash`；
4. `toolSnapshotId`；
5. `mcpSnapshotId`；
6. `skillSnapshotId`；
7. `permissionMode`；
8. `model` / `effort` / `provider`；
9. `contextBudgetPolicyVersion`；
10. `createdFromLedgerCursor`。

同一轮内，Projection、tool runtime、cache observer 都引用这个 snapshot，而不是各自重新读取动态状态。

#### 17.2.2 先持久化已接受的用户输入，后进入模型循环

ClaudeCode 在 SDK / QueryEngine 路径里会在进入 query loop 前先记录用户消息。原因很具体：如果用户发出消息后进程立刻被杀，仍然可以 resume 到“用户输入已被接受”的状态。

OneCEO 当前 managed 链路也应遵守：

1. 用户输入进入 session 后，先写 ledger；
2. 写入成功后再创建 run / 调模型；
3. 如果模型还没返回就失败，resume 仍能看到用户输入；
4. 如果已经产生 `ask_user`，用户回复必须先写成关联 answer entry，再继续下一轮；
5. SSE / 前端展示可以异步，但 ledger 是恢复源。

这能避免“前端发出去了、模型没看到、恢复后丢上下文”的隐性问题。

#### 17.2.3 UI 消息、transcript 消息、API 消息必须三分

ClaudeCode 里 progress、UI-only system message、virtual message、local command output、SDK replay message 都有不同可见性。它不是所有东西都直接进 API。

OneCEO 需要每个 ledger entry 明确三种可见性：

1. `uiVisibility`：前端是否展示，展示成 bubble / notice / progress / drawer；
2. `transcriptVisibility`：history / replay 是否持久展示；
3. `apiVisibility`：是否进入模型上下文，以及以什么 role / block 进入。

`需要补充信息` 应该是：

1. UI：notice / question；
2. transcript：clarification request；
3. API：assistant tool_use。

用户回答应是：

1. UI：用户气泡；
2. transcript：用户原话 + clarification answer 关联；
3. API：user tool_result，必要时再追加真实 user intent。

#### 17.2.4 Projection 必须是确定性函数

ClaudeCode 很多细节都在维护 byte-stable projection：

1. tool schema base session cache；
2. per-request overlay 不污染 base；
3. backfillObservableInput 只改 observer copy，不改 API-bound 原始输入；
4. content replacement 决策持久化；
5. beta header sticky latch；
6. compact 后 reset cache baseline；
7. message 合并、attachment 上浮、tool_result hoist 都有固定规则。

OneCEO 的 Projection 必须满足：

```text
same ledger cursor + same turn snapshot + same projection policy
= same API-bound messages
```

不能在 projection 里临时读取当前时间、当前 MCP 状态、随机排序的 skill 列表、未排序的 object key、实时 DB 状态。所有动态内容必须先成为 ledger entry 或 turn snapshot 字段。

#### 17.2.5 恢复链路要能校验 round-trip consistency

ClaudeCode 有 `checkResumeConsistency` 这类观测，关注“恢复后的 chain 和运行时看到的 chain 是否一致”。OneCEO 现在也需要类似检查：

1. 每次 projection 写入 `projectionSnapshotId`；
2. 记录 entry count、lastEntryId、tool pairing summary、api hash；
3. history reload / run recovery 后重新生成 projection；
4. 对比 hash 和 pairing summary；
5. 不一致时记录 `managed_context_roundtrip_delta`。

这个比单纯看 UI 是否重复更关键，因为本次问题本质就是 UI 和 API 上下文不一致。

### 17.3 最终抽象

ClaudeCode 的核心不是“prompt 写得好”，也不是“工具多”。它真正稳定的地方是：

```text
事件事实稳定保存
  -> 每轮冻结上下文快照
  -> 读时确定性投影
  -> API 协议强校验
  -> 工具结果闭环
  -> 动态能力 delta 化
  -> compact 后恢复能力上下文
  -> cache break 可解释
```

OneCEO 的 Altus managed 改造必须按这条链落地。只修澄清文案、只改 LLM prompt、只做关键词分流，都会继续失败。

### 17.4 对当前方案的审查结论

当前方案已经吸收了 ClaudeCode 的主干思想，但实现前必须额外锁定四个验收条件：

1. **工具闭环验收**：真实 session 中 `ask_user -> 用户回答` 能在 projection snapshot 里看到对应 `tool_result`；
2. **确定性验收**：同一 ledger cursor + turn snapshot 连续投影两次，API hash 完全一致；
3. **恢复验收**：history reload 后重新投影，tool pairing summary 与原 projection 一致；
4. **缓存验收**：连续多轮 stable system hash / tool schema hash 不因 memory、skills、MCP guide、当前时间变化而改变。

只有这四项都满足，才能说真正吸收了 ClaudeCode 的上下文管理核心，而不是只借用了术语。

## 18. 再次复核：ClaudeCode 的精髓是 Context Compiler

再次补读恢复、fork、API round 分组、sidechain transcript、orphaned tool result recovery 后，结论需要再明确一层：ClaudeCode 的精髓不是“上下文拼得更完整”，而是把上下文当作一套可编译、可恢复、可验证、可缓存的工程产物。

对 OneCEO 来说，`AltusManagedContextProjection` 不能只是一个 prompt builder。它必须升级为 `AltusManagedContextCompiler`。

```text
Ledger entries     = source code
Turn snapshot      = compiler flags
Projection policy  = compiler passes
API messages       = compiled artifact
Projection snapshot = build manifest
Recovery check     = reproducible build check
Cache observer     = incremental build profiler
```

如果用这个标准检查，当前方案已经覆盖主要零件，但还需要把“编译器式边界”写成实现约束。

### 18.1 事件图，而不是聊天数组

ClaudeCode 的 transcript 不是简单的 `messages[]`。它通过 `parentUuid`、`sourceToolAssistantUUID`、sidechain、compact boundary、attachment、progress、system hook 等字段形成可恢复的事件图。恢复时不是原样读取，而是 chain-walk、过滤、修复、补齐、恢复状态。

OneCEO 不能继续把 managed 上下文理解为：

```text
conversation_messages + run_events -> append prompt text
```

正确抽象应是：

```text
session ledger -> canonical graph -> API-round groups -> protocol-safe projection
```

这会直接解决当前问题：用户回答“网页应用”时，它不是一句孤立 user text，而是 `ask_user` 节点的 answer edge；投影时必须回填到对应 `tool_use_id` 的 `tool_result`。

### 18.2 API round 是语义单位，不是自然人对话轮次

ClaudeCode 的 compact grouping 使用 assistant message id 切 API round，而不是按用户消息切轮。原因是 agentic session 里一个用户请求可能包含很多模型 round、工具 round、恢复 round；如果按自然语言“你一句我一句”管理，会丢掉工具闭环。

OneCEO 的 managed 链路也必须把 round 拆清楚：

1. `user_turn`：用户发起或补充的信息；
2. `model_round`：一次 LLM API 请求及其 assistant 输出；
3. `tool_round`：assistant tool_use 到 user tool_result；
4. `resume_round`：失败、中断、重放、继续执行；
5. `ui_turn`：前端展示气泡和 notice 的组织方式。

UI 可以按人类习惯展示，但 compiler 只能按 API round 和 tool pairing 管上下文。

### 18.3 上下文是事务，不是即时读取

ClaudeCode 在进入 query loop 前先持久化用户输入；每轮创建 fresh `ToolUseContext`；fork/subagent 复制 cache-safe 参数；恢复时重建 read file state、skills、content replacement、session metadata。

这说明每轮执行应该是事务：

```text
accept input
  -> persist ledger
  -> freeze turn snapshot
  -> compile API messages
  -> call model
  -> append assistant/tool events
  -> run tools
  -> append tool results
  -> finalize projection snapshot
```

事务边界内不能随意重新读取 skills、MCP、权限、系统 prompt、当前时间、工具 schema。需要变化时，先写入 ledger 或生成新的 turn snapshot，再进入下一轮。

### 18.4 恢复链路是一等公民，不是兜底路径

ClaudeCode 的恢复逻辑会处理这些情况：

1. 未闭合的 tool_use；
2. orphaned tool_result；
3. streaming 中断；
4. assistant 空白块；
5. attachment 参与但 assistant 未响应；
6. compact 后 skills 状态恢复；
7. sidechain / fork transcript；
8. resume consistency delta。

OneCEO 当前问题表面是“追问不自然”，本质是恢复和投影没有共同的 canonical source。只要 reload / retry / managed run recovery 后得到的上下文和运行时不同，Altus 就会表现得像失忆或机械追问。

因此验收不能只测实时对话，还必须测：

1. 用户回答澄清问题后立刻继续；
2. 刷新 history 后继续；
3. managed run 失败后恢复继续；
4. 工具事件从 run event replay 回 conversation 后继续；
5. compact / budget 替换后继续。

这些场景必须得到同一个 projection snapshot 语义。

### 18.5 fork / subagent 的关键不是并行，而是隔离与 cache-safe 共享

ClaudeCode 的 forked agent 不是简单复制消息再跑一个模型。它显式区分：

1. 需要和父线程一致的 cache-safe params；
2. 需要隔离的 mutable state；
3. 可选择共享的 app state / abort controller / response metrics；
4. sidechain transcript；
5. content replacement state clone；
6. read file cache clone；
7. no-op mutation callbacks。

OneCEO 后续如果有规划 agent、澄清裁决 agent、执行 agent、总结 agent，也不能让它们各自临时拼上下文。它们必须从同一份 `ProjectionSnapshot` fork：

```text
parent projection snapshot
  -> fork policy
  -> isolated mutable state
  -> sidechain ledger entries
  -> explicit merge or no-merge result
```

这样才能避免多个 agent 同时改变上下文，导致缓存失效或状态漂移。

### 18.6 UI / transcript / API 三分后，还要有 Manifest

前文已经提出 UI、transcript、API 三分，但 ClaudeCode 的精髓还包括可检查的元数据：哪些内容进入 API、哪些被过滤、哪些被 budget 替换、哪些恢复时被修复，都有迹可循。

OneCEO 每次 compiler 输出必须附带 manifest：

1. `projectionSnapshotId`；
2. `ledgerCursor`；
3. `turnSnapshotId`；
4. `apiRoundCount`；
5. `toolUseCount`；
6. `toolResultCount`；
7. `missingToolResultCount`；
8. `orphanToolResultCount`；
9. `repairedToolPairingCount`；
10. `stableSystemHash`；
11. `toolSchemaHash`；
12. `volatileContextHash`；
13. `apiMessageHash`；
14. `cacheBreakReason`；
15. `includedAttachmentIds`；
16. `includedSkillIds`；
17. `includedMcpServerIds`；
18. `budgetReplacementSummary`。

没有 manifest，就无法判断“这轮为什么没命中缓存”或“用户回答为什么没被模型看见”。

### 18.7 对方案的最终修正

因此，本方案里的核心组件命名和职责应调整为：

| 原设计 | 修正后 | 原因 |
| --- | --- | --- |
| `AltusManagedContextProjection` | `AltusManagedContextCompiler` | Projection 只是 compiler 的产物生成阶段 |
| `ProjectionSnapshot` | `ContextBuildManifest` | 需要记录输入、策略、hash、修复、预算、cache 信息 |
| `Context Ledger` | `Managed Context Ledger` | 作为唯一事实源，禁止 prompt service 临时拼状态 |
| `Projection Guard` | `Protocol Validator` | 它不是业务裁决器，只校验 API 协议和安全边界 |
| `Clarification Answer Mapping` | `Tool Result Reconciliation Pass` | 澄清只是 tool_result reconciliation 的一个特例 |

实现时应该把 compiler passes 写清楚：

1. `LoadLedgerPass`：读取 session ledger 到 cursor；
2. `NormalizeGraphPass`：把 run events、messages、attachments、skills、MCP refs 规范成 typed graph；
3. `ApiRoundGroupingPass`：按 assistant/model round 分组；
4. `ToolPairingPass`：补齐、校验、拒绝不合法 tool_use/tool_result；
5. `ClarificationReconciliationPass`：把用户回答映射回 `ask_user` tool_result；
6. `CapabilityDeltaPass`：注入 skills/MCP/tools 的 delta，而不是全量重写；
7. `AttachmentOrderingPass`：稳定附件位置和顺序；
8. `BudgetReplacementPass`：按持久化决策替换大工具结果；
9. `CacheBoundaryPass`：分离 stable / volatile / no-cache；
10. `ManifestPass`：输出可复现的 build manifest。

### 18.8 判断是否真正获取精髓的标准

我现在用以下标准判断是否真正吸收 ClaudeCode：

1. 不再问“这一轮 prompt 怎么写”，而是问“这一轮从哪个 ledger cursor 编译出来”；
2. 不再问“前端显示了什么”，而是问“UI / transcript / API 三个视图是否来自同一 source graph”；
3. 不再问“澄清是否被识别”，而是问“ask_user tool_use 是否被 answer edge 闭合”；
4. 不再问“恢复是否能展示历史”，而是问“恢复后重新编译的 API hash 是否一致”；
5. 不再问“缓存为什么贵”，而是问“stable prefix 哪个 pass 改变了 hash”；
6. 不再问“subagent 怎么拿上下文”，而是问“它 fork 的 snapshot 是隔离还是显式共享”；
7. 不再问“LLM 是否聪明”，而是问“协议层是否保证它看到的是连续世界”。

这才是 ClaudeCode 的精髓：把 LLM 看见的世界做成稳定、可复现、可修复的编译产物，而不是每轮临时拼一个看起来合理的上下文。

### 18.9 当前文档是否达标

补完本节后，我认为当前文档已经从“借鉴 ClaudeCode 的若干机制”提升到“按 ClaudeCode 的核心工程范式重构 OneCEO managed 上下文”。

仍然要注意两点：

1. 文档现在达到了设计审查要求，但还没有通过真实 session 的 projection debug 证明；
2. 进入代码实现时，第一步必须是 read-only compiler / manifest / debug endpoint，而不是直接替换主 runner。

只要实现阶段守住这两个点，就不容易再滑回补丁式修复。

## 19. 渐进式模块拆解

本节把前文方案重新拆成可理解、可评审、可拆任务的模块。拆解原则是：

1. 先讲用户请求如何一步步流过系统；
2. 再把同类能力放到同一组；
3. 每个模块只说明它负责什么、不负责什么、和上下游如何交接；
4. 实施顺序按“先观测、再接入、再增强、最后优化”推进。

### 19.1 一条请求的渐进路径

先用最小闭环理解整个系统：

```text
用户输入
  -> 写入 Managed Context Ledger
  -> 冻结 Turn Snapshot
  -> Context Compiler 读取 ledger + snapshot
  -> 编译出 API messages + ContextBuildManifest
  -> Protocol Validator 校验工具闭环和 API 协议
  -> 调用 LLM
  -> 写入 assistant/tool events
  -> 执行工具或等待用户补充
  -> 写入 tool_result 或 clarification answer
  -> 下一轮从 ledger cursor 继续
```

这条链路里，用户看到的是自然对话；系统内部看到的是 typed ledger、turn snapshot、compiler passes、manifest 和 protocol validation。

因此模块不应该按“前端消息 / 后端 prompt / 运行事件”拆，而应该按上下文生命周期拆。

### 19.2 模块分组总览

| 分组 | 解决的问题 | 包含模块 |
| --- | --- | --- |
| 事实源层 | 什么是真实发生过的事情 | Ledger、Typed Entry、Relation Index |
| 轮次层 | 本轮执行基于哪一份冻结上下文 | Turn Snapshot、API Round、Input Acceptance |
| 编译层 | 如何从事实编译出模型可见上下文 | Context Compiler、Compiler Passes、Protocol Validator、Manifest |
| 能力层 | tools、skills、MCP、memory 如何进入上下文 | Tool Schema、Skill Context、MCP Delta、Memory Block |
| 交互层 | 澄清、工具调用、中途输入如何闭环 | Ask User、Tool Result Reconciliation、State Transition Tools |
| 恢复层 | reload、retry、resume 后如何保持同一个世界 | Resume Loader、Round-trip Check、History Replay |
| 成本与观测层 | 如何稳定缓存和解释 token 变化 | Cache Observer、Budget Replacement、Projection Debug |

后续开发任务应该按这些组拆，不要再按单个 bug 点散修。

### 19.3 事实源层：保存发生过的事实

这一组模块回答一个问题：系统到底相信什么？

#### 19.3.1 Managed Context Ledger

职责：

1. 作为 managed session 的唯一事实源；
2. 追加保存用户输入、assistant 输出、tool_use、tool_result、附件、skill 选择、MCP 引用、状态迁移；
3. 给每个 entry 分配稳定 ID、时间、来源、session、run、turn、tool_use 关联；
4. 支持按 cursor 读取，作为 compiler 输入。

不负责：

1. 不拼 prompt；
2. 不判断业务意图；
3. 不决定是否追问；
4. 不直接面向 UI 渲染。

关键点：用户回答“网页应用”必须保存成一条带关联关系的事实，而不是只保存为普通用户消息。

#### 19.3.2 Typed Entry Schema

职责：

1. 把不同来源的上下文统一成类型化 entry；
2. 明确 `user_message`、`assistant_message`、`tool_use`、`tool_result`、`clarification_request`、`clarification_answer`、`attachment`、`skill_selection`、`mcp_reference` 等类型；
3. 明确每类 entry 的 UI / transcript / API 可见性；
4. 明确哪些字段影响 cache，哪些字段只用于展示或审计。

不负责：

1. 不做复杂投影；
2. 不做工具执行；
3. 不做模型选择。

关键点：类型必须表达协议关系，而不是只表达展示形态。

#### 19.3.3 Relation Index

职责：

1. 维护 `clarification_answer -> clarification_request`；
2. 维护 `tool_result -> tool_use`；
3. 维护 `attachment -> user_turn`；
4. 维护 `skill_selection -> session/turn`；
5. 维护 `mcp_reference -> connector/server`。

不负责：

1. 不修改原始 entry；
2. 不在关系缺失时猜测业务语义；
3. 不做最终 API 修复。

关键点：Relation Index 是 compiler 能否把“补充信息”还原为 tool_result 的基础。

### 19.4 轮次层：冻结本轮执行边界

这一组模块回答一个问题：本轮模型调用到底基于哪一份上下文？

#### 19.4.1 Input Acceptance

职责：

1. 接收用户输入；
2. 先写 ledger；
3. 写入成功后再启动 run 或继续 run；
4. 如果进程在模型调用前失败，恢复后仍能看到用户输入。

不负责：

1. 不调模型；
2. 不执行业务工具；
3. 不对输入做最终语义裁决。

关键点：接受输入和调用模型必须解耦，避免“用户说了，但恢复后模型没看见”。

#### 19.4.2 Turn Snapshot

职责：

1. 冻结本轮使用的模型、工具 schema、MCP 状态、skill 状态、权限模式、预算策略；
2. 记录 `ledgerCursor`；
3. 生成 `turnSnapshotId`；
4. 让 compiler、tool runtime、cache observer 使用同一份 snapshot。

不负责：

1. 不保存全部聊天内容；
2. 不替代 ledger；
3. 不在执行中途自动刷新动态状态。

关键点：同一轮里不允许不同组件各自读取“最新状态”，否则上下文会漂移。

#### 19.4.3 API Round Model

职责：

1. 区分用户自然轮次、模型 API round、工具 round、恢复 round、UI 展示轮次；
2. 按模型协议组织 assistant tool_use 和 user tool_result；
3. 为 compact、resume、debug 提供稳定边界。

不负责：

1. 不决定 UI 气泡怎么合并；
2. 不决定业务流程下一步；
3. 不改变 ledger 原始事实。

关键点：编译层按 API round 工作，UI 层按人类对话体验展示，两者不能混在一起。

### 19.5 编译层：把事实编译成模型可见上下文

这一组模块是方案核心，回答一个问题：LLM 实际看到的世界是如何生成的？

#### 19.5.1 AltusManagedContextCompiler

职责：

1. 读取 ledger cursor 和 turn snapshot；
2. 执行固定 compiler passes；
3. 输出 API messages；
4. 输出 `ContextBuildManifest`；
5. 保证相同输入得到相同输出。

不负责：

1. 不直接写 DB；
2. 不执行业务工具；
3. 不让 LLM 做安全边界；
4. 不临时读取未冻结的动态状态。

关键点：它是上下文管理的主入口，不是 prompt service 的一个 helper。

#### 19.5.2 Compiler Passes

职责按顺序拆分：

1. `LoadLedgerPass`：读取事实；
2. `NormalizeGraphPass`：规范成 canonical graph；
3. `ApiRoundGroupingPass`：按 API round 分组；
4. `ToolPairingPass`：校验 tool_use/tool_result；
5. `ClarificationReconciliationPass`：把用户补充映射回 ask_user tool_result；
6. `CapabilityDeltaPass`：注入 skills/MCP/tools delta；
7. `AttachmentOrderingPass`：稳定附件顺序；
8. `BudgetReplacementPass`：替换超预算工具结果；
9. `CacheBoundaryPass`：划分 stable / volatile；
10. `ManifestPass`：生成可复现清单。

不负责：

1. 不把失败吞掉；
2. 不绕过协议校验；
3. 不在 pass 里做随机或时间敏感逻辑。

关键点：每个 pass 都应该是确定性的，失败时能指出是哪一层坏了。

#### 19.5.3 Protocol Validator

职责：

1. 校验 assistant tool_use 后必须有对应 user tool_result；
2. 校验 orphan tool_result；
3. 校验重复 tool_use_id；
4. 校验 API role / block 顺序；
5. 校验高风险能力是否已经用户确认。

不负责：

1. 不理解“用户管理系统应该怎么做”；
2. 不用关键词拦截普通需求；
3. 不替 LLM 决定产品方案。

关键点：它是协议和安全边界，不是死规则业务 reducer。

#### 19.5.4 ContextBuildManifest

职责：

1. 记录本次编译输入；
2. 记录所有 hash；
3. 记录 tool pairing summary；
4. 记录附件、skills、MCP、memory 的纳入情况；
5. 记录 budget replacement 和 cache break reason；
6. 支持 debug、恢复一致性检查和成本分析。

不负责：

1. 不作为用户可见消息；
2. 不替代日志；
3. 不保存敏感大内容的完整副本。

关键点：没有 manifest，就无法解释上下文是否正确，也无法解释缓存是否稳定。

### 19.6 能力层：管理动态能力上下文

这一组模块回答一个问题：工具、skills、MCP、memory 这些动态能力如何进入上下文，且不破坏缓存？

#### 19.6.1 Tool Schema Snapshot

职责：

1. 冻结本轮可用工具；
2. 生成稳定 tool schema hash；
3. 支持新增工具以 delta 进入；
4. 支持工具权限和风险标签。

不负责：

1. 不执行工具；
2. 不在模型调用中途改 schema；
3. 不把工具结果写成自然语言摘要。

关键点：工具 schema 是 cache 前缀的一部分，必须稳定。

#### 19.6.2 Skill Context

职责：

1. 保存用户选择或系统发现的 skills；
2. 记录 skill id、revision、sourceType；
3. 控制每轮是否注入 skill 内容或只注入 delta；
4. 支持 resume / compact 后恢复已启用 skills。

不负责：

1. 不把所有 skill 每轮全量塞入 prompt；
2. 不在缺少 revision 时猜测最新版本；
3. 不绕过 sandbox 同步协议。

关键点：skills 是 typed capability，不是追加在用户消息末尾的长文本。

#### 19.6.3 MCP / Connector Context

职责：

1. 保存 MCP server / connector 引用；
2. 注入 server instructions delta；
3. 注入 tool metadata，如 read-only、destructive、open-world 风险；
4. 支持连接器状态变化进入下一轮 snapshot。

不负责：

1. 不每轮重建所有 MCP guide；
2. 不把连接失败伪装成用户需求不清；
3. 不让 LLM 绕过平台授权。

关键点：MCP guide 的变化必须可解释，否则 cache 会持续失效。

#### 19.6.4 Memory Context

职责：

1. 把长期记忆、项目记忆、session memory 作为 typed block 纳入；
2. 区分 stable memory 和 volatile reminder；
3. 记录哪些 memory 被使用；
4. 支持 compact 后恢复必要 memory。

不负责：

1. 不无限堆叠历史摘要；
2. 不把低置信记忆当事实；
3. 不覆盖 ledger 里的真实对话事实。

关键点：memory 只能补充上下文，不能替代当前 session 的事实源。

### 19.7 交互层：让对话像人，但协议仍然闭合

这一组模块回答一个问题：用户感知到的自然交互，如何映射为严谨的上下文协议？

#### 19.7.1 Ask User Tool

职责：

1. 由 LLM 在需要用户确认时调用；
2. 输出结构化问题、原因、可选项、风险说明；
3. 前端显示成自然的等待用户补充状态；
4. 用户回答后进入 `ClarificationReconciliationPass`。

不负责：

1. 不对普通方案讨论反复拦截；
2. 不用平台死规则替用户做意图判断；
3. 不把所有不确定性都变成“需要补充信息”。

关键点：只对特定能力、风险边界、必要缺口追问，不能打断正常头脑风暴。

#### 19.7.2 Tool Result Reconciliation

职责：

1. 把用户补充信息映射到对应 `ask_user` tool_use；
2. 生成 API 可见的 user tool_result；
3. 保留用户原话用于 UI 和 transcript；
4. 处理重复回答、过期回答、跨 run 回答。

不负责：

1. 不发明用户没说过的信息；
2. 不把普通用户新需求误并到旧 tool_result；
3. 不绕过 Protocol Validator。

关键点：本次“网页应用后又追问”的核心修复点就在这里。

#### 19.7.3 State Transition Tools

职责：

1. 让 LLM 通过工具表达状态变化意图；
2. 后端校验权限和协议；
3. 合法时写入 ledger；
4. 非法时返回工具错误结果，让模型继续解释或换路径。

不负责：

1. 不硬编码业务意图；
2. 不自动阻断普通对话；
3. 不让 LLM 直接写内部状态。

关键点：LLM 裁决语义，后端守住能力边界和状态完整性。

### 19.8 恢复层：确保刷新、失败、继续后仍是同一个上下文

这一组模块回答一个问题：系统中断或重放后，Altus 是否还生活在同一个世界里？

#### 19.8.1 Resume Loader

职责：

1. 从 ledger 恢复 canonical graph；
2. 过滤无效或未闭合片段；
3. 恢复 turn snapshot、skills、MCP、budget replacement、tool state；
4. 重新运行 compiler。

不负责：

1. 不按 UI 历史直接拼 prompt；
2. 不忽略缺失 tool_result；
3. 不吞掉恢复不一致。

关键点：恢复不是降级路径，而是上下文系统的主验收路径。

#### 19.8.2 Round-trip Consistency Check

职责：

1. 对比运行时 manifest 和恢复后 manifest；
2. 对比 API hash；
3. 对比 tool pairing summary；
4. 对比 included capabilities；
5. 上报 `managed_context_roundtrip_delta`。

不负责：

1. 不修复业务 bug；
2. 不替代单元测试；
3. 不暴露敏感上下文内容。

关键点：只要这里不一致，用户就会感到 Altus 失忆、重复追问或机械。

#### 19.8.3 History Replay View

职责：

1. 从 ledger 派生 UI / transcript 视图；
2. 展示自然对话、工具进度、补充信息提示；
3. 保持和 API projection 使用同一事实源；
4. 避免 realtime 和 history reload 展示不一致。

不负责：

1. 不作为模型上下文源；
2. 不把 UI 文案反写成事实；
3. 不决定工具协议。

关键点：前端展示可以人性化，但不能成为第二套上下文事实源。

### 19.9 成本与观测层：让缓存稳定、问题可解释

这一组模块回答一个问题：为什么这轮贵了，为什么这轮上下文断了？

#### 19.9.1 Cache Observer

职责：

1. 记录 stable system hash；
2. 记录 tool schema hash；
3. 记录 volatile context hash；
4. 记录 cache read/create token；
5. 识别 cache break pass。

不负责：

1. 不为了缓存牺牲正确上下文；
2. 不隐藏必要的动态变化；
3. 不把成本问题简化成少传历史。

关键点：缓存稳定来自 stable/volatile 分层和确定性编译，不来自粗暴截断。

#### 19.9.2 Budget Replacement

职责：

1. 对大工具结果做可恢复替换；
2. 按 tool_use_id 持久化 replacement 决策；
3. resume / fork 时复用同一替换；
4. manifest 记录替换摘要。

不负责：

1. 不改变工具语义；
2. 不丢失必要结果；
3. 不在每轮重新随机决定替换。

关键点：budget 是上下文稳定机制，也是缓存稳定机制。

#### 19.9.3 Projection Debug Endpoint

职责：

1. 给真实 session 生成 read-only context build；
2. 展示 ledger cursor、turn snapshot、API messages 摘要、manifest；
3. 对比现有实际 LLM 请求；
4. 帮助先定位再切主链。

不负责：

1. 不直接改变生产 runner；
2. 不暴露敏感明文给普通用户；
3. 不作为长期用户功能入口。

关键点：第一阶段必须先有这个模块，否则会继续凭感觉修 prompt。

### 19.10 渐进实施顺序

为了避免一次性重构过大，按以下阶段推进。

#### 第一阶段：只读观测

目标：证明当前上下文断在哪里。

包含模块：

1. Managed Context Ledger 的 read-only adapter；
2. Turn Snapshot 只读构造；
3. AltusManagedContextCompiler 的只读版本；
4. ContextBuildManifest；
5. Projection Debug Endpoint；
6. 基础 Protocol Validator。

验收：

1. 能对真实 session 生成 API messages 摘要；
2. 能看到 `ask_user -> 用户回答` 是否闭合；
3. 能对比当前实际 prompt 和 compiler 输出；
4. 不改变线上行为。

#### 第二阶段：接入模型请求

目标：让 Altus 真正使用 compiler 输出。

包含模块：

1. Input Acceptance；
2. Turn Snapshot 持久化；
3. API Round Model；
4. ClarificationReconciliationPass；
5. ToolPairingPass；
6. Protocol Validator 强制校验。

验收：

1. 用户回答“网页应用”后不再重复追问同一问题；
2. 普通方案讨论不会被不必要打断；
3. tool_use/tool_result 在 API projection 中闭合；
4. history reload 后继续对话语义一致。

#### 第三阶段：能力上下文化

目标：把 tools、skills、MCP、memory 都纳入同一上下文系统。

包含模块：

1. Tool Schema Snapshot；
2. Skill Context；
3. MCP / Connector Context；
4. Memory Context；
5. CapabilityDeltaPass；
6. AttachmentOrderingPass。

验收：

1. slash-selected skills 能进入 managed context；
2. MCP guide 不再每轮全量抖动；
3. 附件和图片在 reload 后仍能被模型识别；
4. stable hash 不被无关动态能力打破。

#### 第四阶段：恢复与成本稳定

目标：让系统在失败、刷新、compact、预算替换后仍稳定。

包含模块：

1. Resume Loader；
2. Round-trip Consistency Check；
3. Budget Replacement；
4. Cache Observer；
5. History Replay View 同源化。

验收：

1. run 失败后恢复继续不丢上下文；
2. history reload 后 manifest hash 可解释；
3. 大工具结果替换后语义不丢；
4. cache break 能定位到具体 pass。

#### 第五阶段：fork / subagent 上下文治理

目标：未来多个 agent 协作时仍不污染主上下文。

包含模块：

1. Snapshot Fork Policy；
2. Sidechain Ledger Entries；
3. Isolated Mutable State；
4. Explicit Merge Result；
5. Fork Cache-safe Params。

验收：

1. 子 agent 不直接改主上下文；
2. 子 agent 输出必须显式 merge；
3. fork 后 stable prefix 尽量复用；
4. sidechain 可恢复、可审计。

### 19.11 模块之间的硬边界

为了防止实现时再次退化成补丁式修复，需要锁定这些边界：

1. Ledger 只保存事实，不拼 prompt；
2. Snapshot 只冻结本轮动态状态，不保存完整历史；
3. Compiler 只编译上下文，不执行业务工具；
4. Protocol Validator 只守协议和安全边界，不做业务理解；
5. LLM 只裁决语义和下一步意图，不直接写状态；
6. UI 只展示派生视图，不成为事实源；
7. Recovery 必须重新走 compiler，不读旧 prompt；
8. Cache Observer 只解释成本，不牺牲上下文正确性。

### 19.12 给评审的阅读顺序

如果只想快速理解方案，建议按这个顺序读：

1. `19.1`：先看一条请求怎么流动；
2. `19.2`：看模块分组；
3. `19.5`：看 Context Compiler；
4. `19.7`：看补充信息如何不再机械；
5. `19.8`：看恢复如何保证不失忆；
6. `19.10`：看怎么渐进实施。

如果准备进入开发，再读：

1. `18.7`：组件命名和 compiler passes；
2. `19.11`：硬边界；
3. `11`：回归测试矩阵；
4. `10`：实施步骤。
