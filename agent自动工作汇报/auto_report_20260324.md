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
- 继续收口了 Altus managed 的原子消息：
  - 同一个 `toolCallId` 现在会用稳定 `messageKey` 做 started/completed/failed 原位更迭
  - 聊天页新增 Altus 专用紧凑工具卡片，不再把 managed 工具事件继续塞进 direct mode 的通用执行器样式
  - `artifact_updated` 改成轻量 review 胶囊，避免混入普通正文
- 新增了 `11_Altus与Suna调度架构差异整改清单.md`：
  - 把 Altus 当前实现与 `suna` 在 run 入口、coordinator、state、ownership/idempotency、manager assembly、tool execution engine、event writer、前端 hook 拆分上的差异逐点列清
  - 每个整改点都补了 `oneceo 当前代码位置 + suna 参照代码位置 + 目标结构`
  - 作为后续继续重构 Altus managed 的直接开发索引
- 已开始按整改清单进入代码拆分：
  - 新增 `apps/api/src/services/altus-managed-run-entry-service.ts`
  - 新增 `apps/api/src/services/altus-run-coordinator.ts`
  - 新增 `apps/api/src/services/altus-run-state.ts`
  - 新增 `apps/api/src/services/altus-run-lifecycle-service.ts`
  - 新增 `apps/api/src/services/altus-run-event-writer.ts`
  - 新增 `apps/api/src/services/altus-managed-setup-service.ts`
  - 新增 `apps/api/src/services/altus-managed-shared.ts`
  - `apps/api/src/services/altus-managed-run-service.ts` 已改为兼容出口，routes 无需变更
  - 当前这轮目标是“先完成结构性拆分，不改变 managed API 形态”

## 本轮验证

- `apps/web` 的 `pnpm check` 已通过。
- 用最小假环境变量执行了：
  - `pnpm --filter api exec tsx -e "import('./src/services/altus-managed-run-service.ts')..."`
  - `pnpm --filter api exec tsx -e "import('./src/routes/altus-managed-routes.ts')..."`
- 两个新 backend 模块都能正常装配；直接空环境导入会被仓库既有的 `DATABASE_URL` 启动守卫拦截，这不是本轮新增问题。
- 追加验证：
  - `DATABASE_URL=... pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "altus-managed|task-session-run|taskCreationManagedRun|useTaskCreationAgent"` 无新增命中
  - 说明本轮新增的 managed mode 文件没有留下新的显性 TypeScript 报错
  - 本轮继续追加：
    - `DATABASE_URL=... pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "altus-managed|altus-run|task-session-run|altusManaged"` 无新增命中

## 新增工作记录：LLMAPI 协议兼容层

- 排查了当前平台实际使用的 LLM 上游口径，确认代码和文档里仍混用 `hone`、Cloudflare AI Gateway 与 `llmapi.oneceo.ai`。
- 本地实测确认：
  - `llmapi.oneceo.ai` 的 OpenAI-compatible `chat/completions` 当前返回 `503`
  - `llmapi.oneceo.ai` 的 Anthropic 原生 `v1/messages` 可正常返回 `200`
- 基于以上结论，新建设计文档 `docs/agent研发文档/LLMAPI统一供应商与协议兼容层设计.md`。
- 设计结论：
  - 后续统一使用 `llmapi.oneceo.ai` 作为唯一 LLM 供应商入口
  - 在 `.env` 中新增上游协议类型配置：`openai` / `anthropic`
  - 平台内部继续统一维持 OpenAI-compatible 调用口径，由 `llm-proxy` 负责向 Anthropic 原生协议做转换
- 已完成代码实现：
  - `apps/api/src/connectors/llm-proxy-connector.ts` 新增 `LLM_PROXY_UPSTREAM_API_TYPE`
  - `anthropic` 模式下将 `/v1/chat/completions` 转换为上游 `/v1/messages`，并把响应映射回 OpenAI-compatible `chat.completion`
  - `apps/api/src/agents/base-agent.ts` 默认改走本地 `llm-proxy`，避免后端内部链路直连旧上游
  - `apps/api/src/services/sandbox-agent-provision-service.ts` 与 `apps/api/src/scripts/e2b-sandbox-verify.sh` 已支持按 `openai|anthropic` 分支验证
  - `apps/.env` / `apps/.env.example` 已将 `LLM_PROXY_UPSTREAM_BASE_URL` 统一切到 `https://llmapi.oneceo.ai`
