# 2026-05-03 自动工作汇报

## Composio OAuth callback env 控制

- 做了什么：新增 Composio OAuth callback 环境变量控制设计文档；API 侧新增 `COMPOSIO_OAUTH_CALLBACK_BASE_URL` 解析并用于生成 Composio Connect Link callback URL；Web 侧补齐 `/figma/callback` 固定回调识别与路由。
- 遇到什么：PowerShell 下 API 默认 test 脚本使用 Unix 环境变量语法无法直接执行；API type-check 初次失败是因为 `@oneceo/shared` 未生成 `dist`。
- 计划如何解决：已用 PowerShell 兼容命令跑定向 API 测试，并先构建 `@oneceo/shared` 后完成 API type-check。
