# Notion MCP OAuth 固定 redirect_uri 与 state 动态会话绑定执行文档 [20260408-2205已采用]

## 1. 背景与问题

- 现状：Notion OAuth 流程依赖前端传入 redirectUri，且不同会话可能带不同 URL 参数（如 sessionId）。
- 问题：Notion 后台通常要求预先登记回调地址，若 redirectUri 在不同会话中变化，容易触发回调地址不匹配。
- 目标：将 Notion OAuth 回调地址固定为单一地址，将动态会话信息放入 OAuth state，并在回调后恢复会话关联与挂载行为。

## 2. 方案目标与边界

### 2.1 目标

1. Notion 后台只配置一个固定回调地址：`https://dev.oneceo.ai/notion/callback`。
2. 会话 ID 等动态信息通过 state 传递并在回调后恢复。
3. OAuth 安全校验仍走现有 `connector_auth_requests` 单次有效、过期、用户归属校验链路。
4. 不改变主链编排，不绕过现有连接器状态表与恢复任务。

### 2.2 非目标

1. 不改 GitHub/Supabase 等其他连接器 OAuth 行为。
2. 不新增多账号 Notion profile 管理模型。
3. 不引入新的降级/兜底分支。

## 3. 总体设计

### 3.1 固定 redirect_uri

- Notion 平台配置固定回调：`https://dev.oneceo.ai/notion/callback`。
- oneceo 后端 Notion OAuth 起跳与换 token 均使用同一个固定 redirect_uri。
- 前端不再把会话信息拼入 redirectUri 查询参数。

### 3.2 state 承载动态信息

- state 使用结构化 payload（示例）：

```text
v1.<base64url({rid, sid, ts, nonce})>
```

- 字段说明：
  - `rid`: OAuth 请求 ID（requestId）
  - `sid`: 目标会话 ID（可空）
  - `ts`: 生成时间戳（毫秒）
  - `nonce`: 随机串（防重复构造）

- 关键约束：
  - 回调时先按完整 state 查 `connector_auth_requests.state`。
  - 查到后再校验 userId、connectorKey、profileId、expiresAt、status。
  - state 任意篡改会导致数据库查不到匹配记录，直接失败。

## 4. 后台配置执行步骤（Notion 平台）

1. 打开 Notion Integration 配置页。
2. 在 OAuth Redirect URI 里仅保留：`https://dev.oneceo.ai/notion/callback`。
3. 删除旧的带 session 参数或动态路径回调地址。
4. 保存配置并记录变更时间。

## 5. 后端改造清单（apps/api）

## 5.1 文件：apps/api/src/connectors/definitions/notion.ts

### 变更点

1. 新增环境变量读取：`NOTION_CONNECTOR_REDIRECT_URI`。
2. Notion OAuth provider 增加固定 redirectUri 配置（供服务层使用）。
3. `available` 判定增加 redirectUri 必填校验。

### 验收点

1. 未配置 `NOTION_CONNECTOR_REDIRECT_URI` 时 Notion catalog 标记为 unavailable。
2. 错误提示清晰指出缺少固定回调地址配置。

## 5.2 文件：apps/api/src/services/user-connector-service.ts

### 变更点

1. 为 Notion 增加 state 构造函数与解析函数。
2. `startOAuthForProfile`：
   - Notion 分支忽略外部传入 redirectUri，使用 `NOTION_CONNECTOR_REDIRECT_URI`。
   - 构造 state 时写入 `sid`（来源于 `returnToSessionId`）。
   - `connector_auth_requests.return_to_session_id` 仍落库保存，作为服务端权威值。
3. `completeOAuthByProfile`：
   - 先按 state 取请求并做归属校验。
   - Notion 分支使用固定 redirectUri 换 token。
   - 若 state 里的 sid 与 DB 中 returnToSessionId 不一致，判定非法请求并失败。
4. 保持现有过期、失败、完成状态迁移逻辑。

### 验收点

1. Notion 回调不再依赖前端动态 redirectUri。
2. state 篡改会失败，且不会写入授权成功状态。
3. `returnToSessionId` 可正确回传给前端用于自动挂载。

## 5.3 文件：apps/api/src/routes/connector-routes.ts

### 变更点

1. 保持接口路径不变：
   - `POST /api/connectors/notion/oauth/start`
   - `POST /api/connectors/notion/oauth/callback`
2. Notion 分支下，`redirectUri` 入参改为可选（兼容旧调用），但服务层以固定值为准。
3. 错误返回保持现有统一格式。

### 验收点

1. 旧前端即使继续传 redirectUri，Notion 也不会使用动态值。
2. 其他连接器行为不受影响。

## 5.4 数据与安全约束

1. `connector_auth_requests` 不新增字段（最短路径）。
2. `state` 单次有效、10 分钟过期策略不变。
3. access_token 继续仅加密存储，不写日志。

## 6. 前端改造清单（apps/web）

## 6.1 文件：apps/web/client/src/components/ConnectorCenterPanel.tsx

### 变更点

