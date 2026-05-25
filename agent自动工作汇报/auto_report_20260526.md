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
