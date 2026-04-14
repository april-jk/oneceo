# Slack MCP User OAuth 回调失败修复与用户权限执行详细方案 [20260414-1933已采用]

## 1. 背景与目标

- 当前用户目标已经明确：
  - Slack MCP 必须使用授权用户本人权限执行。
  - 不接受 bot token 作为主链执行凭证。
- 当前线上现象：
  - Slack 授权能够回跳到固定回调地址：
    - `https://dev.oneceo.ai/slack/callback`
  - 但回调阶段失败，并显示：
    - `OAuth 回调未返回 access_token`

本方案的目标只有一个主线：

1. 修复当前 Slack callback 换 token 失败问题。
2. 把 Slack MCP 主链严格收敛到 user OAuth 语义。
3. 保持现有固定 `/slack/callback + state + returnToSessionId + attachSessionConnector(...)` 链路不变。

## 2. 问题现象

用户当前提供的 callback URL 说明了两件事：

1. Slack 已经完成浏览器回跳，说明授权页到前端回调页这半段链路是通的。
2. 问题发生在后端收到 `code` 和 `state` 后，向 Slack 换 token 的阶段。

当前报错文案：

```text
OAuth 回调未返回 access_token
```

这是一条“表面报错”，它不能直接说明真正根因，只能说明：

- 后端最终没有拿到自己预期位置上的 token 字段。

## 2.1 基于最新网络抓包的补充证据

用户补充的实际请求信息如下：

1. 前端回调页命中地址：
   - `https://dev.oneceo.ai/slack/callback?...`
2. 前端随后发起 API 请求：
   - `POST https://dev.oneceo.ai/api/connectors/slack/oauth/callback`
3. 返回结果：
   - `400 Bad Request`
4. 请求中已携带：
   - `Origin: https://dev.oneceo.ai`
   - `Cookie: app_session_id=...`
5. 响应中已返回：
   - `access-control-allow-origin: https://dev.oneceo.ai`
   - `access-control-allow-credentials: true`

这组证据可以进一步排除几类误判：

1. 不是前端没有命中 `/slack/callback`
2. 不是前端没有继续调用 oneceo 自己的 callback API
3. 不是 CORS 拦截
4. 大概率不是登录态丢失
   - 如果 `app_session_id` 无效或当前用户解析失败，按当前路由实现更可能返回 `401`
5. 也不是 API 路由不存在

这说明当前失败点已经进一步收敛到：

- `apps/api/src/routes/connector-routes.ts`
- `apps/api/src/services/user-connector-service.ts`

也就是：

- 路由已经进入
- 当前用户大概率已经解析成功
- 失败发生在 Slack callback 业务处理或 Slack token exchange 结果解析阶段

## 2.2 基于 400 结果对问题边界的进一步收敛

当前 `/api/connectors/slack/oauth/callback` 返回 `400` 而不是 `500`，说明它更像是“服务层主动抛出的可预期业务错误”，而不是未捕获异常或基础设施故障。

结合当前代码，最可能的链路是：

1. `connector-routes.ts` 进入 `POST /:connectorKey/oauth/callback`
2. `currentUserResolver.require(req)` 成功
3. `userConnectorService.completeOAuth(...)` 或 `completeOAuthByProfile(...)` 内部抛错
4. 路由层 `handleError(...)` 将其包装成 `400`

再结合你前面看到的页面错误文案：

```text
OAuth 回调未返回 access_token
```

可以进一步判断：

- 当前 400 并不是 generic 400
- 而是服务层已经命中了现有 Slack callback 的 token 解析错误分支

换句话说，这次最新抓包不是推翻原方案，而是进一步验证了原方案判断方向是对的：

- 问题在服务层 Slack token exchange 结果解析
- 不在前端 callback 页
- 不在跨域
- 不在浏览器请求本身

## 3. 当前代码现状

## 3.1 Slack OAuth 配置

文件：

- `apps/api/src/connectors/definitions/slack.ts`

当前实现要点：

1. OAuth 授权地址配置为：
   - `https://slack.com/oauth/v2_user/authorize`
2. token exchange 地址配置为：
   - `https://slack.com/api/oauth.v2.user.access`
3. scope 参数名仍走通用 `scope`
4. redirect_uri 已固定收敛为：
   - `FRONTEND_URL + /slack/callback`

## 3.2 Callback 处理

文件：

- `apps/api/src/services/user-connector-service.ts`

