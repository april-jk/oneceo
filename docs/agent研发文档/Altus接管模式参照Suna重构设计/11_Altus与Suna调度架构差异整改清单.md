# 11 Altus 与 Suna 调度架构差异整改清单

## 1. 文档目的

本文件不是新的总设计，而是对现有 `Altus 接管模式` 重构文档组做一次“可直接开发”的整改补充。

目标：

1. 把 Altus 当前 managed 实现与 `suna` 的调度架构差异逐点摊开。
2. 每个设计点都明确：
   - `oneceo 当前代码位置`
   - `suna 参照代码位置`
   - `需要补齐的目标结构`
3. 后续进入编码时，开发者可以直接按本文件跳转源码，不再凭概念推断。

明确边界：

- 只覆盖 `Altus managed mode`
- 不改 `OpenCode / Codex / ClaudeCode` 直通模式
- sandbox 继续使用 `E2B`
- 与 sandbox 内现有服务通信时，仍遵守 oneceo 既有 `OSAC` 规则

---

## 2. 总体判断

当前 Altus managed 已经完成了第一轮“对象层”重构：

- 有独立 `run`
- 有独立 `run stream`
- 有独立 `tool runtime`
- 有独立 `managed route`

对应代码：

- `apps/api/src/routes/altus-managed-routes.ts`
- `apps/api/src/services/altus-managed-run-service.ts`
- `apps/api/src/services/altus-managed-prompt-service.ts`
- `apps/api/src/services/altus-managed-tool-runtime.ts`
- `apps/api/src/services/altus-managed-stream-service.ts`

但从调度内核看，Altus 仍然明显比 `suna` 更薄：

- Altus 当前核心仍然集中在 `AltusManagedRunService`
- `suna` 的核心已经拆成 `executor + StatelessCoordinator + state + manager initializer + execution engine + response processor + background tasks`

因此后续整改目标不是“继续加功能”，而是把 Altus managed 从：

- `单服务内串行 tool loop`

补齐到：

- `run entry + coordinator + state + manager assembly + execution engine + runtime adapter`

---

## 3. 差异总览

| 维度 | Altus 当前实现 | Suna 当前实现 | 结论 |
|---|---|---|---|
| run 启动入口 | `altus-managed-routes.ts` + `AltusManagedRunService.startRun(...)` | `agents/api.py` + `execute_agent_run(...)` | Altus 已有入口，但缺独立 runner 分层 |
| 调度内核 | `AltusManagedRunService` 内联完成 | `StatelessCoordinator.execute(...)` | Altus 需要拆 coordinator |
| run state | DAO + service 内局部状态 | `RunState` | Altus 需要补统一 state 对象 |
| 初始化与预热 | service 内局部 ensure | `setup_manager.py` + `ManagerInitializer` | Altus 需要补 setup / manager assembly |
| tool execution | `AltusManagedToolRuntime` 直接执行 | `ToolExecutor + ResponseProcessor + ExecutionEngine` | Altus 需要补执行调度层，不改 E2B runtime |
| stream | `appendRunEvent(...)` 手动发布 | Redis stream 统一写入 | Altus 需要补统一 event writer |
| ownership/idempotency | 基本缺失 | `ownership / idempotency / lifecycle` | Altus 需要补最小并发保护 |
| prompt/tool/mcp 装配 | 已拆 prompt/runtime，registry 还弱 | `PromptManager / ToolManager / MCPManager` | Altus 需要补 manager 边界 |
| 前端 managed hooks | 仍在大 `useTaskCreationAgent.ts` 中 | run-stream-first hooks | Altus 需要补 hook 拆分 |

---

## 4. 整改点 A：Run 入口与 API 边界

### 4.1 当前 oneceo 位置

- `apps/api/src/routes/altus-managed-routes.ts`
  - `POST /sessions/:sessionId/runs`
  - `GET /sessions/:sessionId/runs/latest`
  - `GET /runs/:runId/stream`
  - `POST /runs/:runId/stop`
