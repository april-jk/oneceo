# 20260422 ClaudeCode主循环与工具体系启发的OneCEO渐进优化二期方案 [尚未采用]

更新时间：2026-04-22

关联现有已采用主线：

1. [20260420_ClaudeCode启发的Altus运行循环与恢复策略改进方案_[20260420-1238已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260420_ClaudeCode启发的Altus运行循环与恢复策略改进方案_[20260420-1238已采用].md)
2. [20260403_Altus运行时状态在Redis中的落点与恢复机制_[20260403-1905已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260403_Altus运行时状态在Redis中的落点与恢复机制_[20260403-1905已采用].md)
3. [20260401_连接器隐式Skills_API设计_[20260401-1158已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260401_连接器隐式Skills_API设计_[20260401-1158已采用].md)
4. [18_Altus工具调用消息历史丢失修复方案_[20260407-1449已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/Altus接管模式参照Suna重构设计/18_Altus工具调用消息历史丢失修复方案_[20260407-1449已采用].md)
5. [19_write_file过程原子消息放大交互设计_[20260409-0038已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/Altus接管模式参照Suna重构设计/19_write_file过程原子消息放大交互设计_[20260409-0038已采用].md)
6. [20_部署Skill治理与自动加载方案.md](/Users/watson/codingProj/oneceo/docs/agent研发文档/技能平台化热加载设计/20_部署Skill治理与自动加载方案.md)
7. [20260327_AltusManaged轮次耗尽导致已生成交付物仍失败_问题与修复方案.md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260327_AltusManaged轮次耗尽导致已生成交付物仍失败_问题与修复方案.md)

## 1. 文档目标

本文不是重写 oneceo 的 Altus managed runtime，也不是把 oneceo 改造成 ClaudeCode。

本文要回答的是：

1. ClaudeCode 的主工作循环与工具体系中，哪些机制值得 oneceo 借鉴
2. 这些机制应该如何嫁接到 oneceo 当前 Altus managed 主链
3. 在嫁接过程中，哪些 oneceo 已有设计初衷绝对不能被破坏，否则会直接影响可用性
4. 二期优化应该按什么顺序渐进落地，避免一次性大改导致 managed/direct/tooling 主链不可用

本文只产出方案，不进入代码实现。

## 2. 范围收口

### 2.1 本文重点分析的 oneceo 主链

本次重点不是旧三层 task-creation agent，而是当前 Altus managed 主工作循环：

1. [apps/api/src/services/altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1130)
2. [apps/api/src/services/altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts:513)
3. [apps/api/src/services/altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts:213)
4. [apps/api/src/services/altus-run-lifecycle-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-lifecycle-service.ts:21)

原因：

1. 这一条链才是 oneceo 当前最接近 ClaudeCode agent loop 的实现位置
2. 用户这次关注的是“主工作循环 + 工具体系”的优化空间，而不是 task-creation 三层编排本身

### 2.2 不在本轮范围的链路

以下链路不在本方案首批改造范围：

1. task-creation 三层 agent 本身
2. direct / sandbox 直通模式的编排语义
3. OpenCode / Codex 直通 executor 主链
4. 前端整体对话协议重构

约束依据：

1. [docs/AGENTS_GUIDE/04_agent_flow.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/04_agent_flow.md)
2. [apps/api/src/agents/task-creation/websocket-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/agents/task-creation/websocket-service.ts:269)

## 3. oneceo 当前设计初衷与不可破坏约束

在吸收 ClaudeCode 之前，必须先锁住 oneceo 当前已经证明有效、且不能被新 loop 干扰的设计目标。

### 3.1 Redis 只做热状态与恢复投影，不做事实真相源

当前已采用设计已经明确：

1. DB 是 run / event / timeline / binding 的事实来源
2. Redis 只做 `run:state`、`run:stream`、`run:recovery` 等热状态与恢复辅助
3. 一旦 Redis 与 DB 冲突，永远以 DB 为准并重建 Redis

依据：

1. [20260403_Altus运行时状态在Redis中的落点与恢复机制_[20260403-1905已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260403_Altus运行时状态在Redis中的落点与恢复机制_[20260403-1905已采用].md)
2. [apps/api/src/services/altus-run-lifecycle-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-lifecycle-service.ts:29)

因此二期优化不能引入：

1. 让 Redis 成为 loop 决策唯一真相源的方案
2. 只写 Redis 不写 DB 的工具结果或状态迁移
3. 通过内存态/进程态绕开现有 DB + Redis 恢复链路

### 3.2 工具调用历史必须能回放，不能只存在运行时事件流

当前已采用方案已经确认：

1. 仅写 `task_session_run_events` 的工具事件，在 run 结束后会从历史视图中消失
2. managed 工具调用结果必须投影到会话 timeline，才能跨刷新、跨设备回放

依据：

1. [18_Altus工具调用消息历史丢失修复方案_[20260407-1449已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/Altus接管模式参照Suna重构设计/18_Altus工具调用消息历史丢失修复方案_[20260407-1449已采用].md)

因此二期优化不能引入：

1. 只在 loop 内做“临时工具结果折叠”，却不保证 timeline 可恢复
2. 只保留模型输入摘要，丢掉用户可见的工具过程事实
3. 并发/流式工具执行后让 messageKey、toolCallId、timeline projection 失配

### 3.3 `write_file` 运行中放大卡片是现有交互契约，不能退化

当前已采用设计已经把 `write_file` 运行态做成有独立 UX 约束的特殊工具：

1. 运行中展开
2. 展示当前生成内容
3. 完成后再回到 compact

依据：

1. [19_write_file过程原子消息放大交互设计_[20260409-0038已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/Altus接管模式参照Suna重构设计/19_write_file过程原子消息放大交互设计_[20260409-0038已采用].md)
2. [apps/api/src/services/altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1270)

因此二期优化不能引入：

1. 只保留工具完成结果、不再输出 `write_file` 过程增量
2. 为了并发或压缩而打断 `write_file` 进度展示语义
3. 把 `write_file` 改成不可预测的异步批处理，导致前端失去稳定展开依据

### 3.4 connector guide gating、skill auto-attach、deployment gate 都是强业务约束

oneceo 的工具系统不是通用 CLI，它带有强平台语义：

1. connector guide 必须先加载，才能调用对应 connector MCP tool
2. deployment skill 会被自动挂载，用于保护部署链路
3. deployment tool 只有在明确部署意图下才能进入执行
4. `complete_task` 对部署成功有额外证据门禁

依据：

1. [20260401_连接器隐式Skills_API设计_[20260401-1158已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260401_连接器隐式Skills_API设计_[20260401-1158已采用].md)
2. [20_部署Skill治理与自动加载方案.md](/Users/watson/codingProj/oneceo/docs/agent研发文档/技能平台化热加载设计/20_部署Skill治理与自动加载方案.md)
3. [apps/api/src/services/altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts:518)
4. [apps/api/src/services/altus-managed-prompt-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts:435)

因此二期优化不能引入：

1. 把所有动态 MCP tool 简单并发跑掉，绕过 guide gating
2. 把 deployment tool 当普通 shell/file tool 处理
3. 为了减少 prompt 体积而把 `complete_task` / `deploy_*` / `load_connector_guide` 隐藏到不可见 deferred 状态

### 3.5 managed 与 direct 的模式边界必须稳定

当前代码已经明确：

1. `opencode_input` 只做直通桥接，不进入 Altus 接管流程
2. Altus managed 的 loop 优化不能误伤 direct mode

依据：

1. [apps/api/src/agents/task-creation/websocket-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/agents/task-creation/websocket-service.ts:269)
2. [docs/AGENTS_GUIDE/04_agent_flow.md](/Users/watson/codingProj/oneceo/docs/AGENTS_GUIDE/04_agent_flow.md)

因此二期优化的首批改动必须收敛在 managed runtime 内部，不能顺手重写 shared transport 语义。

### 3.6 新增能力只能挂到现有 transition / recovery 控制面，不能再造第二套状态机

当前已采用主线已经有：

1. `AltusRunTransitionReason`
2. `AltusRunRecoveryPolicy`
3. `AltusRunLoopSnapshot`
4. `AltusRunLifecycleService` 持有的 run status / recovery snapshot 写入职责

依据：

1. [20260420_ClaudeCode启发的Altus运行循环与恢复策略改进方案_[20260420-1238已采用].md](/Users/watson/codingProj/oneceo/docs/agent研发文档/20260420_ClaudeCode启发的Altus运行循环与恢复策略改进方案_[20260420-1238已采用].md)
2. [apps/api/src/services/altus-run-lifecycle-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-lifecycle-service.ts:95)

因此二期优化必须遵守：

1. 新增的 executor / budget policy 只能产出“供现有 coordinator 消费的内部决策信息”
2. 只有 coordinator / lifecycle service 可以最终落 `transitionReason`、`recoveryMode`、terminal status
3. 不允许让 executor 或 budget service 自己长出另一套 `status`、`phase`、`mode`、`state machine`

原因：

1. oneceo 当前真正危险的不是能力不够，而是控制面分裂
2. 一旦 loop、executor、budget service 各自维护一套运行状态，后续恢复与排障会立即失真

## 4. ClaudeCode 中值得借鉴的机制与源码位置

下面只列对 oneceo 当前问题真正有价值的部分。

### 4.1 主工作循环与上下文治理

参考位置：

1. [referance/claudecode_src/query.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/query.ts:307)
2. [referance/claudecode_src/QueryEngine.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/QueryEngine.ts:177)

关键点：

1. `queryLoop()` 是一个显式 while-loop，而不是“调模型 -> 跑工具 -> 再手写补丁”的碎片逻辑
2. 上下文治理独立存在，包括 tool result budget、snip、microcompact、autocompact、reactive recovery
3. streaming fallback、abort、max token、media error 都有统一恢复语义

对 oneceo 的启发：

1. oneceo 也需要把“上下文治理”提升成独立 runtime 能力
2. 但 oneceo 不能直接复制 ClaudeCode 的 compact 输出到用户历史，而应只针对“下一轮模型输入投影”生效

### 4.2 工具元数据是一等公民

参考位置：

1. [referance/claudecode_src/Tool.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/Tool.ts:402)
2. [referance/claudecode_src/tools.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/tools.ts:193)

关键点：

1. 每个工具不仅有 schema，还有 `isConcurrencySafe`
2. 还有 `isReadOnly`、`isDestructive`、`interruptBehavior`
3. 还有 `maxResultSizeChars`、`validateInput`、`checkPermissions`
4. 工具注册、过滤、deferred loading 都建立在统一元数据之上

对 oneceo 的启发：

1. 当前 oneceo 的 base tools 基本只有 JSON schema，[altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts:213)
2. oneceo 需要先补 tool descriptor 层，后面才能谈并发、上下文预算、interrupt behavior、tool exposure layering

### 4.3 工具执行编排独立于主循环

参考位置：

1. [referance/claudecode_src/services/tools/toolOrchestration.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/services/tools/toolOrchestration.ts:19)
2. [referance/claudecode_src/services/tools/StreamingToolExecutor.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/services/tools/StreamingToolExecutor.ts:34)

关键点：

1. 工具会按 `isConcurrencySafe` 分批
2. 读类工具可并发，写类工具保持串行
3. streaming tool executor 负责进度、取消、synthetic result、yield order
4. 工具异常不会简单吞掉，而会变成可继续消费的结构化结果

对 oneceo 的启发：

1. 当前 oneceo 在拿到完整 `tool_calls` 后是串行 `for` 执行，[altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1419)
2. oneceo 需要一个独立 executor 层，但首批应保持串行，先把结构化结果闭环和诊断能力做起来，再评估局部并发

### 4.4 工具结果闭环与中断语义

参考位置：

1. [referance/claudecode_src/query.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/query.ts:1380)
2. [referance/claudecode_src/services/tools/StreamingToolExecutor.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/services/tools/StreamingToolExecutor.ts:153)

关键点：

1. 工具取消、fallback、中断都有 synthetic `tool_result`
2. 主循环不需要猜“某个 tool_use 现在算不算结束”，因为 executor 会产出闭环结果

对 oneceo 的启发：

1. oneceo 当前更多是 `tool_call_started/completed/failed` event 语义
2. 二期可以引入内部的 “tool execution envelope” 统一结果模型，但不应直接改变现有对外 SSE 事件名

## 5. 与 oneceo 当前实现逐项对照

### 5.1 主循环

oneceo 当前：

1. `AltusRunCoordinator.runModelLoop()` 负责模型重试、纯文本恢复、工具执行、完成收口、部署门禁
2. loop 可工作，但职责比较重

参考位置：

1. [apps/api/src/services/altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1130)

ClaudeCode 当前：

1. query loop、tool execution、context governance 分层更清晰

判断：

1. oneceo 适合继续沿“轻量 coordinator + 独立 executor + 独立 budget policy”方向走
2. 不适合现在就把 `runModelLoop()` 彻底拆成大规模框架重构

### 5.2 工具定义

oneceo 当前：

1. base tool schema 明确
2. dynamic MCP tool 直接拼进 tools 列表
3. 缺少 read-only / destructive / concurrency-safe 等统一元数据

参考位置：

1. [apps/api/src/services/altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts:564)

判断：

1. 这是 oneceo 二期最适合先补的一层
2. 没有这一层，后续所有“并发/中断/延迟加载/预算治理”都会继续散在 if/else 中

### 5.3 工具执行

oneceo 当前：

1. 已有不错的 started/progress/completed/failed 事件
2. 但执行主体集中在 runtime + coordinator 的串行调用中

参考位置：

1. [apps/api/src/services/altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts:513)
2. [apps/api/src/services/altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1419)

判断：

1. 先抽 executor abstraction，有利于保留现有业务语义
2. 直接引入流式并发工具执行，风险过高

### 5.4 上下文治理

oneceo 当前：

1. `assistant` 和 `tool` 内容大量依赖局部 `truncate`
2. `maxToolRounds` 是主要的控制杆
3. 缺少独立的 model input budget policy

判断：

1. 这是 oneceo 当前和 ClaudeCode 差距最大的部分
2. 但治理对象必须限定为“模型下一轮输入投影”，不能改写 DB timeline 和用户历史

## 6. 设计判断：哪些能学，哪些不能直接搬

### 6.1 建议吸收的部分

1. 工具元数据层
2. 工具执行器层
3. 模型输入预算治理层
4. 工具结果闭环层
5. 工具暴露分层策略

### 6.2 明确不直接照搬的部分

1. ClaudeCode 全量 feature-gate 体系
2. ClaudeCode 全量交互式 permission 体系
3. 所有工具的流式并发执行
4. 把 compact 结果直接替代用户可见消息历史
5. 把 oneceo 的部署/connector/skill 业务语义压平为通用 CLI tool 语义

## 7. 渐进式优化方案

### 7.1 Phase 0：先补可观测元数据，不改现有执行语义

目标：

1. 给每个 managed base tool 增加统一 descriptor
2. 先让 loop、executor、budget policy 对 managed base tools 依赖这一层，而不是继续散落在 switch/if 中

建议新增最小内部描述字段：

```ts
type ManagedToolDescriptor = {
  name: string;
  category: 'workspace' | 'web' | 'deployment' | 'connector' | 'conversation' | 'skill';
  mutatesWorkspace: boolean;
  readsWorkspace: boolean;
  requiresConnectorGuide: boolean;
  requiresExplicitDeploymentIntent: boolean;
  budgetHint: 'small' | 'medium' | 'large';
  hasStableProgressShape: boolean;
};
```

这里刻意不在 Phase 0 放入以下字段：

1. `canRunInParallelBatch`
2. `interruptBehavior`
3. 输入级 `resultBudgetClass`

原因：

1. 这些能力很多并不是“按工具名静态成立”，而是和输入参数、工具家族、业务上下文有关
2. 如果一开始就把它们塞进静态 descriptor，很容易做成过度设计，后续还要返工
3. timeline 投影当前是事件策略，不是工具静态属性；把它塞进 descriptor 会模糊 `tool_call_progress` 与 `tool_call_started/completed/failed` 的现有边界
4. Phase 0 只记录稳定事实，不记录容易变动的运行时策略

首批只做：

1. 定义 descriptor
2. 给现有 base tools 补齐 descriptor
3. 动态 MCP tools 在 Phase 0 继续按“外部工具分支”处理，不要求现在并入与 base tools 等价的细粒度 descriptor；如果 executor / budget 在边界上必须识别它们，首批只允许补极简 opaque 标记，如 `toolFamily='mcp'`
4. 不改运行时行为

原因：

1. 这是风险最低、收益最高的一步
2. 不会触碰历史消息、SSE、deployment gate、write_file UX

建议落点：

1. `apps/api/src/services/altus-managed-shared.ts`
2. 或新增 `apps/api/src/services/altus-managed-tool-registry.ts`

### 7.2 Phase 1：引入 executor 抽象，但默认仍保持串行

目标：

1. 把“工具 started/progress/completed/failed/result envelope”从 coordinator 中抽出
2. 让 coordinator 只关心“下一步继续/收口/等待用户”

建议新增：

1. `AltusManagedToolExecutor`
2. `AltusManagedToolExecutionEnvelope`

约束：

1. 首批仍按当前顺序串行执行 `tool_calls`
2. 所有现有 SSE 事件名保持不变
3. `toolCallId`、`messageKey`、timeline projection 逻辑保持兼容
4. `tool_call_started -> tool_call_progress -> tool_call_completed/failed` 的现有时序约束保持兼容
5. `write_file` 继续沿用当前 progress payload 语义，至少保留 `writeFileProgress.path` 与 `writeFileProgress.generatedChars`
6. executor 不直接写终态 status，只返回内部 envelope 给 coordinator，由 coordinator 继续驱动现有 `transitionReason / recoveryMode`
7. timeline 投影继续由 executor / coordinator 按事件类型决定，而不是由 tool descriptor 静态决定；当前仍只投影 `tool_call_started / completed / failed`，`tool_call_progress` 继续保持流式可见、历史不落库的语义

原因：

1. oneceo 的主要问题不是“没有并发”，而是“没有稳定的执行语义边界”
2. 先抽 executor，后面才适合接 budget policy、interrupt behavior、future parallel batch

### 7.3 Phase 2：引入 model input budget policy，但不改用户历史

目标：

1. 解决 oneceo 当前对上下文治理主要依赖 `truncate` 的问题
2. 避免历史轮次里大量 tool result 原文持续膨胀 prompt

设计原则：

1. 只压缩“给下一轮模型看的投影”
2. 不压缩 `conversation_messages`
3. 不压缩 `task_session_run_events`
4. 不破坏用户历史回放与调试证据链
5. 不新增第二份“压缩后消息存储”；压缩结果必须是可即时重算的临时视图
6. 首批允许直接按工具类型写少量 summary builder，不为了“未来可扩展”先引入 DSL、规则引擎或可配置策略系统

首批处理对象：

1. `read_file`
2. `search_code`
3. `shell_execute`
4. `web_search`
5. `web_extract`
6. 大体积 MCP JSON 输出

建议策略：

1. 为每类结果定义 summary builder
2. 原结果继续落库/投影
3. 进入下一轮 prompt 前，只把“摘要 + 关键字段 + 必要原文片段”回送模型
4. `shell_execute` 首批只做最小限度的输出控体积：保留 `exitCode`，对超阈值 `stdout/stderr` 生成长度受限摘要，并保留错误场景必要尾部片段；不引入复杂命令分类器
5. 如果 run 中断或服务重启，budget service 只基于“已持久化或可由 recovery snapshot 重建”的输入重新计算投影，不额外恢复一份压缩缓存
6. `plain_text continuation reminder`、未持久化的 assistant 临时文本、以及其他纯内存临时消息，不属于 budget 重算对象；这类输入由现有 recovery policy 在恢复后重新生成，或在恢复后直接跳过
7. 如果重算失败，回退到未压缩输入，而不是阻断 run

这样做的原因：

1. 它不引入新的持久化事实，也不引入新的恢复对象
2. 它不要求重建一份与中断前逐字节完全一致的内存消息数组，而是明确只处理可重建输入，避免为恢复一致性引入第二套缓存或状态机
3. 它把复杂度控制在“纯函数式输入投影”范围内，最不容易制造不可预料的 bug

这是 oneceo 对 ClaudeCode compact 思路最值得吸收、且最不容易伤主链的一步。

### 7.4 Phase 3：工具暴露分层，减少首轮 prompt 宽度

这一阶段不是首批采用项，只能在前 0~2 阶段稳定后再评估。

目标：

1. 缩小每轮模型可见工具面
2. 降低全量动态 MCP tool 直接进 prompt 带来的噪音和误调用概率

原则：

1. `complete_task`、`ask_user`、`deploy_*`、`load_connector_guide`、本地文件基础工具必须始终可见
2. 动态 MCP tools 不应继续默认全量暴露

首批只允许考虑的简单方向：

1. 保留当前 base tools
2. 优先做服务端静态筛选与分组，而不是新引入一套模型可调用的 discovery tool 协议
3. 如果后续仍然确认 prompt 过宽，再单独起文档讨论是否需要更进一步的 discovery 机制

注意：

1. connector guide gating 不能被这个阶段绕开
2. deployment 工具不能进入 deferred 状态
3. 本方案当前不建议在首批实现中引入类似 ClaudeCode `ToolSearchTool` 的新交互协议，因为它会显著放大状态与提示词复杂度

### 7.5 Phase 4：最后才评估只读工具的有限并发

这是本方案里最晚进入、风险最高的一步。

只有在以下前提都满足时才考虑：

1. 已有 descriptor 层
2. 已有 executor 层
3. 已有稳定的 message/timeline projection
4. 已有 budget policy
5. 已有回归测试覆盖

首批允许考虑并发的工具仅限：

1. `read_file`
2. `list_directory`
3. `search_code`
4. `web_search`
5. `web_extract`

明确排除：

1. `write_file`
2. `shell_execute`
3. `debug_open_page`
4. `deploy_*`
5. 所有 MCP tool
6. `load_skill_resource`
7. `load_connector_guide`

原因：

1. 这些工具要么会写 workspace
2. 要么具备平台状态副作用
3. 要么与 oneceo 的业务保护链路绑定过深
4. 即使未来进入这一步，首批也只应采用显式 allowlist + 串行 fallback，不为了并发提前建设通用调度框架

### 7.6 Phase 5：补中断与 synthetic result 语义

在 executor 稳定后，可以补充：

1. 对可取消读类工具，在 executor 内按显式 allowlist 应用 `cancel` 型 interrupt 规则
2. 对不可取消或有强副作用工具保持 `block`
3. 统一在 executor 内产生 synthetic tool failure / cancellation result

约束：

1. synthetic result 只能增强 loop 闭环，不得替代真实 timeline 投影
2. 不能因为取消就抹掉已经持久化的历史事件
3. 这里的 interrupt 行为属于 Phase 5 的 executor 运行时策略，不回填到 Phase 0 的静态 descriptor

## 8. 推荐改造顺序

建议顺序如下：

1. Phase 0：tool descriptor
2. Phase 1：executor abstraction
3. Phase 2：model input budget policy
4. 先停下来做一轮回归验证与能力复测
5. 仅在确有必要时，再评估 Phase 5：interrupt + synthetic result
6. 仅在确有必要时，再评估 Phase 3：工具暴露分层
7. Phase 4：只读工具有限并发永远放到最后

不建议的顺序：

1. 直接上并发
2. 直接照搬 ClaudeCode streaming executor
3. 先做 prompt compact，再回头补历史一致性
4. 一开始就引入新的工具 discovery 协议或第二套运行状态模型

原因：

1. 这些顺序最容易破坏 oneceo 当前已采用的消息持久化和业务 gate 设计

## 9. 建议修改落点

如果后续采纳本方案，优先可能涉及：

1. [apps/api/src/services/altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1130)
2. [apps/api/src/services/altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts:513)
3. [apps/api/src/services/altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts:213)
4. [apps/api/src/services/altus-run-lifecycle-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-lifecycle-service.ts:95)
5. [apps/api/src/services/altus-managed-prompt-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts:482)

建议新增文件：

1. `apps/api/src/services/altus-managed-tool-registry.ts`
2. `apps/api/src/services/altus-managed-tool-executor.ts`
3. `apps/api/src/services/altus-managed-context-budget-service.ts`

## 10. 回归验收要求

如果未来进入实现，至少要锁住以下回归面：

1. managed run 的工具事件在 run 完成后仍能从历史完整回放
2. `write_file` 运行态展开卡片行为不退化
3. `complete_task` 与 deployment gate 语义不退化
4. connector guide 未加载前，connector MCP tool 仍会被阻断
5. skill auto-attach 仍会写 session state 并同步 sandbox
6. Redis recovery 仍然只是投影，不越权为事实源
7. direct mode 不会误入 managed runtime 新逻辑
8. 办公类交付物链路不会因新的 budget policy 提前丢失必要上下文

建议验证文档入口：

1. [docs/单元测试文档/20260420_当前Altus能力题库Smoke评测方案_[20260420-1337已采用].md](/Users/watson/codingProj/oneceo/docs/单元测试文档/20260420_当前Altus能力题库Smoke评测方案_[20260420-1337已采用].md)
2. [docs/单元测试文档/20260420_Altus能力题库修复后复测方案_[20260420-1412已采用].md](/Users/watson/codingProj/oneceo/docs/单元测试文档/20260420_Altus能力题库修复后复测方案_[20260420-1412已采用].md)
3. [docs/单元测试文档/20260421_Altus三级记忆系统_Playwright全链路测试方案_[20260421-1741已采用].md](/Users/watson/codingProj/oneceo/docs/单元测试文档/20260421_Altus三级记忆系统_Playwright全链路测试方案_[20260421-1741已采用].md)

## 11. 结论

本轮最重要的判断不是“ClaudeCode 有哪些高级特性”，而是：

1. oneceo 当前最该学的，不是全量并发和全量 compact
2. 而是先把 tool descriptor、executor abstraction、model input budget 这三层补齐
3. 并且整个过程必须以 oneceo 当前已采用的业务语义为约束

换句话说：

1. ClaudeCode 值得借鉴的是运行时工程化方法
2. oneceo 必须保留的是平台业务约束和消息可恢复性
3. 二期正确方向应是“渐进嫁接”，不是“整体替换”

## 12. 参考代码位置总表

### 12.1 ClaudeCode 参考

1. 主 loop：
   [referance/claudecode_src/query.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/query.ts:307)
2. 会话封装与 query engine：
   [referance/claudecode_src/QueryEngine.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/QueryEngine.ts:177)
3. 工具元数据协议：
   [referance/claudecode_src/Tool.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/Tool.ts:402)
4. 工具注册与过滤：
   [referance/claudecode_src/tools.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/tools.ts:193)
5. 串行/并发分批执行：
   [referance/claudecode_src/services/tools/toolOrchestration.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/services/tools/toolOrchestration.ts:19)
6. 流式工具执行器：
   [referance/claudecode_src/services/tools/StreamingToolExecutor.ts](/Users/watson/codingProj/oneceo/referance/claudecode_src/services/tools/StreamingToolExecutor.ts:34)

### 12.2 oneceo 当前对照

1. managed 主循环：
   [apps/api/src/services/altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts:1130)
2. managed tool runtime：
   [apps/api/src/services/altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts:513)
3. managed tool schema + 动态 MCP tool 暴露：
   [apps/api/src/services/altus-managed-shared.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-shared.ts:213)
4. run lifecycle / recovery snapshot：
   [apps/api/src/services/altus-run-lifecycle-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-lifecycle-service.ts:21)
5. prompt 约束与完成契约：
   [apps/api/src/services/altus-managed-prompt-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts:448)
