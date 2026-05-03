# Vercel MCP Server ������������������͸�������ĵ� [20260425-2359���滻]

## 20260424-״̬����

���ļ��е�������͸�� public URL �����Կɲο������й�����ͨ Vercel OAuth endpoint��PKCE��userinfo��revoke token��VERCEL_MCP_REMOTE_URL �������ѱ� Vercel Integration ��Ȩ���������

更新时间�?026-04-24

## 1. 背景与目�?
当前目标是实现一条稳定可部署�?Vercel MCP Server 链路�?
`Agent -> oneceo Vercel MCP Server -> Vercel REST API`

你当前已经通过内网穿透把本地 Web 开发端口暴露到公网。该地址只应作为本地联调入口，不能写死进代码或设计文档中的固定配置。后续部署到服务器时，应只替换环境变量，不改业务代码�?
本方案文档只讨论 Vercel MCP Server 的可行性、环境变量设计、本�?ngrok/生产部署差异、关键链路与验收标准。代码实现需在你确认本文档后再进入�?
## 2. 官方依据

Vercel 官方资料支持本方案成立：

1. Vercel REST API
   - 官方文档�?https://vercel.com/docs/rest-api>
   - REST API 基础地址�?`https://api.vercel.com`�?   - 请求使用 `Authorization: Bearer <TOKEN>`�?   - 团队资源访问可通过 query string 追加 `teamId`�?
2. Sign in with Vercel / Authorization Server API
   - 官方文档�?https://vercel.com/docs/sign-in-with-vercel/authorization-server-api>
   - Authorization Endpoint：`https://vercel.com/oauth/authorize`
   - Token Endpoint：`https://api.vercel.com/login/oauth/token`
   - Revoke Token Endpoint：`https://api.vercel.com/login/oauth/token/revoke`
   - User Info Endpoint：`https://api.vercel.com/login/oauth/userinfo`

3. Vercel MCP Server 能力
   - 官方文档�?https://vercel.com/docs/mcp/vercel-mcp/tools>
   - 官方 MCP 工具覆盖文档搜索、团队、项目、部署、日志等能力�?   - 官方提醒：MCP 工具执行应启�?human confirmation，并注意 prompt injection 风险�?
4. 自定�?MCP Server 可部署到 Vercel
   - 官方文档�?https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel>
   - Vercel 支持部署自定�?MCP Server，并可结�?Vercel Functions、OAuth、预览部署和防护能力�?
因此，oneceo 自建 Vercel MCP Server 再调�?Vercel REST API 是可行路径�?
## 3. 当前工程事实

当前仓库已经存在 Vercel connector 主线设计与部分实现：

1. Vercel OAuth-only 方案文档
   - `docs/features/connectors/vercel_internal_mcp_wrapper_oauth_only_execution_plan_[20260425-2359���滻].md`

2. OAuth 点击连接修复文档
   - `docs/features/connectors/vercel_oauth_connect_click_flow_fix_doc_[20260423-2321已采用].md`

3. streamable_http 本地 bridge 修复文档
   - `docs/features/connectors/vercel_streamable_http_local_bridge_fix_doc_[20260425-2359���滻].md`

4. 现有关键代码位置
   - `apps/api/src/connectors/definitions/vercel.ts`
   - `apps/api/src/routes/internal-vercel-mcp-routes.ts`
   - `apps/api/src/services/vercel-mcp-service.ts`
   - `apps/api/src/services/vercel-rest-client.ts`
   - `apps/api/src/services/vercel-token-refresh-service.ts`
   - `apps/api/src/connectors/bridges/vercel-stdio-bridge.ts`
   - `apps/api/src/services/connector-registry.ts`

当前问题的核心不是“Vercel REST API 是否可行”，而是本地开发时如何�?sandbox/runtime 内的 bridge 能访问到 oneceo API �?internal MCP endpoint�?
## 4. 为什么不能写�?ngrok 地址

ngrok 免费域名通常会变化，写死会导致：

1. 本地重启 ngrok 后配置失效�?2. OAuth redirect URI �?Vercel App 配置不一致�?3. sandbox bridge 仍请求旧地址�?4. 生产部署时必须改代码，违背环境隔离�?
因此所有公网入口必须通过环境变量表达�?
## 5. 推荐环境变量设计

### 5.1 公共基础地址

建议统一使用以下语义�?
```env
# 用户浏览器访�?oneceo Web 的公网地址。本地联调时�?ngrok Web 地址，生产填正式前端域名�?FRONTEND_URL=https://<public-web-host>

# API 的公网地址。生产建议指向真�?API 域名；本地联调可按代理方案选择是否等于 FRONTEND_URL�?ONECEO_API_PUBLIC_URL=https://<public-api-host>
```

