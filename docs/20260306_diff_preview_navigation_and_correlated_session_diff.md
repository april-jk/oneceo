# 2026-03-06 更改面板联动修复（write/edit 关联 session.diff + 原子消息定位）

## 背景

- “内容预览 -> 更改”页面在仅保留 `apply_patch` 后，部分会话会出现无数据。
- 真实会话中存在 `write`/`edit` 工具改文件 + `session.diff` 回传结构化差异的组合，原逻辑未关联，导致更改列表为空。
- 原子消息（写入文件、文件更新）点击后，仅按猜测 `diffId` 或文件名跳转，容易失配。

## 本次修复

- 前端 diff 构建从“仅 apply_patch”升级为“仅 OpenCode 主动文件修改链路”：
  - 保留 `apply_patch` 显式补丁；
  - 新增 `write`/`edit` 与后续 `session.diff` 的受控关联渲染；
  - 无关联 `session.diff`（如 shell 安装依赖触发）继续忽略。
- 为 diff 条目增加事件关联元数据：`eventIndex`、`relatedEventIndexes`。
- 原子消息点击跳转逻辑改为三段定位：
  1. 显式 `diffId`（存在性校验）
  2. `messageIndex` 关联定位
  3. 文件路径匹配定位
- `file.*` 原子消息支持点击跳转到“更改”页。

## 变更文件

- `apps/web/client/src/lib/opencode-preview.ts`
- `apps/web/client/src/pages/Home.tsx`
- `apps/web/client/src/tests/opencode-sandbox-direct-ui/03_diff_dedupe_render/scenario.test.ts`
- `apps/web/client/src/tests/opencode-sandbox-direct-ui/03_diff_dedupe_render/README.md`

## 验证

- `pnpm exec vitest run client/src/tests/opencode-sandbox-direct-ui`（4 文件 10 用例通过）
- `pnpm exec tsc --noEmit --pretty false`（apps/web 通过）

## 结果

- 更改页可展示 `write/edit` 触发的关联 diff，避免空白。
- 原子消息点击可正确切换并定位到对应更改条目。
- 继续避免 `npm install` / `venv` 等无关联目录级噪音灌入更改面板。