当前实现要点：

1. callback 阶段会先校验：
   - 当前用户
   - connector 类型
   - profileId
   - state 对应 request
   - state 里的 `rid/sid`
   - request 是否过期
2. 随后向 Slack token endpoint 发起 POST 请求。
3. 返回后统一从顶层读取：
   - `access_token`
   - `refresh_token`
   - `token_type`
   - `scope`
4. 若没有顶层 `access_token`，则抛：

```text
OAuth 回调未返回 access_token
```

## 3.3 当前错误处理缺口

当前 `fetchJson(...)` 的行为是：

1. 只在 HTTP 状态码不是 2xx 时抛错。
2. 如果 HTTP 是 200，就默认认为这是成功响应。

但 Slack OAuth 的一个关键特点是：

- 很多失败响应是 `HTTP 200`
- 真正的错误写在 body 里，例如：

```json
{
  "ok": false,
  "error": "bad_redirect_uri"
}
```

这意味着当前后端会把 Slack 的真实错误吞掉，然后在后续解析阶段才因为没拿到预期字段，错误地变成：

```text
OAuth 回调未返回 access_token
```

## 4. 根因分析

本次问题的真正根因不是“前端回调页错误”，而是“Slack user OAuth 的授权入口、换 token 入口、响应解析、错误解析没有按同一套 user-token 语义严格收敛”。

可以拆成 4 个具体问题：

1. Slack 当前实现虽然目标是 user token，但仍然沿用了较多通用 OAuth 抽象。
2. Slack OAuth 返回体没有被按 Slack 自身结构单独处理。
3. Slack 的 `ok=false` 错误响应没有被原样透出。
4. 后端把“没有顶层 `access_token`”误当成根因，而实际上这只是结果。

换句话说，当前错误提示掩盖了真正的 Slack 原始错误。

## 5. 为什么必须走 user 权限，而不是 bot 权限

这部分是本方案的基本约束，不是可选项。

## 5.1 主链执行主体必须是授权用户本人

Slack MCP 的目标是：

- 让用户在 oneceo/session 内，以“自己在 Slack 里的真实权限边界”访问 Slack。

这要求执行凭证必须代表：

- 授权用户本人

而不是：

- oneceo 这个 Slack App/bot

## 5.2 bot token 不满足当前目标

如果继续使用 bot token，会带来几个问题：

1. 权限边界变成 bot 权限，而不是用户本人权限。
2. 用户会看到“我在 oneceo 里能做的事”和“我本人在 Slack 里能做的事”不一致。
3. 多用户使用同一个 Slack App 时，行为边界会更偏向 App 安装状态，而不是用户个人授权状态。

因此本次方案明确要求：

- Slack MCP 主链只保留 user token 语义。

## 6. 采用方案

## 6.1 OAuth 流程统一收敛到 user-centric 模式

本次方案采用单一路径，不做兼容分支：

1. 授权入口改为：
   - `https://slack.com/oauth/v2/authorize`
2. token exchange 改为：
   - `https://slack.com/api/oauth.v2.access`
3. 用户权限范围通过：
   - `user_scope`
4. 固定回调地址继续使用：
   - `https://dev.oneceo.ai/slack/callback`

这样做的原因是：

- `oauth/v2/authorize + user_scope + oauth.v2.access` 这套组合能更明确地表达“我要拿 user token”
- 也更适合当前 Slack MCP “用户本人权限执行”的业务目标

## 6.2 只保存 user token

callback 成功后，Slack connector profile 只保存 user token。

精确要求：

1. 凭证来源：
   - 从 Slack 响应中读取用户 token
2. 禁止行为：
   - 不把 bot `access_token` 保存为 Slack MCP 主链 token
3. 存储结果：
   - `secret.accessToken = <user token>`
   - `secret.tokenType = "user"`

## 6.3 Slack 错误体必须原样透出

Slack callback 的 token exchange 结果必须分三类处理：

### A. HTTP 非 2xx

直接按错误处理。

### B. HTTP 2xx 但 `ok=false`

直接抛出 Slack 原始 `error` 字段，例如：

- `bad_redirect_uri`
- `invalid_scope`
- `oauth_authorization_url_mismatch`
- `invalid_code`

### C. HTTP 2xx 且 `ok=true`

再进入 token 解析和存储逻辑。

这一步是本次修复的关键，不然前端永远只能看到一个误导性的“未返回 access_token”。