- `apps/api/src/services/altus-managed-run-service.ts`
  - `startRun(...)`
  - `getLatestRun(...)`
  - `stopRun(...)`

### 4.2 suna 参照

- `referance/suna/backend/core/agents/api.py`
  - `start_agent_run(...)`
  - `get_run_status(...)`
  - run 启动后异步调 `execute_agent_run(...)`
- `referance/suna/backend/core/agents/runner/executor.py`
  - `execute_agent_run(...)`

### 4.3 现状差异

Altus 现在已经有独立 run API，但 route 与 runner 之间仍然是“服务直调”，没有明确的：

- run entry service
- run scheduler / dispatcher
- run worker boundary

### 4.4 目标结构

后续应补出：

1. `AltusManagedRunEntryService`
   - 负责权限校验、session ownership、run record 创建
2. `AltusManagedRunner`
   - 只负责执行 run
3. route 只调用 entry，不直接碰执行细节

### 4.5 开发直接参考

- oneceo 现有入口改造起点：
  - `apps/api/src/routes/altus-managed-routes.ts`
  - `apps/api/src/services/altus-managed-run-service.ts`
- suna 对照入口：
  - `referance/suna/backend/core/agents/api.py`
  - `referance/suna/backend/core/agents/runner/executor.py`

---

## 5. 整改点 B：Coordinator 拆分

### 5.1 当前 oneceo 位置

- `apps/api/src/services/altus-managed-run-service.ts`
  - 当前同时承担：
    - session ownership
    - sandbox ensure
    - history 构造
    - prompt 注入
    - LLM 请求
    - tool loop
    - run event 发布
    - timeline 持久化

### 5.2 suna 参照

