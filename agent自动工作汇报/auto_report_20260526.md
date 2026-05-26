# auto_report_20260526

## Composio Callback 环境检查

做了什么：

1. 检查 `.env.develop`、`.env.staging`、`.env.product`、`.env.localhost` 中的 `COMPOSIO_OAUTH_CALLBACK_BASE_URL`、`FRONTEND_URL`、`ONECEO_API_URL`、`WEB_BFF_API_TARGET` 和 `VITE_API_BASE_URL`。
2. 确认 develop / staging / product 的 Composio callback base 均指向前端域名，分别为 `https://dev.oneceo.ai`、`https://staging-0505.oneceo.ai`、`https://oneceo.ai`。
3. 确认本地 callback 配置此前指向 API 端口 `localhost:4000`，已改为前端端口 `localhost:3000`。
4. 保留 API 根路径连接器 callback 兜底 302，避免旧配置或第三方回跳到 API 端口时出现 `Cannot GET /github/callback`。

验证结果：

1. `rg` 检查各环境 callback base 与前端域名一致。
2. 上一轮已验证 callback 路由测试与 API 类型检查通过。

## Composio Callback 授权确认转圈修复

做了什么：

1. 排查 GitHub 授权成功后设置弹窗一直显示“重新连接”loading 的问题。
2. 确认 Composio 成功回调使用 `status=success&connected_account_id=...`，不是传统 `code=...` OAuth callback。
3. 前端 callback 完成请求现在会把 `connected_account_id` / `connectedAccountId` 和 `status` 一并传给 API。
4. 后端 Composio 授权确认会优先使用 callback 带回的 connected account id 覆盖旧 metadata，避免确认阶段找不到正确连接账号。
5. 前端补充无 `code` 的 GitHub Composio success callback 识别测试。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/connector-center-panel.test.ts`：25/25 通过。
2. `TMPDIR=/private/tmp pnpm --filter api exec tsx --test --test-name-pattern "completeOAuthByProfile confirms Slack Composio authorization" tests/user-connector-service.test.ts`：新增覆盖点通过。
3. `pnpm --filter api type-check`：通过。
4. `pnpm --filter web check`：通过。
5. `git diff --check`：通过。

## OSAC backend_rpc 挂载失败修复

做了什么：

1. 排查 `授权已完成，但挂载失败：unsupported mcp transport: backend_rpc`，确认授权已经完成，失败发生在连接器 attach 到会话时。
2. 定位到旧 sandbox OSAC bridge 复用判断只检查 endpoint/token 是否存在，可能继续复用不支持 `backend_rpc` 的旧 OSAC v1.1.3。
3. 调整 OSAC bridge 复用逻辑：复用前必须校验当前已发布 OSAC artifact sha，并探测 `/status`；sha 缺失或不一致时自动重写二进制并重启 bridge。
4. provision 与 runtime metadata 均写入 `osacBinaryVersion/osacBinarySha256/osacBinaryObjectKey`，后续会话可稳定判断是否需要刷新。

验证结果：

1. 已补充 `canReuseOsacBridge` 单测，覆盖 sha 缺失/不一致拒绝复用与 sha 匹配后探测 `/status`。
2. `TMPDIR=/private/tmp pnpm --filter api exec tsx --test tests/sandbox-osac-bridge-service.test.ts`：2/2 通过。
3. `pnpm --filter api type-check`：通过。
4. `git diff --check`：通过。

## 新建 managed 会话右侧工作区首屏空白修复

做了什么：

1. 复现 `/new-task` 首轮发送后已跳转 `/session/:id`、消息和 run recovery 均存在，但右侧 Altus Actions 工作区仍未自动打开的问题。
2. 定位根因：首轮 managed 创建链路只绑定 session 和 run 状态，没有在新 session 创建成功后恢复右侧工作区打开态；同时 SPA route state 可能落后于浏览器真实 URL，导致 `/new-task?new=...` 被误判为旧 session 续聊。
3. 发送瞬间改用 `window.location` 判断真实新建路由，并在 managed processing/active 后对每个 session 自动打开一次右侧工作区；用户手动关闭后同一 session 不反复重开。
4. 更新相关研发文档并补充前端判定单测。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/home-managed-workspace.test.ts`：通过。
2. `pnpm --filter web check`：通过。
3. Playwright 真实浏览器复测 `/new-task?new=codex-fix-20260526h` 首轮发送后跳到 `/session/345687a7-6a04-4291-99af-81f9387561bc`，右侧 `Altus Actions` 自动打开。

## 新建 managed 会话 Actions 默认折叠修正

做了什么：

