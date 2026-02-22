# Sandbox 内 OpenCode 多 Session 集成最佳实践（oneceo 绑定）

适用范围：在单台 sandbox 上启动一个 OpenCode Server（`opencode serve --port`），由 OSAC 转发 SSE 事件，oneceo 会话 1:1 绑定 OpenCode session，并通过工作区目录隔离。

## 目标与原则

- 单台 sandbox 内运行一个 OpenCode 服务实例。
- oneceo 每个任务会话绑定一个 OpenCode session（1:1）。
- 每个会话使用独立工作区目录，避免互相污染。
- 事件通过 OSAC 转发到 oneceo Web，不直接暴露 OpenCode Web UI。

## 关键组件与职责

- OpenCode Server（sandbox 内）：
  - `opencode serve --port <port>` 提供 HTTP API 与 SSE 事件。
- OSAC（sandbox 内）：
  - 启动并守护 OpenCode Server。
  - 通过 `GET /global/event` 订阅 SSE 事件。
  - 转发事件与命令给 oneceo API。
- oneceo API（平台端）：
  - 建立 oneceo 会话与 OpenCode session 的 1:1 绑定。
  - 将 OpenCode SSE 事件映射回对应 oneceo 会话。
  - 向 OpenCode session 发送 prompt / commands。
- oneceo Web：
  - 通过 WebSocket 接收 OpenCode 事件流并展示。

## 目录与会话绑定策略

- 工作区根目录：`/opt/.altus/opencode/workspaces`
- 每个任务会话目录：
  - `/opt/.altus/opencode/workspaces/{taskSessionId}`
- 绑定关系：
  - oneceo 会话 `taskSessionId` ↔ OpenCode `opencodeSessionId`
  - 事件到达时优先按 `opencodeSessionId` 路由；若缺失则按 `directory` 解析回 `taskSessionId`。

## OpenCode Server 启动方式

OSAC 内部通过以下方式启动：

- 命令：
  - `opencode serve --port 4096`
- 端口可配置（默认 4096）。
- 仅在 sandbox 内监听，不对外开放。

## SSE 事件订阅与转发

- 订阅端点：`GET /global/event`
- 说明：
  - `/event` 为单目录事件流，`/global/event` 为跨目录流。
  - 需确保事件 payload 中包含 `directory` 或 `sessionId` 信息，便于路由。
- OSAC 负责事件转发，oneceo API 负责路由。

## oneceo API 侧映射与路由

核心流程：

1. `opencode_input` 进入后，确保 OSAC 已启动 OpenCode Server。
2. 若会话尚未绑定 OpenCode session，则创建新 session，并写入 runtime。
3. 发送 prompt 至对应 OpenCode session。
4. SSE 事件到达时：
   - 优先按 `opencodeSessionId` 路由。
   - 若缺失，解析 `directory` → `taskSessionId`。

## 推荐配置

- `OPENCODE_TASK_WORKSPACE_ROOT=/opt/.altus/opencode/workspaces`
- `OPENCODE_SERVER_PORT=4096`

## 回归与验收

必测场景：

1. 多会话并发：
   - 同时创建 2-5 个 oneceo 会话。
   - 确认每个会话都收到自己的 SSE 事件。
2. 工作区隔离：
   - 在会话 A 创建/修改文件，确认会话 B 工作区不受影响。
3. 绑定稳定性：
   - `taskSessionId` ↔ `opencodeSessionId` 一致且不重复。
4. 断线恢复：
   - SSE 断线后可自动重连，事件继续回传。

推荐脚本：

- `oneceo/apps/api/scripts/_tmp_opencode_multi_session_sse_test.ts`

## 常见问题与处理

- 事件路由错误：
  - 检查是否订阅 `GET /global/event`。
  - 检查事件 payload 是否包含 `directory`。
- 会话冲突或串流：
  - 检查 oneceo 侧 `opencodeSessionId` 是否 1:1 绑定。
  - 检查目录映射是否正确解析 `taskSessionId`。