- `referance/suna/backend/core/agents/runner/executor.py`
  - `execute_agent_run(...)`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/stateless.py`
  - `StatelessCoordinator.execute(...)`
  - `_execution_loop(...)`
  - `_load_prompt_and_tools(...)`
  - `_cleanup(...)`

### 5.3 现状差异

Altus 当前还没有明确的 coordinator，对后续新增这些能力不利：

- auto-continue
- step 级状态
- 中断恢复
- 后台任务
- run 生命周期细粒度监控

### 5.4 目标结构

后续拆成：

1. `AltusManagedRunner`
   - 对外 run 执行入口
2. `AltusRunCoordinator`
   - run 生命周期驱动
3. `AltusExecutionEngine`
   - 单轮模型请求与工具响应循环

### 5.5 开发直接参考

- oneceo 当前待拆文件：
  - `apps/api/src/services/altus-managed-run-service.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/runner/executor.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/coordinator/stateless.py`

---

## 6. 整改点 C：Run State 与生命周期

### 6.1 当前 oneceo 位置

- `apps/api/src/db/dao/task-session-run.dao.ts`
- `apps/api/src/services/altus-managed-run-service.ts`
  - `appendRunEvent(...)`
  - `toSummary(...)`
  - `ensureSessionOwnership(...)`

### 6.2 suna 参照

- `referance/suna/backend/core/agents/pipeline/context.py`
  - `PipelineContext`
- `referance/suna/backend/core/agents/pipeline/stateless/state.py`
  - `RunState`
- `referance/suna/backend/core/agents/pipeline/stateless/lifecycle.py`
- `referance/suna/backend/core/agents/pipeline/stateless/metrics.py`

### 6.3 现状差异

Altus 现在的状态是：

- DB 中有 run record
- 内存里有一些局部控制变量
- 缺少统一 `RunState` 对象

这会导致：

- step 级扩展困难
- 流式事件很难统一来源
- 中断、失败、完成的语义难统一

### 6.4 目标结构

新增：

1. `AltusRunContext`
   - session/run/user/sandbox/connectors 的只读上下文
2. `AltusRunState`
   - 当前 step、termination reason、active tool call、current model 等
3. `AltusRunLifecycle`
   - running / waiting_user / completed / failed / stopped 的统一迁移

### 6.5 开发直接参考

- oneceo 当前状态入口：
  - `apps/api/src/db/dao/task-session-run.dao.ts`
  - `apps/api/src/services/altus-managed-run-service.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/pipeline/context.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/state.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/lifecycle.py`

---

## 7. 整改点 D：Ownership / Idempotency / Stop

### 7.1 当前 oneceo 位置

- `apps/api/src/services/altus-managed-run-service.ts`
  - `controllers = new Map<string, AbortController>()`
- `apps/api/src/services/altus-managed-stream-service.ts`
  - 只负责 stream 发布/订阅

### 7.2 suna 参照

- `referance/suna/backend/core/agents/runner/executor.py`
  - `check_stop()`
- `referance/suna/backend/core/agents/pipeline/stateless/ownership.py`
- `referance/suna/backend/core/agents/pipeline/stateless/idempotency.py`

### 7.3 现状差异

Altus 目前只有本进程内 `AbortController` 级别 stop，不具备：

- run ownership claim
- step idempotency
- 多 worker 并发保护

### 7.4 目标结构

新增最小组件：

1. `AltusRunOwnership`
   - 启动 run 前 claim
   - 结束后 release
2. `AltusRunIdempotency`
   - 避免 step/tool loop 重放
3. `AltusStopSignalStore`
   - stop 不只依赖进程内 controller

### 7.5 开发直接参考

- oneceo 当前起点：
  - `apps/api/src/services/altus-managed-run-service.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/runner/executor.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/ownership.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/idempotency.py`

---

## 8. 整改点 E：Setup / Prewarm / Manager Assembly

### 8.1 当前 oneceo 位置

- `apps/api/src/services/altus-managed-run-service.ts`
  - `ensureSandbox(...)`
  - history 构造逻辑
- `apps/api/src/services/altus-managed-prompt-service.ts`
- `apps/api/src/services/altus-managed-tool-runtime.ts`

### 8.2 suna 参照

- `referance/suna/backend/core/agents/runner/setup_manager.py`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/initialization.py`
  - `ManagerInitializer.init_managers(...)`
  - `ManagerInitializer.load_prompt_and_tools(...)`

### 8.3 现状差异

Altus 现在没有明确的 setup / manager initializer 层，导致：

- 初始化逻辑分散
- prompt/tool/mcp 装配边界不够清楚
- 后续接动态工具时会继续把责任塞回 run service

### 8.4 目标结构

新增：

1. `AltusManagedSetupService`
   - sandbox ensure
   - connector snapshot
   - session history build
2. `AltusManagerInitializer`
   - prompt manager
   - tool registry
   - connector/mcp manager

### 8.5 开发直接参考

- oneceo 当前起点：
  - `apps/api/src/services/altus-managed-run-service.ts`
  - `apps/api/src/services/altus-managed-prompt-service.ts`
  - `apps/api/src/services/altus-managed-tool-runtime.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/runner/setup_manager.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/coordinator/initialization.py`

---

## 9. 整改点 F：Prompt / Tool / MCP 三层装配

### 9.1 当前 oneceo 位置

- `apps/api/src/services/altus-managed-prompt-service.ts`
- `apps/api/src/services/altus-managed-tool-runtime.ts`
- `apps/api/src/services/session-connector-service.ts`
- `apps/api/src/services/connector-registry.ts`

### 9.2 suna 参照

- `referance/suna/backend/core/agents/runner/prompt_manager.py`
- `referance/suna/backend/core/agents/runner/tool_manager.py`
- `referance/suna/backend/core/agents/runner/mcp_manager.py`

### 9.3 现状差异

Altus 目前是：

- prompt 已独立
- runtime 已独立
- tool registry / connector mcp manager 仍未成型

### 9.4 目标结构

新增：

