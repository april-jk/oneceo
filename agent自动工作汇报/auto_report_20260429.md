# 2026-04-29 自动工作汇报

## 部署 Umami 统计 ID 错位排查

- 问题：新部署会话 `a8a09e77-89cd-423c-83ae-3daf18987686` 的面板查询 `ed13ea9f-833f-4ccd-9bfe-e1c279fe6368`，但线上页面实际注入并上报 `a7901c57-a927-49c6-a9c3-c3faa1e868dd`，导致面板显示 0。
- 处理方向：发布注入和前端 dist 运行时注入均改为替换旧 `ONECEO_ANALYTICS` 块；部署成功后的最终绑定改为重新读取最新 sandbox metadata，并增加公网页面实际注入配置回读校验，必要时以已发布页面的 `websiteId` 修正面板 metadata。
- 验证：已通过部署模板相关 19 个单测、`git diff --check` 和目标运行时文件诊断；全量 API type-check 仍受既有 `altus-managed-setup-service.ts` 类型错误阻断。
- 复查补强：Umami `listWebsites(teamId)` 可能漏列真实存在的 website，已改为先通过 `/api/websites/:id` 读取详情并校验 `teamId`，同 team 才复用更新；跨 team 或 not found 才回退到域名匹配/创建，避免再次创建新 ID 或误改平台站点。

## 非 HTML 部署类型覆盖检查

- 问题：HTML 部署链路已趋于稳定后，需要继续确认 Vite/Node/Python/PHP/Java 等其他网站类型不会被 HTML 专用逻辑影响。
- 处理：部署模板扫描补充 `.jinja2` 模板识别，合规检查同步纳入 `.jinja2`；新增 Python Flask/Jinja2 单测，确认 analytics bootstrap 可以注入并被合规检测识别。
- 验证：`pnpm --filter api exec tsx --test tests/deployment-template-bootstrap-service.test.ts tests/deployment-template-baseline-service.test.ts` 通过 21 项；`pnpm --filter api exec tsx --test tests/altus-managed-deployment-tool-service.test.ts tests/task-session-deployment-analytics-service.test.ts tests/umami-analytics-service.test.ts` 通过 18 项。
- 真实链路：已启动 `WD-JS-01` Vite/JS 真实部署矩阵测试，生成阶段完成并进入部署阶段；后续轮询 `/api/altus-managed/sessions/:id/runs/latest` 时遇到 500。复查 `http://oneceo.ai:3000/api/system/health` 和 `/api/auth/login` 同样返回 500，因此当前阻断是线上 API 服务层异常，暂不能归因到 Vite 部署模板。
- 补充：顺手修正 `src/services/altus-managed-setup-service.ts` 中一个不改变行为的窄类型比较，`pnpm --filter api type-check` 已恢复通过。

## 多类型部署真实链路复测与修复

- 覆盖：在服务重启后重新跑了 Vite/JS、Node、Python、PHP、Java/Spring Boot 五类非纯 HTML 网站部署链路，并补跑 Umami 注入/统计验证。
- 主要修复：E2B 文件读写增加重试并在连接异常后清理缓存 sandbox；Railway redeploy/rollback GraphQL 补齐返回字段；API 入口忽略可恢复的 `EPIPE`/`ECONNRESET` socket 断连；运行时 analytics 注入移除过期 `data-domains`；Java/Spring Boot 补充 `src/main/resources/templates` 与 `static` 扫描，并将平台健康检查标准化为 `/`。
- 验证：Vite/JS、Node、Python、PHP、Java 均已真实部署到 Railway 且公网 200；JS/Node/Python/Java 的 Umami e2e 均确认面板进入 `tracking` 并读到 pageviews/visits/visitors；PHP 完整统计脚本曾遇到一次公网 TLS 瞬断，但通过真实页面上报与后端查询确认 `pageviews=1`、`visits=1`、`visitors=1`。
- 本地检查：`pnpm --filter api exec tsx --test tests/deployment-template-baseline-service.test.ts tests/deployment-template-bootstrap-service.test.ts` 通过 24 项；`pnpm --filter api type-check` 通过。
- 遗留观察：Java 统计脚本额外触发过一条 redeploy，面板历史列表中仍可见非当前的 `BUILDING` 记录；当前绑定为 `ready`、线上版本为 `SUCCESS`、`activeDeploymentPending=false`，不影响当前可用性。

## Railway 线上地址短时间后 404 排查

- 问题：已发布成功的 Railway 公网地址在后续一段时间后出现 `x-railway-fallback: true` / 404。
- 根因：部署成功后 runtime 会调用跨资源键的 `pruneSupersededProjectResources`，按同一用户 Railway project 删除其他 Environment/Service。正确模型应是 OneCEO 用户 -> 一个 Railway Project，OneCEO 用户项目 -> 一个 Railway Environment；跨用户项目删除会误删其他项目线上服务，导致旧 URL 变为 Railway fallback 404。
- 处理：移除部署成功、重部署/回滚成功后的跨 session 清理调用，并删除 `pruneSupersededProjectResources` 入口；普通 `provider_error`、`FAILED`、`CRASHED` 不再先删 service 再重建，只有明确的 `railway_environment_not_found` / `railway_service_not_found` 资源缺失才允许回收重建。
- 补强：禁用"服务创建额度到顶时复用其他 session service"的路径，避免新项目覆盖旧项目；公网验证阶段的 `deployment_provider_error` 保留资源用于诊断/恢复，不再立即删除刚创建的 service 导致慢启动变 404。
- 模型修正：部署资源键优先使用 `session.projectId`，只有未绑定用户项目的临时会话才回退到 `taskSessionId`；资源绑定标记更新为 `environmentModel=per_user_project`。
- 保留：失败部署的当前 session 资源清理仍保留，避免首次部署或替换部署失败后留下持续计费资源。
- 验证：`rg` 确认源码/测试无剩余 `pruneSupersededProjectResources` 或跨 session 复用入口；`pnpm --filter api exec tsx --test tests/platform-deployment-account-service.test.ts tests/task-session-deployment-runtime-service.test.ts` 通过 25 项；`pnpm --filter api type-check` 通过；`pnpm --filter web check` 通过；`git diff --check` 通过。

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
