# 2026-03-24 工作汇报

## 今天做了什么

- 回顾了 oneceo 当前 `Altus 接管模式` 的运行链路，确认其现状仍是 `WebSocket + TaskCreationService + 三层 Agent + file-memory-store/DB 双状态`。
- 对照 `referance/suna` 梳理了其 `thread + agent_run + stateless pipeline + tool runtime + MCP assembly` 架构。
- 新建 `docs/agent研发文档/Altus接管模式参照Suna重构设计/` 文档组，按索引拆分为总览、对象模型、run 编排、消息流、E2B sandbox、工具装配、前端、数据迁移和实施计划九个模块。
- 继续深挖了 `suna` 的默认智能体提示词、`PromptManager`、`ToolManager`、`MCPManager` 与前端 `mode` 数据流，并新增 `10_Suna智能体架构与提示词研究.md` 专章。
- 明确确认了 `suna` 的 `mode` 只是前端输入与 prompt shaping 层，不是后端独立执行架构；同时确认其默认 worker 采用 `单一主 system prompt + 动态上下文装配` 模式。
- 对 `suna` 做了最后一轮源码级复核，把关键判断全部补成“结论 + 代码依据 + 快速源码索引”，确保后续 Altus managed 开发时每个操作都有可回查的实现依据。
- 继续补齐了 `Altus接管模式参照Suna重构设计` 文档组的模块级 `Suna 代码参照`，让 `M0-M8` 每一篇都能直接回查到 `referance/suna` 的文件与关键函数，不再只依赖总研究文档。

## 遇到什么问题

- oneceo 现有 managed 与 direct 在前后端都存在明显耦合，尤其是消息入口、状态恢复和实时流协议层。
- 当前 managed 模式并不存在独立 `run` 对象，这意味着后续代码重构不能从局部补丁开始，必须先完成架构切面拆分。
- 如果不先把 `业务 mode` 与 `执行架构` 边界写清楚，后续重构很容易把前端产品 mode 再次错误地下沉成后端执行分支。

## 计划如何解决

- 下一步等待用户审核这组技术文档。
- 文档确认后，按 `run 数据模型 -> managed runner -> prompt manager -> E2B tool runtime -> 前端 managed hooks -> 删除旧 managed 主链路` 的顺序进入实现。

## 本轮代码落地补充

- 已开始把 Altus 接管模式从 `WebSocket + TaskCreationService` 主链拆出，接入新的 `HTTP start run + SSE run stream + stop run` 流程。
- 后端已新增：
  - `apps/api/src/routes/altus-managed-routes.ts`
  - `apps/api/src/services/altus-managed-run-service.ts`
  - `apps/api/src/services/altus-managed-prompt-service.ts`
  - `apps/api/src/services/altus-managed-tool-runtime.ts`
  - `apps/api/src/services/altus-managed-stream-service.ts`
  - `apps/api/src/db/dao/task-session-run.dao.ts`
- 前端 `apps/web/client/src/hooks/useTaskCreationAgent.ts` 与 `apps/web/client/src/lib/task-creation-client.ts` 已切 managed mode 到新 API，不再通过旧的 WS `user_input` 发 managed 消息。
- 当前 direct mode 仍保持原链路，未动 `OpenCode / Codex / ClaudeCode` 直通执行。
- 继续修掉了本轮新增的两个后端类型问题：
  - `apps/api/src/services/altus-managed-prompt-service.ts`
  - `apps/api/src/services/altus-managed-run-service.ts`
- 补齐了 managed run stream 的最小权限边界：
  - 前端 stream URL 显式带当前 `userId`
  - 后端 `apps/api/src/routes/altus-managed-routes.ts` 在订阅前校验 `run.sessionId -> session.userId`
- 调整了设置弹窗的模式联动：
  - `Altus 接管模式` 下不再显示执行器选择
  - `执行器选择` 只在 `直通模式` 下显示，避免把 managed mode 错误理解成依赖 OpenCode / Codex / ClaudeCode
- 修复了发送消息时报 `task_creation_sessions.id` 查询失败的问题：
  - 根因是前端在 `crypto.randomUUID` 不可用时回退到了 `session_xxx` 这种非 UUID 字符串
  - 现已改成合法 UUID fallback，managed 与 direct 两条发送入口统一处理
- 修复了 `task_session_runs` 查询失败的问题：
  - 根因是 API 启动时只执行了连接器相关迁移，没有在 listen 前确保整套 `runMigration()` 完成
  - 现已改成启动前等待完整迁移完成，再开始接收请求
- 继续修了 managed run 首轮即失败的问题：
  - 根因是发给上游模型的 tool parameter schema 过于宽松，被 provider 转成 `custom.input_schema` 后直接判定非法
  - 现已把 managed tools 的 `parameters` 全部收紧成显式 JSON Schema，并统一加上 `additionalProperties: false`
- 继续修了 managed 对话身份串线问题：
  - 根因一是 managed prompt 对底层模型身份约束不够，导致模型会自报 `Claude`
  - 根因二是前端把 managed tool 事件沿用了 `executor_event -> Codex` 的直通渲染链
  - 现已在 `apps/api/src/services/altus-managed-prompt-service.ts` 强制 Altus 身份口径
  - 现已在 `apps/web/client/src/hooks/useTaskCreationAgent.ts` 为 managed 事件显式标记 `executor=altus`
  - 现已在 `apps/web/client/src/pages/Home.tsx` 按执行器动态渲染，不再把 managed 事件硬编码成 `Codex`

## 本轮验证

- `apps/web` 的 `pnpm check` 已通过。
- 用最小假环境变量执行了：
  - `pnpm --filter api exec tsx -e "import('./src/services/altus-managed-run-service.ts')..."`
  - `pnpm --filter api exec tsx -e "import('./src/routes/altus-managed-routes.ts')..."`
- 两个新 backend 模块都能正常装配；直接空环境导入会被仓库既有的 `DATABASE_URL` 启动守卫拦截，这不是本轮新增问题。
- 追加验证：
  - `DATABASE_URL=... pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "altus-managed|task-session-run|taskCreationManagedRun|useTaskCreationAgent"` 无新增命中
  - 说明本轮新增的 managed mode 文件没有留下新的显性 TypeScript 报错
