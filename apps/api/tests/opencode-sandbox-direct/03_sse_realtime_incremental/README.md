# 场景 03：SSE 实时增量

## 目标

验证前端依赖的 SSE 通道具备“实时 + 增量”特征，而不是长时间无输出后一次性回灌。

## 模拟方式

- 先建立 SSE：`/api/task-creation/sessions/:id/opencode/events`
- 发送较长输出请求
- 真实等待并统计事件
- 保留 sleep 5 秒收集增量事件

## 通过标准

- 首个 SSE 事件延迟 < 15s
- 至少 2 条新增 SSE 事件
- 至少 1 条 `message.part.updated`
