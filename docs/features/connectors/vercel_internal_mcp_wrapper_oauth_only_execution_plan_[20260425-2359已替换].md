# Vercel �ڲ� MCP ��װ�� OAuth-only ����ִ�з��� [20260425-2359���滻]

## 20260424 状态更�?
本文件中关于 “OAuth-only / Sign in with Vercel / PKCE / userinfo / refresh token / revoke token�?的授权描述已�?`vercel_integration_oauth_migration_doc_[20260424-2035已采用].md` 替代。当前仍沿用本文件的部分只有 internal MCP wrapper �?sandbox 不直�?Vercel token 的运行边界�?
## 1. 背景与目�?
当前仓库里的 `vercel` 连接器实现方向与本次需求不一致：

1. `apps/api/src/connectors/definitions/vercel.ts` 当前仍允�?`token` 直连�?2. 当前 runtime 直接指向官方 MCP：`https://mcp.vercel.com`�?3. 前端引导文案仍把 Personal Access Token 作为可见入口�?
本次目标明确收敛为唯一方案�?
`Agent -> oneceo 自建 Vercel MCP server -> Vercel REST API`

并满足以下硬约束�?
1. 只允�?OAuth，不允许 Personal Access Token 录入或作为用户入口�?2. 不直接使用官�?Vercel MCP，不�?`https://mcp.vercel.com` 挂进 session runtime�?3. 继续复用 oneceo 现有 connector-level OAuth、session attach、OSAC provider lifecycle、MCP 恢复链路�?4. 保持 oneceo 的“统一 MCP tool runtime”架构，不为 Vercel 单独开旁路调用�?
## 2. 为什么必须走内部包装�?
### 2.1 外部约束

Vercel 官方文档说明，官�?Vercel MCP 只支持“被 Vercel 审核并批准”的 AI client，因此把 oneceo 直接当作官方 MCP client 不是最稳妥主线�?
参考：

- Vercel MCP 文档�?https://vercel.com/docs/agent-resources/vercel-mcp>
- 其中明确写到官方 MCP “only supports AI clients that have been reviewed and approved by Vercel�?
### 2.2 仓库现状

oneceo 已经具备�?
1. 用户�?connector OAuth 落库与回调链路：
   - `apps/api/src/services/user-connector-service.ts`
   - `apps/api/src/routes/connector-routes.ts`
2. session attach / detach / recovery 闭环�?   - `apps/api/src/services/session-connector-service.ts`
   - `apps/api/src/services/session-mcp-recovery-service.ts`
3. 运行�?MCP provider 注册与恢复：
   - `apps/api/src/routes/osac-routes.ts`
   - `apps/api/src/services/connector-registry.ts`

因此，最短路径不是绕开现有连接器系统，而是�?Vercel 接成“平台自�?remote MCP provider”�?
## 3. 方案结论

采用以下唯一实现路径�?
1. 保留 Vercel 作为 oneceo 内置 connector�?2. 用户在平台外完成 Vercel OAuth�?3. 平台加密保存 OAuth access token / refresh token / scope�?4. session attach 时，不再把官�?MCP 地址投影�?sandbox�?5. 改为�?oneceo 自建�?`internal vercel mcp server` 注册�?remote MCP provider�?6. internal MCP server 收到 tool call 后，再以用户 OAuth token �?Vercel REST API�?
也就是说�?
- MCP �?agent 可见
- OAuth 对用户可�?- Vercel REST API 对平台内部可�?- 官方 MCP 对主链路不可�?
## 4. 与现�?Slack / Supabase 的对应关�?
### 4.1 参照 Slack

Vercel 的授权入口应当参�?Slack �?connector-level OAuth 形态，而不�?token 表单�?
对齐点：

1. `authMode` 固定�?`oauth`
2. 前端详情页走 OAuth 卡片模式
3. 回调成功后复用现�?runtime refresh / session attach 机制

参考文档：

