# 2026-03-07 可靠性增强最终版（完成态门闩 + sessionEventSeq + WAL）

## 目标
- 在极端场景下（立即刷新、断连、短时抖动、进程异常）保证消息一致性与可恢复性。

## 1) 完成态门闩（Completion Barrier）
### 改动
- 文件：`apps/api/src/services/opencode-remote-service.ts`
- 新增 `flushPersistenceBarrier(reason)`。
- 在以下终态路径中，发送终态/返回前强制 `flushMessageQueue(true)`：
  - `OPENCODE_ERROR` 落盘后
  - `outcome=completed`（direct/non-direct）
  - `outcome=failed`（direct/non-direct）

### 效果
- 终态对前端可见前，持久化队列已尽可能刷盘，降低“看到完成但刷新缺内容”的窗口。

## 2) sessionEventSeq（结构化顺序）
### 改动
- 文件：
  - `apps/api/src/agents/task-creation/file-memory-store.ts`
  - `apps/api/src/routes/task-creation-routes.ts`
  - `apps/web/client/src/hooks/useTaskCreationAgent.ts`

- `file-memory-store`：
  - 在 `addMessage/addMessagesBatch` 自动注入 `metadata.sessionEventSeq`（单会话递增）。
  - 若外部已提供合法 `sessionEventSeq`，保留并推进下一序号。

- 消息接口排序：
  - `/sessions/:sessionId/messages` 返回前按 `sessionEventSeq` 优先排序，再按 `createdAt`。

- 前端历史重建：
  - `loadHistory` 优先按 `sessionEventSeq` 排序。
  - 实时合并增加同 `sessionEventSeq + type` 去重。

### 效果
- 消息重建顺序更稳定，减少时间戳同值/抖动导致的错位。

## 3) WAL（Write-Ahead Log）
### 改动
- 文件：`apps/api/src/services/opencode-remote-service.ts`
- 为 DB 异步落盘队列新增 WAL：
  - 路径：`TASK_CREATION_MESSAGE_WAL_PATH` 或默认 `data/task-creation-message-queue.wal.jsonl`
  - 入队先写 WAL，再进入 flush 调度。
  - flush 成功后按当前剩余队列重写 WAL；失败则回队并重写。
  - 服务初始化时 `recoverMessageQueueFromWal()` 回放未刷入记录并触发强制 flush。

### 效果
- 进程异常中断后可恢复未刷入 DB 的尾部消息，降低丢失风险。

## 验证
- `pnpm -C apps/web check` 通过。
- `pnpm -C apps/api exec tsc --noEmit` 仍有仓库既有历史错误（与本次新增逻辑无直接冲突）。

## 兼容性说明
- 新增字段为 `metadata.sessionEventSeq`，对旧历史数据兼容（缺失时退回 `createdAt` 逻辑）。
- WAL 为增量安全机制，不改变既有 file-memory 持久化主路径。
