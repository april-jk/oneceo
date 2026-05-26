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