- `docs/features/connectors/slack_mcp_oauth_fixed_redirect_uri_state_execution_doc_[20260412-1710已采用].md`
- `docs/features/connectors/slack_notion_github_style_oauth_card_redesign_[20260415-1932已采用].md`

### 4.2 参照 Supabase

Vercel 的“自�?MCP 包装层”思路应当参照 Supabase �?runtime materialize 方式：由 oneceo 自己控制最终注入到 MCP runtime �?provider，而不是把第三方官�?MCP 原样暴露�?agent�?
对齐点：

1. Vercel runtime �?`connector-registry.ts` 统一 materialize
2. provider attach / detach / recover 继续�?`session-connector-service.ts`
3. agent 感知到的�?MCP tool，不是业务直�?REST API

参考实现：

- `apps/api/src/connectors/bridges/supabase-stdio-bridge.ts`
- `apps/api/src/services/connector-registry.ts`

## 5. OAuth 方案

### 5.1 OAuth-only

Vercel 连接器改�?OAuth-only�?
1. `apps/api/src/connectors/definitions/vercel.ts`
   - 删除 `token` 模式
   - 删除 `accessToken` 配置字段
   - `authMode` 固定�?`oauth`
2. 前端不再出现 Personal Access Token 输入框、提示语和帮助链�?3. 清理 Vercel guide / locale 中“如�?OAuth 没配就用 token”的文案

### 5.2 OAuth 端点

应按 Vercel 当前官方 Authorization Server API 对齐，而不是继续沿用仓库里旧端点�?
官方文档当前给出的端点为�?
1. Authorization Endpoint:
   - `https://vercel.com/oauth/authorize`
2. Token Endpoint:
   - `https://api.vercel.com/login/oauth/token`
3. Revoke Endpoint:
   - `https://api.vercel.com/login/oauth/token/revoke`
4. User Info Endpoint:
   - `https://api.vercel.com/login/oauth/userinfo`

参考：

- <https://vercel.com/docs/sign-in-with-vercel/authorization-server-api>

### 5.3 OAuth 数据处理

继续复用现有 `connector_auth_requests` �?`user_connector_profiles`，不新增授权专用表�?
要求�?
1. 保留 PKCE
2. 保留 `state` �?`returnToSessionId`
3. access token / refresh token 继续走加密存�?4. callback 后用 `userinfo` 填充 displayName / profileName

## 6. MCP 包装层形�?
### 6.1 采用 remote MCP provider，不采用 local stdio bridge

本次推荐直接做平台内 remote MCP server，挂�?`apps/api` 内部路由下，�?OSAC/runtime 来说它仍然是标准 remote MCP provider�?
原因�?
1. 最贴合“你�?Agent -> 你的 MCP server -> Vercel REST API”要�?2. 最贴合 oneceo 现有 remote provider attach / recover 能力
3. 不需要在 sandbox 内额外启动一�?Vercel 专属 Node bridge 进程
4. 便于统一做权限、审计、限流、日志脱敏、用户隔�?
### 6.2 推荐传输

优先使用 `streamable_http`�?
原因�?
1. 当前仓库 `ConnectorDefinition.runtime.transport` 已支�?`streamable_http`
2. Vercel REST API 本身�?request/response 型，天然更适合 streamable HTTP MCP 包装
3. 对部署事件、日志流等再按工具级别决定是否做增量流式返回，不必把整个 provider 设计�?SSE first

## 7. 内部 MCP server 的职责边�?
内部 Vercel MCP server 只做三类事情�?
1. MCP 协议适配
2. 用户授权上下文解�?3. Vercel REST API 映射

明确不做�?
1. 不把 Vercel 官方 MCP 再代理一�?2. 不做“官�?MCP 优先，REST 兜底”的兼容双轨
3. 不做匿名共享 token
4. 不绕过现�?`user_connector_profiles` / session binding

## 8. v1 工具范围