## 6.3.1 基于本次抓包新增的实现要求

由于现在已经确认前端实际拿到的是 oneceo API 返回的 `400`，所以实现上必须再增加一个明确要求：

1. `/api/connectors/slack/oauth/callback` 返回给前端的错误必须区分：
   - Slack 原始错误
   - oneceo 本地校验错误
2. 若是 Slack 原始错误，应直接返回其关键错误名，而不是被二次包装成“未返回 access_token”
3. 若是 oneceo 本地校验错误，应明确写出是哪个校验失败，例如：
   - state 不匹配
   - request 过期
   - profile 不存在

这样做的目的是让下一次网络抓包时，单看 response body 就能直接定位问题来源。

## 6.4 固定回调与 session 恢复链路保持不变

以下链路已经被采用并且是正确方向，本次不改：

1. 前端固定回调页：
   - `/slack/callback`
2. redirect_uri 固定为：
   - `FRONTEND_URL + /slack/callback`
3. state 结构：
   - `oneceo_slack_v1.<base64url({ rid, sid, ts, nonce })>`
4. callback 成功后恢复：
   - `returnToSessionId`
5. attach 到目标 session：
   - `attachSessionConnector(sessionId, 'slack', { profileId })`

## 7. 响应结构处理方案

## 7.1 成功响应的读取规则

Slack callback 成功时，后端不能再只看顶层 `access_token`。

需要按 Slack user OAuth 的响应结构读取用户 token，并将其映射到现有 secret 结构。

保存规则：

```ts
{
  accessToken: "<user token>",
  tokenType: "user",
  refreshToken?: "...",
  scope?: "..."
}
```

metadata 追加：

```ts
{
  slackAuthMode: "user_oauth",
  slackTokenType: "user",
  slackUserId: "U...",
  slackTeamId: "T...",
  slackEnterpriseId?: "E..."
}
```

## 7.2 失败响应的读取规则

如果 Slack 返回：

```json
{
  "ok": false,
  "error": "bad_redirect_uri"
}
```

则必须直接报：

```text
bad_redirect_uri
```

而不是再落到：

```text
OAuth 回调未返回 access_token
```

## 7.3 结构异常规则

只有在以下条件都满足时，才允许抛“响应结构异常”：

1. HTTP 是 2xx
2. `ok` 不是 `false`
3. 也没有拿到有效 user token
4. 也没有明确错误字段

这才是真正的“响应结构不符合预期”。

## 8. 代码改造清单

## 8.1 `apps/api/src/connectors/definitions/slack.ts`

改造点：

1. 授权地址从 `oauth/v2_user/authorize` 改为 `oauth/v2/authorize`
2. token 地址从 `oauth.v2.user.access` 改为 `oauth.v2.access`
3. scope 参数名从 `scope` 改为 `user_scope`
4. 继续使用 `SLACK_CONNECTOR_USER_SCOPES`
5. 更新 Slack connector 文案，明确当前保存的是 user token

预期结果：

1. start OAuth 生成的地址明确是 user-centric 语义
2. Slack App 后台配置与线上行为完全一致

## 8.2 `apps/api/src/services/user-connector-service.ts`

改造点：

1. 调整 Slack token exchange 成功/失败分支解析逻辑
2. 增加对 Slack `ok=false` 的显式处理
3. 只保存 user token
4. `tokenType` 强校验为 `user`
5. 保留现有：
   - state 校验
   - request 过期处理
   - returnToSessionId 恢复
   - auth request 完成/失败状态更新
6. 增加更细粒度的错误分类，保证路由层返回给前端的是可定位错误，而不是统一落成 `OAuth 回调未返回 access_token`

预期结果：

1. 真正失败时，前端拿到 Slack 原始错误
2. 真正成功时，数据库里只会保存 user token

## 8.3 `apps/api/tests/user-connector-service.test.ts`

需要补齐或修改的测试：

1. `startOAuthForProfile` 应断言授权入口是 `oauth/v2/authorize`
2. 应断言使用 `user_scope`
3. `completeOAuthByProfile` 成功时应断言保存 user token
4. 应断言 `metadataJson.slackTokenType === 'user'`
5. 应新增 `ok=false` 错误透传用例
6. 应保留现有 state 篡改与过期用例

## 8.4 `apps/web/client/src/lib/connector-guides.ts`

需要同步调整说明文案：

