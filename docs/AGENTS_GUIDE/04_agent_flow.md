# 04 Agent 流程

当前主线应理解为“任务会话编排系统”，而不是旧版演示型三个 HTTP Agent。

你关心的核心问题可以直接先给结论：

## 先给结论

### 1. 原来的三层架构是否还存在

存在，但不是整个系统唯一的运行主链。

代码中仍然保留并可调用的三层 Agent 类有：

1. `IntentRecognitionAgent`
2. `PlanningAgent`
3. `ExecutionPlanAgent`

对应路径：

- `apps/api/src/agents/task-creation/layers/intent-recognition-agent.ts`
- `apps/api/src/agents/task-creation/layers/planning-agent.ts`
- `apps/api/src/agents/task-creation/layers/execution-plan-agent.ts`

并且 `TaskCreationService` 仍然在按这三层顺序串联它们：

- `apps/api/src/agents/task-creation/task-creation-service.ts`

### 2. Altus 模式是否仍然直接走这三层

按当前代码事实，`Altus managed` 主链不是直接调用这三个 Layer 类。

当前 `Altus managed` 走的是独立链路：

1. `altus-managed-input-service.ts`
2. `altus-managed-run-entry-service.ts`
3. `altus-managed-setup-service.ts`
4. `altus-run-coordinator.ts`
5. `altus-managed-tool-runtime.ts`
6. `altus-run-lifecycle-service.ts`
7. `altus-managed-stream-service.ts`

也就是说：

- 三层架构在仓库里仍然存在
- 直通 / task-creation 相关主链仍然会使用三层
- 但 `Altus managed` 已经不是“简单复用三层后再执行”，而是 Suna 化之后的一套独立协调器架构

这个判断来自当前代码，不是只来自旧设计稿。

## 当前代码里的两条主链

### A. Task Creation / Sandbox 直通链

主入口：

- 路由：`apps/api/src/routes/task-creation-routes.ts`
- 服务：`apps/api/src/agents/task-creation/task-creation-service.ts`
- WebSocket：`apps/api/src/agents/task-creation/websocket-service.ts`

这条链里，三层仍然是明确存在的：

1. Layer 1
   - `IntentRecognitionAgent`
   - 负责意图识别、是否需要澄清、是否复用历史定义
2. Layer 2
   - `PlanningAgent`
   - 负责任务描述结构化、约束与交付要求整理
3. Layer 3
   - `ExecutionPlanAgent`
   - 负责执行计划生成

补充节点：

- `executionReviewAgent`
  - 审查执行结果、决定继续修复还是通过
- `playwrightTestDetectionAgent`
  - 用于测试行为识别
- `direct-capability-intercept-agent`
  - 用于 sandbox 直通模式下的平台能力拦截

### B. Altus Managed 链

主入口：

- 路由：`apps/api/src/routes/altus-managed-routes.ts`
- 输入服务：`apps/api/src/services/altus-managed-input-service.ts`
- run 入口：`apps/api/src/services/altus-managed-run-entry-service.ts`
- 协调器：`apps/api/src/services/altus-run-coordinator.ts`
- 工具运行时：`apps/api/src/services/altus-managed-tool-runtime.ts`

这一条链当前更接近“Suna 风格的 managed 协调器”：

1. 接收用户输入和附件
2. 绑定会话归属、准备 sandbox
3. 同步 skills、连接器快照、MCP tools
4. 创建 managed run
5. 在 `AltusRunCoordinator` 内构造 prompt、消息历史、工具定义
6. 通过 `AltusManagedToolRuntime` 执行 shell / 文件 / MCP / 联网等工具
7. 通过 Redis + stream + lifecycle service 维护 run 状态与事件输出

这条链里虽然也会出现：

- clarification
- planning/analysis
- tool calling
- completion / delivery

但这些行为不是通过 `IntentRecognitionAgent -> PlanningAgent -> ExecutionPlanAgent` 这三个类显式串联完成的，而是在 `AltusRunCoordinator` 的模型循环里完成。

## 为什么会产生“看起来还是三层”的错觉

当前代码里有三处会让人误以为 Altus 仍然走旧三层：

1. 前端注释还写着 `managed: Altus 三层智能体编排`
   - 文件：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
2. 旧设计文档里写过“Altus 接管模式仍走完整三层”
3. 会话仍然复用统一的 `stage / phase` 状态名

但如果按代码执行入口看，`Altus managed` 并没有直接进入 `TaskCreationService.createTask()`，而是直接进入 `altus-managed-input-service -> startRun -> AltusRunCoordinator`。

所以当前更准确的说法应是：

- “三层架构仍保留在 task-creation / sandbox 主链里”
- “Altus managed 已演进成独立的 managed coordinator 架构”
- “两条链共享部分状态模型、Sandbox、OSAC、连接器、Skills 和会话存储”

## 当前状态模型

会话维度仍然使用两套状态：

- Stage
  - `collecting`
  - `clarifying`
  - `planning`
  - `executing`
  - `reviewing`
  - `completed`
  - `failed`
- Phase
  - `ideation`
  - `analysis`
  - `development`
  - `testing`
  - `repair`
  - `delivery`

统一会话状态存储仍在：

- `apps/api/src/agents/task-creation/file-memory-store.ts`

但要注意：

- direct / sandbox 链更强依赖 task-creation 三层与 `TaskCreationService`
- managed / Altus 链更强依赖 run state、Redis state、stream event、lifecycle service

## 事件、恢复与共享基础设施

两条链并不是完全分裂，它们共享以下基础设施：

- Sandbox / E2B
- OSAC
- MCP provider 恢复
- connector bindings
- skill sync
- session ownership / user isolation

关键共享服务包括：

- `sandbox-agent-provision-service.ts`
- `osac-agent-service.ts`
- `session-mcp-recovery-service.ts`
- `session-connector-service.ts`
- `sandbox-skill-sync-service.ts`

其中：

- direct / sandbox 链主要由 `opencodeRemoteService` 聚合执行事件
- Altus managed 链主要由 `altus-run-event-writer`、`altus-managed-stream-service`、`altus-run-redis-state-service` 输出事件和状态

## 当前对外可用的准确表述

如果后续你要对别人解释当前架构，建议直接用下面这段：

1. oneceo 当前不是单一的一套“三层 Agent 全包所有模式”的架构。
2. 现在至少有两条主链：
   - 一条是 task-creation / sandbox 直通链，仍保留原三层 Agent。
   - 一条是 Altus managed 链，已经改成独立的 managed coordinator 架构。
3. Altus managed 在产品概念上仍承接“意图理解、规划、执行、澄清、交付”这些职责，但代码实现上不再直接等同于原来的三个 Layer 类。

## 身份与隔离

- 任务会话、Altus run、Skills、连接器 profile、Sandbox 绑定都以真实用户身份归属
- 当前不应继续把匿名请求头当作长期身份模型
- 身份设计依据：
  - `docs/agent研发文档/20260402_用户身份认证与后台管理设计/README.md`
  - `docs/agent研发文档/20260402_多用户隔离模型与标识边界设计_[20260402-1106已采用].md`