为了走最短路径，v1 只覆盖高频且容易稳定映射�?REST API 的工具，不追求复刻官�?MCP 全量工具�?
### 8.1 读操�?
1. `vercel_list_projects`
2. `vercel_get_project`
3. `vercel_list_deployments`
4. `vercel_get_deployment`
5. `vercel_get_deployment_events`
6. `vercel_list_project_domains`
7. `vercel_list_env_vars`

### 8.2 写操�?
1. `vercel_add_project_domain`
2. `vercel_upsert_env_var`
3. `vercel_remove_env_var`
4. `vercel_redeploy_deployment`

### 8.3 暂不纳入 v1

以下能力先不进入本轮主方案：

1. 通用源码打包上传式新�?deployment
2. 覆盖全部项目设置写操�?3. 复刻官方 MCP 的全部文档搜�?/ 全量工具矩阵

原因不是降级，而是为了保证 first usable version 最短闭环，并避免把复杂度引入上传文件、构建输入和长任务编排�?
## 9. 平台侧实现拆�?
### 9.1 Connector 定义�?
文件�?
- `apps/api/src/connectors/definitions/vercel.ts`

改动�?
1. 改成 OAuth-only
2. 删除 token 配置字段
3. runtime 从官�?MCP URL 改为 oneceo internal MCP URL
4. 允许通过 profile config 保留可选上下文�?   - `teamId`
   - `projectId`
   - `projectSlug`

说明�?
- 这些上下文字段是“工具默认上下文”，不是授权凭证

### 9.2 OAuth 服务�?
文件�?
- `apps/api/src/services/user-connector-service.ts`

改动�?
1. 更新 Vercel OAuth token endpoint
2. callback 后保�?refresh token
3. �?`userinfo` 获取显示�?4. 增加 Vercel token refresh 能力
5. revoke 时调官方 revoke endpoint

### 9.3 Runtime materialize �?
文件�?
- `apps/api/src/services/connector-registry.ts`

改动�?
1. Vercel runtime 不再 materialize �?`https://mcp.vercel.com`
2. 改为 materialize �?oneceo internal MCP URL
3. headers 不再直接透传第三�?token �?sandbox
4. 改为�?oneceo 内部签名头或 session-scoped internal auth header

关键点：

- sandbox 只能访问 oneceo internal MCP endpoint
- Vercel OAuth token 只在平台服务端使用，不下发到 sandbox

### 9.4 Internal MCP server

建议新增�?
- `apps/api/src/routes/internal-vercel-mcp-routes.ts`
- `apps/api/src/services/vercel-mcp-service.ts`
- `apps/api/src/services/vercel-rest-client.ts`
- `apps/api/src/services/vercel-token-refresh-service.ts`

职责�?
1. `internal-vercel-mcp-routes.ts`
   - 提供 MCP HTTP 入口
2. `vercel-mcp-service.ts`
   - 返回 tool schema
   - 派发 tool call
3. `vercel-rest-client.ts`
   - 封装 Vercel REST API
4. `vercel-token-refresh-service.ts`
   - 处理 access token 过期�?refresh

### 9.5 Session attach / recovery

复用现有�?
- `apps/api/src/services/session-connector-service.ts`
- `apps/api/src/services/session-mcp-recovery-service.ts`

原则�?
1. 不新增旁�?attach 逻辑
2. 不新�?Vercel 专属恢复�?3. Vercel 仍然是普�?connector，只�?runtime provider 指向 internal MCP

## 10. 安全与隔离要�?
### 10.1 用户隔离

必须满足�?
1. 每次 tool call 都能反查到：
   - `app_users.id`
   - connector profile id
   - task session id
2. 不允许跨用户复用 access token
3. 不允许把 OAuth token 暴露�?sandbox env

### 10.2 写操作保�?
Vercel 属于部署与环境基础设施，写操作必须增加 server-side guard�?
1. 没有明确 `projectId` / `projectSlug` 时拒绝写操作
2. 涉及生产环境变量时要求参数显式写出目标环�?3. 删除类操作记录审计日�?
这部分要继续�?`connector-guide-service.ts` �?Vercel guide 保持一致�?
### 10.3 Token 生命周期