说明�?
1. 当前仓库已有 `FRONTEND_URL`，用�?OAuth redirect URI 解析、CORS 白名单等�?2. `ONECEO_API_PUBLIC_URL` 是建议新增的语义变量，用于避免把 internal MCP URL 误绑�?Web 域名�?3. 如果本地开发只暴露 Web 端口 3000，且 Vite 已把 `/api` 代理到本�?API 4000，则 `ONECEO_API_PUBLIC_URL` 可以暂时等于 `FRONTEND_URL`�?4. 生产环境不建议依�?Vite 代理，`ONECEO_API_PUBLIC_URL` 应直接指�?API 服务公网域名或反向代理后�?API 入口�?
### 5.2 Vercel OAuth 配置

```env
VERCEL_CONNECTOR_CLIENT_ID=<vercel-oauth-client-id>
VERCEL_CONNECTOR_CLIENT_SECRET=<vercel-oauth-client-secret>
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
VERCEL_CONNECTOR_SCOPES=
```

解析规则�?
1. `VERCEL_CONNECTOR_REDIRECT_URI` 推荐保持相对路径�?2. 服务端通过 `FRONTEND_URL + VERCEL_CONNECTOR_REDIRECT_URI` 生成完整回调地址�?3. Vercel OAuth App 后台配置�?redirect URI 必须与最终生成地址一致�?
本地联调示例�?
```env
FRONTEND_URL=https://<your-ngrok-host>
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
```

最终回调地址为：

```txt
https://<your-ngrok-host>/vercel/callback
```

### 5.3 oneceo Internal MCP 配置

```env
ONECEO_INTERNAL_TOKEN=<strong-random-token>
VERCEL_INTERNAL_MCP_URL=${ONECEO_API_PUBLIC_URL}/api/internal/connectors/vercel/mcp
VERCEL_BRIDGE_TIMEOUT_MS=30000
```

说明�?
1. `ONECEO_INTERNAL_TOKEN` 用于保护内部 MCP 路由�?2. `VERCEL_INTERNAL_MCP_URL` �?sandbox/runtime �?Vercel bridge 访问 oneceo internal MCP 的地址�?3. 这个地址必须�?sandbox/runtime 可访问�?4. 不能�?sandbox 链路中使�?`http://127.0.0.1:4000` �?`http://localhost:4000` 指向宿主机，因为 sandbox 内的 localhost 指向 sandbox 自己�?
### 5.4 本地 ngrok 开发推荐配�?
如果只把 Web 端口 3000 暴露出去，并�?Vite `/api` 代理到本�?API 4000�?
```env
FRONTEND_URL=https://<your-ngrok-host>
ONECEO_API_PUBLIC_URL=https://<your-ngrok-host>
VERCEL_INTERNAL_MCP_URL=https://<your-ngrok-host>/api/internal/connectors/vercel/mcp
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
ONECEO_INTERNAL_TOKEN=<local-random-token>
```

同时 Web Vite dev server 必须允许 ngrok Host�?
建议不要把某个临�?ngrok host 写死�?`vite.config.ts`。更好的方式是新增环境变量：

```env
WEB_DEV_ALLOWED_HOSTS=.ngrok-free.app
```

然后�?Vite 配置读取并追加到 `server.allowedHosts`�?
如果暂时不改代码，也可以临时�?`allowedHosts` 中加�?`.ngrok-free.app`。但长期方案应走环境变量�?
### 5.5 生产部署推荐配置

生产环境建议分离前端域名�?API 域名�?
```env
FRONTEND_URL=https://app.example.com
ONECEO_API_PUBLIC_URL=https://api.example.com
VERCEL_INTERNAL_MCP_URL=https://api.example.com/api/internal/connectors/vercel/mcp
VERCEL_CONNECTOR_REDIRECT_URI=/vercel/callback
ONECEO_INTERNAL_TOKEN=<production-secret>
```

生产环境还需要：

1. API CORS 允许 `FRONTEND_URL`�?2. Vercel OAuth App redirect URI 配置�?`https://app.example.com/vercel/callback`�?3. `VERCEL_INTERNAL_MCP_URL` 所�?API 路由只允许内�?token 访问�?4. 日志不得输出 OAuth access token、refresh token、internal token、runtime auth token�?
## 6. 目标链路设计

### 6.1 用户授权链路

