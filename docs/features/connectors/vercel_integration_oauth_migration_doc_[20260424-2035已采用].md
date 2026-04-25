# Vercel Connector 迁移到 Integration OAuth 授权方案 [20260424-2035已采用]

## 20260424-清理更新

本方案现在作为 Vercel MCP 授权链路的唯一当前方案。代码侧已收口为：

1. Vercel 只支持 Integration install flow，不再支持 Sign in with Vercel 普通 OAuth 登录流。
2. 授权入口固定由 `VERCEL_INTEGRATION_SLUG` 生成 `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new`。
3. token exchange 固定使用 `POST https://api.vercel.com/v2/oauth/access_token`。
4. 不再使用 Vercel 普通 OAuth 的 PKCE、scope、prompt、userinfo、refresh token、remote revoke 逻辑。
5. Disconnect 只清理 OneCEO 本地 profile secret；Vercel Integration 的卸载/撤销以 Vercel 侧 installation 状态为准。
6. Runtime 只走 OneCEO internal MCP wrapper，不再把 `https://mcp.vercel.com` 作为 session runtime。

以下旧变量不再作为 Vercel MCP 当前实现入口使用，后续不应重新引入：

```env
VERCEL_MCP_REMOTE_URL
VERCEL_CONNECTOR_SCOPES
VERCEL_CONNECTOR_AUTHORIZE_URL
VERCEL_CONNECTOR_TOKEN_URL
```

## 1. 背景

当前 Vercel MCP 已经实现内部 MCP wrapper、REST API 映射、本地穿透调试、项目生命周期工具和基础 smoke 能力。但是在调用 `vercel_create_project` 时，Vercel 返回：

```text
You don't have permission to create the project.
```

排查后确认，旧实现使用的是 Sign in with Vercel 授权链路：

```text
https://vercel.com/oauth/authorize
https://api.vercel.com/login/oauth/token
https://api.vercel.com/login/oauth/userinfo
```

该链路更适合登录身份识别，当前实际 token scope 为：

```text
openid email profile offline_access
```

它不足以支撑 Vercel REST API 的项目创建、项目更新、环境变量管理、域名管理等写操作。

本次用户已将 Vercel 改为 Integrations 集成，安装地址为：

```text
https://vercel.com/integrations/oneceo
```

因此连接器授权模型需要从普通 OAuth 登录迁移为 Vercel Integration 安装授权。

## 2. 目标

采用唯一方案：

```text
OneCEO 用户点击连接 Vercel
-> 跳转 Vercel Integration 安装页
-> Vercel 回调 OneCEO Redirect URL，携带 code / teamId / configurationId / next
-> OneCEO 用 code 换 Integration access token
-> OneCEO 保存 teamId / configurationId / accessToken
-> Vercel MCP tool call 使用 Integration token 调 Vercel REST API
```

迁移后必须解决：

1. `vercel_create_project` 因 scope 不足无法创建项目的问题。
2. Team 安装时 REST API 缺少 `teamId` 的问题。
3. Altus 无法判断当前 Vercel 授权上下文的问题。
4. 旧 Sign in with Vercel token 与新 Integration token 混用的问题。

## 3. 官方文档依据

Vercel Integration REST API 文档说明：

1. Integration 安装回调会携带 `code`。
2. `code` 通过 `POST https://api.vercel.com/v2/oauth/access_token` 换取 REST API access token。
3. token exchange 响应包含 `team_id`，若安装在 Team 上，后续 REST API 必须追加 `teamId` query。
4. 403 时需要检查 `teamId` 是否缺失、access token scope 是否正确。
5. Integration Redirect URL 在安装流中还会收到 `configurationId`、`next`、`source` 等参数。

参考：

1. https://vercel.com/docs/integrations/create-integration/vercel-api-integrations
2. https://vercel.com/docs/integrations/create-integration/submit-integration

## 4. 环境变量

### 4.1 新增变量

```env
VERCEL_CONNECTOR_MODE=integration
VERCEL_INTEGRATION_SLUG=oneceo
VERCEL_INTEGRATION_CLIENT_ID=<integration-client-id>
VERCEL_INTEGRATION_CLIENT_SECRET=<integration-client-secret>
VERCEL_INTEGRATION_REDIRECT_URI=https://<public-host>/vercel/callback
```

说明：

1. `VERCEL_INTEGRATION_SLUG=oneceo` 对应安装地址 `https://vercel.com/integrations/oneceo`。
2. `VERCEL_INTEGRATION_CLIENT_ID` 和 `VERCEL_INTEGRATION_CLIENT_SECRET` 来自 Vercel Integration Console 的 Credentials。
3. `VERCEL_INTEGRATION_REDIRECT_URI` 必须与 Vercel Integration Console 中配置的 Redirect URL 完全一致。
4. 本地调试时 `<public-host>` 可以是 ngrok 域名；部署后换成正式域名。

### 4.2 兼容变量

短期为了降低改动面，可以允许以下旧变量作为兼容 fallback：

