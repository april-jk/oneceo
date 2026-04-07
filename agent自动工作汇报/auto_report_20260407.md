# auto report 2026-04-07

- 做了什么：
  - 创建并认领 Issue #34（Connector Guide 启动全量重算改按需加载）。
  - 将方案文档状态从 `[尚未采用]` 更新为 `[20260407-1403已采用]`。
  - 代码修复已完成：
    1. 启动时默认跳过 `recomputeBuiltinPolicySessions`，新增开关 `CONNECTOR_GUIDE_STARTUP_RECOMPUTE_ENABLED=true` 才执行。
    2. 新增 `connectorGuideService.ensureSessionGuidesUpToDate(taskSessionId)` 做会话级按需重算。
    3. 在 `GET /api/task-creation/sessions/:sessionId/connectors` 入口接入按需校验。
- 遇到什么：
  - 本 worktree 初始未安装依赖，首次 type-check 失败（`tsc: command not found`）。
  - 安装依赖后，`apps/api` 存在大量与本次改动无关的既有 TypeScript 报错，无法用全量 type-check 作为本次通过依据。
- 计划如何解决：
  - 继续以接口级联调验证本改动行为（启动日志不再全量重算、会话 connectors 访问触发按需重算）。
  - 如需通过 CI，先单独处理当前分支既有 TS 基线问题或在独立任务中修复。

## 补充：触发点测试（2026-04-07 14:xx）

- 新增测试：
  - `apps/api/tests/connector-guide-startup-config.test.ts`
  - `apps/api/tests/connector-guide-on-demand-trigger.test.ts`
- 覆盖点：
  - 启动开关默认关闭，仅 `true` 启用。
  - `ensureSessionGuidesUpToDate` 在集合不一致时触发重算、集合一致时跳过。
  - `GET /api/task-creation/sessions/:sessionId/connectors` 会触发按需校验。
  - 按需校验异常时接口仍可返回成功（仅记录 warn 日志）。
- 执行命令：
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable pnpm --filter api exec tsx --test tests/connector-guide-startup-config.test.ts tests/connector-guide-on-demand-trigger.test.ts`
- 结果：6/6 通过。
