# Altus接管模式参照Suna重构设计

日期：2026-03-24

本文档组仅覆盖 **Altus 接管模式（managed mode）** 的重构设计。

明确边界：

- 重构对象：`Altus 接管模式`
- 保持不动：`直通模式`
- 直通模式范围：`OpenCode / Codex / ClaudeCode` 现有链路全部保留
- Sandbox 前提：继续使用 `E2B`，不改为 Suna 的 sandbox 形态
- Sandbox 规则：凡是与 sandbox 内服务通信，仍需遵守 oneceo 的 `OSAC` 链路约束

本设计的目标不是在当前 Altus managed 链路上打补丁，而是直接将 managed mode 重构为一套参照 Suna 的：

- `会话(thread-like session)`
- `运行(agent run)`
- `单一事件流(stream)`
- `工具驱动执行(tool-driven execution)`
- `E2B sandbox tool runtime`

架构。

## 文档索引

| 模块 | 文档 | 说明 |
|---|---|---|
| M0 | `01_现状回顾与重构目标.md` | 当前 Altus managed 链路回顾、问题与重构目标 |
| M1 | `02_目标架构与核心对象.md` | 目标架构、核心对象、模块边界 |
| M2 | `03_对话线程与AgentRun编排.md` | 会话、运行、调度与生命周期 |
| M3 | `04_消息事件流与状态模型.md` | 消息持久化、流式事件、状态机 |
| M4 | `05_命令执行与E2B-Sandbox体系.md` | 命令执行体系、E2B 接入、OSAC 边界 |
| M5 | `06_工具_连接器_MCP装配.md` | Tool registry、Connector/MCP 装配 |
| M6 | `07_前端对话页与交互状态.md` | 前端 managed 对话页重构方案 |
| M7 | `08_数据模型_存储与迁移.md` | 数据模型、表结构、迁移边界 |
| M8 | `09_实施步骤_风险与验收.md` | 实施顺序、风险、验收标准 |
| M9 | `10_Suna智能体架构与提示词研究.md` | Suna 的 run 架构、提示词系统、tool/MCP 装配、mode 设计研究与源码依据索引 |
| M10 | `11_Altus与Suna调度架构差异整改清单.md` | Altus 当前实现与 Suna 在 run 调度、state、manager、execution engine、前端消息适配上的差异清单与代码级整改索引 |
| M11 | `12_Suna预览卡片与Altus产物预览对齐设计.md` | Suna 的过程预览、完成卡片、HTML iframe 预览，以及 `Actions / Files / replay` 查看器与 oneceo Altus 对齐设计 |
| M12 | `13_Suna流式执行链路与SSE事件流研究.md` | Suna 的 run 级 SSE、流式模型执行、tool output stream、前端重组机制，以及其与 oneceo 当前 `upstream_timeout` 问题的直接对照研究 |
| M13 | `14_对话消息附加内容引用样式优化_[20260404-2307已采用].md` | 对话消息中 `Skills / 附件` 的消息级引用样式优化方案，聚焦附加内容归属表达与统一视觉结构 |
| M14 | `15_输入框斜线引用与Token化交互优化_[20260405-1738已采用].md` | 输入框内 `/xxxx` 斜线引用、确认后 token 渲染、删除回退文本的交互方案，覆盖 skills 与 mcp |

除 `M9-M12` 的专题研究外，`M0-M8` 每篇文档末尾也必须提供对应的 `Suna 代码参照`，开发时优先按该模块末尾列出的源码入口回查，不允许只依据概念描述实现。

## 设计原则

1. `Altus managed` 与 `sandbox direct` 必须成为两条清晰分离的架构路径。
2. `managed mode` 不再复用当前 `TaskCreationService + 三层 Agent + file-memory-store` 作为主链路。
3. `managed mode` 直接引入 `session + run + stream + tool runtime` 结构，不保留旧链路回退。
4. `task_session` 在 managed mode 中承担 `thread` 角色，但运行对象必须独立为 `run`。
5. `file-memory-store` 不再作为 managed mode 的权威状态源。
6. `DB + run stream` 是 managed mode 的唯一权威状态体系。
7. `E2B` 是唯一 sandbox 执行底座；若访问 sandbox 内服务，仍通过 `OSAC`。
8. `mode` 在重构后的 managed mode 中仅作为对话输入侧的产品模式与 prompt 装配信号，不得演化成独立后端执行架构分支。

## 与 Suna 的对应关系

| Suna 概念 | oneceo managed 重构后概念 |
|---|---|
| `thread` | `task_session` |
| `agent_run` | `altus_managed_run` |
| `ThreadManager` | `AltusConversationManager` |
| `Runner / StatelessCoordinator` | `AltusManagedRunner / AltusRunCoordinator` |
| `ToolManager` | `AltusToolRegistry` |
| `MCPManager` | `AltusConnectorMcpManager` |
| `sandbox tools` | `E2BSandboxToolRuntime` |

## 本组文档结论

最终实现口径如下：

1. Altus managed 模式改造成一套独立的对话智能体架构。
2. managed 消息入口从“WebSocket 直连任务创建服务”改成“创建 run 并订阅 run stream”。
3. managed 命令执行从“OpenCode 远程执行补充到 Altus 编排后面”改成“Altus run 直接驱动工具运行时”。
4. direct mode 不参与本次重构，不共享新 runner，不被新状态机侵入。

## 当前已落地代码（2026-03-24）

第一轮代码重构已经开始落地，当前已经接入的主线如下：

1. `run + run_event + sandbox_binding + connector_snapshot` 数据对象已写入 oneceo：
   - `apps/api/src/db/schema.ts`
   - `apps/api/src/db/migrate.ts`
   - `apps/api/src/db/dao/task-session-run.dao.ts`
2. managed 独立事件流已接入：
   - `apps/api/src/services/altus-managed-stream-service.ts`
3. managed 独立 prompt / tool runtime / run service 已接入：
  - `apps/api/src/services/altus-managed-prompt-service.ts`
  - `apps/api/src/services/altus-managed-tool-runtime.ts`
  - `apps/api/src/services/altus-managed-run-service.ts`
  - 并已继续拆出：
    - `apps/api/src/services/altus-managed-run-entry-service.ts`
    - `apps/api/src/services/altus-run-coordinator.ts`
    - `apps/api/src/services/altus-run-state.ts`
    - `apps/api/src/services/altus-run-lifecycle-service.ts`
    - `apps/api/src/services/altus-run-event-writer.ts`
    - `apps/api/src/services/altus-managed-setup-service.ts`
    - `apps/api/src/services/altus-managed-shared.ts`
4. managed 独立 HTTP / SSE 路由已接入：
   - `apps/api/src/routes/altus-managed-routes.ts`
   - `apps/api/src/index.ts`
   - run stream 当前已补齐基于 `userId` 的订阅校验，避免无鉴权的 `EventSource` 直接暴露 run 事件
5. 前端 managed mode 已切到 `start run + stream run + stop run`：
   - `apps/web/client/src/lib/task-creation-client.ts`
   - `apps/web/client/src/hooks/useTaskCreationAgent.ts`
   - managed stream URL 已显式携带当前客户端 `userId`，与后端 run 所属 session 做一致性校验

这轮实现仍然遵守本索引页的边界：

- 只重构 `Altus managed mode`
- `OpenCode / Codex / ClaudeCode` 直通模式保持不动
- sandbox 仍然使用 `E2B`
- 与 sandbox 内服务的既有 direct-mode 通信仍维持 `OSAC` 约束