- 本轮实测结果：
  - `anthropic` 模式下，经新兼容层请求 `POST /v1/chat/completions` 返回 `200`，并成功映射为 OpenAI-compatible 响应
  - `openai` 模式下，`GET /v1/models` 返回 `200`，`POST /v1/chat/completions` 仍返回 `503`，与上游现状一致

## 新增工作记录：Altus managed 单元测试

- 为本轮拆出的 managed 后端服务补了定向单元测试：
  - `apps/api/tests/altus-managed-run-entry.service.test.ts`
  - `apps/api/tests/altus-run-lifecycle.service.test.ts`
  - `apps/api/tests/altus-run-coordinator.test.ts`
  - `apps/api/tests/llm-proxy-connector.test.ts`
- 当前覆盖的关键分支：
  - `startRun` 会创建 run、写入时间线、发送 `run_ack` 并启动 coordinator
  - `stopRun` 在存在活动 controller 时会中断当前 run
  - `markCompleted` 会更新 run 状态、会话生命周期并发送 `run_completed`
  - `markFailed` 会写错误时间线并发送 `run_failed`
  - `execute` 会在工具调用后继续收敛到最终 assistant 完成态
  - `execute` 会在 `ask_user` 分支进入 `waiting_user`
  - `llm-proxy` 的 Anthropic 分支会把 OpenAI-compatible `tools/tool_calls/tool` 正确映射到 `tools/tool_use/tool_result`
  - Anthropic `tool_use` 响应会正确映射回 OpenAI-compatible `message.tool_calls`
  - 指定 `tool_choice=function:name` 时会正确映射到 Anthropic `{ type: "tool", name }`
  - `tool_result` 错误输出会正确标记 `is_error`
