# 2026-03-06 SSE 事件落盘可靠性修复（完成态立即落盘）

## 现状检查结果
- 组件：`apps/api/src/services/opencode-event-stream-service.ts`
- 双路径机制：
  - 实时路径：`emitFast` 直接推送给 SSE 订阅端，低延迟渲染。
  - 持久化路径：`enqueuePersist -> persistQueue -> flushPersistQueue` 周期落盘。
- 原有落盘周期：`OPENCODE_EVENT_PERSIST_INTERVAL_MS`，默认 `1000ms`。

## 发现的问题
- 问题1：仅依赖定时 flush，收到“本轮结束标志”时不会立即落盘，完成态前后的少量消息可能滞留队列。
- 问题2：当 `OPENCODE_EVENT_PERSIST_INTERVAL_MS <= 0` 时，原逻辑不会启动 flush 定时器，队列存在“仅入队不刷盘”风险。
- 问题3：`stopStream` 结束流时未强制清空队列，异常退出窗口仍可能丢失尾部消息。

## 修复方案
- 文件：`apps/api/src/services/opencode-event-stream-service.ts`
- 关键改动：
  1. 新增 `shouldFlushPersistImmediately(...)`，识别结束标志：
     - `message.final` / `message.completed` / `message.done`
     - `session.idle` / `session.completed` / `session.error`
     - `message.updated` 且状态为 `completed/done/success/failed`
  2. 结束标志到达时立即 `flushPersistQueue(true)`，不再等待周期定时器。
  3. `persistIntervalMs <= 0` 时改为“即时 flush”兜底。
  4. `stopStream(...)` 时强制 `flushPersistQueue(true)`，清空尾部队列。
  5. 落盘 flush 串行化（`persistFlushInProgress`），避免并发 flush 竞争。

## 结果
- SSE 仍保留实时低延迟转发。
- 完成态事件出现时会立刻把当前队列写入持久层。
- 停流/禁用周期 flush 场景下，落盘可靠性显著提升。
