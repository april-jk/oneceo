# 2026-03-06 内容预览-更改页空白修复（write 原子消息）

## 问题
- 点击 `写入文件` 原子消息后，`内容预览 -> 更改` 显示“暂无更改”。

## 根因
- 预览层只依赖结构化 metadata 提取 `toolName/diff`，但在大内容场景下后端会对 `metadata.event/rawPayload/diff` 做长度截断，可能变成字符串，导致：
  - 无法识别 `write` 工具事件（候选修改事件丢失）；
  - `session.diff` 关联不到候选事件，被过滤；
  - 最终 `diffItems` 为空。

## 修复
- 文件：`apps/web/client/src/lib/opencode-preview.ts`
- 关键改动：
  - `toRecord` 增加 JSON 字符串解析（对象字符串可恢复为对象）；
  - `extractSessionDiff` 增加“字符串 JSON -> structured diff”解析；
  - `buildPreviewItems` 增加 `content` 回退识别工具名（支持 `[Tool] write`、`Tool: write`）；
  - `pickMutationCandidate` 在 `sessionPaths` 为空时回退选择最近修改候选，避免字符串化 diff 丢失关联；
  - structured diff 去重签名改为 `file+before+after+status`，消除 `write` 与 `session.diff` 统计差异导致的重复卡片。

## 测试
- 文件：`apps/web/client/src/tests/opencode-sandbox-direct-ui/03_diff_dedupe_render/scenario.test.ts`
- 新增/调整：
  - `write + session.diff` 场景断言（去重后保留一条）；
  - `content-only write` + 文本 `session.diff` 仍可渲染；
  - `metadata` 为 JSON 字符串时仍可渲染 write diff。

## 验证结果
- `pnpm exec tsc --noEmit --pretty false`（apps/web）通过。
- `pnpm exec vitest run client/src/tests/opencode-sandbox-direct-ui`（apps/web）通过（4 文件 12 用例）。
