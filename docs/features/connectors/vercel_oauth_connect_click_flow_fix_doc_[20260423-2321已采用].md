# Vercel OAuth 点击连接流程修复文档 [20260423-2321已采用]

## 20260424-״̬����

���ļ��޸����Ǿ� Sign in with Vercel �����·����ǰ Vercel MCP ��Ȩ��Ǩ�Ƶ� Vercel Integration install flow�����ļ�����Ϊ��ʷ�����¼��������Ϊ��ʵ�����ݡ�

## 1. 问题背景

用户反馈 Vercel MCP 连接器点击“连接”后没有成功，并且表现为点击后没有明显授权操作就直接进入回调/连接状态，怀疑当前实现没有做必要判断而直接回调�?
本次问题属于既有 Vercel internal MCP OAuth-only 方案的修复，不改变主方案�?
`Agent -> oneceo internal Vercel MCP server -> Vercel REST API`

依据文档�?
- `docs/features/connectors/vercel_internal_mcp_wrapper_oauth_only_execution_plan_[20260425-2359���滻].md`

## 2. 当前链路检查结�?
### 2.1 后端回调不是无判断直接通过

后端 OAuth callback 当前会做以下校验�?
1. `connector_auth_requests` 中必须存在对�?`state`�?2. `request.userId` 必须等于当前登录用户�?3. `request.connectorKey` 必须等于当前 connector�?4. `request.profileId` 必须存在，并�?profile callback 场景匹配�?5. 请求未过期�?6. PKCE 场景必须存在并使�?`code_verifier` �?token�?7. token 交换后必须拿�?`access_token`�?8. Vercel callback 后会调用 `userinfo` 填充 `displayName/profileName`�?
对应代码�?
- `apps/api/src/services/user-connector-service.ts`
- `apps/api/src/routes/connector-routes.ts`

### 2.2 MCP tool call 也有授权与绑定检�?
Vercel internal MCP tool call 前会检查：

1. 当前 task session 是否挂载对应 Vercel connector profile�?2. profile id 是否与运行时上下文一致�?3. profile 是否存在�?4. profile `authStatus` 是否�?`authorized`�?
对应代码�?
- `apps/api/src/services/vercel-mcp-service.ts`

因此，本次优先修复点不是后端“无判断直接授权”，而是前端启动 OAuth 的分支选择与设计文档不一致�?
## 3. 发现的问�?
### 3.1 设计要求

已采用设计文档要求：

1. Vercel OAuth 入口参照 Slack �?connector-level OAuth�?2. Vercel 前端详情页走 OAuth card 模式�?3. 回调成功后复�?connector-level OAuth、runtime refresh、session attach�?
### 3.2 代码现状

当前前端存在两个判断�?
1. `shouldUseUnifiedConnectorCard`
   - 已把 `vercel` 放进统一 OAuth 卡片�?2. `shouldUseConnectorLevelOauth`
   - 只包�?`notion` �?`slack`，没有包�?`vercel`�?
结果是：

1. 用户�?Vercel 统一卡片点击连接�?2. `handleOAuth` 没有进入 connector-level OAuth 分支�?3. 前端先执�?`persistProfile`，本地创�?保存一�?Vercel profile�?4. 再通过 profile-level OAuth start 发起授权�?5. �?Vercel 使用固定回调 `/vercel/callback`，后端实际发送给 Vercel �?redirect uri 不带 `profileId` 查询参数�?6. 回调进入前端时没�?`profileId`，前端又把它当成 connector-level callback 完成�?
这形成了“profile-level start + connector-level callback”的混用链路。虽然后端可以通过 `state` 找回 profile，但这与设计目标不一致，也会导致点击连接时用户感知混乱：先创建本�?profile，再进入外部授权；如�?Vercel 已经授权过该 App，官方会立即跳回回调页，用户就会感觉“没有任何操作就直接回调”�?
## 4. 修复目标

本次只做最短路径修复：

1. Vercel 点击连接必须进入 connector-level OAuth start�?2. Vercel OAuth start 由后端统一查找或创建默�?profile�?3. 前端不在点击连接时提�?`persistProfile`�?4. Vercel callback 继续�?connector-level callback，通过 `state` 反查真实 request/profile�?5. session attach 只在 callback 返回 `authStatus === "authorized"` 后执行�?6. 用户点击“取消授�?断开授权”后，下一次点击授权必须重新进�?Vercel consent page，而不是直接静默回调�?
不新增兼容链路，不引�?token 手填入口，不改变 internal MCP runtime 设计�?
## 5. 修改方案

### 5.1 前端 OAuth 分支修正

文件�?
- `apps/web/client/src/components/ConnectorCenterPanel.tsx`

修改�?
1. �?`vercel` 纳入 `shouldUseConnectorLevelOauth`�?2. `handleOAuth` �?Vercel 进入 connector-level OAuth 分支�?3. Vercel redirectUri 使用固定回调路径 `/vercel/callback`，与后端 `VERCEL_CONNECTOR_REDIRECT_URI` 对齐�?
预期行为�?
1. 点击 Vercel 连接�?2. 前端调用 `POST /api/connectors/vercel/oauth/start`�?3. 后端创建 `connector_auth_requests`，保�?`state/profileId/codeVerifier/returnToSessionId`�?4. 浏览器跳转到 Vercel Authorization Endpoint�?5. Vercel 回调 `/vercel/callback?code=...&state=...`�?6. 前端调用 `POST /api/connectors/vercel/oauth/callback`�?7. 后端�?`state` 找回 profile 并完�?token 交换�?8. 如果授权成功且存在目�?session，再 attach Vercel connector�?
### 5.2 前端测试补充

