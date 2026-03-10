# 02_sse_incremental_and_final_render

目标：验证增量文本与 `message.final` 的渲染优先级。

模拟内容：

- 同一 `partId` 的 `message.part.updated` 文本事件
- 后续 `message.final`

预期：最终只展示 final，不展示同 part 的中间文本片段。
