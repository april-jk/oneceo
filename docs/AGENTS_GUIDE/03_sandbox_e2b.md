# 03 Sandbox（E2B）

- 现分支默认使用 E2B，`kvm-orchestrator` 已停用，仅保留历史文档。
- 所有 Sandbox 操作必须经由 `apps/api/src/connectors/e2b-connector.ts` 统一调用。
- 相关配置：`apps/api/src/config/e2b-config.ts`。

## 模板构建

- 模板目录：`e2b_templates/opencode-playwright-mcp`
- 默认模板名：`opencode-playwright-mcp-v2-min-eko`
- 构建脚本：
  - `pnpm -C apps/api exec tsx D:/project/oneceo.ai/oneceo/e2b_templates/opencode-playwright-mcp/build.ts`

## n.eko + Playwright

- n.eko UI 补丁：`e2b_templates/opencode-playwright-mcp/patches/neko-client-minimal.patch`
- 启动与编排：`apps/api/src/services/sandbox-debug-service.ts`
- 调试页通过 API 获取 debug 信息：`/api/task-creation/sessions/:id/debug`

## 注意事项

- 新模板仅对“新创建”的 sandbox 生效。
- 远程调试需确保 `neko` 服务端口可访问（默认 8081）。
