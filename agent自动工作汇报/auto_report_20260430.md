# 2026-04-30 自动工作汇报

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
