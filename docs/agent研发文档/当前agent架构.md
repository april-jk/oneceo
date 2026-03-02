# 当前 Agent 架构（oneceo.ai）

日期：2026-03-02

本文档聚焦**当前代码实现**的基层智能体/编排链路与状态机（以 `oneceo/apps/api` 为主），用于研发协作与后续批注迭代。

---

## 1. 基层智能体与用途

### 1.1 三层 Task Creation Agents（任务创建）

| 层级 | 类名 | 主要职责 | 关键输出 | 代码位置 |
|---|---|---|---|---|
| Layer 1 | `IntentRecognitionAgent` | 意图识别、任务类型判定 | `IntentRecognitionResult` | `oneceo/apps/api/src/agents/task-creation/layers/intent-recognition-agent.ts` |
| Layer 2 | `PlanningAgent` | 任务描述/需求结构化 | `TaskDescription` | `oneceo/apps/api/src/agents/task-creation/layers/planning-agent.ts` |
| Layer 3 | `ExecutionPlanAgent` | 执行计划生成 | `ExecutionPlan` | `oneceo/apps/api/src/agents/task-creation/layers/execution-plan-agent.ts` |

### 1.2 执行审查智能体（Review Gate）

| 名称 | 主要职责 | 关键输出 | 代码位置 |
|---|---|---|---|
| `executionReviewAgent` | 审查执行输出、给出是否通过/修复建议 | `ReviewResult` | `oneceo/apps/api/src/agents/task-creation/layers/execution-review-agent.ts` |

### 1.3 Layer 1 双路径（新增）

Layer 1 在**新任务**与**已存在会话**两种场景下采用不同策略：

1. **新任务（无历史意图）**  
   - 进行意图识别（IntentRecognitionAgent）  
   - 决定任务类型并引导到对应 Layer 2  

2. **已存在会话（有历史意图）**  
   - **跳过意图识别**，复用会话创建时的基础定义  
   - 直接进入规划层（Layer 2），基于历史定义 + 用户补充更新任务描述  

此策略避免在“续聊/补充”时反复识别任务类型导致的误判或重分流。

### 1.4 Layer 2 子智能体拆解（新增）

Layer 2 已拆解为**独立规划智能体类**，用于后续逐个细化：

- 基类：`oneceo/apps/api/src/agents/task-creation/layers/planners/base-planner.ts`
- 注册表：`oneceo/apps/api/src/agents/task-creation/layers/planners/persona-registry.ts`

#### 当前已预置的领域规划智能体类（可直接细化）

- 编程规划智能体：`software-planner.ts`
- 财务/商业规划智能体：`finance-planner.ts`
- 运营规划智能体：`ops-planner.ts`
- 内容/文案规划智能体：`content-planner.ts`
- 设计规划智能体：`design-planner.ts`
- 研究/分析规划智能体：`research-planner.ts`
- 通用规划智能体：`generic-planner.ts`

每个类内置 `personaPrompt`（可直接替换/扩展），并由 `PlanningAgent` 通过注册表选择。

#### 交付模板与澄清模板（新增）

每个子智能体类包含两类可直接细化的模板字段：
- `clarificationTemplate`: 建议优先使用的澄清问题清单
- `deliverableTemplate`: 默认交付清单模板

`PlanningAgent` 会将这两类模板注入提示词中，作为生成任务描述时的辅助约束。

---

## 2. 编排层核心服务

### 2.1 TaskCreationService（任务创建主编排）

职责：
- 串联 L1/L2/L3
- 持久化会话、消息、意图、计划
- 根据配置是否启用 OSAC 执行
- 负责 **stage / phase** 更新并发出 `status_update` 消息

代码位置：`oneceo/apps/api/src/agents/task-creation/task-creation-service.ts`

### 2.2 OpencodeRemoteService（OpenCode 事件编排）

职责：
- 监听 OSAC/OpenCode 事件（SSE/WS）
- 汇总 diff / tool / file / command 轨迹
- 驱动 **开发→测试→修复→交付** 的状态机
- 触发 Playwright-MCP 测试与 n.eko 画面转发

代码位置：`oneceo/apps/api/src/services/opencode-remote-service.ts`

### 2.3 OSAC / Sandbox / Debug

- `sandboxAgentProvisionService`：调度 e2b sandbox
- `osacAgentService`：调用 OSAC 执行命令/接入 OpenCode
- `ensureNekoDebug`：启动 n.eko 调试服务
- `ensurePlaywrightMcp`：确保 Playwright MCP 已安装

---

## 3. 系统整体链路（逻辑图）

```mermaid
flowchart LR
  U[用户输入] --> W[Web 前端]
  W --> API[API / TaskCreationService]

  API --> L1[IntentRecognitionAgent]
  L1 --> L2[PlanningAgent]
  L2 --> L3[ExecutionPlanAgent]

  L3 --> DB[(会话/计划/消息 DB)]
  L3 -->|OSAC 启用| PROV[sandboxAgentProvisionService]
  PROV --> E2B[e2b Sandbox]

  E2B --> OSAC[OSAC Agent]
  OSAC --> OC[OpenCode]
  OC --> ORS[OpencodeRemoteService]

  ORS --> Neko[n.eko 调试服务]
  ORS --> Playwright[playwright-mcp]
  ORS --> W

  W --> Admin[管理后台可观测]
  ORS --> Admin
```

---

## 4. 状态机（Stage + Phase）

