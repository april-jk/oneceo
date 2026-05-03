# 10_用户端 Google/GitHub 社交登录接入方案 [20260504-已采用]

## 1. 目标

1. 在 `/login` 和 `/register` 页面提供 Google、GitHub 一键登录入口。
2. 登录后直接建立 `app_users` 登录态，不新增独立用户体系。
3. 复用现有 `app_user_sessions`、`app_session_v2_id`、`app_session_v2_state` cookie 主链。

## 2. 约束

1. Google/GitHub 登录只用于用户态主站，不用于管理后台。
2. 账号归属以 `app_user_oauth_accounts` 为准。
3. 同一 provider 的 `provider_subject` 必须唯一。
4. 现有邮箱密码登录保留不变。

## 3. 页面

1. 登录页展示 Google、GitHub 按钮。
2. 注册页展示 Google、GitHub 按钮，并保留邮箱注册。
3. 按钮仅承担授权跳转，不承担表单提交。

## 4. 配置

1. `APP_AUTH_GOOGLE_CLIENT_ID`
2. `APP_AUTH_GOOGLE_CLIENT_SECRET`
3. `APP_AUTH_OAUTH_STATE_SECRET`
4. `APP_AUTH_GITHUB_CLIENT_ID`
5. `APP_AUTH_GITHUB_CLIENT_SECRET`
6. `APP_AUTH_GITHUB_DEV_CLIENT_ID`
7. `APP_AUTH_GITHUB_DEV_CLIENT_SECRET`
8. `APP_AUTH_GITHUB_STAGING_CLIENT_ID`
9. `APP_AUTH_GITHUB_STAGING_CLIENT_SECRET`
10. `APP_AUTH_GITHUB_PRODUCT_CLIENT_ID`
11. `APP_AUTH_GITHUB_PRODUCT_CLIENT_SECRET`

## 5. 回调

1. Google 回调：`/api/auth/oauth/google/callback`
2. GitHub 回调：`/api/auth/oauth/github/callback`
3. 发起授权时服务端生成并下发一次性 `state` cookie，回调必须校验通过
4. 授权成功后服务端直接签发登录 cookie 并重定向回 `redirect`

## 6. 验收

1. 未注册社交账号可自动创建用户并登录。
2. 已绑定社交账号再次授权可直接登录同一用户。
3. 登录页与注册页都可见社交入口图标。
