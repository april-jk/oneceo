# 场景 05：完成信号与处理中退出

## 目标

验证消息处理后能出现“完成类事件”，以支撑前端结束“正在处理”状态。

## 模拟方式

- 发送短消息请求
- 监听 `opencode_event` 中的 `session.idle/session.status`
- 保留真实等待（sleep 1.5s）

## 通过标准

- 90 秒内收到完成类事件
- 事件包含有效 `eventType`
