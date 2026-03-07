# SSE 流式消息落库与编排转发最佳实践

## 背景
历史问题：前端直接连 sandbox 内 OpenCode SSE，消息仅前端渲染未落库，刷新/重进会话后丢失“解释说明”类文本。

## 目标
- SSE 统一走编排平台转发，不允许前端直连 sandbox。
- 流式消息进入内存缓冲并定期批量写入数据库，降低高频 IO。
- 刷新/重开会话时，历史说明文本与实时流保持一致。

## 方案概览
1. **编排层统一转发**
   - SSE 接口由编排层订阅 `opencodeRemoteService` 转发。
   - 严禁前端直接调用 sandbox/OpenCode SSE。

2. **内存队列 + 定期落库**
   - OpenCode 事件消息先写入 `taskCreationFileMemoryStore`。
   - 同步进入内存队列，按批次/时间窗口落库。

3. **前端兼容载荷**
   - SSE 返回 `{ type, content, metadata }`，与 WebSocket 的 `opencode_event` 结构一致。
   - 前端统一使用同一套渲染逻辑，避免数据结构分裂。

## 实施要点
- **SSE 接口**：`GET /api/task-creation/sessions/:sessionId/opencode/events`
  - 订阅 `opencodeRemoteService` 的事件并过滤 `sessionId`、`opencodeSessionId`。
  - 保留心跳 `: ping`。

- **消息落库策略**
  - 使用内存队列，参数建议：
    - `TASK_CREATION_MESSAGE_FLUSH_INTERVAL_MS=2000`
    - `TASK_CREATION_MESSAGE_FLUSH_MAX_BATCH=50`
    - `TASK_CREATION_MESSAGE_FLUSH_MAX_QUEUE=300`
  - 达到批量阈值或定时窗口触发写入。

- **前端兼容**
  - SSE `payload.type` 存在时直接映射成消息对象。
  - 兼容旧的 `payload.event`（opencode raw event）

## 验收清单
- 新建会话后，SSE 输出的解释性文本在刷新页面后仍可从历史消息看到。
- 前端 Network 不再出现直连 sandbox/OpenCode 的 SSE 请求。
- 数据库中的 `conversation_messages` 按批次写入（观察写入频率下降）。

## 常见风险与处理
- **批量写入失败**：应保留队列并重试，避免丢失。
- **消息重复**：允许轻微重复，但前端应做去重/合并。
- **长文本膨胀**：遵循消息截断规则（`maxMessageLength`）。

## 相关文件
- `oneceo/apps/api/src/routes/task-creation-routes.ts`
- `oneceo/apps/api/src/services/opencode-remote-service.ts`
- `oneceo/apps/api/src/db/dao/task-creation-session.dao.ts`
- `oneceo/apps/web/client/src/hooks/useTaskCreationAgent.ts`