1. 新增 Notion 专用固定回调构造：
   - `const notionRedirectUri = `${window.location.origin}/notion/callback``
2. 发起 startOAuth 时：
   - Notion 传固定 redirectUri。
   - 会话 ID 仅通过 `returnToSessionId` 传给后端。
3. 回调处理触发条件：
   - 在 `/notion/callback` 页面读取 `code` 与 `state`。
   - 完成 callback 后通过 `returnToSessionId` 执行 attach。
4. 回调完成后清理查询参数：
   - 若存在 `sessionId`，跳转到 `/session/:sessionId` 继续聊天。
   - 若不存在 `sessionId`，跳回常规页面（如 `/home`）。

### 验收点

1. URL 中不再出现 sessionId 形式的 redirect 参数。
2. 同一固定回调地址可服务多个会话授权。

## 6.2 文件：apps/web/client/src/App.tsx

### 变更点

1. 新增路由：`/notion/callback`。
2. 路由组件复用已登录主页面容器（建议走 `withUserAuth(Home)`），确保全局设置弹窗与连接器回调逻辑可执行。

### 验收点

1. 访问 `/notion/callback?code=...&state=...` 时可进入回调处理流程。
2. 未登录用户会先进入登录，并在登录后继续回调处理。

## 6.3 文件：apps/web/client/src/lib/connectors-client.ts

### 变更点

1. 接口定义保持不变（不破坏调用层）。
2. 文档注释注明：Notion 的 redirectUri 采用固定值，不应拼接会话动态参数。

## 7. 环境变量与部署

## 7.1 新增/确认变量

- `NOTION_CONNECTOR_CLIENT_ID`
- `NOTION_CONNECTOR_CLIENT_SECRET`
- `NOTION_CONNECTOR_SCOPES`
- `NOTION_MCP_REMOTE_URL`
- `FRONTEND_URL`（例如 `https://dev.oneceo.ai`）
- `NOTION_CONNECTOR_REDIRECT_URI`（仅路径，例如 `/notion/callback`，最终会拼接为 `FRONTEND_URL + NOTION_CONNECTOR_REDIRECT_URI`）

## 7.2 发布前检查

1. API 与 Web 部署环境中的 `NOTION_CONNECTOR_REDIRECT_URI` 一致。
2. Notion 后台回调地址与环境变量完全一致（协议、域名、路径大小写）。
3. 无旧动态回调地址残留。

## 8. 测试计划

## 8.1 单元测试（API）

文件建议：apps/api/tests/connector-routes.test.ts

1. Notion start 使用固定 redirectUri 构造 authUrl。
2. state 中含 sid，且 `connector_auth_requests.return_to_session_id` 正确落库。
3. callback 成功：授权状态 authorized，返回正确 `returnToSessionId`。
4. state 过期：返回失败并标记 expired。
5. state 篡改：返回失败，不能完成授权。

## 8.2 单元测试（Web）

文件建议：apps/web/client/src/tests/connector-center-panel.test.ts

1. Notion OAuth 使用固定回调路径。
2. `/notion/callback` 场景可触发 completeConnectorOauth。
3. callback 成功后触发 attach 并跳回常规页面。
4. callback 成功且存在 `sessionId` 时，跳转到对应 `/session/:sessionId`。

## 8.3 手工联调

1. 在 session A 发起 Notion 授权并完成，确认自动挂载到 session A。
2. 在 session B 重复流程，确认不会串到 session A。
3. 在回调 URL 手改 state，确认回调失败。
4. 授权成功后在 run 中调用 Notion MCP tools，确认可用。

## 9. 验收标准

1. Notion 后台仅需一个固定回调地址即可完成所有会话授权。
2. 多会话并发授权时，不发生会话串绑。
3. 所有动态会话关联均来源于 state + 服务端请求记录。
4. 失败场景有明确错误提示，可重试。

## 10. 实施顺序（最短路径）

1. 先改后端（固定 redirect + state 载荷 + 校验）。
2. 再改前端（固定回调路由 + 回调处理入口）。
3. 执行 API/Web 单测。
4. 进行真实 Notion OAuth 联调与会话挂载验证。
5. 通过验收后再将文档状态改为 `[yyyymmdd-hhmm已采用]`。

## 11. 风险与处理

1. 风险：回调路径未被前端路由接管导致 404。
   - 处理：显式新增 `/notion/callback` 路由并验证登录重定向后仍可执行回调。
2. 风险：环境变量与 Notion 后台配置不一致。
   - 处理：发布前做逐项比对检查。
3. 风险：state 载荷过长。
   - 处理：载荷仅保留 `rid/sid/ts/nonce`，避免写入冗余字段。

## 12. 关联文档

- docs/features/connectors/notion_mcp_oauth_execution_plan_[20260407-1640已采用].md
- docs/features/connectors/github_auth_logic_[20260330-1000已采用].md

## 13. 方案采用状态

- 当前状态：20260408-2205 已采用。
- 实施说明：已进入代码实现并完成后端与前端改造及回归验证。
