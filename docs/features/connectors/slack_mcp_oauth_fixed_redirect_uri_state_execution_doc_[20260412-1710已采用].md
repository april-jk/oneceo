# Slack MCP OAuth 固定 redirect_uri 与 state 会话绑定改造方案 [20260412-1710已采用]

## 1. 背景与问题

- 现状：Slack 已切到 connector 级 OAuth 主路径，但当前仍沿用前端动态传入 `redirectUri` 的方式。
- 问题：
  - Slack OAuth 回调地址仍依赖当前页面 URL，不利于像 Notion 一样在第三方后台登记单一固定回调地址。
  - 当前回调链路虽然保留了 `returnToSessionId`，但没有把 Slack 对齐到“固定回调地址 + state 内携带会话信息”的模式。
  - 前端与设置弹窗对固定 Slack 回调页还没有专门识别入口。
- 目标：参照 Notion MCP 已采用方案，把 Slack OAuth 改成固定回调地址 `FRONTEND_URL + /slack/callback`，并通过 state 传递会话信息，在回调成功后把 Slack MCP 自动挂到对应会话。

## 2. 方案目标与边界

### 2.1 目标

1. Slack OAuth 固定回调地址统一为：`FRONTEND_URL + SLACK_CONNECTOR_REDIRECT_URI`，其中 env 内只写路径：`/slack/callback`。
2. 发起连接时，将目标会话 ID 写入 state 载荷，而不是拼进动态回调 URL。
3. 回调后通过解析 state 中的 `sessionId` 恢复发起连接的会话，并继续走现有 attach 链路。
4. 复用现有 `connector_auth_requests`、`user_connector_profiles`、`task_session_connector_bindings`，不新增绕路存储。
5. 不改变 Slack 官方 MCP、OAuth-only、connector 级入口这些已采用约束。

### 2.2 非目标

1. 不做 Slack 与 Notion/GitHub 的通用 OAuth 抽象重构。
2. 不新增 token 模式、兼容模式或降级分支。
3. 不改动与本次固定回调方案无关的其它连接器行为。

## 3. 参照基线

本方案直接参照当前仓库中 Notion 已采用实现：

- [notion_mcp_oauth_fixed_redirect_uri_state_execution_doc_[20260408-2205已采用].md](/D:/aiBeginner/test/oneceo-task-creation-agent/docs/features/connectors/notion_mcp_oauth_fixed_redirect_uri_state_execution_doc_[20260408-2205已采用].md)
- `apps/api/src/services/user-connector-service.ts`
- `apps/web/client/src/components/ConnectorCenterPanel.tsx`
- `apps/web/client/src/components/SettingsDialog.tsx`
- `apps/web/client/src/App.tsx`

Slack 的改造必须直接对齐这条已落地链路，避免再保留“Slack 单独一套动态 redirectUri 逻辑”。

## 4. 总体设计

### 4.1 固定 redirect_uri

- Slack OAuth start 与 callback 换 token 都统一使用：

```text
https://dev.oneceo.ai/slack/callback
```

- Slack App 后台只登记这一条回调地址。
- 前端不再把当前页面路径、`targetSessionId`、`profileId` 等动态信息拼到 Slack 的 redirectUri 中。

### 4.2 state 承载动态会话信息

- Slack 使用与 Notion 同类型的结构化 state：

```text
oneceo_slack_v1.<base64url({rid, sid, ts, nonce})>
```

- 字段说明：
  - `rid`: OAuth 请求 ID（`requestId`）
  - `sid`: 发起连接的目标会话 ID，可空
  - `ts`: 时间戳
  - `nonce`: 随机串

- 关键约束：
  - 服务端仍先按完整 state 查询 `connector_auth_requests`。
  - 查到请求后，再校验 `rid` 与 DB 中 `requestId` 一致。
  - 同时校验 `sid` 与 DB 中 `returnToSessionId` 一致。
  - 任意篡改 state，都会导致回调失败，不得进入授权成功态。

### 4.3 回调后的会话恢复与 attach

- Slack 回调页只负责承接 `code` 和 `state`。
- 服务端在 callback 阶段解析 state 中的 `sid`，并通过现有返回结构把 `returnToSessionId` 回传前端。
- 前端在 OAuth callback 成功后：
  1. 取回 `returnToSessionId`
  2. 取回默认 Slack profile
  3. 调用现有 `attachSessionConnector(sessionId, 'slack', { profileId })`
  4. 成功后跳转到 `/session/:sessionId`