1. 明确当前 Slack 连接器代表授权用户本人执行
2. 不再暗示 bot token 是默认主链凭证
3. 指导用户在 Slack App 后台配置 user scopes

## 9. Slack App 后台配置要求

本方案落地前，Slack App 后台必须满足以下要求：

1. Redirect URL 精确包含：
   - `https://dev.oneceo.ai/slack/callback`
2. OAuth 权限配置要以 user scopes 为准
3. 不再把当前 oneceo Slack MCP connector 当作 bot install 主链

推荐最小 user scopes 仍按当前 MCP 实际能力收敛，例如：

```text
channels:history groups:history mpim:history im:history chat:write
```

如果需要搜索或用户资料能力，再按实际工具需求补充，不做超配。

## 10. 实施顺序

严格按最短路径实施：

1. 先确认并采用本文档
2. 改 `slack.ts`
3. 改 `user-connector-service.ts`
4. 更新 Slack 相关测试
5. 更新前端 guide 文案
6. 跑 API/Web 最小回归
7. 用真实 Slack OAuth 再走一轮完整联调

## 11. 验收标准

本方案完成后，必须同时满足以下条件：

1. 用户完成 Slack OAuth 后，数据库保存的是 user token，而不是 bot token。
2. Slack MCP 挂到 session 后，实际执行权限等于授权用户本人权限。
3. callback 失败时，前端能看到 Slack 真实错误，而不是笼统的 `OAuth 回调未返回 access_token`。
4. `/slack/callback`、`state`、`returnToSessionId`、`attachSessionConnector(...)` 这条链路继续可用。
5. 旧 bot token profile 不再继续参与 Slack MCP 主链执行。
6. 再次抓包 `/api/connectors/slack/oauth/callback` 时，若失败，response body 能直接反映真实根因类别。

## 12. 最小验证计划

## 12.1 API 单测

1. Slack start OAuth 使用 `oauth/v2/authorize`
2. 请求参数使用 `user_scope`
3. token exchange 使用 `oauth.v2.access`
4. callback 成功后保存 user token
5. `ok=false` 时透出真实错误
6. state 被篡改时失败
7. request 过期时失败
8. route 层返回的错误文案能区分 Slack 原始错误与 oneceo 本地校验错误

## 12.2 Web 最小回归

1. `/slack/callback` 仍能触发 callback 处理
2. 授权成功后仍按 `returnToSessionId` attach session
3. cleanup 后仍能正确跳回：
   - `/session/:sessionId`
   - 或 `/home`

## 12.3 手工联调

1. 从 settings/session 中重新发起一轮完整 Slack OAuth
2. 确认 callback 成功
3. 检查保存结果为 user token
4. 将 Slack MCP 挂到 session
5. 验证在 session 中的 Slack 权限边界等于授权用户本人
6. 若失败，浏览器 Network 中 `/api/connectors/slack/oauth/callback` 的 response body 应能直接给出真实错误名

## 13. 非目标与边界

以下内容本次明确不做：

1. 不保留 bot token / user token 双模式并存。
2. 不增加失败时自动降级到 bot token 的逻辑。
3. 不重构成全 connector 通用的复杂 OAuth 框架。
4. 不修改与 Slack MCP 主链无关的其他 connector。

## 13.1 当前仍缺失的一条关键信息

虽然现在已经确认失败发生在 oneceo 服务层，但要 100% 锁定 Slack 返回的原始错误名，仍缺少这次 `400` 响应的 body 内容。

当前我们已经能确定：

1. 失败点在 oneceo callback 服务层
2. 现有报错大概率就是 `OAuth 回调未返回 access_token`

但如果要继续把文档收窄到“具体是 `bad_redirect_uri` 还是 `invalid_scope` 还是 `oauth_authorization_url_mismatch`”，还需要其中之一：

1. 浏览器 Network 里这次 `400` 的 response body
2. 服务端对应时间点日志

不过这不影响当前方案成立，因为本方案本来就要求把这类真实错误直接透出，避免后续再陷入同样的信息黑箱。

## 14. 方案状态

- 当前状态：`[20260414-1933已采用]`
- 说明：
  - 本文档已进入代码实现阶段。
  - 当前实现采用标准 `oauth/v2/authorize + user_scope + oauth.v2.access` 链路，并在 callback 中兼容 Slack user token 的两种可能返回位置，确保主链只保存 user token。