```env
VERCEL_CONNECTOR_CLIENT_ID=<integration-client-id>
VERCEL_CONNECTOR_CLIENT_SECRET=<integration-client-secret>
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
```

兼容规则：

1. 若存在 `VERCEL_INTEGRATION_CLIENT_ID`，优先使用新变量。
2. 若不存在新变量，再读取 `VERCEL_CONNECTOR_CLIENT_ID`。
3. 若 `VERCEL_INTEGRATION_REDIRECT_URI` 不存在，可继续用 `VERCEL_CONNECTOR_REDIRECT_URI` + `FRONTEND_URL` 拼出绝对地址。
4. 最终目标是前缀统一为 `VERCEL_INTEGRATION_*`。

### 4.3 Integration Console API Scopes

Vercel Integration Console 中需要开启以下权限：

```text
project: Read/Write
deployment: Read/Write
team: Read
user: Read
domain: Read/Write
integration-configuration: Read
global-project-env-vars: Read/Write
```

如果只允许管理 integration 自己创建的环境变量，可以用：

```text
project-env-vars: Read/Write
```

如果需要管理全部项目环境变量，应使用：

```text
global-project-env-vars: Read/Write
```

## 5. 授权启动流程

### 5.1 旧流程

旧流程由 `user-connector-service.ts` 生成普通 OAuth URL：

```text
https://vercel.com/oauth/authorize?client_id=...&scope=...&state=...
```

该流程本次迁移后不再用于 Vercel。

### 5.2 新流程

Vercel 在 `VERCEL_CONNECTOR_MODE=integration` 时应生成 Integration 安装 URL：

```text
https://vercel.com/integrations/oneceo/new?state=<state>
```

实现要求：

1. 继续复用现有 `connector_auth_requests` 表记录 `state`、`userId`、`profileId`、`returnToSessionId`。
2. Vercel Integration 安装流不使用 PKCE。
3. 不再拼接 `scope` 参数，scope 由 Vercel Integration Console 控制。
4. `state` 必须继续用于 CSRF 校验和回到对应 profile。

## 6. 授权回调流程

### 6.1 回调参数

Vercel Integration Redirect URL 会携带：

```text
code
teamId
configurationId
next
source
state
```

字段说明：

1. `code`：短期授权码，用于换取 Integration access token。
2. `teamId`：安装在 Team 时存在，后续 REST API 必须作为 `teamId` query。
3. `configurationId`：本次安装配置 ID，形如 `icfg_*`。
4. `next`：安装完成后跳回 Vercel 的 URL。
5. `source`：安装来源，例如 `external`、`marketplace`、`deploy-button`。
6. `state`：OneCEO 发起安装时生成的 CSRF state。

### 6.2 token exchange

用 `code` 换 token：

```http
POST https://api.vercel.com/v2/oauth/access_token
Content-Type: application/x-www-form-urlencoded

client_id=<integration-client-id>
client_secret=<integration-client-secret>
code=<code>
redirect_uri=<integration-redirect-uri>
```

注意：

1. endpoint 必须是 `/v2/oauth/access_token`。
2. 不再使用 `/login/oauth/token`。
3. 不再调用 `/login/oauth/userinfo` 作为 Vercel profile 显示名来源。

## 7. Profile 存储结构

### 7.1 secretCiphertext

保存敏感 token：

```json
{
  "source": "vercel_integration",
  "accessToken": "<access-token>",
  "tokenType": "Bearer"
}
```

说明：

1. Integration token 按长期 access token 处理。
2. 不要求存在 `refreshToken`。
3. token 不允许下发到 sandbox，只能由 OneCEO API 服务端用于调用 Vercel REST API。

### 7.2 configJson

保存非敏感运行上下文：

```json
{
  "vercelAuthMode": "integration",
  "teamId": "team_xxx",
  "configurationId": "icfg_xxx",
  "installationSource": "external"
}
```

说明：

1. `teamId` 可为空，表示安装在个人账号。
2. `configurationId` 必须保存，用于后续配置查询、卸载事件、重新安装识别。
3. `teamId` 优先级应高于用户手动填写的默认 Team ID。

### 7.3 metadataJson

保存便于展示的安装信息：

```json
{
  "vercelIntegrationSlug": "oneceo",
  "next": "<next-url>",
  "installedAt": "ISO datetime"
}
```

## 8. REST Client 行为

`apps/api/src/services/vercel-rest-client.ts` 当前已经支持 `context.teamId` 自动拼入 query：

```text
?teamId=team_xxx
```

迁移后需要确保：

1. `vercel-mcp-service.ts` 从 profile `configJson.teamId` 读取 Integration 安装 teamId。
2. 用户手动参数 `teamId` 可以覆盖默认值，但默认应来自 Integration 安装结果。
3. 403 错误日志中保留 Vercel 返回的 `code/message`，方便判断是 scope 还是 teamId。

## 9. Token 服务行为

`apps/api/src/services/vercel-token-refresh-service.ts` 需要调整：

1. 若 secret `source === "vercel_integration"`：
   - 有 `accessToken` 即返回。
   - 不要求 `refreshToken`。
   - 不做 refresh。
