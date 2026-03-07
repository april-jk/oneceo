# 2026-03-07 刷新后消息不一致（三次修复：即时刷新兜底）

## 现象
- 用户在“回复看起来已完成”后立即刷新。
- 刷新前可见解释文本，刷新后历史接口返回中缺少部分最新解释文本。

## 根因
- 实时文本流先通过 SSE 展示，落盘存在毫秒级异步窗口。
- 用户立即刷新时，`GET /sessions/:id/messages` 可能早于该窗口完成，导致历史重建少量缺失。

## 修复方案
### 1) 服务层新增实时文本快照读取
- 文件：`apps/api/src/services/opencode-remote-service.ts`
- 新增：`getLiveTextStreamSnapshots(taskSessionId, opencodeSessionId?)`
- 作用：从内存 `textStreams` 提取当前最新文本流（不清空、不打断流），用于刷新兜底。

### 2) 历史接口合并实时快照
- 文件：`apps/api/src/routes/task-creation-routes.ts`
- 在 `GET /sessions/:sessionId/messages` 中：
  - 读取 file-memory 历史后，追加 live snapshots。
  - 以 `streamKey + content` 去重，避免重复。
  - 按 `createdAt` 排序后返回。

## 结果
- 即使用户在回复结束后立即刷新，历史接口也能包含尚在内存但未完成落盘的最新解释文本。
- 不改变既有持久化路径，仅增加读取兜底，风险可控。

## 验证
- `tsc` 过滤检查中未新增本次改动文件的类型错误（仓库仍有既有历史错误）。
- 建议复测：发送消息 -> 等回复完成 -> 立即刷新，对比 `111刷新前/111刷新后` 文本一致性。
