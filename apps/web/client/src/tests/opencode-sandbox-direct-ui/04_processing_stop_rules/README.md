# 04_processing_stop_rules

目标：验证前端处理态 `isProcessing` 的终止规则。

模拟内容：

- `clarification_request`
- `status_update` 终态
- `opencode_event` 的 `message.final / session.idle / session.status(idle)`
- `question` 工具事件

预期：以上终态应统一触发停止处理。
