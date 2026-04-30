## 2026-04-30

- 修复 oneceo.space 默认部署域名绑定链路：Railway 自定义域名除了 CNAME 外，还需要写入 ownership TXT 验证记录，后端现在会读取 `verificationDnsHost` / `verificationToken` 并同步到 Cloudflare。
- 修复部署面板状态收敛：`pending_dns` / `pending_certificate` 会继续触发 live refresh，Railway 证书生效后平台状态会更新为 `active`，并统一展示 `oneceo.space 默认域名已生效`。
- 验证会话 `737373f7-7f5a-4e31-b3f5-f78126045931`：Railway custom domain 已 verified，平台部署接口返回 `domainStatus=active`，浏览器可打开 `https://app-737373f7-7f5-dd76de-3bc30f.oneceo.space/`。
- 修复部署统计域名错位：Umami 绑定和注入配置现在优先使用 oneceo.space public URL / publicDomain，旧 Railway websiteName 会在 live refresh 时收敛为 oneceo.space。验证该会话统计接口返回 `tracking`，`pageviews=7`、`visits=7`、`visitors=6`。
- issue `#60` 已认领并开始修复 Altus managed 部署完成条件与公网收敛判定。
- 部署链新增 4 个收口点：显式部署意图不允许停在代码完成、发布前统一执行 deployable workspace 预检、provider success 与 public readiness 分层、`public_settling` 超时后才升级成公网失败。
- 代码落地位置：`altus-run-coordinator.ts`、`task-session-deployment-runtime-service.ts`、`altus-managed-deployment-tool-service.ts`、`railway-deployment-service.ts`、`internal-admin-deployment-routes.ts`。
- 回归结果：`pnpm --dir apps/api run type-check` 通过；`altus-run-coordinator`、`task-session-deployment-runtime-service`、`altus-managed-deployment-tool-service`、`altus-managed-prompt-service` 组合测试 `86/86` 通过。
- 真实验收：启动本地 API 后执行 `pnpm --dir apps/api run test:deployment-main-chain:e2e` 通过，生成报告：
  - `apps/api/tests/e2e/reports/deployment-main-chain-2026-04-30T16-33-20-394Z.json`
  - `apps/api/tests/e2e/reports/deployment-main-chain-2026-04-30T16-33-20-394Z.md`
- 真实链路会话：`172af17b-7212-4687-ac45-6cc87cfb3d1d`；e2e 验证项包含 run 完成、部署状态持久化、公网 URL 可达、analytics 状态可读、DB session 记录存在。

## Slack Composio MCP OAuth 接入

- 做了什么：新增 `docs/features/connectors/slack_composio_notion_style_mcp_operation_doc_[20260430-1228已采用].md`，并将 Slack 从自建 OAuth + remote MCP 改为参照 Notion 的 Composio Connect Link + oneceo API broker 模式。
- 遇到什么：工作区已有 Supabase Composio 相关未提交改动，本次只在 brokered connector 集合、env 示例和测试中追加 Slack，避免覆盖既有改动。
- 计划如何解决：完成 API/Web 最小验证后，真实联调需配置 `COMPOSIO_API_KEY` 与 `COMPOSIO_SLACK_TOOLKITS=slack`，再执行 Slack 授权、attach 和 `slack__COMPOSIO_SEARCH_TOOLS` 调用验证。

## Supabase Composio MCP OAuth 接入

- 做了什么：按 `docs/features/connectors/20260429_supabase_composio_notion_style_mcp_oauth_doc_[20260429-2305已采用].md` 将 Supabase 连接器从 token/remote MCP 主路径切换为 Composio Connect Link + oneceo API broker 模式；同步更新后端 definition、hosted provider、恢复、快照、guide、误用拦截、前端连接入口、回调路径、文案和环境变量示例。
- 遇到什么：当前代码中 Notion/Figma 已经具备通用 Composio 分支，Supabase 主要需要接入该通用路径；旧测试仍覆盖 Supabase token/remote MCP 和 Notion remote_sse 预期，已同步更新为 Composio brokered runtime 预期。
- 计划如何解决：已完成最小闭环验证，后续真实联调时需要配置 `COMPOSIO_API_KEY` 与 `COMPOSIO_SUPABASE_TOOLKITS=supabase`，再走 Connect Link 授权、attach 和 `supabase__COMPOSIO_SEARCH_TOOLS` 调用验证。

## Slack legacy route cleanup

- Did: removed old Slack direct OAuth callback/token/state code from `apps/api/src/services/user-connector-service.ts`, and removed obsolete Slack OAuth/remote MCP env fixtures from related tests.
- Issue: legacy Slack token profiles still exist in data, so the downgrade-to-`needs_auth` path was kept.
- Next: verify Slack Composio authorization and attach flow with real `COMPOSIO_API_KEY`.

## Vercel Composio MCP OAuth 接入

- 做了什么：新增 `docs/features/connectors/vercel_composio_notion_style_mcp_operation_doc_[20260430-1314已采用_20260430-1341已替换].md`，并将 Vercel 连接器主链路改为参照 Notion 的 Composio Connect Link + oneceo API broker 模式；该方案随后已被回退方案替换。
- 遇到什么：Vercel 原先仍有 internal MCP wrapper / Integration OAuth 旧实现，本次先把 catalog、attach、recovery、guide、前端文案和测试切到 Composio broker；旧 wrapper 服务已不再由 hosted provider 主链路调用。
- 计划如何解决：完成最小测试后，真实联调需配置 `COMPOSIO_API_KEY` 与 `COMPOSIO_VERCEL_TOOLKITS=vercel`，再验证授权、attach 与 `vercel__COMPOSIO_SEARCH_TOOLS`。

## Vercel 退回非 Composio 版本

- 做了什么：按用户要求将 VercelMcp 从 Composio 方案退回 Vercel Integration + oneceo internal MCP wrapper；新增 `docs/features/connectors/vercel_internal_mcp_wrapper_oauth_only_rollback_doc_[20260430-1341已采用].md`，并把 Vercel Composio 文档标记为已替换。
- 遇到什么：当前分支同时有 Slack/Supabase Composio 改动，本次只回退 Vercel 相关 definition、hosted provider、registry、env、guide 和测试，避免影响其他连接器。
- 计划如何解决：跑 Vercel 定向测试与 API/Web 静态检查，确认 `VERCEL_INTEGRATION_*` 主链路恢复。
