# 03 对话线程与 AgentRun 编排

## 1. 总体编排模型

Altus managed 重构后采用和 Suna 相同的基本运行模型：

- 先有 `session`
- 再有 `run`
- 一条用户消息对应一次新的 `run`

不再采用当前：

- 用户消息直接进入 `TaskCreationService`
- `TaskCreationService` 内部串行跑完整条 managed 流程

## 2. 目标调用流程

### 2.1 前端发送消息

1. 前端确认当前模式为 `managed`
2. 前端将用户输入写入会话
3. 前端调用 `POST /api/altus-managed/sessions/:sessionId/runs`
4. 后端返回：
   - `runId`
   - `streamUrl`
   - `sessionId`

### 2.2 后端启动 run

后端收到 start-run 请求后执行：

1. 校验 session 归属
2. 写入用户消息
3. 创建 `altus_managed_run`
4. 固化 connector snapshot
5. 固化 sandbox binding
6. 异步启动 `AltusManagedRunner.execute(runId)`

### 2.3 Runner 内部执行

Runner 的最小职责链：

1. 加载 session 历史
2. 构建 prompt context
3. 装配工具
4. 启动模型循环
5. 产生 assistant/tool 事件
6. 落消息与事件
7. 标记 run 完成/失败/中断

## 3. Runner 子模块

建议按 Suna 风格拆为以下模块：

### 3.1 `SetupManager`

职责：

- 读取 session
- 读取用户身份
- 获取 connector snapshot
- 获取 sandbox binding
- 构造 run context

### 3.2 `PromptManager`

职责：

- 构建 system prompt
- 装配会话历史
- 注入连接器能力说明
- 注入 sandbox 能力说明

### 3.3 `ToolManager`

职责：

- 注册核心工具
- 注册 connector/MCP 工具
- 注册 E2B sandbox 工具

### 3.4 `ResponseProcessor`

职责：

- 处理 assistant 增量文本
- 处理 tool call
- 处理 tool result
- 将结果转换为标准消息与事件

### 3.5 `StatusManager`

职责：

- 管理 run 生命周期
- 负责 `queued / running / waiting_user / completed / failed / stopped`

## 4. 生命周期状态

### 4.1 Session 状态

managed mode 的 session 仅保留粗粒度状态：

- `idle`
- `running`
- `waiting_user`
- `completed`
- `failed`

### 4.2 Run 状态

run 状态单独管理：

- `queued`
- `starting`
- `running`
- `streaming`
- `waiting_tool`
- `waiting_user`
- `completed`
- `failed`
- `stopped`

### 4.3 中断与恢复

Suna 风格的做法是中断 `run`，不是中断 `session`。

因此 oneceo managed mode 改造后：

1. 停止动作只针对 `run`
2. session 仍然存在
3. 用户下一条消息会创建新 run
4. 若上一个 run 产生“待用户回答”的问题，则新 run 在上下文里读取该问题继续执行

### 4.4 工具结果后的继续执行约束

Altus managed mode 在 `tool_call_completed -> waiting_tool -> 下一轮模型推理` 之间必须满足以下约束：

1. 如果模型在读取最新 tool result 后直接返回“向用户追问”的纯文本，而不是 `tool_call`，coordinator 必须把该文本视为真实澄清请求，直接落成：
   - timeline `clarification_request`
   - run event `clarification_requested`
   - run/session 状态切到 `waiting_user`
2. 如果模型只返回说明性纯文本，但任务实际上未阻塞，coordinator 只允许追加一次 continuation reminder，强制模型立刻继续发起下一步 `tool_call` 或 `complete_task`。
3. 如果 reminder 之后模型仍然继续返回纯文本且不发 `tool_call`，必须直接判定为协议违规并结束当前 run，禁止无限循环“继续处理工具结果”。

这样做的目标不是兼容模型漂移，而是把 managed mode 的协议边界钉死，避免前端持续看到“继续处理工具结果”后最终才因为上游超时而失败。

### 4.5 上游瞬时故障重试

managed coordinator 对模型调用只允许做有界重试，不允许无上限等待：

- 可重试错误：`upstream_timeout`、`upstream_unavailable`、`fetch failed`、`network error`
- 默认重试次数：1 次
- 上限：3 次
- 每次重试之间做短暂退避，超过上限后立即按失败 run 收口

这一层的目标是吸收上游供应商的瞬时抖动，但不改变 managed mode 的状态机，也不把真实逻辑错误伪装成“自动恢复”。

## 5. Managed 模式不再保留的旧结构

以下结构不再作为 managed mode 主架构组成：

- `IntentRecognitionAgent`
- `PlanningAgent`
- `ExecutionPlanAgent`
- `TaskCreationService.createTask`
- `activeManagedRuns` 这类 WebSocket 进程内运行态

这些模块不是“小幅收敛”，而是被新 runner 架构直接替换。

## 6. 与 Suna 的结构映射

| Suna | oneceo managed |
|---|---|
| `/agent/start` | `POST /altus-managed/.../runs` |
| `execute_agent_run` | `AltusManagedRunner.execute` |
| `PipelineContext` | `AltusRunContext` |
| `thread_manager` | `AltusConversationManager` |

## 7. 设计结论

Altus managed 的“对话智能体”从这一层开始被定义为：

> 一个基于 session 历史上下文反复创建 run 的系统，而不是一个在 WebSocket 请求里同步推进三层 Agent 的系统。

## 8. Suna 代码参照

本篇编排设计对应的 `suna` 代码入口如下：

- `referance/suna/backend/core/agents/api.py` -> `start_agent_run(...)`
  - 对应 oneceo 未来的 `POST /altus-managed/.../runs` 启动入口。
- `referance/suna/backend/core/agents/api.py` -> `_background_setup_and_execute(...)`
  - 对应“HTTP 接口只负责创建 run，实际执行异步展开”的边界。
- `referance/suna/backend/core/agents/runner/setup_manager.py` -> `create_new_thread_records(...)`、`create_agent_run_record(...)`
  - 对应 `session` 与 `run` 的预备创建阶段。
- `referance/suna/backend/core/agents/runner/setup_manager.py` -> `write_user_message_for_existing_thread(...)`
  - 对应“先写消息，再启动 run”的顺序。
- `referance/suna/backend/core/agents/runner/executor.py` -> `execute_agent_run(...)`
  - 对应 oneceo 未来的 `AltusManagedRunner.execute(runId)`。
- `referance/suna/backend/core/agents/pipeline/context.py` -> `PipelineContext`
  - 对应 oneceo 未来的 `AltusRunContext`。
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/stateless.py` -> `StatelessCoordinator.execute(...)`
  - 对应“单一 coordinator 驱动整轮执行”，不是多层 agent 级联。
- `referance/suna/backend/core/agents/runner/services/status_manager.py` -> `StatusManager`
  - 对应 oneceo 未来 run 生命周期状态管理。
