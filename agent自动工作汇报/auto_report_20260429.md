# 自动工作汇报 20260429

## Notion 改走 Composio 方案文档

- 做了什么：新增 `20260429_Notion改走Composio_MCP_OAuth清理方案_[尚未采用].md`，详细设计 Notion 从旧 Notion OAuth/remote MCP 直连迁移到 Composio Tool Router/Connect Link/API broker 的方案。
- 遇到什么：当前 `apps/.env` 仍保留旧 Notion OAuth 与 `NOTION_MCP_REMOTE_URL=https://mcp.notion.com/mcp`，同时已有 `COMPOSIO_API_KEY`；方案明确这些旧变量不再由 Notion 生产代码读取。
- 计划如何解决：等待用户评审并确认 toolkit slug、allowed tools、旧 profile 是否全部重授权；确认后再更新文档状态并进入代码清理实现。

## Notion Composio 方案补充

- 做了什么：按用户补充要求更新 Notion Composio 方案，明确必须保留通用 Composio MCP 扩展接口，后续其他 MCP 只新增 definition/env/toolkit 配置，不复制专属服务分支。
- 遇到什么：用户要求无关 env 不直接删除，因此文档已把 `.env` / `.env.example` 清理方式改为 legacy 注释停用。
- 计划如何解决：实现阶段先抽通用接口，再迁移 Notion；旧 Notion env 只注释并标明 Composio 方案不读取。

## Composio Tool Router payload 字段修正

- 做了什么：按 Composio 请求侧 schema 修正 Tool Router session payload，`toolkits.enabled` 改为 `toolkits.enable`，`manage_connections.enabled` 改为 `manage_connections.enable`，tool 白名单也改为 `tools.<toolkit>.enable`。
- 遇到什么：`apps/.env` 已配置 `COMPOSIO_API_KEY`，但未配置 `COMPOSIO_GOOGLE_CLOUD_TOOLKITS`，当前代码会按设计使用默认 `googlebigquery`；本次 validation error 不是环境变量导致，而是 payload 字段名错误。
- 计划如何解决：已同步更新已采用设计文档并通过 `pnpm --filter api type-check`；后续用真实 OAuth start 链路验证 Composio 是否返回 Connect Link。

## Composio Google Cloud MCP OAuth 接入设计

- 做了什么：新增 Composio Google Cloud MCP OAuth 接入设计文档，状态为 `[尚未采用]`，覆盖 OAuth、session attach、API 侧 MCP broker、token 不进 Sandbox、恢复链路与扩展接口。
- 遇到什么：本地 `rg.exe` 执行被拒绝，已改用 PowerShell 原生命令检索已有 MCP、OAuth、连接器文档与代码位置。
- 计划如何解决：等待用户评审设计文档；确认 Google Cloud 对应的 Composio toolkit slug 和 tool 白名单后，再按已采用文档进入实现。

## Composio Google Cloud MCP OAuth 接入实现

- 做了什么：用户确认进入实现后，将设计文档状态更新为 `[20260429-1843已采用]`；新增 `google_cloud` 连接器定义、Composio Tool Router OAuth 启动与回调确认、API 侧 MCP broker、hosted provider 执行桥接。
- 遇到什么：首次 API type-check 被 `@oneceo/shared` 未生成 dist 阻断，先构建 shared 后重新验证通过；`rg.exe` 仍不可用，继续使用 PowerShell 检索。
- 计划如何解决：后续联调时配置 `COMPOSIO_API_KEY` 与 `COMPOSIO_GOOGLE_CLOUD_TOOLKITS`，再跑 OAuth start/callback、attach、tool list/call 的真实链路验证。

## Composio Google Cloud OAuth 问题修正

- 做了什么：修正 Composio Tool Router 请求字段，`manage_connections.enabled` 与 `workbench.proxy_execution_enabled` 按官方 v3.1 API 使用；前端将 `google_cloud` 改为 connector-level OAuth，点击连接直接跳转外部授权，不再要求先填写 profile。
- 遇到什么：Web 类型检查提示 `ConnectorKey` 新增后缺少 Google Cloud guide 文案，已补齐中英文 guide。
- 计划如何解决：继续用真实 `COMPOSIO_API_KEY` 联调 OAuth 链接、回调确认和 session 自动挂载。

## Composio Validation Error 复查

- 做了什么：再次对照 Composio v3.1 Tool Router 文档，确认 `googlebigquery` toolkit 存在；进一步精简 Tool Router session 请求体，去掉非必要 `workbench` 配置，并增强 Composio API 错误详情透出。
- 遇到什么：Composio link 页面可能对 callback URL 做严格校验，原先复用 settings URL 会携带较多查询参数。
- 计划如何解决：Google Cloud 改用固定 `/google-cloud/callback`，生成给 Composio 的 callback URL 不继承当前页面杂项查询参数，只保留必要连接器回调参数。

## Notion Composio MCP OAuth 实现

- 做了什么：用户确认进入实现后，将 Notion Composio 清理方案更新为 `[20260429-1958已采用]`；后端开始把 Notion 切到通用 `catalogItem.composio` 授权、confirm、hosted provider 与 API broker 链路。
- 遇到什么：当前工作区已有 Google Cloud Composio 未提交实现，本轮以该通用化基础继续修改；`rg.exe` 仍无法执行，继续使用 `git grep` 与 PowerShell 检索。
- 计划如何解决：跑 API/Web 静态检查，继续清理旧 Notion OAuth/remote MCP 引用，并用 Composio callback/attach/tool list 主链做最小闭环验证。

## Notion Composio Router 使用修正

- 做了什么：针对模型仍尝试安装 `@notionhq/mcp-cli` 的问题，更新内置 Notion connector guide，明确禁止 sandbox 内旧 Notion MCP CLI/remote MCP 安装，要求改用已挂载的 Composio router 工具；同时在 `shell_execute` 运行时增加旧 Notion MCP 命令拦截。
- 遇到什么：挂载日志显示 Notion provider 已 connected，但暴露的是 Composio Tool Router 工具，不是旧 Notion 直连业务工具；工具列表还出现重复，可能影响 raw tool name 选择。
- 计划如何解决：已补充 provider 工具去重；服务重启后内置 guide 会自动发布 v2 并重算 session guide，后续用新会话验证模型不再走 shell 安装链路。
## Notion Composio Search Tools 参数修正

- 做了什么：复现 `notion__COMPOSIO_SEARCH_TOOLS` 调用，确认 Notion profile 与 Composio MCP 已连接，失败原因是模型传参不符合当前 router schema；在 API broker 中把 `query`、`use_case`、空参数或仅传 `toolkits` 统一归一化为 `queries` 数组，并把 Notion guide 更新到 v3，明确 `COMPOSIO_SEARCH_TOOLS` 必须使用 `queries`。
- 遇到什么：Composio router 返回的 meta tool schema 要求 `queries: [{ use_case }]`，如果模型只传 `toolkits` 会返回 `Required at "queries"`，随后容易退回 shell 安装旧 Notion MCP CLI。
- 计划如何解决：已通过真实已挂载 profile 复测三类易错参数均返回 `successful=true`，并重新计算当前 task session guide；后续若仍失败，优先查看工具调用 payload 与 broker 归一化后的参数。
