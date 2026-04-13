# Slack MCP 切换 User OAuth Token 与用户权限执行方案 [20260412-2029已采用]

## 1. 背景与问题

- 现状：
  - 当前 Slack 连接器已经采用 connector 级 OAuth 与固定 `/slack/callback` 回调路径。
  - 现有实现使用：
    - 授权地址：`https://slack.com/oauth/v2/authorize`
    - 换 token 地址：`https://slack.com/api/oauth.v2.access`
  - 当前 `apps/api/src/services/user-connector-service.ts` 在 OAuth callback 成功后，直接保存返回体顶层 `access_token` 到 `user_connector_profiles.secret_ciphertext`。
- 当前问题：
  - Slack `oauth.v2.access` 在现有配置下返回的是 app/bot 侧 token，权限展示与实际执行主体体现为 oneceo 这个 app/bot，而不是发起授权的用户本人。
  - 这会导致“管理权限/执行权限”表现为 oneceo 的机器人权限，而不是用户个人在该 workspace 中的真实可见范围与可操作范围。
  - 对于 Slack MCP 这种“代表用户在 IDE / agent 场景内访问 Slack”的能力，这与目标模型不一致。
- 用户目标：
  - 获取 `User OAuth Token`
  - 让 Slack MCP 以授权用户本人的权限执行，而不是以 oneceo bot 的权限执行

## 2. 官方依据

本方案以 Slack 官方文档为直接依据：

1. Slack OAuth 安装文档指出：
   - 用户侧 flow 应走 `https://slack.com/oauth/v2_user/authorize`
   - code 应通过 `https://slack.com/api/oauth.v2.user.access` 换取 user token
   - 该 flow 适用于“只需要 user token、不需要 bot token”的场景
   - 也明确点名适用于 MCP / IDE client 场景
2. Slack MCP Server 文档指出：
   - Slack MCP 的 user token 授权端点就是 `oauth/v2_user/authorize`
   - token 端点就是 `oauth.v2.user.access`
3. Slack Tokens 文档指出：
   - user token 代表的是用户本人
   - 它继承的是该用户在 workspace 中真实拥有的访问范围与操作权限

建议评审时同时参考：

