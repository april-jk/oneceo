# 04_processing_stop_rules

目标：验证前端处理态 `isProcessing` 的终止规则。

模拟内容：

- `clarification_request`
- `status_update` 终态
- `opencode_event` 的 `message.final / session.status(idle) / question tool`
- `question` 工具事件

预期：

- `message.final` 与真正 completed/failed 状态应停止处理
- `session.idle / session.status(idle)` 不应单独触发停转
