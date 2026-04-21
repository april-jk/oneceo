# 2026-04-22 自动工作汇报

- 已定位“侧边栏最近会话显示不全”的确定性根因：`GET /api/task-creation/sessions` 旧逻辑会在 DB 已查到完整 owned sessions 后，只要 file-memory 命中任意一条就提前返回 memory 过滤结果，导致重登录或 Railway 重部署后常出现“后台多条、前台只剩 1 条”。
- 已确认该问题不在 Redis，也不是本次样本中的用户标识识别错误。当前用户态列表链路实际依赖 DB + `taskCreationFileMemoryStore` + 进程内 `sessionListCacheByUser`，其中 memory 是造成结果集被截断的直接因素。
- 已修复用户态会话列表路由：改为始终以 DB owned sessions 为返回基准，memory 仅用于补充实时状态；同时增加 `TASK_SESSION_LIST_MEMORY_PARTIAL` 诊断日志，便于在现网继续观测“DB 全量、memory 残缺”的样本。
- 已补两条 API 回归测试：一条固定覆盖“DB 多条、memory 少量仍返回全量”，另一条覆盖“较小 limit 的缓存不会污染后续 `limit=all` 请求”。
- 已完成定向验证：`pnpm --filter api exec tsx --test tests/task-creation-business-routes.test.ts` 与 `pnpm --filter api type-check` 均通过。