文件�?
- `apps/web/client/src/tests/connector-center-panel.test.ts`

修改�?
1. �?`shouldUseConnectorLevelOauth("vercel")` 期望改为 `true`�?2. 保留固定回调路径与回调识别测试�?
### 5.3 后端暂不改动

本次检查后，后�?OAuth callback �?MCP tool call 已具备必要校验。除非后续联调证�?Vercel token/userinfo 响应结构与当前解析不一致，否则不扩大后端修改范围�?
### 5.4 补充：Vercel 取消授权后必须再次进入真�?OAuth 授权�?
根据 Vercel 官方文档�?
1. 用户第一次授权时会看�?consent page�?2. 如果用户已经授权过该 app，后续授权会立即重定向，不再展示 consent page�?3. 如果业务上需要强制再次展�?consent page，授权请求必须显式带�?`prompt=consent`�?
因此，要满足“点击取消授权后，再次点击授权必须重新进入真�?OAuth 授权页，并可再次看到 consent page”，需要同时满足：

1. 点击取消授权时，必须成功调用 Vercel revoke endpoint，撤销远端授权�?2. 下一次发�?Vercel Authorization Endpoint 时，必须显式带上 `prompt=consent`�?3. 只有远端 revoke 成功，才允许把本�?profile 标记为已清空授权�?4. 如果远端 revoke 失败，前端必须明确报错，且本地不能伪装成“已取消授权成功”�?
### 5.5 当前实现中的具体缺口

当前 `clearProfileAuth()` 的顺序是�?
1. 尝试调用 Vercel revoke endpoint�?2. 即使 revoke 失败，也继续把本�?`secretCiphertext/authStatus/lastAuthAt` 清空�?
同时前端 `handleDisconnect()` 只对 GitHub 专门提示 `remoteGrantRevoked === false`，对 Vercel 没有同等处理�?
这会导致�?
1. 用户界面看到“已取消授权”�?2. 本地数据库也看起来像未授权�?3. �?Vercel 远端授权其实可能仍然存在�?4. 下一次点击授权时，Vercel 因为仍认为该 app 已获授权，直接重定向，不展示 consent page�?
### 5.6 本次针对取消授权的修复口�?
Vercel 断开授权改为强一致语义：

1. `clearProfileAuth()` �?`connectorKey === "vercel"` 且远�?revoke 失败时，直接返回错误�?2. 不再继续清空本地授权字段�?3. 前端展示“取消授权失败”的真实原因�?4. 只有远端 revoke 成功后，才清空本地授权状态�?
这样可以保证�?
1. “本地显示已断开�?�?“Vercel 远端真的已撤销�?一致�?2. 下次重新授权时，浏览器会重新进入 Vercel OAuth 授权页；由于请求�?`prompt=consent`，会再次展示 consent page�?
### 5.7 当前会话 pending_recover 卡住问题

本次联调又发现一个会话态问题：

1. OAuth 成功后，前端会继续对目标 session 调用 attach�?2. 如果 attach �?sandbox/runtime 还没完全 ready，binding 会被写成 `pending_recover`�?3. 当前 attach 路径只返�?`pending_recover`，没有立刻触�?`ensureSessionRecovered()`�?4. 结果是当前会话里�?connector tool access 会停留在 `blocked_until_runtime_recovers`，只能等待后�?backlog 或其他链路被动恢复�?
### 5.8 本次针对 pending_recover 的修复口�?
不改主状态机，只补齐当前会话的主动恢复触发：

1. attach 路由在拿�?`pending_recover` 后，立即对当�?session 调用 `ensureSessionRecovered()`�?2. 会话详情读取、会�?connectors 读取、Altus connector snapshot 读取时，只要拿到当前 sandbox session id，也会补做一次按需恢复�?3. `ensureSessionRecovered()` 改为在当前调用链内等待本�?recovery job 跑完，而不是只�?fire-and-forget�?
这样可以保证�?
1. 当前会话�?OAuth 完成后，不会因为恢复任务只进队列却没人马上消费而长期卡�?`pending_recover`�?2. Altus 在读�?connector snapshot 时，能看到恢复后的最�?runtime status，而不是继续把工具判定�?blocked�?
## 6. 验证计划

最小验证：

1. 运行前端 connector center 测试，确�?Vercel 判定�?connector-level OAuth�?2. 运行 Vercel OAuth 相关 API 测试，确�?PKCE、固�?redirect uri、token callback 仍通过�?3. 增加/调整 Vercel 取消授权测试，确�?revoke 失败时本地状态不会被提前清空�?
建议命令�?
1. `pnpm --filter web test -- connector-center-panel`
2. `pnpm --filter api test -- vercel-oauth-connector`
3. `pnpm --filter api test -- user-connector-service`

手工验证�?
1. 打开连接器中心�?2. 点击 Vercel 连接�?3. 确认请求�?connector-level start：`/api/connectors/vercel/oauth/start`�?4. 确认浏览器进�?Vercel Authorization Endpoint�?5. �?Vercel 已授权过�?App，直接回调是 Vercel 官方行为；但回调后必须由后端完成 state、PKCE、token、userinfo 校验后才显示授权成功�?6. 点击“取消授权”后，再次点击“授权”，必须重新出现 Vercel consent page�?
## 7. 采用前确�?
如果采用本修复文档，我将进入代码实现阶段，并把本文件状态从 `[尚未采用]` 更新�?`[yyyymmdd-hhmm已采用]`�?
