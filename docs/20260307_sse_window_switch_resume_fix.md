# 2026-03-07 SSE切窗中断续传修复

## 问题现象
- 场景1：同窗口持续停留，SSE 正常完整回复。
- 场景2：发送后切换窗口再返回，回复被中断或只剩片段（如仅“会话已创建”或短句）。

## 根因
1. 前端 `since` 游标在流式过程中会被 timestamp 覆盖，覆盖了 seq 游标，导致重连回放游标类型错乱。
2. 后端客户端状态中的 `lastCursor` 也可能被 timestamp 覆盖，后续 seq 事件无法推进游标。
3. 直通模式（sandbox direct）未做文本流 checkpoint 持久化，断线期间生成的增量文本无法通过历史回放补齐。

## 修复
### 前端
- 文件：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- 增加 `sseCursorKindRef`（`seq | timestamp`），游标更新策略改为：
  - 优先使用 seq。
  - 已进入 seq 模式后，不再被 timestamp 覆盖。
- `openSse` 仅在 seq 游标可用时传 `since`，避免错误 timestamp 游标干扰后端回放。
- 收到 `bridge.reconnecting=true` 时触发历史补拉（`loadHistory`）。
- `loadHistory` 恢复游标时优先取最大 seq，否则回退 timestamp。

### 后端
- 文件：`apps/api/src/routes/task-creation-routes.ts`
- 增加 `isTimestampCursorValue` 与游标合并策略：
  - query/header 与 server-state 游标类型冲突时，优先使用 server-state。
  - `updateSseClientCursor` 防止 seq 被 timestamp 覆盖；若已是 timestamp 且收到 seq，则切回 seq。

### 直通文本回放
- 文件：`apps/api/src/services/opencode-remote-service.ts`
- 在 direct 模式也启用 `scheduleStreamCheckpoint`，确保断线期间文本增量可回放。

## 验证
- `pnpm --dir apps/web check` 通过。
- `pnpm --dir apps/web test:opencode-direct-ui` 通过（4 files / 12 tests）。
- `pnpm --dir apps/api type-check` 仍有仓库历史错误（非本次修复新增）。