- 若 `sid` 为空，则回调成功后仅完成授权，不做 session attach，并跳回 `/home`。

## 5. 代码改造清单

## 5.1 文件：`apps/api/src/connectors/definitions/slack.ts`

### 变更点

1. 为 Slack OAuth provider 增加固定 `redirectUri` 配置：
   - 读取 `SLACK_CONNECTOR_REDIRECT_URI=/slack/callback`
   - 运行时自动拼接为 `FRONTEND_URL + SLACK_CONNECTOR_REDIRECT_URI`
2. Slack provider 不再依赖前端传入动态回调地址。
3. 保持 Slack runtime 继续固定指向官方 MCP：
   - `https://mcp.slack.com/mcp`

### 验收点

1. Slack start OAuth 生成的授权 URL 中，`redirect_uri` 固定为 `FRONTEND_URL + /slack/callback`。
2. Slack callback 换 token 时使用的 `redirect_uri` 与 start 保持完全一致。

## 5.2 文件：`apps/api/src/services/user-connector-service.ts`

### 变更点

1. 增加 Slack 专用 state 版本常量，例如：
   - `const SLACK_STATE_VERSION = 'oneceo_slack_v1'`
2. 参照 Notion 增加：
   - Slack state 构造函数
   - Slack state 解析函数
3. `startOAuthForProfile`：
   - Slack 分支不再使用前端传入的动态 `redirectUri`
   - Slack 分支构造带 `sid` 的结构化 state
   - `connector_auth_requests.return_to_session_id` 继续落库，作为服务端权威会话来源
4. `completeOAuthByProfile`：
   - Slack 分支在换 token 前校验 state 中的 `rid/sid`
   - 若 state 中的 `sid` 与落库的 `returnToSessionId` 不一致，直接失败
   - Slack callback 返回体继续带 `returnToSessionId`
5. `resolveOauthRedirectUri(...)`：
   - 把 Slack 加入固定 redirect 分支，行为对齐 Notion

### 验收点

1. Slack callback 不再依赖前端当前页面动态 URL。
2. `sessionId` 只通过 state + `connector_auth_requests` 恢复。
3. state 被篡改时，Slack OAuth 必须失败，且不得写入授权成功结果。

## 5.3 文件：`apps/api/src/routes/connector-routes.ts`

### 变更点

1. 保持 Slack 的 connector 级 OAuth 路由不变：
   - `POST /api/connectors/slack/oauth/start`
   - `POST /api/connectors/slack/oauth/callback`
2. 对 Slack 来说，`redirectUri` 入参保留兼容外壳，但服务层应忽略动态值并使用固定回调地址。
3. OAuth callback 成功后继续沿用现有 runtime refresh queue 和返回结构。

### 验收点

1. 前端即使继续传入动态 `redirectUri`，Slack 也只使用固定值。
2. 现有 connector 级 OAuth 接口路径不需要变更。

## 5.4 文件：`apps/web/client/src/App.tsx`

### 变更点

1. 参照 Notion 新增路由：
   - `/slack/callback`
2. 路由组件复用 `withUserAuth(Home)`，确保登录后仍能继续执行回调处理。

### 验收点

1. 访问 `/slack/callback?code=...&state=...` 时能进入现有连接器回调流程。
2. 未登录用户先登录，登录完成后仍可继续处理 Slack callback。

## 5.5 文件：`apps/web/client/src/components/SettingsDialog.tsx`

### 变更点

1. 将 `/slack/callback` 加入固定回调页识别逻辑，行为对齐 `/notion/callback`。
2. 当当前路径为 `/slack/callback` 且 URL 中包含 `code` 与 `state` 时：
   - 自动打开 Settings Dialog
   - 自动切到 `connectors` tab
   - 自动高亮 `slack`

### 验收点

1. Slack OAuth 回调页进入后，不需要额外参数也会自动打开连接器面板。
2. 用户不会停留在一个“只展示空白页但未触发 callback 处理”的状态。

## 5.6 文件：`apps/web/client/src/components/ConnectorCenterPanel.tsx`

### 变更点

1. 新增 Slack 固定回调路径常量：
   - `const SLACK_FIXED_CALLBACK_PATH = '/slack/callback'`
2. Slack connector-level OAuth start：
   - 不再用当前页面路径作为 Slack redirectUri
   - 改为 `window.location.origin + '/slack/callback'`
   - `effectiveTargetSessionId` 只通过 `returnToSessionId` 传给后端
