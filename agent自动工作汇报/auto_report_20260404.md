# auto_report_20260404

## 做了什么

1. 按已采用方案在 `apps/api/src/services/session-connector-service.ts` 落地 Supabase 连接修复：
   - 增加 `failed_to_attach/attach_failed -> failed` 状态映射。
   - Supabase 传输从 `remote_sse` 切换为 `streamable_http`。
   - attach 回包非 `connected` 时立即失败短路，并保留 runtime 原始错误到 `lastError`。
   - 增加 Supabase 代理注入可观测日志（仅记录是否注入与键名，不输出敏感值）。
2. 在 `apps/api/src/services/osac-agent-service.ts` 扩展 MCP 传输类型定义，新增 `streamable_http`。
3. 在 `env.windows` 增补平台代理与 attach 重试参数模板。
4. 更新方案文档状态为已采用，并把传输描述同步为 `streamable_http`。

## 遇到什么

1. 方案文档原始描述与真实测试结果存在偏差（`remote_sse` vs `streamable_http`），已在文档中统一。

## 计划如何解决

1. 执行 API 类型检查验证本次改动可编译。
2. 如类型检查通过，进入真实链路回归（attach/list_tools/call_tool）。