- [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)
- [oauth.v2.user.access](https://docs.slack.dev/reference/methods/oauth.v2.user.access/)
- [Slack MCP Server Overview](https://docs.slack.dev/ai/slack-mcp-server/)
- [Tokens](https://docs.slack.dev/authentication/tokens/)

## 3. 方案目标与边界

### 3.1 目标

1. Slack OAuth 全量切换到 user-centric flow。
2. OAuth callback 后保存的 Slack token 必须是 user token，而不是 bot token。
3. Slack MCP runtime 挂载到 session 后，实际执行权限按授权用户本人生效。
4. 继续复用现有：
   - `connector_auth_requests`
   - `user_connector_profiles`
   - `task_session_connector_bindings`
5. 不改变现有 `/slack/callback + state + returnToSessionId + attachSessionConnector(...)` 这条已采用主链。

### 3.2 非目标

1. 不保留“Slack bot token / user token 双模式并行”。
2. 不做“先兼容 bot token、以后再慢慢迁移”的补丁方案。
3. 不抽象成所有连接器通用的多 token OAuth 框架。
4. 不改动与 Slack user token 切换无关的其它连接器行为。

## 4. 当前仓库现状

## 4.1 当前 Slack OAuth 配置

文件：`apps/api/src/connectors/definitions/slack.ts`

当前行为：

- `authorizationUrl = https://slack.com/oauth/v2/authorize`
- `tokenUrl = https://slack.com/api/oauth.v2.access`
- `scopeParam = 'scope'`
- `scopes = SLACK_CONNECTOR_SCOPES`

这条配置天然更偏向 workspace install / bot token 语义，而不是“只拿用户 token”的 MCP 语义。

## 4.2 当前 callback 存储逻辑

文件：`apps/api/src/services/user-connector-service.ts`

当前行为：

- callback 成功后统一从 token payload 顶层读取：
  - `access_token`
  - `refresh_token`
  - `token_type`
  - `scope`
- 然后直接写入：
  - `secretCiphertext`
  - `authStatus`
  - `displayName`

在当前 Slack 配置下，这里保存的是 bot token，不是 user token。

## 5. 总体设计

## 5.1 改为 Slack 官方 user OAuth flow

Slack 连接器改为：

- 授权端点：

```text
https://slack.com/oauth/v2_user/authorize
```

- token 端点：

```text
https://slack.com/api/oauth.v2.user.access
```

这意味着 Slack OAuth 语义从“workspace install / bot token 优先”切换为“直接申请 user token”。

## 5.2 保存 user token，不再保存 bot token

在 `oauth.v2.user.access` 成功后：

- 保存返回体顶层 `access_token`
- 该 token 的 `token_type` 应为 `user`
- secret 仍保存到现有 `secretCiphertext`
- Slack runtime 仍通过 bearer token 注入 `https://mcp.slack.com/mcp`

也就是说：

- `secret.accessToken = user token`
- 不是 `xoxb...`
- 而是 `xoxp...` / `xoxe.xoxp...` 一类用户 token

## 5.3 session attach 主链保持不变

本方案不改已采用的回调挂载链：

1. 前端发起 Slack OAuth
2. Slack 回调 `/slack/callback`
3. 后端完成 token 交换
4. 后端返回 `returnToSessionId`
5. 前端调用 `attachSessionConnector(sessionId, 'slack', { profileId })`
6. MCP 连接挂到原 session

变化只在于：

- 以前挂进去的是 bot token
- 改造后挂进去的是 user token

## 6. 配置设计

## 6.1 环境变量

新增并采用：

- `SLACK_CONNECTOR_USER_SCOPES`

停止把 Slack user token flow 依赖在：

- `SLACK_CONNECTOR_SCOPES`

原因：

- 当前变量名 `SLACK_CONNECTOR_SCOPES` 无法明确它是 bot scopes 还是 user scopes。
- 切到 user-centric OAuth 后，继续沿用旧变量名容易误导后续维护者。
- 本次改造不做兼容双写，直接收敛为新的明确变量名。

推荐初始范围按 Slack MCP 官方能力来配，最小集合由实际工具需求决定。若目标是“搜索消息 + 读对话 + 发消息”，建议至少覆盖：

```text
channels:history,groups:history,mpim:history,im:history,chat:write
```

如果还要支持 Slack MCP 的搜索能力，可补充：

```text
search:read.public,search:read.private,search:read.mpim,search:read.im,search:read.files,search:read.users
```

如果需要用户资料类能力，再补充：

```text
users:read,users:read.email
```

若需要 canvas 能力，再补充：

```text
canvases:read,canvases:write
```

## 6.2 Slack App 后台配置

需要同步修改 Slack App：

1. OAuth 回调地址继续使用：
   - `https://<frontend>/slack/callback`
2. 作用域改为 user token 需要的 scopes
3. 不再把当前这条 MCP 授权链依赖在 bot scopes 上

如果当前 Slack App 还承担 oneceo 在 Slack 内部的 bot 能力：

- 不应继续让同一条 MCP 用户连接链复用该 bot token 语义
- 最短路径做法是：
  - 当前 Slack MCP connector 改为纯 user-token flow
  - Slack 内部 bot 体验若仍需要，应由独立方案管理

## 7. 数据设计

## 7.1 不新增表

继续复用：

- `connector_auth_requests`
- `user_connector_profiles`
- `task_session_connector_bindings`

## 7.2 secret 存储

仍使用现有加密存储：

- `user_connector_profiles.secret_ciphertext`

保存结构建议仍为：

```ts
{
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
}
```

但这里的 `accessToken` 明确表示 Slack user token。

## 7.3 metadata 补充

建议在 `metadataJson` 中补充 Slack 用户态标识，便于后续排查与 UI 展示：

```ts
{
  slackAuthMode: "user_oauth",
  slackTokenType: "user",
  slackUserId: "U...",
  slackTeamId: "T...",
  slackEnterpriseId?: "E..."
}
```

说明：

- `oauth.v2.user.access` 返回里至少可稳定获得 `team.id`
- `authed_user.id` 也应保存
- 不要求额外调用 Slack API 去补工作区名称，避免多余权限与额外链路

## 8. 代码改造清单

## 8.1 文件：`apps/api/src/connectors/definitions/slack.ts`

### 变更点

1. 把授权端点改成：

```ts
https://slack.com/oauth/v2_user/authorize
```

2. 把 token 端点改成：

```ts
https://slack.com/api/oauth.v2.user.access
```

3. 把 scopes 来源改成：

```ts
SLACK_CONNECTOR_USER_SCOPES
```

4. 更新 Slack 连接器字段文案：
   - 不再描述为“通常填写 bot token”
   - 明确当前 OAuth 链路获取的是 user token

### 验收点

1. start OAuth 生成的授权地址是 `oauth/v2_user/authorize`
2. `scope` 里传的是 user scopes
3. callback 换 token 调用的是 `oauth.v2.user.access`

## 8.2 文件：`apps/api/src/services/user-connector-service.ts`

### 变更点

1. Slack callback 成功后，保存 `oauth.v2.user.access` 返回的顶层：
   - `access_token`
   - `refresh_token`
   - `token_type`
   - `scope`
2. 对 Slack 来说，`token_type` 期望为：

```text
user
```

3. `displayName` 不能再依赖 `tokenPayload.team.name` 作为主来源，因为 user endpoint 不保证提供工作区名称。
4. Slack profile 命名逻辑改为：
   - 优先保留用户手工填写的 `profileName`
   - 否则使用现有默认名
   - 不额外引入依赖更多 scope 的补充 API 调用
5. `metadataJson` 写入：
   - `slackAuthMode=user_oauth`
   - `slackTokenType=user`
   - `slackUserId`
   - `slackTeamId`

### 验收点

1. Slack profile 的 `secretCiphertext` 解密后，`accessToken` 是 user token
2. `tokenType === 'user'`
3. 不再保存 bot token 到 Slack MCP 主链 profile

## 8.3 文件：`apps/web/client/src/lib/connector-guides.ts`

### 变更点

1. 更新 Slack Guide 文案：
   - 当前 Slack MCP 默认使用 User OAuth Token
   - 用户看到的是“代表你本人授权”
   - 不再默认宣导 bot token 优先
2. 快速说明改成：
   - 这是用户权限，不是 oneceo bot 权限

### 验收点

1. Slack guide 不再误导用户认为当前链路默认拿 bot token
2. 设置页文案与实际实现一致

## 8.4 文件：`apps/api/tests/user-connector-service.test.ts`

### 新增或调整用例

1. Slack start OAuth 使用：
   - `https://slack.com/oauth/v2_user/authorize`
2. Slack callback 使用：
   - `https://slack.com/api/oauth.v2.user.access`
3. callback 成功时保存的是 user token
4. `metadataJson.slackTokenType === 'user'`
5. state 校验、过期处理、session attach 返回值继续保持现有约束

## 8.5 文件：`apps/web/client/src/tests/connector-center-panel.test.ts`

### 新增或调整用例

1. Slack callback 成功后仍会 attach 到原 session
2. 切换到 user token flow 后，前端 callback 识别与跳转行为不变

## 9. 迁移方案

## 9.1 为什么必须迁移旧数据

当前数据库里可能已经存在 Slack bot token profile。

如果不主动迁移：

- 新代码是 user-token 语义
- 旧 profile 仍可能继续挂载 bot token
- 结果会出现同一连接器下“有的 session 用 bot 权限，有的 session 用 user 权限”的混乱状态

这不符合本次目标。

## 9.2 迁移策略

本方案采用强制收敛，不保留兼容模式：

1. 所有现有 `connectorKey='slack'` 的 profile 全部标记为 `needs_auth`
2. 清空旧的 Slack `secretCiphertext`
3. 写入明确错误提示：

```text
Slack connector 已切换为 User OAuth Token，请重新连接。
```

4. 用户重新走一遍 Slack OAuth，拿到新的 user token

### 验收点

1. 升级后旧 Slack bot token 不再继续被 runtime 使用
2. 用户必须重新授权一次，之后才以用户权限执行

## 10. 安全与权限约束

1. user token 的权限边界是“授权用户本人在 Slack 中真实可见、真实可操作的范围”
2. 继续按当前用户归属隔离保存 profile，不允许跨 `app_users.id` 共用
3. token 继续只加密保存，不写明文日志
4. callback state、过期、会话绑定、attach 主链继续沿用现有已采用约束

## 11. 风险与应对

## 11.1 scope 不足导致工具不可用

风险：

- user token 没申请到 Slack MCP 所需 scopes，会导致部分 tool 运行失败

应对：

- 以 Slack MCP 官方工具需求为准收敛 `SLACK_CONNECTOR_USER_SCOPES`
- 不做兜底 bot token 回退

## 11.2 现有用户需要重新授权

风险：

- 现有 Slack 连接会失效，需要重新连接

应对：

- 明确迁移提示
- 统一强制重连，不保留双模式

## 11.3 同一 Slack App 同时承担 bot 与 user 两类职责

风险：

- 把一个 App 同时当成 bot 体验入口和 MCP user token 入口，容易在后台 scopes、安装方式和认知上混淆

应对：

- 对 Slack MCP connector，这次只保留 user-token 语义
- bot 体验若仍需保留，另立文档和实现边界，不混入本方案

## 12. 测试计划

## 12.1 API 单测

1. Slack start OAuth 使用 `oauth/v2_user/authorize`
2. Slack callback 使用 `oauth.v2.user.access`
3. 保存的是 user token 而不是 bot token
4. `slackTokenType=user`
5. state 被篡改时失败
6. 过期时失败

## 12.2 Web 单测

1. `/slack/callback` 仍能触发 callback 处理
2. callback 成功后仍 attach 到原 session
3. cleanup 后：
   - 有 sessionId -> `/session/:sessionId`
   - 无 sessionId -> `/home`

## 12.3 手工联调

1. 进入 Slack 授权页，确认展示的是用户权限而不是 bot/workspace install 语义
2. callback 成功后检查 DB 中 Slack profile 解密结果：
   - `accessToken` 为 user token
   - `tokenType = user`
3. 把 Slack MCP 挂到 session 后，验证只能访问该用户本来有权限看到的频道/消息
4. 用另一个权限更低的用户重复授权，确认 MCP 能力范围随用户变化

## 13. 验收标准

1. Slack OAuth 已切换到 `oauth/v2_user/authorize`
2. token exchange 已切换到 `oauth.v2.user.access`
3. 保存到数据库中的 Slack token 是 user token，不是 bot token
4. session attach 主链保持可用
5. MCP 在 Slack 中执行时体现为授权用户本人的权限边界
6. 旧 bot token profile 不再继续参与主链执行

## 14. 实施顺序（最短路径）

1. 先改文档与配置定义：明确 Slack MCP 采用 user token
2. 再改 API：
   - Slack provider endpoint
   - callback 保存逻辑
   - 迁移旧 Slack profile
3. 再改前端文案与 guide
4. 补 API/Web 单测
5. 最后做真实 Slack user token 联调

## 15. 需要同步更新的现有文档

若本方案被采用，需要同步更新：

1. [slack_mcp_oauth_fixed_redirect_uri_state_execution_doc_[20260412-1710已采用].md](/D:/aiBeginner/test/oneceo-task-creation-agent/docs/features/connectors/slack_mcp_oauth_fixed_redirect_uri_state_execution_doc_[20260412-1710已采用].md)
2. 任何仍写着“Slack MCP 默认优先 bot token”的旧文案

重点更新内容：

1. Slack OAuth 主链改为 user-centric flow
2. token 类型从 bot token 收敛为 user token
3. 旧 Slack profile 需要强制重新授权

## 16. 方案状态

- 当前状态：`[20260412-2029已采用]`
- 说明：已按本方案进入代码实现，Slack MCP 主链收敛为 User OAuth Token 执行语义。
