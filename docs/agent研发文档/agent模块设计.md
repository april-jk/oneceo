# 通用智能体模块设计文档

日期：2026-02-22

本文基于 `agent架构设计.md` 进一步展开到可落地的模块设计，覆盖全链路设计、数据模型、接口与流程。

## 1. 设计范围与约束

- 单一通用智能体架构，支持多任务类型与端到端交付。
- 长记忆双层：Agent 侧（策略与语义） + OpenCode 执行侧（工作区与执行轨迹）。
- 必须具备：意图识别、规划、执行、审查、交付、可观测。
- 现阶段默认固定 VM（`test_session_manual_use`），后续再接入多 VM 分配。

## 2. 模块总览

| 模块 | 责任 | 输入 | 输出 |
|---|---|---|---|
| 会话管理（Session） | 任务会话生命周期与状态机 | 用户输入、系统事件 | 会话状态、阶段变更 |
| 意图识别（Intent Agent） | 任务类型与目标识别 | 用户消息 + 上下文 | intent 结构体 |
| 规划（Planner Agent） | 任务拆解与计划树 | intent + 约束 | plan 结构体 |
| 编排器（Orchestrator） | 事件驱动调度与推进 | plan + runtime + events | 调度决策、执行指令 |
| 执行层（Executor） | 具体执行与操作产物 | 执行指令 | SSE/WS 事件、产物 |
| 工具层（Tool Registry） | 工具标准化与策略 | tool schema | 调用与审计 |
| 长记忆（Memory） | 语义/执行记忆 | 事件与产物 | 可检索记忆 |
| 审查（Review Agent） | 结果质量检验 | 产物 + 计划 | review 结论 |
| 交付（Delivery） | 面向用户输出 | review + 产物 | 用户可读结果 |
| 观测（Trace/Logs） | 全链路追踪 | 所有事件 | timeline + 诊断 |
| 评测（Eval） | 回放与指标 | 会话数据 | 成功率与质量指标 |

## 3. 模块详细设计

### 3.1 会话管理（Session）

**目标**：提供任务生命周期管理，统一状态机与流程推进。

**核心职责**
- 创建新会话，不复用历史会话。
- 维护会话状态（created → intent_collected → planned → executing → reviewing → completed）。
- 支持 `blocked` / `need_user` / `retrying` 等中间状态。

**关键数据**
- `task_session`：id、status、stage、createdAt、updatedAt
- `runtime`：orchestratorSessionId、vmName、opencodeSessionId

**关键接口**
- `POST /tasks`：创建新会话
- `POST /tasks/:id/messages`：写入用户消息并触发意图识别
- `GET /tasks/:id`：获取会话详情

**错误处理**
- 强制幂等：多次点击“新建任务”不复用历史。
- 重要状态变更必须记入 Trace。

### 3.2 意图识别（Intent Agent）

**目标**：快速确定任务类型、目标、约束、风险。

**输入**
- 用户首条消息 + 近期上下文

**输出**
```json
{
  "intentType": "software_development",
  "objective": "...",
  "constraints": ["单文件", "HTML"],
  "riskTags": ["tool_write", "sandbox_exec"]
}
```

**执行策略**
- 若缺乏关键需求，进入 `need_user` 并生成澄清问题。
- 结果写入 Agent Memory。

### 3.3 规划（Planner Agent）

**目标**：生成可执行的任务树。

**输出结构**
- 计划树（步骤、依赖、工具、验证点）
- 计划摘要（供 UI 展示）

**示例**
```json
{
  "title": "贪吃蛇 HTML",
  "steps": [
    { "id": "s1", "tool": "write", "desc": "生成 snake.html" },
    { "id": "s2", "tool": "bash", "desc": "验证文件存在" }
  ]
}
```

### 3.4 编排器（Orchestrator）

**目标**：事件驱动调度，确保执行与反馈闭环。

**核心机制**
- 事件循环（Runner）：接收状态 → 决策下一步 → 产出命令
- 支持超时、重试、回滚

**关键逻辑**
1. 接收 `planned` 事件 → 启动执行
2. 执行中接收 SSE → 更新状态
3. 执行完成 → 进入 Review
4. Review 通过 → completed，否则回到执行

