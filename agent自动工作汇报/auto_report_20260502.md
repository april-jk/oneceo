# 2026-05-02 自动工作汇报

## VercelMcp 显示卡片文案统一

- 做了什么：将 Vercel 已授权卡片的账号展示文案固定为 `vercel`，避免继续显示 `team_mGcDixrMSgZ5EN1BzoNrAHhT` 这类原始团队标识。
- 遇到什么：当前工作区已有连接器卡片相关未提交改动，本次只补齐 locale 文案，不覆盖既有结构调整。
- 计划如何解决：继续以 `apps/web` 最小校验确认前端类型与文案引用可用。

## MCP 连接器卡片语言统一

- 做了什么：为连接器目录新增 `connectors.catalog` 中英文文案，并让卡片、详情弹窗、搜索索引和连接按钮统一使用当前语言下的展示文案。
- 遇到什么：后端 catalog 定义里 Slack/GitHub/Figma/Vercel 是英文，Notion/Supabase 是中文，前端直出时会在同一界面混用。
- 计划如何解决：已通过前端 type-check，后续若新增连接器需要同步补齐 `connectors.catalog` 文案。

## Custom API 生成 MCP 工具执行链路

- 做了什么：根据 `docs/features/connectors/custom_api_generated_mcp_tools_execution_doc_[20260502-1642已采用].md` 实现 custom_api 连接器定义、数据库表、DAO、安全审查、MCP 工具生成、oneceo broker 执行、Hosted provider tools/list 与 tools/call 接入、用户/管理路由、Altus shell 绕过拦截和连接器使用指南。
- 遇到什么：本地 `rg.exe` 执行被系统拒绝，改用 PowerShell 原生命令检索；API type-check 只剩既有 `@oneceo/shared` workspace 类型解析失败，新增 custom_api 代码相关类型错误已修复。
- 计划如何解决：已补充 custom_api 安全审查与 MCP 工具暴露规则的定向单元测试，后续若处理仓库级 type-check，需要先修复 `@oneceo/shared` 的 workspace 解析。
