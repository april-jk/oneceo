# 场景 01：首条消息建会话

## 目标

验证 sandbox 直通模式下，首条 `opencode_input` 能完成以下动作：

- 生成并返回 `sessionId`
- 返回 `opencodeSessionId`、`orchestratorSessionId`
- 发送后能够开始收到 `opencode_event`

## 模拟方式

- 真实 WS 连接：`/ws/task-creation`
- 真实消息发送：`type=opencode_input`
- 真实等待：发送后 sleep 2 秒并等待事件

## 通过标准

- ack 中包含会话与运行时绑定信息
- 60 秒内收到首个 `opencode_event`
