# 01_message_roundtrip_render

目标：验证直通模式下“用户发送 -> OpenCode回复”的渲染链路。

模拟内容：

- `user_input`
- 一条与用户内容相同的 `message.final`（应被过滤，避免回显重复）
- 一条有效 `message.final`（应显示为 OpenCode 输出）