1. `AltusPromptManager`
2. `AltusToolRegistry`
3. `AltusConnectorMcpManager`

规则：

- prompt 只负责 system prompt 与上下文拼装
- tool registry 只负责 tool definitions
- connector/mcp manager 只负责 run 时装配可用 MCP 工具

### 9.5 开发直接参考

- oneceo 当前起点：
  - `apps/api/src/services/altus-managed-prompt-service.ts`
  - `apps/api/src/services/session-connector-service.ts`
  - `apps/api/src/services/connector-registry.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/runner/prompt_manager.py`
  - `referance/suna/backend/core/agents/runner/tool_manager.py`
  - `referance/suna/backend/core/agents/runner/mcp_manager.py`

---

## 10. 整改点 G：Tool Execution Engine 与 E2B Runtime 分层

### 10.1 当前 oneceo 位置

- `apps/api/src/services/altus-managed-run-service.ts`
  - LLM tool calls 解析与循环
- `apps/api/src/services/altus-managed-tool-runtime.ts`
  - `shell_execute / read_file / write_file / list_directory / search_code / ask_user`
- `apps/api/src/connectors/e2b-connector.ts`

### 10.2 suna 参照

- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/tool_executor.py`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/response_processor.py`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/execution.py`

### 10.3 现状差异

Altus 现在把：

- tool call orchestration
- tool runtime execution

混在两个层里，但还没有独立的 execution engine。

### 10.4 目标结构

保持 `E2B` 不变，但新增中间层：

1. `AltusToolExecutor`
   - tool call 级调度
2. `AltusResponseProcessor`
   - 处理 assistant delta / tool calls / completion
3. `AltusExecutionEngine`
   - 单 step 驱动模型与 tool executor
4. `AltusManagedToolRuntime`
   - 继续只做 E2B 工具执行，不承担调度

### 10.5 开发直接参考

- oneceo 当前起点：
  - `apps/api/src/services/altus-managed-run-service.ts`
  - `apps/api/src/services/altus-managed-tool-runtime.ts`
  - `apps/api/src/connectors/e2b-connector.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/pipeline/stateless/coordinator/tool_executor.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/coordinator/response_processor.py`
  - `referance/suna/backend/core/agents/pipeline/stateless/coordinator/execution.py`

---

## 11. 整改点 H：统一 Event Writer 与 Stream 语义

### 11.1 当前 oneceo 位置

- `apps/api/src/services/altus-managed-run-service.ts`
  - `appendRunEvent(...)`
- `apps/api/src/services/altus-managed-stream-service.ts`

### 11.2 suna 参照

- `referance/suna/backend/core/agents/runner/executor.py`
  - `stream_status_message(...)`
  - `redis.stream_add(...)`
- `referance/suna/backend/core/agents/runner/services.py`

### 11.3 现状差异

Altus 已有统一 stream 出口，但还没有统一 writer 协议层。

当前问题：

- 事件 schema 仍然由 run service 手工散写
- 原子消息语义容易和 direct mode 历史协议串线

### 11.4 目标结构

新增：

1. `AltusRunEventWriter`
   - 统一输出 `run_status / assistant / tool / clarification / artifact`
2. `AltusRunEventSchema`
   - 统一 event payload shape

### 11.5 开发直接参考

- oneceo 当前起点：
  - `apps/api/src/services/altus-managed-run-service.ts`
  - `apps/api/src/services/altus-managed-stream-service.ts`
- suna 对照：
  - `referance/suna/backend/core/agents/runner/executor.py`
  - `referance/suna/backend/core/agents/runner/services.py`

---

## 12. 整改点 I：前端 Hook 拆分与原子消息适配

### 12.1 当前 oneceo 位置

- `apps/web/client/src/hooks/useTaskCreationAgent.ts`
  - `mergeRealtimeMessage(...)`
  - `compactHistoryMessages(...)`
  - `handleManagedRunStreamEvent(...)`
- `apps/web/client/src/pages/Home.tsx`
  - managed 消息渲染
  - managed 原子工具卡片
- `apps/web/client/src/lib/task-creation-client.ts`
  - `getTaskCreationManagedRunStreamUrl(...)`

### 12.2 suna 参照

- `referance/suna/apps/frontend/src/lib/api/agents.ts`
- `referance/suna/apps/frontend/src/lib/streaming/use-agent-stream.ts`
- `referance/suna/apps/frontend/src/hooks/messages/useAgentStream.ts`

### 12.3 现状差异

Altus managed 已经接入 run stream，但：

- 仍在大 hook 中与 direct mode 共存
- history compact / realtime merge / render adapter 仍然耦合

### 12.4 目标结构

拆成：

1. `useAltusManagedConversation`
2. `useAltusManagedRunStream`
3. `useAltusManagedMessageAdapter`

同时保留：

- direct mode 继续留在 `useTaskCreationAgent.ts`

### 12.5 开发直接参考

- oneceo 当前起点：
  - `apps/web/client/src/hooks/useTaskCreationAgent.ts`
  - `apps/web/client/src/pages/Home.tsx`
  - `apps/web/client/src/lib/task-creation-client.ts`
- suna 对照：
  - `referance/suna/apps/frontend/src/lib/api/agents.ts`
  - `referance/suna/apps/frontend/src/lib/streaming/use-agent-stream.ts`
  - `referance/suna/apps/frontend/src/hooks/messages/useAgentStream.ts`

---

## 13. 整改点 J：E2B 特有适配，不照抄 Suna Sandbox

### 13.1 当前 oneceo 位置

- `apps/api/src/connectors/e2b-connector.ts`
- `apps/api/src/services/altus-managed-tool-runtime.ts`
- `apps/api/src/services/sandbox-environment-service.ts`
- `apps/api/src/services/sandbox-archive-service.ts`

### 13.2 suna 参照

- `suna` 的 sandbox tools 与 thread manager/runner 深度耦合，但其底座不是 oneceo 当前的 E2B + OSAC 组合

### 13.3 结论

这一块不能照抄 `suna`，只能借鉴“执行调度层”和“tool runtime 分层思想”。

必须坚持：

1. `E2B` 仍是唯一 sandbox 执行底座
2. `AltusManagedToolRuntime` 调用 E2B 的事实不变
3. 如果后续有 sandbox 内服务桥接，仍必须单独通过 oneceo 的 `OSAC` 服务链，而不是直接照搬 `suna` 的 sandbox tools 结构

---

## 14. 推荐实施顺序（整改版）

基于上面的差异判断，后续编码顺序建议固定为：

1. `AltusRunContext / AltusRunState / AltusRunLifecycle`
2. `AltusManagedRunEntryService`
3. `AltusManagedRunner + AltusRunCoordinator`
4. `AltusManagerInitializer`
5. `AltusPromptManager / AltusToolRegistry / AltusConnectorMcpManager`
6. `AltusToolExecutor / AltusResponseProcessor / AltusExecutionEngine`
7. `AltusRunEventWriter`
8. 前端 `useAltusManagedConversation / useAltusManagedRunStream / useAltusManagedMessageAdapter`

不允许跳过前面的结构层，直接继续往 `AltusManagedRunService` 里加逻辑。

---

## 15. 最终结论

当前 Altus managed 与 `suna` 的真实关系是：

- 在对象层与入口层，Altus 已开始接近 `suna`
- 在调度内核、状态机、manager assembly、execution engine 上，Altus 仍明显不完整

因此后续整改重点不是再加新功能，而是把 Altus managed 从：

- `单服务 + 内联 tool loop`

重构成：

- `run entry + coordinator + state + setup + managers + execution engine + event writer + E2B runtime`

这才是与 `suna` 设计模式真正对齐、同时又不违背 oneceo `E2B` 现实边界的最短路径。
