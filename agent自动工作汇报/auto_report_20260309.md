## 2026-03-09

- 做了什么：
  - 修复 `apps/api/src/services/sandbox-activity-service.ts` 中 `markSandboxDirty` 重复导出导致的编译失败。
  - 合并重复实现时保留“标记 dirty”与“刷新 lastActiveAt/lastActiveReason”两类语义。
  - 给 API 入口补充 `SIGINT` / `SIGTERM` 优雅退出与 `httpServer error` 处理，减少热重启时 `4000` 端口残留占用。
  - 给任务创建 `WebSocketServer` 增加 `error` 监听，避免未处理错误事件直接打爆进程。
- 遇到什么：
  - 单独导入 API 模块时如果不显式加载 `apps/.env`，会先因为缺少 `DATABASE_URL` 失败，影响最小验证。
  - `EADDRINUSE` 既可能来自代码编译失败后的 watch 重启循环，也可能来自旧进程未及时释放端口。
- 计划如何解决：
  - 继续用“模块导入 + 备用端口启动/退出”做最小验证，避免直接干扰当前 4000 端口上的开发进程。
  - 若后续仍出现 4000 被占住，再继续排查是否存在额外终端或 GUI 同时拉起 API 的场景。

## 2026-03-09 补充

- 做了什么：
  - 先对比 `e080c24` 到当前分支的聊天主链路差异，再转到本机运行态排查。
  - 直接运行 `apps/api/tests/opencode-sandbox-direct` 的前两个场景，确认后端在这台 Mac 上可以完成“首条消息建立会话 + 第二条消息继续同会话执行”。
  - 再用浏览器自动化在本机页面上实际发送第一、第二、第三条消息，确认 Chromium 中页面也能正常续聊并收到 `three-ok`。
  - 在这个过程中定位到两个前端/浏览器层风险点：首次 SSE 订阅可能因为未 hydrate 会话而返回 `404`；SSE 失败时前端仍可能继续偏好 SSE，导致 WS 兜底不稳定。
  - 已补充修复：`apps/api/src/routes/task-creation-routes.ts` 的 SSE 路由改为走 `resolveTaskSessionRecord`；`apps/web/client/src/hooks/useTaskCreationAgent.ts` 改为仅在 SSE 真正连上后才偏好 SSE，并在 SSE 出错时回退到 WS。
- 遇到什么：
  - 当前问题无法在本机 Chromium 中复现，说明“Mac 机器本身不能续聊”这个范围已经可以排除，更像是某个具体浏览器实例或本地状态差异。
- 计划如何解决：
  - 如果用户仍能稳定复现，下一步收集其实际浏览器类型，以及浏览器控制台/Network 中 `opencode/events`、WebSocket 消息的表现，再继续缩小范围。

## 2026-03-09 再补充

- 做了什么：
  - 按用户给出的两条消息在本机重新复现，确认“第二条消息发出后卡住”的真实根因不是 session 状态机，而是 OpenCode 首条消息触发了 `question` 工具后，第二条消息仍被桥接成普通 `/session/{id}/message`。
  - 直接探测了 OpenCode 远端接口与前端 bundle，确认官方可用接口是 `GET /question` 与 `POST /question/{requestID}/reply`，并且 `answers` 的正确结构是二维数组 `string[][]`。
  - 新增 `apps/api/src/services/opencode-question-adapter.ts`，把自然语言续答映射成 OpenCode `question reply` 需要的答案结构。
  - 在 `apps/api/src/connectors/opencode-http-client.ts` 和 `apps/api/src/services/osac-agent-service.ts` 增加 `listQuestions` / `replyQuestion` 能力。
  - 在 `apps/api/src/services/opencode-remote-service.ts` 中补上“直通模式先检查挂起 question，再决定是 reply 还是发新 prompt”的桥接逻辑，并在 reply 前允许把已完成 session 重开到 `in_progress/executing`。
  - 新增 `apps/api/tests/opencode-question-adapter.test.ts`，覆盖选项匹配、自由文本回退、按 opencodeSessionId 选取最新挂起 question。
- 遇到什么：
  - 这台机器上原先跑在 `4000` 的 API 不是 watch 进程，修改后不会自动生效；需要重启后才能验证新桥接逻辑。
  - 新建 E2B runtime 时偶发 `fetch failed`，会干扰完整 smoke，因此验证时优先复用已有健康 sandbox，避免把环境波动误判为代码回归。
- 计划如何解决：
  - 用户后续可直接在当前 Mac 上重测原始两条消息路径。
  - 如果还出现卡住，下一步继续抓该会话的 `/question` 列表、`question.replied` 事件与前端 WebSocket 收包，确认是否还有别的浏览器层问题。

## 2026-03-09 复测结论

