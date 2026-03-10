# 2026-03-06 Diff 预览范围收敛（仅保留 apply_patch）

## 背景

- 在 Sandbox 直通会话中，`session.diff` 可能带出工作区全量变更（例如 `npm install` 触发的 `node_modules` 大量文件）。
- 前端“内容预览 -> 更改”会把这些目录级变更也渲染为 diff，导致变更列表异常膨胀并推高内存占用。

## 本次调整

- 更改面板只展示 OpenCode 明确输出的补丁 diff：`apply_patch`。
- 不再将 `session.diff` 事件纳入：
  - 实时消息渲染入口过滤（`useTaskCreationAgent`）
  - 对话区 Diff 卡片识别（`Home.buildChatItems`）
  - 预览区 diff 构建（`opencode-preview.buildPreviewItems` / `extractDiffPayload`）
- 不做路径黑名单：若 OpenCode 显式补丁修改了 `node_modules`、Python `venv` 等目录，仍会正常展示。

## 变更文件

- `apps/web/client/src/hooks/useTaskCreationAgent.ts`
- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/lib/opencode-preview.ts`
- `apps/web/client/src/tests/opencode-sandbox-direct-ui/03_diff_dedupe_render/scenario.test.ts`
- `apps/web/client/src/tests/opencode-sandbox-direct-ui/03_diff_dedupe_render/README.md`

## 结果

- `node_modules` 等目录级噪音变更不再进入“更改”列表。
- “更改”只保留补丁级 diff，符合“只展示 OpenCode 显式 diff”的预期。
- 前端渲染回归测试通过。
