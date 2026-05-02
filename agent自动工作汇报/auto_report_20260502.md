# 2026-05-02 自动工作汇报

## VercelMcp 显示卡片文案统一

- 做了什么：将 Vercel 已授权卡片的账号展示文案固定为 `vercel`，避免继续显示 `team_mGcDixrMSgZ5EN1BzoNrAHhT` 这类原始团队标识。
- 遇到什么：当前工作区已有连接器卡片相关未提交改动，本次只补齐 locale 文案，不覆盖既有结构调整。
- 计划如何解决：继续以 `apps/web` 最小校验确认前端类型与文案引用可用。

## MCP 连接器卡片语言统一

- 做了什么：为连接器目录新增 `connectors.catalog` 中英文文案，并让卡片、详情弹窗、搜索索引和连接按钮统一使用当前语言下的展示文案。
- 遇到什么：后端 catalog 定义里 Slack/GitHub/Figma/Vercel 是英文，Notion/Supabase 是中文，前端直出时会在同一界面混用。
- 计划如何解决：已通过前端 type-check，后续若新增连接器需要同步补齐 `connectors.catalog` 文案。