```txt
用户点击连接 Vercel
-> Web 调用 /api/connectors/vercel/oauth/start
-> API 创建 state + PKCE + profile
-> 浏览器跳�?Vercel Authorization Endpoint
-> Vercel 回调 FRONTEND_URL + /vercel/callback
-> Web 调用 /api/connectors/vercel/oauth/callback
-> API 换取 access token / refresh token
-> API �?userinfo 填充 profile
-> 保存加密后的 secret
```

### 6.2 Session attach 链路

```txt
用户�?Vercel profile attach �?session
-> connector-registry materialize Vercel runtime config
-> 生成 local_stdio bridge command
-> 注入 VERCEL_INTERNAL_MCP_URL / ONECEO_INTERNAL_TOKEN / runtime auth
-> OSAC 注册 MCP provider
-> sandbox/runtime 启动 local stdio bridge
-> bridge 通过公网 URL 请求 oneceo internal MCP
-> internal MCP 再用用户 OAuth token �?Vercel REST API
```

### 6.3 Tool call 链路

```txt
Agent �?vercel_list_projects
-> runtime �?local_stdio bridge
-> bridge POST VERCEL_INTERNAL_MCP_URL
-> internal-vercel-mcp-routes 校验 internal token + runtime auth
-> vercel-mcp-service 校验 session/profile 绑定
-> vercel-rest-client �?https://api.vercel.com
-> 返回 MCP JSON-RPC result
```

## 7. v1 工具范围

建议 v1 保持短路径，只做高频�?REST 映射稳定的工具：

1. `vercel_list_projects`
2. `vercel_get_project`
3. `vercel_list_deployments`
4. `vercel_get_deployment`
5. `vercel_get_deployment_events`
6. `vercel_list_project_domains`
7. `vercel_list_env_vars`
8. `vercel_add_project_domain`
9. `vercel_upsert_env_var`
10. `vercel_remove_env_var`
11. `vercel_redeploy_deployment`

暂不纳入 v1�?
1. 源码打包上传式创�?deployment�?2. 全量复制 Vercel 官方 MCP 工具矩阵�?3. 绕过 oneceo session/profile 绑定的裸 REST API 代理�?
## 8. 安全边界

必须满足�?
1. OAuth token 只保存在 API 服务端，不下发到 sandbox�?2. sandbox 只拿�?`VERCEL_INTERNAL_MCP_URL`、`ONECEO_INTERNAL_TOKEN` �?session-scoped runtime auth�?3. internal MCP 每次 tool call 必须校验�?   - `taskSessionId`
   - `userId`
   - `profileId`
   - session connector binding
   - profile 授权状�?4. 写操作必须要求明确项目上下文�?5. 修改环境变量必须显式传入 target，例�?`production`、`preview`、`development`�?6. 删除、覆盖、生产环境写操作需要进入人类确认策略�?7. 日志中禁止输出：
   - Vercel access token
   - Vercel refresh token
   - Authorization header
   - `ONECEO_INTERNAL_TOKEN`
   - `x-oneceo-connector-runtime-auth`

## 9. 本地联调流程

### 9.1 启动 API

```powershell
$env:FRONTEND_URL="https://<your-ngrok-host>"
$env:ONECEO_API_PUBLIC_URL="https://<your-ngrok-host>"
$env:VERCEL_INTERNAL_MCP_URL="https://<your-ngrok-host>/api/internal/connectors/vercel/mcp"
$env:VERCEL_CONNECTOR_REDIRECT_URI="/vercel/callback"
$env:ONECEO_INTERNAL_TOKEN="<local-random-token>"
$env:ONECEO_REDIS_ENABLED="false"
pnpm --filter api dev
```

### 9.2 启动 Web

```powershell
$env:WEB_DEV_ALLOWED_HOSTS=".ngrok-free.app"
pnpm --filter web dev
```

如果当前代码尚未读取 `WEB_DEV_ALLOWED_HOSTS`，需要先�?Vite 配置；否�?Vite 会阻�?ngrok host�?
### 9.3 启动 ngrok

```powershell
ngrok http 3000
```

ngrok 输出的新 HTTPS 域名只写入本�?`.env` 或当�?shell 环境变量，不写入代码�?
### 9.4 Vercel OAuth App 配置

�?Vercel OAuth App 后台配置 redirect URI�?
```txt
https://<your-ngrok-host>/vercel/callback
```

每次 ngrok host 变化，都需要同步更新：

1. `FRONTEND_URL`
2. `ONECEO_API_PUBLIC_URL`
3. `VERCEL_INTERNAL_MCP_URL`
4. Vercel OAuth App redirect URI
5. Vite allowed host 配置�?`WEB_DEV_ALLOWED_HOSTS`

## 10. 验收标准

