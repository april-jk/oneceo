## 2026-04-05 Altus 接管模式吞消息排查与修复计划

- 做了什么：
  - 针对会话 `f563bf1e-596b-4393-a4ce-a83ff78f06ad` 完成二次深度排查，重点复核了 Altus managed run 流式事件、history 回放与前端渲染路径。
  - 创建修复计划文档 `docs/agent研发文档/Altus接管模式参照Suna重构设计/16_Altus接管模式吞消息与消息不一致修复计划_[20260405-2301已采用].md`。
  - 同步更新索引 `docs/agent研发文档/Altus接管模式参照Suna重构设计/README.md`，新增 M15 条目并标记为 `[20260405-2301已采用]`。
- 遇到什么：
  - 用户补充测试机 Redis 禁用，需将 Redis 相关问题降级为潜在风险，主因改为非 Redis 链路（managed stream 合并与 history 事实源）。
- 计划如何解决：
  - 等待文档评审确认后，按计划顺序执行：
    1) 先修复 `assistant_delta`/`assistant_message` 覆盖问题；
    2) 再修正 managed history 的 DB 优先事实源；
    3) 收口前端 mixed timeline 渲染与终态回放校正。

## 2026-04-05 Altus 接管模式吞消息修复实施（A/B/C/D）

- 做了什么：
  - 完成 A：`useTaskCreationAgent.ts` 增加 managed assistant 同 key 内容保护，避免短 final 覆盖长 delta 聚合内容。
  - 完成 B：`task-creation-routes.ts` 的 timeline 解析改为 managed 会话 DB 优先，file-memory 退为补偿源。
  - 完成 C：`Home.tsx` 收紧 direct 渲染切换条件，mixed timeline 遇到 managed 特征时走 legacy，避免 UI 层吞消息。
  - 完成 D：`useTaskCreationAgent.ts` 增加 managed_recovery 的 recent/history 对账，recent 非空但落后时自动纠正。
  - 补齐回归测试：
    - `apps/web/client/src/tests/managed-message-stream-identity.test.ts`
    - `apps/web/client/src/tests/managed-history-pending-message.test.ts`
    - `apps/web/client/src/tests/managed-mixed-timeline-render.test.ts`
    - `apps/api/tests/task-creation-deep-routes.test.ts`（DB 优先冲突场景）
- 遇到什么：
  - `pnpm --filter api type-check` 受仓库既有错误影响未全绿（与本次改动不直接相关），需单独清理历史类型债务。
- 计划如何解决：
  - 继续在目标会话与同类会话做手工回归，重点观察 run 终态后刷新/重进一致性与 mixed timeline 显示稳定性。
