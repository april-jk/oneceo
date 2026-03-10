# 场景 02：同会话续聊

## 目标

验证用户第二次输入时，消息仍进入同一个 OpenCode 会话，不会额外新建会话。

## 模拟方式

- 复用场景 01 获得的 `sessionId`
- 再次发送 `opencode_input`
- 真实等待下一批 `opencode_event`

## 通过标准

- 第二次 ack 的 `sessionId` 与首次一致
- 若已有 `opencodeSessionId`，则保持一致
- 续聊后仍持续收到事件