### 10.1 OAuth 验收

1. 点击 Vercel 连接后进�?Vercel OAuth 授权页�?2. 回调地址�?`FRONTEND_URL + VERCEL_CONNECTOR_REDIRECT_URI`�?3. callback �?profile 状态为 `authorized`�?4. secret 中包含加密后�?access token / refresh token / expiresAt�?
### 10.2 Internal MCP 验收

1. `POST /api/internal/connectors/vercel/mcp` 缺少 internal token 时返�?401�?2. 缺少 runtime auth 时返�?401�?3. `tools/list` 返回 v1 Vercel 工具列表�?4. 非绑�?session/profile 调用 tool 被拒绝�?
### 10.3 Session attach 验收

1. Vercel provider runtime transport 最终为 `local_stdio`�?2. binding 进入 `connected`�?3. `runtimeAttachedToolsJson` �?Vercel 工具�?4. 不再出现 `unsupported mcp transport: streamable_http`�?
### 10.4 实际工具调用验收

1. `vercel_list_projects` 成功返回项目列表�?2. 指定 `teamId` 时能访问团队项目�?3. access token 过期后能 refresh 并重试一次�?4. `vercel_upsert_env_var` 缺少 target 时拒绝执行�?5. 写操作日志只记录 project/key/target 等非敏感信息�?
## 11. 风险与处�?
### 11.1 ngrok host 变化

风险：OAuth redirect URI、CORS、Vite allowed host、internal MCP URL 不一致�?
处理：所有公�?host 都通过 env 管理；本地联调时建立一�?`.env.local.ngrok` 或启动脚本集中设置�?
### 11.2 Web 端口代理 API 不稳�?
风险：sandbox bridge 访问 `FRONTEND_URL/api/internal/...` 时依�?Vite proxy，Vite 重启�?Host 拦截会导�?MCP 不可用�?
处理：本地可以接受；生产必须使用真实 API 公网入口作为 `ONECEO_API_PUBLIC_URL`�?
### 11.3 Redis 噪音影响判断

风险：本�?Redis 未启动但 `ONECEO_REDIS_ENABLED=true`，日志中大量 `[redis] get_json failed` 干扰排查�?
处理：本地联�?Vercel MCP 时默认设置：

```env
ONECEO_REDIS_ENABLED=false
```

### 11.4 Token 泄漏

风险：bridge env、debug log、错误响应泄�?token�?
处理：所有内�?token 只参�?header 注入，日志只输出是否存在，不输出值�?
## 12. 实施任务拆分

### 阶段 A：环境变量收�?
1. 增加或确�?`ONECEO_API_PUBLIC_URL`�?2. `VERCEL_INTERNAL_MCP_URL` 优先显式读取 env�?3. Vite `allowedHosts` 支持�?`WEB_DEV_ALLOWED_HOSTS` 追加�?4. 文档补充本地 ngrok 与生产部署差异�?
### 阶段 B：Internal MCP 验证

1. 测试 `tools/list`�?2. 测试 runtime auth 校验�?3. 测试 session/profile binding 校验�?4. 测试 Vercel REST client 401 refresh retry�?
### 阶段 C：Session attach 验证

1. OAuth 授权成功�?attach Vercel�?2. 确认 provider transport �?`local_stdio`�?3. 确认 bridge 能从 sandbox 访问 `VERCEL_INTERNAL_MCP_URL`�?4. 确认 `vercel_list_projects` 实际调用成功�?
### 阶段 D：生产部署准�?
1. �?`FRONTEND_URL` 替换为正�?Web 域名�?2. �?`ONECEO_API_PUBLIC_URL` 替换为正�?API 域名�?3. �?Vercel OAuth App redirect URI 替换为正式回调地址�?4. 配置 `ONECEO_INTERNAL_TOKEN` 为生产强随机值�?5. 确认 CORS、Cookie、反向代理、HTTPS 终止位置一致�?
## 13. 结论

该方案可行�?
关键判断是：

1. Vercel 官方 REST API 能支�?oneceo 自建 MCP wrapper�?2. Vercel 官方 OAuth 端点能支撑用户授权�?3. oneceo 当前 connector/session/OSAC/MCP runtime 架构已经具备接入条件�?4. 本地 ngrok 只能作为环境变量中的公网入口，不能写死�?5. sandbox 内访�?oneceo internal MCP 时，必须使用 sandbox 可达的公�?URL，不能使用宿主机 localhost�?
本文档当前状态为 `[20260424-1914已采用]`。已按本文进入代码实现阶段；后续若方案被替换、暂停或废弃，需要同步更新文件名、标题与引用状态�?
