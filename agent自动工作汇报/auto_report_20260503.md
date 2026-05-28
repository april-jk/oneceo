# 2026-05-03 自动工作汇报

## Composio OAuth callback env 控制

- 做了什么：新增 Composio OAuth callback 环境变量控制设计文档；API 侧新增 `COMPOSIO_OAUTH_CALLBACK_BASE_URL` 解析并用于生成 Composio Connect Link callback URL；Web 侧补齐 `/figma/callback` 固定回调识别与路由。
- 遇到什么：PowerShell 下 API 默认 test 脚本使用 Unix 环境变量语法无法直接执行；API type-check 初次失败是因为 `@oneceo/shared` 未生成 `dist`。
- 计划如何解决：已用 PowerShell 兼容命令跑定向 API 测试，并先构建 `@oneceo/shared` 后完成 API type-check。

## 自定义 API 当前阶段隐藏与安全收口

- 做了什么：将 `docs/20260503_自定义API后端Broker调用设计_[20260503-1353已采用].md` 标记为已采用；新增 `ONECEO_CUSTOM_API_ENABLED` 默认关闭开关；默认隐藏 `custom_api` catalog 入口，关闭用户态 custom API routes、generic profile 创建、hosted RPC、tools/list 与 broker 执行路径。
- 遇到什么：代码中已经存在 Custom API definition、connector routes、broker 和 MCP tools/list 逻辑，且 Web 设置弹窗里还有硬编码的 `自定义 API` tab 和占位创建按钮，不能只靠 API catalog 隐藏。
- 计划如何解决：已补充定向测试覆盖 catalog 隐藏、feature flag materialize、custom API route 404、generic profile 创建拒绝、tools/list 默认空和 hosted RPC 直接调用失败；Web 侧已移除 `自定义 API` tab 与占位翻译文案；后续只有完成安全评审后再打开 UI。