3. Slack callback 处理：
   - 允许在 `/slack/callback` 路径下，仅凭 `code + state + connector=slack` 或固定路径识别进入回调逻辑
   - callback 成功后使用服务端返回的 `returnToSessionId` 作为 attach 目标
4. 清理与跳转：
   - 若存在恢复出的 `sessionId`，跳转 `/session/:sessionId`
   - 否则跳转 `/home`
5. `cleanupConnectorQuery(...)` 与 callback 打开条件需要把 Slack 固定回调路径纳入特殊处理，不能只覆盖 Notion。

### 验收点

1. Slack 发起 OAuth 时地址栏中不再包含动态 session 参数回调链接。
2. Slack callback 成功后，能自动 attach 到发起请求的那一个会话。
3. 多个会话分别发起 Slack OAuth 时，不发生串绑。

## 6. 数据与安全约束

1. 继续复用：
   - `connector_auth_requests`
   - `user_connector_profiles`
   - `task_session_connector_bindings`
2. 不新增表、不增加绕过现有状态表的新链路。
3. OAuth state 仍为单次有效、10 分钟过期。
4. access token 继续仅加密保存，不写明文日志。

## 7. 测试计划

## 7.1 API 单元测试

文件建议：`apps/api/tests/user-connector-service.test.ts`

新增或调整以下用例：

1. Slack start OAuth 使用固定 redirectUri：`https://dev.oneceo.ai/slack/callback`
2. Slack state 中包含 `sid`，且 `connector_auth_requests.return_to_session_id` 正确落库
3. Slack callback 成功时返回正确 `returnToSessionId`
4. Slack state 中 `rid` 或 `sid` 被篡改时回调失败
5. Slack callback 过期时标记 failed/expired，且不得完成授权

## 7.2 Web 单元测试

文件建议：`apps/web/client/src/tests/connector-center-panel.test.ts`

新增或调整以下用例：

1. Slack connector-level OAuth 使用固定回调路径 `/slack/callback`
2. `/slack/callback` 场景能够触发 `completeConnectorOauth('slack', ...)`
3. callback 成功后使用 `returnToSessionId` 执行 attach
4. cleanup 后：
   - 有 sessionId 时跳转 `/session/:sessionId`
   - 无 sessionId 时跳转 `/home`

## 7.3 手工联调

1. 在 session A 发起 Slack 连接并完成回调，确认 Slack 自动 attach 到 session A
2. 在 session B 重复同样流程，确认不会 attach 到 session A
3. 手动篡改 Slack callback 中的 state，确认授权失败
4. attach 成功后，在对应会话运行 Slack MCP tool，确认 runtime 可用

## 8. 验收标准

1. Slack App 后台只需要登记一个回调地址：`https://dev.oneceo.ai/slack/callback`
2. Slack OAuth 发起与回调都使用同一固定 redirect_uri
3. `sessionId` 不再依赖拼接在动态回调 URL 上
4. Slack callback 成功后，能够把 MCP 连接到发起请求的对应会话
5. 多会话并发授权时，不发生会话串绑
6. state 篡改、过期、用户不匹配等场景都能正确失败

## 9. 实施顺序（最短路径）

1. 先改 API：固定 Slack redirectUri、state 构造与校验、callback 返回 `returnToSessionId`
2. 再改 Web：新增 `/slack/callback` 路由、SettingsDialog 识别、ConnectorCenterPanel 固定回调处理
3. 补 API/Web 单测
4. 最后做真实 Slack OAuth 联调与 session attach 验证

## 10. 需要同步更新的现有文档

若本方案被采用，需同步更新当前已采用 Slack 文档：

- [slack_official_mcp_oauth_requirement_[20260411-2319已采用].md](/D:/aiBeginner/test/oneceo-task-creation-agent/docs/features/connectors/slack_official_mcp_oauth_requirement_[20260411-2319已采用].md)

重点需要更新的内容：

1. 用户操作链路从“动态 redirectUri”明确收敛为“固定 `/slack/callback` + state 恢复会话”
2. 代码改造要求中补充：
   - `App.tsx`
   - `SettingsDialog.tsx`
   - Slack state 结构与校验逻辑
3. 验收标准中补充“单一固定回调地址”和“多会话不串绑”

## 11. 方案状态

- 当前状态：`[20260412-1710已采用]`
- 实施说明：已完成 Slack 固定 `/slack/callback` 回调路径、state 会话校验、前端固定 callback 路由识别，以及 API/Web 最小回归测试补充。