- 做了什么：
  - 用 Playwright 在本机 Chromium 按用户给定的两条消息重新跑真实页面流程，并抓取会话 `db8d19aa-aee7-4c5d-9618-e864c5fd04fe`、`4f9453bf-1b11-4740-88c7-5efd9fd46ac8`、`fd452de7-eb58-4b33-99d0-930d07b1e7c8` 的持久化数据。
  - 确认第二条消息已经能继续执行，页面会继续生成待办、调用 Shell 并进入开发流程，不再停在“待确认”卡片。
  - 继续检查 `opencode_user_input.metadata.questionAnswers` 时发现多选题仍会把“协作功能”误选进去，于是收紧 `apps/api/src/services/opencode-question-adapter.ts` 的匹配规则，并给 `apps/api/tests/opencode-question-adapter.test.ts` 增加误匹配回归测试。
  - 发现 `4000` 上实际跑的是凌晨启动的旧 `tsx src/index.ts` 进程，不是 `tsx watch`；重启为 `pnpm dev` 后再次复测。
  - 在新进程上再次验证，`fd452de7-eb58-4b33-99d0-930d07b1e7c8` 的第二条消息已按 `answeredVia: opencode_question_reply` 持久化，且 `questionAnswers` 只保留 `创建和编辑备忘录` 与 `JavaScript/TypeScript` 的正确映射。
- 遇到什么：
  - 重启 API 后，浏览器已有标签页会保留旧连接状态，导致第一次继续测时消息没有真正进入新后端；需要整页刷新后再测，避免把旧前端状态和新 API 混在一起。
- 计划如何解决：
  - 当前这条问题已经可以认为在本机 Chromium 上复测通过。
  - 如果用户接下来还在自己的 Chrome 窗口里复现同类问题，优先让其整页刷新并确认后端是当前 `pnpm dev` 进程，再根据具体 sessionId 继续抓取。

## 2026-03-09 连接器设置页

- 做了什么：
  - 按用户给的参考样式重构了 [ConnectorCenterPanel.tsx](/Users/eunice/codingProject/oneceo/apps/web/client/src/components/ConnectorCenterPanel.tsx)，把“设置 -> Connectors”改成一级连接器列表 + 二级详情页结构。
  - 一级页面现在只展示连接器行项目、状态和“添加连接器”按钮；点击某一行后进入二级详情页，才展示 OAuth、手动配置、挂载到会话等具体操作。
  - 保留了原有 quick guide、manual config、attach session 等能力，但把它们都下沉到详情页，避免一级页面信息过载。
- 遇到什么：
  - 本机 `3000` 上原来的 Vite 进程没有把新组件热更新到浏览器，导致页面一直显示旧的大卡片布局；重启 web dev 进程后才拿到最新 bundle。
- 计划如何解决：
  - 当前样式和交互已经在本机 Chromium 实看通过。
  - 如果后续还要继续贴近参考稿，可以再补真实品牌图标、状态分组和搜索/筛选，但这次先把结构层级调整正确。

## 2026-03-09 连接器弹窗调整

- 做了什么：
  - 根据用户新要求，把 [ConnectorCenterPanel.tsx](/Users/eunice/codingProject/oneceo/apps/web/client/src/components/ConnectorCenterPanel.tsx) 的详情交互从“列表页内切换到二级子页”改成“列表页上方弹出详情弹窗”。
  - 一级列表保留不动；点击连接器行会打开新的详情弹窗，关闭后回到原列表位置。
  - 详情弹窗中保留原先的 quick guide、manual config、OAuth、attach session 等操作。
- 遇到什么：
  - 当前设置总弹窗本身仍有一条既有的 `DialogTitle/DialogDescription` 无障碍警告，这不是这次连接器弹窗改动引入的。
- 计划如何解决：
  - 当前连接器交互层级已经符合“一级列表 + 额外弹窗”的要求。

## 2026-03-09 附件二级悬浮菜单

- 做了什么：
  - 将 [AttachmentPickerButton.tsx](/Users/eunice/codingProject/oneceo/apps/web/client/src/components/AttachmentPickerButton.tsx) 从“直接打开文件选择器”改成“点击加号显示二级悬浮菜单”。
  - 一级菜单增加了“从云端添加”“使用技能”“从本地文件添加”；其中云端和技能都采用二级子菜单，网站/Google Drive/OneDrive 通过额外弹窗输入链接。
  - 在 [task-creation-client.ts](/Users/eunice/codingProject/oneceo/apps/web/client/src/lib/task-creation-client.ts) 增加远程附件抓取方法，在 [task-creation-routes.ts](/Users/eunice/codingProject/oneceo/apps/api/src/routes/task-creation-routes.ts) 增加 `/api/task-creation/attachments/fetch`，并拆出 [remote-attachment-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/remote-attachment-service.ts) 负责链接校验、分享链接转换和文件名推断。
  - “使用技能”暂时按用户交互需求实现为生成 skill brief markdown 附件，统一复用现有附件流，不额外发散成另一套会话状态。
  - 增加 API 单测 [remote-attachment-service.test.ts](/Users/eunice/codingProject/oneceo/apps/api/tests/remote-attachment-service.test.ts) 和页面 smoke 脚本 [attachment-picker-menu.playwright.spec.ts](/Users/eunice/codingProject/oneceo/apps/web/client/src/tests/attachment-picker-menu.playwright.spec.ts)。
- 遇到什么：
  - 第一次页面实测时，网站导入虽然成功，但前端只能拿到 `website-file`，原因是 API 没有通过 CORS 暴露 `X-Attachment-Name` 响应头。
  - Playwright MCP 在 file chooser 场景里崩了一次，最终改成仓库内显式依赖 `@playwright/test` 后再跑本地 smoke。
- 计划如何解决：
  - 当前“网站导入 + 技能导入 + 本地导入”已经在本机 Playwright 上整链路通过。
  - 后续如果你还想把“使用技能”接成真正的 sandbox skill 装载，再单独补 E2B/OSAC 支持，不和这次附件入口改动混在一起。
