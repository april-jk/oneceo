# SSE 断线重连与后端持续转发补齐（2026-03-07）

## 目标
- 后端标记前端 SSE 连接/断开/重连状态。
- 前端重连后自动补齐断线期间遗漏事件。
- 执行环境仅由后端接入并转发，用户离开页面时后端持续接收并落盘。

## 本次改动

### 1) 前端稳定 clientId + SSE 参数上送
- 在前端本地生成并持久化 `task_creation_sse_client_id`。
- 订阅 SSE 时通过 query 传给后端：`clientId`。
- 文件：
  - `apps/web/client/src/hooks/useTaskCreationAgent.ts`
  - `apps/web/client/src/lib/task-creation-client.ts`

### 2) 后端维护 SSE 客户端状态
- 新增后端内存状态表（按 `sessionId + clientId`）：
  - `connectedAt` / `disconnectedAt`
  - `activeConnections`
  - `reconnectCount`
  - `lastCursor`
- 新连接时判定是否为重连；断开时落状态。
- 文件：`apps/api/src/routes/task-creation-routes.ts`

### 3) 重连补齐策略增强
- 回放 cursor 来源优先级：
  1. 前端 `since` 参数
  2. `Last-Event-ID` header
  3. 若以上缺失且判定为重连，则回退使用后端保存的 `lastCursor`
- 回放过滤兼容两类 cursor：
  - 时间戳 cursor（毫秒）
  - 序号 cursor（seq）
- 回放后与实时推送都会更新 `lastCursor`。

### 4) 连接状态标志
- SSE 建连时发送 `event: bridge` 状态包（connected/reconnecting/replayCursor 等）。
- 后端日志新增：
  - `OPENCODE_SSE_CLIENT_CONNECTED`
  - `OPENCODE_SSE_CLIENT_DISCONNECTED`

### 5) 历史加载时机优化
- 前端历史加载改为“只要有 sessionId 就加载”，不再依赖 WS 已连接。
- 避免“页面恢复时 WS 尚未连上导致历史空白”。

## 结果
- 前端断网/切页后再回到会话，能从后端游标或前端游标补齐遗漏事件。
- 即使用户不在当前页面，后端仍持续接收执行环境事件并落盘。
- 重新打开会话会先拉历史，再衔接未接收的增量事件。