当前系统存在两套并行状态，但**统一由 `updateSessionState` 管理并校验迁移合法性**：
- **Stage（流程阶段）**：`collecting` / `clarifying` / `planning` / `executing` / `reviewing` / `completed` / `failed`
- **Phase（业务阶段）**：`ideation` / `analysis` / `development` / `testing` / `repair` / `delivery`

状态更新入口：`taskCreationFileMemoryStore.updateSessionState`  
位置：`oneceo/apps/api/src/agents/task-creation/file-memory-store.ts`

### 4.0 统一状态更新规则（新增）

- **单一更新入口**：所有 stage / phase / status 更新需走 `updateSessionState`（内部校验合法迁移）。  
- **Stage 由 Phase 派生**：当 phase 更新时，会自动映射到对应 stage。  
- **终态保护**：`completed` / `failed` 后禁止回滚。  
- **Clarifying 保护**：等待用户输入时不允许 phase 覆盖 stage。  

### 4.1 Stage 状态机（统一入口驱动）

```mermaid
stateDiagram-v2
  [*] --> collecting
  collecting --> planning
  collecting --> clarifying: 需要澄清
  clarifying --> collecting: 用户补充
  planning --> executing: OSAC 启用
  planning --> completed: OSAC 关闭
  executing --> reviewing: 本地审查/OSAC 执行后
  reviewing --> executing: 审查不通过
  reviewing --> completed: 审查通过
  collecting --> failed
  planning --> failed
  executing --> failed
  reviewing --> failed
```

### 4.2 Phase 状态机（统一入口驱动）

当前由 OSAC / OpenCode 事件触发，驱动业务闭环：

```mermaid
stateDiagram-v2
  [*] --> ideation
  ideation --> analysis
  analysis --> development
  development --> testing: 产出内容后自动进入测试
  testing --> repair: 测试失败
  repair --> testing: 修复完成后复测
  testing --> delivery: 测试通过
  delivery --> [*]
```

#### Phase 驱动逻辑（关键规则）

- **development → testing**：OpenCode 执行完成，且检测到 workspace 产物
- **testing → repair**：Review Gate 返回 `retry`
- **repair → testing**：基于修复反馈再次触发 Playwright 测试
- **testing → delivery**：Review Gate 通过/跳过

#### Phase → Stage 映射规则

- ideation → collecting  
- analysis → planning  
- development → executing  
- testing → reviewing  
- repair → executing  
- delivery → reviewing（最终完成时再转 `completed`）  

---

## 5. Playwright + n.eko 组合调试流程

当前系统在 `testing/repair` 阶段要求：
- 使用 `playwright-mcp`（可视模式，headless=false）
- 使用 **同一浏览器实例**（CDP 9222）
- 复用首个 context/page，以便画面出现在 n.eko 窗口

关键实现点：
- `TaskCreationService.buildOpencodePrompt` 中写入 Playwright 约束
- `OpencodeRemoteService` 在执行完成后触发 `ensurePlaywrightMcp` + `ensureNekoDebug`

---

## 6. 关键组件与职责映射

| 组件 | 角色 | 责任 | 产出 |
|---|---|---|---|
| TaskCreationService | 任务编排入口 | L1/L2/L3 串联、状态广播 | plan / status_update |
| OpencodeRemoteService | 执行态编排器 | 收集事件、驱动 phase 状态机 | opencode_event / testing / delivery |
| OSAC Agent | 执行代理 | 启动 sandbox，转发 OpenCode | 命令/事件流 |
| E2B Sandbox | 运行环境 | 执行代码、运行 Playwright + n.eko | 产物 + 画面 |
| n.eko | 画面转发 | 输出浏览器实时画面 | 调试预览 |

---

## 7. 现有交互消息类型（关键）

- `status_update`：阶段/状态变化
- `agent_message`：自然语言解释/规划
- `plan_generated`：执行计划
- `opencode_event`：OSAC/OpenCode 事件
- `opencode_status`：OpenCode session 状态
- `opencode_error`：执行错误
- `auto_plan`：用户主动选择“自主规划”（无需澄清）

---

## 8. 当前瓶颈与注意事项（供批注）

- 状态机已统一入口，但仍需评估是否需要合并 `stage`/`phase` 为单状态源
- Playwright 及 n.eko 必须共享 CDP 9222，否则用户端画面为空
- 若 OpenCode 执行未产生文件变更，会阻断自动测试
- OSAC 执行模式存在 `command` 与 `opencode_remote` 两种，需要统一策略

---

## 11. 无澄清自动规划机制（新增）

为面向新手用户，系统支持**无人澄清自动继续**：

1. 当 Layer2 提出澄清问题时，系统进入 `waiting_user`。  
2. 若超时（默认 45 秒，可由 `TASK_CREATION_CLARIFY_TIMEOUT_MS` 配置），自动生成“默认假设”回复并继续规划。  
3. 用户可主动发送 `auto_plan` 指令跳过澄清，直接进入规划。  

此机制保证无须用户补充也能端到端完成任务。  

---

## 9. 可观测性落地点（管理后台）

管理后台可参考以下维度检查：
- 会话状态 / phase / stage
- 全链路时间线（status_update + opencode_event）
- LLM 调用轨迹（intent/planning/execution_plan）
- OSAC 消息流（OpenCode event / diff / tool / file）

---

## 10. 文档引用（代码来源）

- TaskCreationService：`oneceo/apps/api/src/agents/task-creation/task-creation-service.ts`
- OpencodeRemoteService：`oneceo/apps/api/src/services/opencode-remote-service.ts`
- Agents Layers：`oneceo/apps/api/src/agents/task-creation/layers/*`
- File Memory Store：`oneceo/apps/api/src/agents/task-creation/file-memory-store.ts`

```