- 已执行：
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsx --test tests/altus-managed-run-entry.service.test.ts tests/altus-run-lifecycle.service.test.ts tests/altus-run-coordinator.test.ts`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsx --test tests/llm-proxy-connector.test.ts tests/altus-managed-run-entry.service.test.ts tests/altus-run-lifecycle.service.test.ts tests/altus-run-coordinator.test.ts`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "llm-proxy-connector|altus-run|altus-managed|llm-proxy"`
- 结果：
  - `llm-proxy` 定向测试 `3/3` 通过
  - Altus managed 相关组合测试 `8/8` 通过
  - 首次执行曾因未注入 `DATABASE_URL` 被仓库既有启动守卫拦截，补上测试环境变量后已正常通过
  - `rg` 无命中，说明本轮新增的 `llm-proxy` / `altus-managed` 相关文件没有新增显性 TypeScript 报错

## 新增工作记录：Altus managed 工具协议修复

- 定位到当前“聊天框直接输出完整代码、不走工具调用”的根因不在 coordinator，而在 `apps/api/src/connectors/llm-proxy-connector.ts` 的 Anthropic 分支。
- 旧实现只支持纯文本 `chat/completions -> /v1/messages` 转换，没有转换：
  - `tools`
  - `tool_choice`
  - `assistant.tool_calls`
  - `tool role`
  - Anthropic `tool_use`
- 这会导致 Altus managed 在 `LLM_PROXY_UPSTREAM_API_TYPE=anthropic` 下天然退化成纯文本回答。
- 已完成修复：
  - OpenAI-compatible `tools` -> Anthropic `tools`
  - `assistant.tool_calls` -> `tool_use`
  - `tool` role -> `tool_result`
  - Anthropic `tool_use` -> OpenAI-compatible `message.tool_calls`
  - `stop_reason=tool_use` -> `finish_reason=tool_calls`
  - Anthropic 流式 SSE：
    - `message_start`
    - `content_block_start`
    - `content_block_delta`
    - `message_delta`
    - `message_stop`
    - `error`
    现在会映射为 OpenAI-compatible `chat.completion.chunk`
- 同时收紧了 `apps/api/src/services/altus-managed-prompt-service.ts`：
  - 明确要求“修改 workspace 时必须先走工具，不允许把完整实现直接贴回聊天框”
- 当前核查结论：
  - 对 Altus managed 真正使用到的能力，`openai` 与 `anthropic` 现在已对齐：
    - 非流式 `chat/completions`
    - `system/user/assistant/tool` 消息链
    - `tools`
    - `tool_choice`
    - `tool_use/tool_result`
    - `finish_reason=tool_calls`
    - 流式 `chat.completion.chunk`
  - 仍未对齐、且当前没有实现的点：
  - 多模态 block 映射
  - `responses` API
  - Anthropic `server_tool_use / web_search / code_execution` 等内建服务型工具映射
  - 这些未对齐项当前不影响 Altus managed 主链，因为 Altus managed 现在固定 `stream: false` 且只走文本+工具调用

## 新增工作记录：Altus 网页产物完成卡片

- 按 `suna` 的 `CompleteToolView -> FileAttachment -> HtmlRenderer/IframePreview` 设计路径，先在 oneceo 落地第一阶段网页产物闭环。
- 后端改动：
  - `apps/api/src/routes/task-creation-routes.ts`
    - 新增 `/api/task-creation/sessions/:sessionId/workspace/raw/*`
    - Altus workspace 读取统一改走 E2B 分支，不再误落到 OpenCode 分支
    - 补充了 `html/css/js/json/csv/xml/yaml` 等 MIME 推断
  - `apps/api/src/services/altus-run-coordinator.ts`
    - `tool_call_completed / tool_call_failed` 现在显式带回 `arguments`
- 前端改动：
  - `apps/web/client/src/lib/task-creation-client.ts`
    - 新增 `getWorkspaceRawFileUrl(...)`
  - `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`
    - 新增 `Preview / Code / Open` 完成卡片
  - `apps/web/client/src/pages/Home.tsx`
    - 把 managed `write_file` 完成事件聚合成 run 级 `managed_artifact_card`
    - 在 `run_completed` 前插入最终产物卡片
    - 同时修正 `outputPreview` 的字符串解析，避免工具摘要丢失结构化信息
- 文档已同步：
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/12_Suna预览卡片与Altus产物预览对齐设计.md`
- 本轮验证：
  - `pnpm --filter web check` 通过
  - `pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "AltusArtifactPreviewCard|task-creation-routes\\.ts\\(47|task-creation-routes\\.ts\\(48|altus-run-coordinator|workspace/raw|isE2bWorkspaceExecutor|parseManagedToolOutputPreview"` 无命中
  - API 全量 `tsc` 仍存在仓库内既有错误，未由本轮新增文件引入
- 已按要求把未实现项显式写入：
  - `docs/agent研发文档/LLMAPI统一供应商与协议兼容层设计.md`
- 并同步提取到：
  - `todos.md`
  - 标注日期 `2026-03-24`
  - 管理文档为 `LLMAPI统一供应商与协议兼容层设计.md`

## 新增工作记录：Altus managed 闭环终止修复

- 继续排查发现 Altus managed 仍会在“执行了一次工具后，模型输出一句说明性文本”时直接结束 run。
- 根因在 `apps/api/src/services/altus-run-coordinator.ts`：
  - 旧逻辑把 `tool_calls.length === 0` 直接判定为正常完成
  - 这会导致模型只要输出“我开始创建 2048 游戏”之类的普通正文，run 就被错误收尾
- 参照 `suna` 的显式 terminating tool 模式，完成了以下调整：
  - 在 `apps/api/src/services/altus-managed-shared.ts` 新增 `complete_task` tool definition
  - 在 `apps/api/src/services/altus-managed-tool-runtime.ts` 新增 `complete_task` 运行结果类型 `complete`
  - 在 `apps/api/src/services/altus-managed-prompt-service.ts` 明确要求：
    - 普通 assistant 文本不能结束 managed run
    - 只有在实际完成并验证后才能调用 `complete_task`
  - 在 `apps/api/src/services/altus-run-coordinator.ts` 改为：
    - `complete_task` 是唯一正常完成信号
    - 遇到普通 assistant 文本但没有 tool calls 时，不再直接完成
    - coordinator 会把该响应作为中间轮次，并追加系统提醒继续调用工具或显式 `complete_task`
- 补了两条关键单元测试到 `apps/api/tests/altus-run-coordinator.test.ts`：
  - “工具轮次后必须通过 `complete_task` 才能完成”
  - “普通 assistant 文本不会自动完成，会继续下一轮直到 `complete_task`”
- 已执行：
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsx --test tests/altus-run-coordinator.test.ts`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsx --test tests/llm-proxy-connector.test.ts tests/altus-managed-run-entry.service.test.ts tests/altus-run-lifecycle.service.test.ts tests/altus-run-coordinator.test.ts`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "altus-run-coordinator|altus-managed-tool-runtime|altus-managed-shared|altus-managed-prompt-service|altus-run-coordinator.test"`
- 结果：
  - coordinator 定向测试 `3/3` 通过
  - Altus managed 相关组合测试 `12/12` 通过
  - 类型检查过滤 `rg` 无命中，说明这轮相关文件没有新增显性 TypeScript 报错

## 新增工作记录：Altus managed 工具原子消息交互优化

- 继续收紧了 Altus managed 对话页中的工具调用显示，目标是把其表现从“大块执行卡片”调整为真正的原子消息。
- 已更新设计文档 `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`：
  - 原子消息主形态应为紧凑胶囊/芯片

## 新增工作记录：Suna 预览卡片与 Altus 产物预览研究

- 按用户要求，重新回到 `referance/suna` 源码，对“过程预览 + 最终完成卡片 + HTML iframe 预览”这条链路做了一轮完整研究。
- 这轮确认的关键结论：
  - `suna` 的最终完成卡片不是普通 assistant markdown，而是 `CompleteToolView` 对 `complete` 工具结构化参数的渲染。
  - 过程预览不是单点组件，而是三层结构：
    - `chat-snack.tsx + floating-tool-preview.tsx`
    - `ThreadContent.tsx + ShowToolStream.tsx + ToolCard.tsx`
    - `CompleteToolView.tsx + FileAttachment + HtmlRenderer`
  - HTML 预览不是基于文本 API 响应临时拼接，而是基于 `sandbox_url + filePath` 生成真实 iframe URL，这样相对资源才能正常工作。
- 新增专题文档：
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/12_Suna预览卡片与Altus产物预览对齐设计.md`
- 文档里已经明确写出：
  - `suna` 的三层预览结构
  - 相关源码路径
  - oneceo 当前已有能力
  - oneceo 当前缺口
  - 后续实现 Altus 产物卡片时必须补的后端 raw file route 与前端 artifact model
- 同时补了索引与前端章节回链：
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/README.md`
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`
- 本轮只完成代码级研究与设计文档整理，没有开始这部分的 UI/后端实现。
  - hover 时展示工具用途、目标对象、输入/输出摘要与失败原因
  - hover 层只展示高价值摘要，不直接倾倒完整 JSON
- 已在 `apps/web/client/src/pages/Home.tsx` 完成实现：
  - `managed_tool` 主消息改为紧凑胶囊式按钮
  - hover 使用 `HoverCard` 展示更完整的介绍信息
  - 点击仍保留原有 detail dialog，用于查看完整详情
  - 新增 `getManagedToolDisplayName(...)`
  - 新增 `formatManagedToolPreview(...)`
  - 重写 `formatManagedToolDetail(...)`，把原 JSON 详情改为更可读的结构化文本
- 当前工具原子消息在主流中只保留：
  - 工具名
  - 状态
  - 摘要
- hover 层补充：
  - 中文动作名称
  - 原始工具名
  - 结果摘要
  - 更多信息预览
  - 点击查看完整详情提示
- 已执行：
  - `pnpm --filter web check`
- 结果：
  - 前端类型检查通过

## Altus 三层预览补充研究（Actions / Files / Replay）

- 继续深挖 `suna` 的预览体系，确认用户提供的 `Actions / Files / Prev / Next / Jump to Latest` 抽屉不属于 `CompleteToolView`，而是独立的 `KortixComputer` 链路：
  - `referance/suna/apps/frontend/src/components/thread/kortix-computer/KortixComputer.tsx`
  - `referance/suna/apps/frontend/src/stores/kortix-computer-store.ts`
  - `referance/suna/apps/frontend/src/components/thread/kortix-computer/components/NavigationControls.tsx`
  - `referance/suna/apps/frontend/src/components/thread/kortix-computer/FileBrowserView.tsx`
  - `referance/suna/apps/frontend/src/hooks/messages/useThreadToolCalls.ts`
- 已把该链路补进专题设计文档：
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/12_Suna预览卡片与Altus产物预览对齐设计.md`
- 文档新增内容包括：
  - `Actions / Files` 查看器源码入口
  - replay state model
  - oneceo 目标组件与状态字段
  - 从 `managed_tool` 原子消息跳到 replay step 的联动要求
- 同步更新：
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`
  - `docs/agent研发文档/Altus接管模式参照Suna重构设计/README.md`
- 本轮仍停在文档层，未开始这部分代码实现，等待用户确认后继续开发。

## Altus Actions / Files / Replay 第一版实现

- 已新增：
  - `apps/web/client/src/components/AltusRunReplayDrawer.tsx`
- 已在 `apps/web/client/src/pages/Home.tsx` 接入：
  - managed run 级 `replay actions / files` 聚合
  - 从 `managed_tool` 原子消息点击后打开 replay drawer
  - 自动定位到对应 `toolCallId` 的 step
  - `Actions / Files`
  - `Prev / Next / Jump to Latest`
- `Files` 视图当前复用了已有：
  - `AltusArtifactPreviewCard`
  - 直接显示网页类 `Preview / Code / Open`
- 已执行：
  - `pnpm --filter web check`
- 结果：
  - 前端类型检查通过
- 当前仍未覆盖：
  - 输入区附近的 floating preview
  - 过程中的流式 richer preview

## Altus 产物卡片文件读取修复

- 用户反馈 `AltusArtifactPreviewCard` 在 `Code` 标签读取 `game.js` 时出现 `request failed: 409`
- 排查结果：
  - 问题不在卡片本身，而在后端 `workspace/file` 与 `workspace/raw` 路由对 Altus/E2B 也沿用了 `runtimeStatus !== ready` 的门禁
  - Altus 文件读取实际直走 E2B，这层门禁会误判，导致 `Code / Open / iframe preview` 在 run 完成后被挡住
- 已修复：
  - `apps/api/src/routes/task-creation-routes.ts`
  - 对 `Altus / Codex` 这类 E2B workspace executor，读取文件时不再强依赖非 E2B 的 runtime ready 状态
- 已执行：
  - `pnpm --filter web check`
  - `pnpm --filter api exec tsc --noEmit --pretty false 2>&1 | rg "task-creation-routes\\.ts|workspace/file|workspace/raw"`
- 结果：
  - 前端检查通过
  - API 侧仍有仓库内既有的 `task-creation-routes.ts` 历史类型错误，但这轮改动附近没有新增与 `workspace/file/raw` 相关的新报错

## Altus 产物卡片样式收口

- 继续优化：
  - `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`
- 已调整：
  - 非网页文件不再显示禁用的 `Preview` 标签
  - 非网页文件不再强占网页预览高度，改为更贴近代码查看器的卡片高度
- 已执行：
  - `pnpm --filter web check`
- 结果：
  - 前端类型检查通过

## Altus 最终网页卡片与内部预览收口

- 用户进一步明确：
  - 最终完成卡片不是代码文件展示器
  - 它只应该承载网页类产物预览
  - 右上角按钮应进入 oneceo 内部右侧 preview viewer
- 已调整：
  - `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`
    - 新增 `displayMode`
    - `web-preview` 模式下只保留 HTML 产物
    - 恢复右上角 `Open in viewer` 按钮，并改为内部 viewer 语义
  - `apps/web/client/src/components/OpencodePreviewPanel.tsx`
    - 新增 `selectedWorkspacePath` 受控入口，允许外部直接打开指定 workspace 文件
  - `apps/web/client/src/pages/Home.tsx`
    - 新增 `openWorkspacePreview(path)` 统一入口
    - 最终 `managed_artifact_card` 只在 run 完成后展示网页类产物
    - 点击最终卡片右上角按钮时，打开 oneceo 右侧文件预览面板并定位到对应 HTML 文件
    - replay `Files` 视图的 `Open` 也改走内部 preview 链路
- 已执行：
  - `pnpm --filter web check`
- 结果：
  - 前端类型检查通过