1. 用户确认新建任务发送内容后进入对话记录时，右侧 Altus Actions 不应自动打开，默认必须折叠。
2. 删除首轮发送前后设置 `previewOpen` 的自动展开意图，并移除 managed run processing/active 后对每个 session 自动打开一次的 effect。
3. 保留 debug ready 自动切换逻辑：可视化调试页面 ready 后仍自动打开 Altus Actions 并切到 debug 视图。
4. 更新相关设计说明：新建 managed 首轮只保证消息与 session 绑定，不再把普通 run 状态变化当成打开 Actions 的理由。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/home-managed-workspace.test.ts`：通过。
2. `pnpm --filter web check`：通过。

## 新建 managed 会话首轮消息区空白修复

做了什么：

1. 重新检查“新建会话输入后跳转新页面，底部输入框出现，但上方消息区空白，刷新后才显示”的完整链路。
2. 复测真实新建入口，确认后端 session、recent/history 与 managed run 都能创建；问题集中在前端首轮 session 绑定后的路由状态同步。
3. 定位根因：`bindSessionId` 使用 `window.history.replaceState` 直接改地址栏，绕过 `wouter` route state。首轮创建后浏览器 URL 已是 `/session/:id`，但 React 路由状态仍可能停在 `/new-task?new=...` 或旧 session，导致首屏消息加载/本地 pending message 合并被旧路由状态干扰；刷新后 router 重新从地址栏初始化，因此消息恢复。
4. 改为通过 `wouter` 的 `setLocation(nextUrl, { replace: true })` 绑定新 session，并抽出 `buildBoundSessionRoute` 统一删除创建期 query `new` / `sessionId`，只保留业务 query。
5. 保留并补强新建 managed 首轮本地消息和右侧工作区自动打开逻辑。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/managed-session-resolution.test.ts src/tests/home-managed-workspace.test.ts`：13/13 通过。
2. `pnpm --filter web check`：通过。
3. `git diff --check`：通过。
4. Playwright 真实浏览器复测侧边栏“新建任务”入口，首轮发送后跳到 `/session/d23d3e4f-9a57-4e12-8400-55865688412b`，上方消息区立即显示用户消息、`managed run 已创建` 与处理中状态，底部输入框正常，右侧 `Altus Actions` 自动打开。

## 历史回放重复出现 MCP 高风险确认卡修复

做了什么：

1. 排查“历史会话中已经点过同意的 Google 工作区高风险确认卡，重新查看历史时又显示待确认”的问题。
2. 定位根因：历史消息中保留的是当时的 `confirmation_required` 工具输出；确认后的真实状态在 `task_session_mcp_tool_confirmations` 表中，前端仅靠当前消息数组里的 follow-up/approved/rejected 消息隐藏确认卡，历史窗口缺少后续消息时会误判为仍待确认。
3. 后端 recent/history/messages 返回 timeline 前统一扫描消息中的 `confirmationId`，查询 `task_session_mcp_tool_confirmations` 并注入 `mcpToolConfirmationStatuses`。
4. 前端渲染 Google Workspace 确认卡时使用该状态：`approved/rejected/consumed/expired` 都不再显示确认按钮；仅实时新事件未补状态或明确 `pending` 时继续显示。
5. 补充前端回归测试，覆盖 consumed 状态隐藏、实时 pending 可见、历史 enriched status 批量隐藏。

验证结果：

1. `pnpm --filter web exec vitest run src/tests/home-managed-workspace.test.ts src/tests/mcp-tool-confirmation.test.ts`：10/10 通过。
2. `pnpm --filter web check`：通过。
3. `pnpm --filter api type-check`：通过。
4. 额外运行 `src/tests/managed-clarification-rendering.test.ts` 时发现 2 个既有断言与当前语言/渲染规则不一致，和本次确认卡修复无关，本次未混入处理。

## Altus 续聊复用 sandbox 的 sandbox_info 瞬断修复

做了什么：

1. 排查会话 `a4b8d017-d746-4434-bc23-be539d8fce79` 后续 managed run 失败，确认首轮已在 sandbox `i11rc53p7evpvkfxysd95` 成功生成 PPT，后续三次失败均停在 provision 的 `sandbox_info`。
2. 直接探测同一 sandbox：`getSandboxInfo()` 返回 `fetch failed / ECONNRESET`，但 `runCommand("printf ...")` 成功，说明 sandbox 仍可执行，失败是控制面信息查询瞬断。
3. 修正 `sandbox-agent-provision-service`：已判定复用的 Altus sandbox 遇到 `sandbox_info` 控制面瞬断时降级为 warning，复用 DB 中已有 metadata，并继续用 `commands_ready` 作为真实执行能力门禁。
4. 继续做闭环检查后，补齐 `ensureNekoDebug()` 的同类风险：debug runtime 已有历史 URL 时，`getSandboxHost()` 控制面瞬断复用旧 URL，避免失败从 `sandbox_info` 挪到 debug host 解析。
5. 同步更新 Altus Sandbox 恢复设计文档，记录本次边界：真实 sandbox 不可用错误仍走恢复链路，控制面瞬断不提前终止短时间续聊。

验证结果：

1. 已用真实 sandbox `i11rc53p7evpvkfxysd95` 验证命令通道可执行。
2. 已补充 `sandbox-agent-provision-service.test.ts` 控制面瞬断分类回归。
3. 已补充 `sandbox-debug-service.test.ts` debug host 解析瞬断复用旧 URL 回归。
