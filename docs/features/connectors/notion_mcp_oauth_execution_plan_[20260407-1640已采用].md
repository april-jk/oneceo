# Notion MCP OAuth 对齐 GitHub MCP 的可执行方案 [20260407-1640已采用]

## 1. 背景与目标

### 1.1 需求背景
- 目标：在 oneceo 中落地 Notion MCP，体验与现有 GitHub MCP 连接器一致，且必须使用 OAuth 登录。
- 参考资料：
  - https://www.notion.com/help/notion-mcp
  - https://developers.notion.com/docs/mcp
  - https://developers.notion.com/docs/get-started-with-mcp
  - https://developers.notion.com/docs/mcp-supported-tools
  - https://developers.notion.com/docs/mcp-security-best-practices

### 1.2 方案目标
- 复刻 GitHub MCP 的核心体验：一键连接、状态清晰、回调后自动应用到当前会话。
- 严格使用 OAuth：不再向用户暴露“手工填 token 作为主路径”的交互。
- 接入现有 oneceo 连接器链路，不绕开已有状态表、恢复任务和会话绑定机制。

### 1.3 非目标
- 不改动 OSAC 主编排架构。
- 不改动 KVM 旧链路。
- 不扩展多账号 Notion profile 高级管理（本轮主推单账号默认 profile）。

## 2. 参照基线（GitHub MCP）

本方案以以下现有实现为直接参照：
- API 路由：apps/api/src/routes/connector-routes.ts
- 用户连接器服务：apps/api/src/services/user-connector-service.ts
- 运行时装配：apps/api/src/services/connector-registry.ts
- 连接器定义：apps/api/src/connectors/definitions/github.ts
- 前端连接器面板：apps/web/client/src/components/ConnectorCenterPanel.tsx
- 既有设计文档：docs/features/connectors/github_auth_logic_[20260330-1000已采用].md

## 3. 现状与差距

### 3.1 当前现状
- Notion 连接器已存在定义与 OAuth provider 解析：apps/api/src/connectors/definitions/notion.ts
- 通用 OAuth 起停与回调链路已存在：apps/api/src/routes/connector-routes.ts、apps/api/src/services/user-connector-service.ts
- Notion 运行时为 remote MCP 模式，依赖 NOTION_MCP_REMOTE_URL：apps/api/src/connectors/definitions/notion.ts

### 3.2 与目标差距
- Notion 当前仍保留 token 字段语义，不符合“必须 OAuth 主路径”的产品要求。
- 前端交互未对 Notion 做 GitHub 式极简引导（连接/已连接双态卡片、连接后快捷再授权/管理）。
- OAuth 回调后的会话自动挂载与提示语还需对齐 GitHub 流程语义。

## 4. 总体方案（最短路径）

### 4.1 主流程
1. 用户打开 Connectors 面板并选择 Notion。
2. 若无 profile：后台自动创建默认 profile（Notion Default），前端不要求用户手工先建 profile。
3. 点击“连接”触发 OAuth start，跳转 Notion 授权页。
4. 回调后 complete OAuth，写入 user_connector_profiles 与 connector_auth_requests 状态。
5. 若页面带 targetSessionId：回调成功后静默 attach 到该 session。
6. 运行时由 session-connector-service + connector-registry 完成 MCP provider 投影。

### 4.2 关键交互
- 未授权态：显示单一 CTA“连接 Notion”。
- 已授权态：显示“已连接 workspace”、按钮“重新授权”“管理/断开”。
- 会话场景：显示“授权后将自动挂载到当前会话”。

### 4.3 边界条件
- state 无效、过期、用户不匹配：直接失败并提示重新发起 OAuth。
- OAuth 成功但未返回 access_token：标记失败并提示重试。
- 运行时 attach 失败：保留已授权态，但给出可重试提示，不回滚 OAuth。
- Notion MCP 限流：按 Notion 官方建议减少并发调用并重试。

## 5. 数据结构与状态机

### 5.1 复用现有表
- user_connector_profiles：保存 profile、授权状态、加密 secret、展示名。
- connector_auth_requests：保存 OAuth state、过期时间、回跳 sessionId、防重放。
- task_session_connector_bindings：保存会话绑定期望态与运行态。

### 5.2 授权状态
- not_configured：未配置。
- needs_auth：需要授权。
- authorized：授权成功。
- error：授权异常。
- unavailable：部署未满足可用条件。

## 6. 接口行为（对齐 GitHub MCP）

