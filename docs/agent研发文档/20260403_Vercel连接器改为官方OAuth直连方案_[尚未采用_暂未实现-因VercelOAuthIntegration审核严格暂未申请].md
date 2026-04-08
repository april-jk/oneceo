# 20260403 Vercel 连接器改为官方 OAuth 直连方案 [尚未采用：暂未实现，因 Vercel OAuth integration 审核严格暂未申请]

更新时间：2026-04-03

参考：

1. Manus 当前 Vercel 连接流程
2. [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)
3. [Vercel Authorization Server API](https://vercel.com/docs/sign-in-with-vercel/authorization-server-api)

## 0. 当前暂未实现原因

当前暂未进入正式实现，不是方案本身有问题，而是前置条件尚未满足：

1. 要走 Manus 式官方 OAuth 单路径，必须先申请并拿到 Vercel OAuth integration 的 `client_id / client_secret`
2. 当前该 integration 的审核较严格，团队暂时还未提交申请
3. 因此前台无感 OAuth 闭环暂时无法真正打通

所以本方案当前状态应视为：

1. 方案已明确
2. 开发任务已拆分
3. 等待 Vercel OAuth integration 申请后再继续

## 1. 背景

当前 oneceo 的 Vercel connector 已经完成了：

1. connector guide 隐式挂载
2. runtime `load_connector_guide`
3. `connector_guide_blocked:vercel -> load -> retry` 自动化闭环
4. 官方 MCP 地址 `https://mcp.vercel.com` 的运行时接入

但当前授权方案仍然保留了手动输入 access token 的路径，这与新的产品要求冲突。

用户已明确要求：

1. 避免手动输入密钥
2. 参照 Manus 的 Vercel 连接方式
3. 点击连接时直接跳转到 Vercel OAuth
4. 用户点击 Allow 后回调回平台，自动完成授权

因此本次方案需要进一步收敛：

> Vercel connector 改为官方 OAuth 直连模式，不再以手动 token 输入作为用户主路径。

## 2. 目标

本次方案只解决一件事：

1. 让 oneceo 的 Vercel connector 像 Manus 一样，使用官方 OAuth 完成授权

并满足以下产品约束：

1. 用户侧点击“连接”后直接跳转 Vercel OAuth 授权页
2. 用户侧不再手动粘贴 Vercel token
3. 授权成功后自动回调 oneceo，并把 access token 写入对应 profile
4. 运行时继续使用官方 MCP 地址 `https://mcp.vercel.com`
5. 继续沿用现有 connector guide 隐式挂载体系

## 3. 非目标

本次不做：

1. 不再保留“用户手动输入 Vercel access token”作为前台主路径
2. 不把 Vercel 接成自定义 MCP
3. 不改变 GitHub / Slack / Notion 等其他 connector 的授权方式
4. 不改变 connector guide 的运行时规则

## 4. 参考 Manus 的目标行为

目标链路与 Manus 对齐为：

1. 用户点击连接 Vercel
2. 前端请求平台生成 OAuth authorization URL
3. 平台生成带 PKCE 的官方 Vercel OAuth URL
4. 浏览器跳转：

```text
https://vercel.com/oauth/authorize?...&code_challenge=...&code_challenge_method=S256&redirect_uri=...&state=...
```

5. 用户在 Vercel 页面点击 Allow
6. Vercel 回调到 oneceo
7. oneceo 使用 `code + code_verifier` 向 Vercel token endpoint 兑换 token
8. oneceo 保存 profile secret，并把 profile 标记为 `authorized`
9. 后续 session attach / MCP 调用继续走官方 MCP 地址

## 5. 为什么必须这样收敛

如果继续保留“手动 token + 可选 OAuth”双路径，会产生以下问题：

1. 用户心智混乱
2. 前端表单逻辑复杂
3. 文档与引导会出现分叉
4. 与 Manus 对齐目标不成立

用户已经明确要求“避免手动输入密钥”，因此本次不应继续保留前台手动 token 作为主路径。

## 6. 平台方案

### 6.1 连接器定义

Vercel definition 收敛为：

1. `authMode = oauth`
2. `runtime.type = remote`
3. `runtime.urlDefault = https://mcp.vercel.com`
4. `oauth.supported = true`

同时：

1. 不再因为 `VERCEL_MCP_REMOTE_URL` 缺失而把 connector 标记成 unavailable
2. 平台是否可连接，改由 Vercel OAuth client 配置决定

### 6.2 前端连接流程

Vercel connector 点击“连接”后：

1. 调 `/api/connectors/profiles/:id/oauth/start`
2. 返回官方 Vercel authorize URL
3. 浏览器直接跳转

用户不再看到 token 输入框作为主入口。

### 6.3 OAuth callback

平台 callback 处理逻辑：

1. 从 `connector_auth_requests` 读取 `state`
2. 读取已保存的 `code_verifier`
3. 调用 Vercel token endpoint 兑换 token
4. 调用 `https://api.vercel.com/www/user` 获取 display name
5. 写回 `user_connector_profiles.secret_ciphertext`
6. 标记 `auth_status = authorized`

### 6.4 运行时接入

授权成功后，运行时保持不变：

1. session attach 仍由 `session-connector-service.ts` 负责
2. runtime config 仍使用 remote MCP
3. endpoint 仍是 `https://mcp.vercel.com`
4. Authorization 仍从 profile secret 注入 Bearer token

## 7. 数据与状态

### 7.1 继续复用

继续复用：

1. `user_connector_profiles`
2. `connector_auth_requests`
3. `task_session_connector_bindings`
4. `task_session_connector_guides`

### 7.2 不新增新表

本次不需要新增数据表。

因为 PKCE 所需的 `code_verifier` 字段已经存在于 `connector_auth_requests`。

## 8. 受影响模块

后端：

1. `apps/api/src/connectors/definitions/vercel.ts`
2. `apps/api/src/connectors/definitions/index.ts`
3. `apps/api/src/services/user-connector-service.ts`
4. `apps/api/src/services/connector-registry.ts`
5. `apps/api/src/routes/connector-routes.ts`
6. `apps/api/tests/connector-registry.test.ts`
7. `apps/api/tests/user-connector-service.test.ts`

前端：

1. `apps/web/client/src/components/ConnectorDialog.tsx`
2. `apps/web/client/src/lib/connector-guides.ts`
3. `apps/web/client/src/lib/connectors-client.ts`

文档：

1. `docs/agent研发文档/连接器模块参照Suna Integrations重构设计.md`
2. `docs/agent研发文档/20260401_连接器隐式Skills挂载与后台管理设计_[20260401-1037已采用].md`

## 9. 最短路径实现

### 9.1 后端

1. Vercel provider 固定支持 OAuth
2. `startOAuthForProfile()` 对 Vercel 生成 PKCE URL
3. `completeOAuthByProfile()` 对 Vercel 使用 `code_verifier` 兑换 token
4. 不再要求用户先提供手动 token

### 9.2 前端

1. Vercel connector 主操作改为“连接”
2. 不再展示手动 token 输入为主路径
3. OAuth 成功回跳后刷新 connector 状态

### 9.3 测试

至少覆盖：

1. `startOAuthForProfile(vercel)` 生成带 `code_challenge` 的 URL
2. `completeOAuthByProfile(vercel)` 正确带 `code_verifier`
3. 当前用户视角下 Vercel catalog 为可连接
4. 真实连接成功后，可 attach 到 session
5. attach 后 guide 正常生效
6. Vercel MCP 工具能在真实 run 中使用

## 10. 验收标准

达到以下结果才算完成：

1. 用户在连接器中心点击 Vercel，只走 OAuth，不再要求手动填 token
2. 浏览器跳转到官方 Vercel OAuth 页面
3. 点击 Allow 后自动回调回 oneceo
4. oneceo 中对应 profile 变为 `authorized`
5. session 可 attach 该 Vercel profile
6. Altus 在真实 run 中能按 guide 规则使用 Vercel MCP

## 11. 当前唯一前置条件

要实现 Manus 这种 OAuth 流程，平台必须具备：

1. `VERCEL_CONNECTOR_CLIENT_ID`
2. `VERCEL_CONNECTOR_CLIENT_SECRET`

没有这两个配置，就无法真正生成官方 OAuth 链接并完成 token 兑换。

所以代码改造之外，还必须同步补上 Vercel OAuth app 配置。
