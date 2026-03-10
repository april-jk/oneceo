# MCP 热更新与用户级连接器中心

## 范围

- 本次只覆盖 `opencode` 执行器的运行时 MCP 管理。
- `claudecode` / `codex` 仅在前端选择器和类型层保留兼容，不提供运行时 attach/detach。
- 首批内置连接器固定为 `GitHub`、`Slack`、`Notion`、`Postgres`。

## 整体模型

- 用户级配置存储在 `user_connector_accounts`
  - 作用：统一保存授权状态、显示名、非敏感配置、加密后的 token/DSN。
  - 敏感字段使用 `CONNECTOR_SECRET_KEY` 进行 `AES-256-GCM` 加密。
- 会话级绑定存储在 `task_session_connector_bindings`
  - 作用：记录 task session 对某个连接器的期望状态、运行时状态、最近活跃时间、最近错误。
  - 绑定作用域是 `task session`，不是 sandbox。
- OAuth 事务存储在 `connector_auth_requests`
  - 作用：保存一次授权往返中的 `state`、`requestId`、返回会话 ID、防重放与过期控制。

## 关键链路

### 1. 用户级授权 / 配置

- 路由：`/api/connectors`
- `GET /catalog`
  - 返回内置连接器目录、auth 模式、是否可用、配置 schema 摘要。
- `GET /me`
  - 返回当前用户的连接器配置与授权状态。
- `PUT /:connectorKey`
  - 保存非 OAuth 配置，例如 `Postgres DSN` 或 token fallback。
- `POST /:connectorKey/oauth/start`
  - 生成 OAuth 跳转地址，并记录 `connector_auth_requests`。
- `POST /:connectorKey/oauth/callback`
  - 交换 access token，更新 `user_connector_accounts`。
- `DELETE /:connectorKey/auth`
  - 清除当前用户该连接器的授权态。

### 2. 当前会话热挂载 / 热卸载

- 路由：`/api/task-creation/sessions/:sessionId/connectors`
- `GET /connectors`
  - 聚合用户级授权状态、会话绑定状态、OpenCode `/mcp` 运行态和最近活跃状态。
- `POST /connectors/:connectorKey/attach`
  - 若当前 session 尚未启动 runtime，会先走 `ensureTaskSessionRuntime()`。
  - 然后执行：
    1. `POST /mcp`
    2. `POST /mcp/{name}/connect`
    3. `GET /mcp`
    4. 更新 `task_session_connector_bindings`
- `POST /connectors/:connectorKey/detach`
  - 执行 `POST /mcp/{name}/disconnect`
  - 将 binding 更新为 `desired_state=detached`

### 3. Sandbox 重放

- `osacAgentService.ensureOpencodeServer()` 成功后会调用
  - `sessionConnectorService.reconcileByOrchestratorSessionId(sessionId)`
- 它会读取 sandbox metadata 中的 `taskSessionId`
- 将所有 `desired_state=attached` 的连接器重新注册并连接到当前 OpenCode runtime

### 4. 活跃状态

- `opencodeEventStreamService` 在收到 OpenCode SSE tool 事件后，会调用
  - `sessionConnectorService.noteUsageFromEvent()`
- 当前规则：
  - 工具名命中连接器关键字后，更新 `last_used_at`
  - 30 秒内视为 `active`
  - 超过 30 秒视为 `idle`

## 连接器实现

### GitHub

- 用户授权优先走平台 OAuth。
- 若部署未配置 GitHub OAuth，可退回 token 模式。
- 运行时通过官方 MCP server：
  - `npx -y @modelcontextprotocol/server-github`
- token 通过环境变量投影：
  - `GITHUB_PERSONAL_ACCESS_TOKEN`

### Postgres

- 保存加密后的 DSN。
- 运行时通过官方 MCP server：
  - `npx -y @modelcontextprotocol/server-postgres <dsn>`

### Slack / Notion

- 连接器卡片始终可见。
- 只有部署层提供 MCP adapter URL 时才允许 attach。
- 运行时走 remote MCP config。
- token 通过 header 模板投影到远端 adapter。

## 前端入口

- 输入框旁 `Plug` 弹窗：
  - 展示当前 session 的 attach/detach 状态
  - 未授权时可直接打开 `设置 -> Connectors`
- 设置弹窗新增 `Connectors` 页签
  - 统一管理用户级授权和配置
  - 若存在 `targetSessionId`，授权或保存完成后会自动 attach 到目标 session

## 当前限制

- 暂不支持同一用户对同一连接器配置多个账号。
- 暂不支持 `codex` / `claudecode` 运行时 MCP 控制。
- OAuth 成功后的 display name 目前只对 GitHub 做了额外 profile 拉取；Slack / Notion 主要依赖 token 返回体。