### 6.1 用户级 OAuth
- POST /api/connectors/notion/oauth/start
  - 入参：redirectUri, returnToSessionId(optional)
  - 出参：authUrl, requestId, state
- POST /api/connectors/notion/oauth/callback
  - 入参：state, code, redirectUri
  - 出参：account/profile, returnToSessionId
- DELETE /api/connectors/notion/auth
  - 行为：清除 oneceo 侧授权态并触发会话解绑

### 6.2 会话挂载
- POST /api/task-creation/sessions/:sessionId/connectors/notion/attach
- POST /api/task-creation/sessions/:sessionId/connectors/notion/detach

## 7. 代码改造清单（按文件执行）

### 7.1 API
1. apps/api/src/connectors/definitions/notion.ts
- 将 Notion 产品主路径定义为 OAuth。
- 保留 remote MCP 模式，默认 endpoint 对齐官方：https://mcp.notion.com/mcp
- configFields 移除用户手填 token 的主文案，改为 OAuth 引导文案。

2. apps/api/src/services/user-connector-service.ts
- 在 completeOAuth 的 notion 分支中补充 displayName/profileName 规范化（workspace/user 优先级）。
- 复用现有 state 校验、过期校验、防重放逻辑。

3. apps/api/src/routes/connector-routes.ts
- 保持 connectorKey 级 OAuth start/callback 路由为主入口。
- OAuth 成功后继续复用 runtime refresh queue。

4. apps/api/src/services/connector-registry.ts
- Notion runtime 继续走 remote + bearer token header template。
- 校验无 token 时抛出一致错误语义。

### 7.2 Web
1. apps/web/client/src/components/ConnectorCenterPanel.tsx
- 给 notion 增加 GitHub 同款极简态 UI（未授权/已授权）。
- 隐藏不必要 profile 手动输入流程，点击连接时自动创建或选默认 profile。
- 回调成功后自动 attach 到 targetSessionId，并提示成功。

2. apps/web/client/src/lib/connectors-client.ts
- 统一优先走 connectorKey 级 oauth start/callback 调用。

### 7.3 测试
1. apps/api/tests/connector-routes.test.ts
- 新增 notion OAuth start/callback 成功、state 过期、用户不匹配用例。
2. apps/web/client/src/tests/connector-center-panel.test.ts
- 新增 Notion 卡片两态与回调自动挂载行为测试。

## 8. 配置与安全

### 8.1 环境变量
- NOTION_CONNECTOR_CLIENT_ID
- NOTION_CONNECTOR_CLIENT_SECRET
- NOTION_CONNECTOR_SCOPES
- NOTION_MCP_REMOTE_URL（默认建议 https://mcp.notion.com/mcp）
- CONNECTOR_SECRET_KEY（用于 token 加密）

### 8.2 安全约束
- OAuth state 仅一次有效，10 分钟过期（复用现有策略）。
- token 仅加密存储，不写入日志。
- 用户隔离基于 app_users.id，不使用匿名 X-User-Id 作为长期身份源。
- Notion MCP endpoint 仅允许官方域名白名单（mcp.notion.com）。

## 9. 验收标准（必须全部满足）

1. 用户可在 Connectors 中一键完成 Notion OAuth。
2. OAuth 回调成功后，Notion 显示为已授权状态。
3. 带 targetSessionId 的授权流程会自动 attach 到对应 session。
4. run 内可见并可调用 Notion MCP tools。
5. 清除授权后，session 绑定被移除，工具不可再调用。
6. 错误场景（state 失效、回调失败、attach 失败）有明确提示且可重试。

## 10. 联调与发布步骤

1. 本地配置 Notion OAuth 环境变量与回调地址。
2. 验证 OAuth start/callback 接口。
3. 验证连接器面板交互与回调 URL 清理。
4. 验证会话 attach/detach 与 run 内工具调用。
5. 执行最小闭环检查：
- pnpm --filter api type-check
- pnpm --filter web check

## 11. 风险与处理

- 风险：Notion 企业管理员限制外部 AI tools。
  - 处理：在授权失败提示中明确“请检查 Notion Workspace 的 MCP Governance/批准列表配置”。
- 风险：Notion MCP 限流导致间歇失败。
  - 处理：提示减少并发工具调用并重试。

## 12. 方案采用状态
- 当前状态：20260407-1640 已采用。
- 实施说明：本次已按文档进入代码实现阶段，后续变更以本方案为准执行与验收。
