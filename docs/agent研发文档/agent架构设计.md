# 通用智能体架构设计（基于公开资料研究）

日期：2026-02-22

## 摘要（Executive Summary）
- 采用“事件驱动 + 多阶段流水线”的智能体架构，确保从意图识别到执行交付全链路可观测、可回放、可评估。
- 将“Agent 侧长记忆”和“OpenCode 执行侧长记忆”分层管理：前者记录意图、计划、决策、风险与用户偏好，后者记录工作区文件状态、命令轨迹、工具输出与回溯点。
- 以“工具规范化 + 结构化输出 + 评测闭环”为核心工程手段，降低工具调用错误并可持续优化。
- 引入“执行审查/质量门（Review Gate）”作为强制节点，支持自动复核 + 人工复核的可插拔策略。
- 面向端到端交付设计“编排器—执行器—审查器”三段式协作，默认支持单任务多回合迭代。

## 研究来源（覆盖 Google / Manus / Claude / OpenAI / Meta）
| 机构 | 资料 | 核心启示 |
|---|---|---|
| OpenAI | New tools for building agents（2025-03-11） | 提供 Responses API + 内置工具 + Agents SDK + 可观测性，强调构建可编排、多工具、可追踪的 agent 体系 |
| OpenAI | Agents SDK 文档 | 代理可使用工具、handoff、流式输出、完整 trace | 
| OpenAI | Function Calling 指南 | 结构化输出（strict: true）提高工具调用可靠性 | 
| Anthropic | Writing tools for agents | 工具描述要精确、可评测；工具错误输出需可行动；强调评估与工具指标 | 
| Anthropic | Computer Use Tool | 推荐“agent loop + sandbox 环境”，工具动作与回传形成闭环 | 
| Google | ADK Runtime / Event Loop | 事件驱动运行时：Runner 作为 orchestrator，Agent/Tool 以事件形式推进 | 
| Meta | Llama 3.1 Model Card | 模型支持工具调用，强调工具安全与评测 | 
| Manus | arXiv 2505.02024 | 通用 agent 结合规划与执行，实现端到端任务完成 | 

## 目标与约束
1. 通用智能体：支持跨任务类型，具备端到端交付能力。
2. 长记忆体系：Agent 侧 + OpenCode 执行侧双层记忆。
3. 意图识别：对用户输入进行任务类型判定与任务摘要生成。
4. 质量审查：对完成产物进行校验、复核与解释。
5. 可观测：每一步工具调用/决策/输出可追踪、可回放。

## 核心架构（逻辑视图）

用户输入
  → Intent Agent（意图识别）
  → Planner Agent（任务拆解与计划）
  → Orchestrator（事件驱动调度）
  → Executor（OpenCode / OSAC / Sandbox）
  → Review Agent（质量审查）
  → Delivery（结果交付与后续追问）

### 关键模块说明

1. **Intent Agent（意图识别）**
   - 输入：用户对话文本 + 历史上下文
   - 输出：任务类型、目标、约束、风险标签
   - 产出进入 Agent 侧记忆，用于后续规划与执行

2. **Planner Agent（规划与拆解）**
   - 产出：计划树（步骤、依赖、工具）、执行顺序、验证点
   - 计划需可视化（前台对用户展示简化版计划）

3. **Orchestrator（调度器）**
   - 事件驱动：Runner ↔ Agent ↔ Tool 通过事件流推进（参考 ADK Event Loop）
   - 负责：状态机、重试策略、超时、分阶段推进

4. **Executor（执行器）**
   - OpenCode 与 OSAC 通过 SSE/WS 回传实时操作
   - 需要记录：命令、文件写入、工具调用、错误

5. **Review Agent（审查）**
   - 自动审查 + 人工审查可选
   - 输出：完成度、风险、下一步优化建议

6. **Delivery（交付与闭环）**
   - 面向用户展示最终产物 + 操作轨迹摘要
   - 提供“继续修改 / 追加需求”入口

## 长记忆体系设计

### A. Agent 侧记忆（策略层）
- **语义记忆**：用户偏好、组织约束、项目背景
- **任务记忆**：计划、阶段状态、决策理由
- **评估记忆**：失败原因、工具错误、优化经验
- 存储建议：向量库 + 结构化状态库（task_session / plan / decision / review）

### B. OpenCode 执行侧记忆（工作层）
- **工作区记忆**：文件树、修改 diff、产物列表
- **执行轨迹**：命令、工具输出、异常日志
- **恢复点**：可回溯的 checkpoint（用于 resume）
- 存储建议：工作区目录隔离 + 执行日志库

### C. 同步策略
- Orchestrator 在阶段边界同步记忆：
  - 执行后 → 更新产物/错误
  - 审查后 → 写入评估结论
  - 用户反馈 → 更新偏好与后续计划

## 任务流水线与状态机

状态机示例：
- `created` → `intent_collected` → `planned` → `executing` → `reviewing` → `completed`
- 失败时可进入：`blocked` / `need_user` / `retrying`

关键决策点：
- 是否需要澄清问题
- 是否可以自动执行
- 是否需要人工确认（高风险工具调用）

## 工具与执行体系

1. **工具规范化**
   - 工具描述、参数命名、返回格式必须明确
   - 结构化输出强制：工具参数严格 schema
   - 工具响应要“可行动”而非 opaque error

2. **OpenCode / OSAC 执行**
   - OSAC → OpenCode 通过 SSE 转发执行状态
   - SSE 内容要区分：tool event / diff event / message event

3. **安全边界**
   - 执行环境隔离（sandbox / VM）
   - 工具调用审计、行为白名单

## 可观测与评测

1. **Trace & Timeline**
   - 每个事件记录：来源、阶段、类型、payload、时间
   - 前台：简化版；后台：完整 trace

2. **评测体系**
   - 自动评测集：模拟真实用户任务
   - 指标：成功率、工具错误率、执行时长、token 消耗
   - 失败回放 → 提炼“改进规则”

## 结合当前 oneceo 平台的落地点

- **编排器**：沿用现有任务创建与阶段推进框架，补齐事件驱动调度
- **OSAC**：负责 SSE/WS 转发，将执行轨迹变成可观测事件
- **OpenCode**：作为执行层，必须输出完整的工具调用/文件 diff/命令日志
- **前台 UI**：实时渲染操作轨迹 + 最终交付产物
- **管理后台**：聚合全链路日志、LLM 调用轨迹、工具调用轨迹

## 后续建议（MVP）
1. 完成 SSE 结构化事件分类（tool / file / message）
2. 增加 Review Agent 作为强制流程节点
3. 引入长记忆存储（向量库 + 结构化状态库）
4. 构建评测集（真实任务 + 失败案例）
5. 管理后台提供全链路 trace 回放

## 参考资料
- OpenAI: https://openai.com/index/new-tools-for-building-agents/
- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/agents/
- OpenAI Function Calling: https://help.openai.com/en/articles/8555517-function-calling-updates
- Anthropic Writing Tools: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/writing-tools
- Anthropic Computer Use: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use
- Google ADK Runtime: https://google.github.io/adk-docs/runtime/
- Google ADK Event Loop: https://google.github.io/adk-docs/runtime/event-loop/
- Meta Llama 3.1 Model Card: https://huggingface.co/meta-llama/Meta-Llama-3.1-70B-Instruct
- Manus (arXiv): https://arxiv.org/abs/2505.02024