要求�?
1. access token 失效时自�?refresh
2. refresh 失败则把 profile 标为 `needs_auth`
3. 不在日志中打�?token、refresh token、Authorization header

## 11. 前端改�?
文件范围�?
- `apps/web/client/src/lib/connector-guides.ts`
- `apps/web/client/src/locales/zh.json`
- `apps/web/client/src/locales/en.json`
- �?Vercel 详情页仍走通用表单，则同步调整 `ConnectorCenterPanel.tsx`

改动目标�?
1. Vercel 文案改成 OAuth-only
2. 删除 Personal Access Token 指导文案
3. 引导用户完成 OAuth 并说明本连接器通过平台内部 MCP 访问 Vercel
4. 明确强调项目/团队上下文的重要�?
## 12. 数据与协议约�?
### 12.1 不新增的数据�?
本方案不要求新增以下授权/绑定表：

1. `connector_auth_requests`
2. `user_connector_profiles`
3. `task_session_connector_bindings`
4. `task_session_mcp_recovery_jobs`

### 12.2 可能新增的数据字�?
如现�?`secret` 结构未稳定保�?refresh token，则需要补齐：

1. `refreshToken`
2. `tokenType`
3. `scope`
4. `expiresAt` 或可推导过期信息

优先复用现有 secret JSON 结构，不单独开 Vercel token 表�?
## 13. 测试计划

### 13.1 API / 服务测试

建议新增或调整：

1. `apps/api/tests/user-connector-service.test.ts`
   - Vercel start OAuth 使用�?token endpoint 对应配置
   - callback 正确保存 refresh token
   - refresh 失败时标�?`needs_auth`
2. `apps/api/tests/connector-registry.test.ts`
   - catalog �?Vercel 不再暴露 token 字段
   - runtime URL 不再�?`https://mcp.vercel.com`
3. 新增 `apps/api/tests/vercel-mcp-service.test.ts`
   - tools/list
   - tools/call -> REST 映射
   - 401 �?refresh 重试
4. 新增 `apps/api/tests/session-connector-service.test.ts`
   - Vercel attach / recover 继续正常

### 13.2 Web 测试

建议新增或调整：

1. Vercel 详情页不再出�?token 输入�?2. OAuth 按钮与说明文案正�?3. OAuth 成功后仍能触�?runtime refresh / session attach

### 13.3 手工联调

必须覆盖�?
1. 新建 session，连�?Vercel，attach 成功
2. agent 调用 `vercel_list_projects`
3. 指定项目后读�?deployments
4. 修改 env var
5. sandbox 重启�?recovery 成功
6. access token 过期后自�?refresh

## 14. 实施顺序

按最短闭环执行：

1. 更新设计文档并确认采�?2. �?`vercel.ts` �?OAuth-only + internal MCP runtime
3. 修正 `user-connector-service.ts` 中的 Vercel OAuth 端点�?refresh/revoke/userinfo
4. �?internal Vercel MCP server
5. �?`connector-registry.ts` materialize
6. �?attach / recovery / tool-call 测试
7. 更新前端 guide �?locale

## 15. 采用前需要你确认的点

如果按本方案进入实现，默认采用以下口径：

1. Vercel v1 只做“项�?/ 部署 / 域名 / 环境变量”这一组工�?2. runtime 采用 oneceo internal remote MCP server
3. 用户侧完全移�?Personal Access Token 入口
4. 不再接入官方 `https://mcp.vercel.com`

## 16. 参考资�?
1. Vercel Authorization Server API
   - <https://vercel.com/docs/sign-in-with-vercel/authorization-server-api>
2. Vercel REST API
   - <https://vercel.com/docs/rest-api>
3. Vercel MCP
   - <https://vercel.com/docs/agent-resources/vercel-mcp>
