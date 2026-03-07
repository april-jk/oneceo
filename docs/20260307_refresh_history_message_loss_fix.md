# 2026-03-07 刷新后解释性消息丢失修复

## 问题现象
- 同一会话在未刷新时可看到大量 OpenCode 解释文本（步骤说明）。
- 刷新后历史重建只剩原子事件为主，解释文本明显丢失。

## 根因
1. `useTaskCreationAgent.ts` 在终态分支会“全局清空文本流事件”（而不是按 stream 维度清理），导致历史重建时大量解释文本被误删。
2. 文本流合并键在缺少 `streamKey/partId` 时会退化到 `opencodeSessionId:eventType`，存在跨段误合并风险。

## 修复
- 文件：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- 新增 `resolveTextStreamKeyFromMetadata`：文本流只使用 `streamKey` 或 `opencodeSessionId+partId` 作为合并键。
- `mergeRealtimeMessage`：
  - `message.final` 改为仅替换同 `streamKey` 的文本流，不再清空全部文本流。
  - `status_update` 终态不再触发全量文本清空。
- `compactHistoryMessages`：
  - `message.final` 仅清理同 `streamKey` 文本流。
  - 终态 `status_update/opencode_status` 不再清空全部文本流，仅重置压缩状态。
- `shouldAcceptStreamUpdate` 与 `loadHistory` 的文本流去重键改为 `resolveTextStreamKeyFromMetadata`。

## 验证
- `pnpm -C apps/web check` 通过。
- 预期结果：刷新前后解释性文本保持一致，不再被终态消息误清空。
