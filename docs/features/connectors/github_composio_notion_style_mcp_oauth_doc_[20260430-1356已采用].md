# GitHub 改走 Composio MCP OAuth 清理方案 [20260430-1356已采用]

## 背景

Notion 已切换为 Composio Connect Link 授权，并通过 oneceo API broker 暴露 MCP 工具，避免把用户 token 或第三方 MCP server 下发到 sandbox。GitHub 原实现仍保留本地 `@modelcontextprotocol/server-github`、PAT/OAuth App token 和 sandbox 环境变量注入路径，和 Notion 的安全边界不一致。

本次修改按 NotionMcp 的实现方式处理 GitHubMcp：

- GitHub catalog 直接声明为 Composio OAuth 连接器。
- GitHub runtime 不再物化本地 stdio MCP server。
- GitHub MCP 调用统一走 `backend_rpc` + `api_brokered_mcp`。
- 旧 GitHub token profile 在读取时标记为 `needs_auth`，要求重新通过 Composio 连接。
- `env.windows` 补充 GitHub Composio toolkit 配置。

## 范围

### 后端连接器定义

- `apps/api/src/connectors/definitions/github.ts`
  - 移除 GitHub OAuth App / PAT 表单配置。
  - 新增 `COMPOSIO_GITHUB_TOOLKITS`，默认 `github`。
  - 新增 `COMPOSIO_GITHUB_ALLOWED_TOOLS`，默认不限制。
  - 设置 `composio.provider = composio`、`brokerMode = api_only`、`toolNamePrefix = github`。

### Runtime 装配

- `apps/api/src/services/connector-registry.ts`
  - GitHub 不再生成 `node -e` stdio wrapper。
  - GitHub 和 Notion 一样进入 Composio hosted provider 分支。

- `apps/api/src/services/session-connector-service.ts`
  - GitHub Composio 模式下不再执行旧 GitHub App repository installation 校验。

- `apps/api/src/services/altus-managed-setup-service.ts`
- `apps/api/src/services/session-mcp-recovery-service.ts`
  - 将 GitHub 纳入 `api_brokered_mcp` runtime transport 校验集合。

### 账号迁移行为

- `apps/api/src/services/user-connector-service.ts`
  - 旧 GitHub token profile 不再作为可用授权继续使用。
  - 读取旧 profile 时清空 secret，标记 `needs_auth`，提示通过 Composio 重新连接。
  - 新建 GitHub profile 时不接受用户手动 token 作为授权来源。

### 环境变量

- `env.windows`
  - 新增 `COMPOSIO_API_BASE_URL`
  - 新增 `COMPOSIO_API_KEY`
  - 新增 `COMPOSIO_GITHUB_TOOLKITS`
  - 新增 `COMPOSIO_GITHUB_ALLOWED_TOOLS`
  - 保留 Notion Composio toolkit 配置示例，方便本地对照。

## 验证点

- GitHub catalog 在 `COMPOSIO_API_KEY` 存在时可用，OAuth provider 为 `composio`。
- GitHub catalog 在缺少 `COMPOSIO_API_KEY` 时不可用。
- GitHub runtime materialize 为 hosted provider，不包含本地 `server-github` 命令和 token env。
- session provider transport 为 `backend_rpc`，`transportName = api_brokered_mcp`。
- GitHub Composio OAuth start 会创建 Composio tool router session 和 Connect Link。

## 20260430 回调与挂载修正

- GitHub 前端回调页改为固定 `\/github\/callback`，和 Notion 一样由固定 callback 路由接管，再在回调完成后清理参数并跳回 session 或 `/home`，避免从任意页面起跳时回跳地址不稳定，导致 callback 未被统一处理。
- `hosted-provider-host-service` 必须把 `github` 归入 Composio hosted provider 分发集合，避免授权后挂载时出现 `hosted_provider_rpc_failed: 不支持的 hosted provider: github`。
- Composio Connect Link 回调后，第三方连接状态可能晚于浏览器回跳完成；确认授权时允许短轮询同一个 tool router session，直到 toolkit connection 变为 active 或超时。
- GitHub 授权成功后，如果 Composio 返回连接账号名或仓库安装范围，写入 profile `displayName` / `config.repositories` / `metadata.composioRepositoryNames`，前端授权卡片优先显示真实账号和仓库名称；如果 Composio 未返回仓库明细，则显示连接账号名，避免继续只展示泛化的“授权仓库”。
- 会话附加弹窗里的“显示所有仓库”改为三级来源：优先从 Composio tool router session / toolkit connection 读取仓库名；若该摘要为空，则直接通过 GitHub MCP 的 `COMPOSIO_SEARCH_TOOLS + GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER` 实时拉取当前账号可访问仓库；若实时调用仍失败，再回退使用 profile 已缓存的 `metadata.composioRepositoryNames` / `config.repositories`，避免前端面板继续显示空列表。

## 不做项

- 不保留旧 PAT / OAuth App runtime 兼容分支。
- 不在 sandbox 内安装或运行 GitHub MCP server。
- 不把 GitHub access token 注入 sandbox 环境变量。
