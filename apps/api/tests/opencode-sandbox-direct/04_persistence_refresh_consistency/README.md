# 场景 04：落盘一致性与刷新可恢复

## 目标

验证事件经编排平台落盘后，重复拉取历史消息不会丢失已产生的对话数据。

## 模拟方式

- 调用两次 `/sessions/:id/messages`
- 两次拉取之间保留真实等待（sleep 1.5s）
- 检查用户输入与 opencode_event 是否稳定存在

## 通过标准

- 第二次消息数不小于第一次
- opencode_event 数量不倒退
- 本次 suite 发送的 `user_input / opencode_user_input` 全部可在历史中找到