2. 若 secret 是旧 Sign in with Vercel：
   - 保留现有 refresh token 逻辑，作为过渡兼容。
3. 401/403 时：
   - 不自动把 Integration profile 标记为 `needs_auth`，除非 Vercel 明确表示 token 无效。
   - 错误提示应引导用户重新安装 Integration 或确认 scopes。

## 10. MCP 诊断工具

新增工具：

```text
vercel_get_auth_context
```

返回非敏感信息：

```json
{
  "authMode": "integration",
  "hasAccessToken": true,
  "teamId": "team_xxx",
  "configurationId": "icfg_xxx",
  "installationSource": "external",
  "integrationSlug": "oneceo"
}
```

目的：

1. 让 Altus 在执行写操作前能判断是否安装在 Team。
2. 避免模型在权限错误时只能猜测。
3. 方便 smoke 测试快速确认当前 profile 是否是 Integration token。

## 11. 需要修改的代码

### 11.1 Connector 定义

文件：

```text
apps/api/src/connectors/definitions/vercel.ts
```

改动：

1. 增加 Integration mode 解析。
2. 增加 `VERCEL_INTEGRATION_SLUG`、`VERCEL_INTEGRATION_CLIENT_ID`、`VERCEL_INTEGRATION_CLIENT_SECRET`、`VERCEL_INTEGRATION_REDIRECT_URI`。
3. Vercel 在 Integration mode 下不再返回普通 OAuth authorize/token/userinfo 配置。
4. catalog availability 需要检查 slug、client id、client secret、redirect uri、internal token、internal MCP URL。

### 11.2 OAuth 启动与回调

文件：

```text
apps/api/src/services/user-connector-service.ts
```

改动：

1. `startOAuthForProfile()` 对 Vercel Integration mode 走安装 URL。
2. `completeOAuthByProfile()` 对 Vercel Integration mode 走 `/v2/oauth/access_token`。
3. callback 入参需要接收 `teamId`、`configurationId`、`next`、`source`。
4. profile 保存 Integration token 与安装上下文。

### 11.3 Callback Route

文件：

```text
apps/api/src/routes/connector-routes.ts
```

改动：

1. 确认 `/vercel/callback` 或现有 connector callback 路由能接收 `configurationId`、`next`、`source`。
2. 若当前前端 callback 页面只传 `code/state`，需要同步传递额外参数到 API。
3. 成功后如果存在 `next`，可在页面显示“返回 Vercel”按钮或自动跳转。

### 11.4 Token 服务

文件：

```text
apps/api/src/services/vercel-token-refresh-service.ts
```

改动：

1. 支持 `source: "vercel_integration"`。
2. 不要求 refresh token。
3. 错误消息区分 token invalid、scope insufficient、teamId missing。

### 11.5 MCP 服务

文件：

```text
apps/api/src/services/vercel-mcp-service.ts
```

改动：

1. 新增 `vercel_get_auth_context`。
2. tool call request context 默认读取 Integration `teamId`。
3. project/domain/env 写操作继续打审计日志，但不记录 token。

### 11.6 测试

文件：

```text
apps/api/tests/vercel-oauth-connector.test.ts
apps/api/tests/vercel-mcp-service.test.ts
```

需要覆盖：

1. Vercel Integration start 生成 `/integrations/oneceo/new?state=...`。
2. start 不再携带 PKCE、scope、prompt。
3. callback 调 `/v2/oauth/access_token`。
4. callback 保存 `teamId`、`configurationId`、`source`。
5. Integration token 不要求 refresh token。
6. `vercel_get_auth_context` 返回非敏感安装上下文。
7. `vercel_create_project` 自动带 profile config 中的 `teamId`。

## 12. 验收标准

1. 点击 Vercel 连接按钮跳转到：

```text
https://vercel.com/integrations/oneceo/new?state=...
```

2. Vercel 回调后 profile 中保存：

```text
authStatus = authorized
configJson.teamId = team_xxx 或空
configJson.configurationId = icfg_xxx
secret.source = vercel_integration
```

3. `vercel_get_auth_context` 显示：

```text
authMode = integration
hasAccessToken = true
configurationId = icfg_xxx
```

4. Team 安装时，所有 Vercel REST API 自动带：

```text
teamId=team_xxx
```

5. `vercel_create_project` 不再因为旧 Sign in with Vercel scope 返回 `You don't have permission to create the project`。

6. 最小验证命令：

```bash
pnpm exec tsx --test apps/api/tests/vercel-oauth-connector.test.ts
pnpm exec tsx --test apps/api/tests/vercel-mcp-service.test.ts
pnpm --filter api type-check
```

## 13. 回滚与清理

本次迁移不保留双主链路。旧 Sign in with Vercel 只作为历史 profile 读取兼容，不作为新连接入口。

清理要求：

1. 新授权必须走 Integration。
2. 旧 `openid email profile offline_access` token 不能用于 MCP 写操作。
3. 已存在的旧 Vercel profile 需要用户重新连接，生成 Integration profile。