**输出**
- `osacCommand`：下发 OpenCode 指令
- `stage_update`：推进阶段

### 3.5 工具层（Tool Registry）

**目标**：统一工具描述、参数、调用方式。

**设计要点**
- 每个工具强制 schema
- 工具输出必须结构化：`ok / error / output`
- Tool 调用必须记录 `tool_call_id`

**典型工具**
- write / read / ls / grep / bash / webfetch
- apply_patch

### 3.6 执行层（Executor）

#### 3.6.1 OSAC

- 负责 WS/SSE 转发
- OpenCode 事件原样透传
- 聚合事件入 Trace

#### 3.6.2 OpenCode

- CLI 形式执行任务
- 产生 `message.part.updated` / `session.diff` / `tool` 等事件
- 输出需在前台实时展示

#### 3.6.3 Sandbox / VM

- 现阶段固定 VM
- 多会话需工作区隔离：`/opt/.altus/opencode/workspaces/{taskSessionId}`

### 3.7 长记忆系统

#### Agent 侧记忆（策略层）
- 语义记忆：偏好、约束、历史决策
- 任务记忆：计划、阶段、状态
- 评估记忆：失败原因、修复策略

**存储建议**
- 结构化表（SQL）
- 向量库（语义检索）

#### OpenCode 执行侧记忆（工作层）
- 工作区结构与文件 diff
- Tool 调用输出
- 失败回放点

**存储建议**
- 工作区隔离目录
- SSE 事件存档表

### 3.8 审查（Review Agent）

**目标**：确保交付质量。

**输入**
- 产物 + 计划 + 执行日志摘要

**输出**
```json
{
  "status": "pass",
  "issues": [],
  "recommendations": []
}
```

**策略**
- 自动审查：规则 + LLM
- 人工审查：高风险标记时触发

### 3.9 交付（Delivery）

**目标**：面向用户交付结果。

**内容**
- 最终产物摘要
- 操作轨迹摘要
- 下一步建议

**UI 行为**
- 实时事件流展示
- 最终交付应为静态结果，不再以流式形式回放

### 3.10 可观测与追踪

**Trace 结构**
- 每事件：id、source、category、payload、timestamp
- 管理后台应支持检索与回放

**强制记录**
- 任务阶段变更
- Tool 调用与输出
- 错误与重试

### 3.11 评测（Eval）

**目标**：建立可持续优化机制。

**指标**
- 成功率
- 工具错误率
- 执行时长
- token 消耗

**流程**
- 自动回放固定任务
- 对比产物差异
- 输出改进建议

## 4. 数据模型建议

### 核心表结构（示意）

#### task_sessions
- id (uuid)
- status
- stage
- created_at / updated_at

#### task_messages
- id
- session_id
- role
- content
- metadata (json)

#### task_plans
- id
- session_id
- plan_json

#### opencode_events
- id
- session_id
- event_type
- payload
- created_at

#### review_results
- id
- session_id
- status
- issues
- recommendations

#### memory_items
- id
- session_id
- memory_type (agent / execution)
- content

## 5. 关键流程（简化）

### 新建任务
1. 创建 Session
2. Intent Agent 识别
3. Planner 生成计划
4. Orchestrator 下发执行

### 执行流
1. OSAC 将命令下发到 OpenCode
2. OpenCode SSE 回传执行事件
3. Orchestrator 根据事件推进阶段

### Review Gate
1. 产物完成后进入 Review
2. Review 输出 pass/fail
3. 若 fail → 回到执行修正

## 6. 风险与控制

- **工具误用**：强制 schema + 审计
- **长记忆污染**：隔离 session + 定期清理
- **执行超时**：设定超时阈值 + 自动重试
- **模型不可用**：降级策略（只记录信息 + 暂停）

## 7. 后续落地清单

1. 完整实现 SSE 事件分类与 UI 渲染
2. 引入 Review Agent 与质量门
3. 建立 memory 存储结构
4. 管理后台提供 trace 回放
5. 构建最小 eval 集并定期回放

