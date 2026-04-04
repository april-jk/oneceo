## 2026-04-04 managed run 实时流不刷新修复

- 做了什么：
  - 新增测试文档 `docs/单元测试文档/20260404_managed_run_实时流不刷新测试.md`，把本次问题拆成 stream URL 身份、stream 路由鉴权、前端实时消费和页面退出 processing 四类最小测试单元。
  - 排查后确认当前实现与已采用文档不一致：设计要求 managed run stream 允许按 `session.userId === query.userId` 做强校验，但 `apps/api/src/routes/altus-managed-routes.ts` 的现有实现只认当前请求上下文用户，没有接住 `query.userId`。
  - 在 `apps/web/client/src/hooks/useTaskCreationAgent.ts` 接入 `useAuth()`，让 managed `EventSource` 建连时把当前认证用户 `user.id` 显式带入 `getTaskCreationManagedRunStreamUrl(...)`。
  - 在 `apps/web/client/src/lib/task-creation-client.ts` 扩展 managed stream URL，增加 `userId` query 参数。
  - 在 `apps/api/src/routes/altus-managed-routes.ts` 恢复 query userId 的强校验回退：
    - 有 auth user 时，必须与 `session.userId` 一致
    - query `userId` 存在时，也必须与 `session.userId` 一致
    - 两者都缺失时拒绝订阅
  - 新增 `apps/web/client/src/tests/managed-run-stream-url.test.ts`，并在 `apps/api/tests/altus-managed-redis-route-live.test.ts` 补了两条 stream 授权回归：
    - EventSource 无法带 header 时允许 `query userId`
    - `query userId` 与 `session.userId` 不一致时拒绝订阅
  - 同步更新 `docs/agent研发文档/Altus接管模式参照Suna重构设计/07_前端对话页与交互状态.md`，明确 EventSource 不能依赖自定义 header，必须显式带当前认证用户 id。
- 遇到什么：
  - 这个 worktree 没有完整的本地依赖环境，直接用 `pnpm` 跑 web 测试会遇到 `vitest/tsc` 缺失；改用主仓库依赖后，api live test 可以执行，但 web 侧仍因为该 worktree 缺少完整 Vite 插件解析环境而无法在本轮直接跑通。
- 计划如何解决：
  - 当前已拿到一条确定性回归证据：`apps/api/tests/altus-managed-redis-route-live.test.ts` 在补丁后通过，说明 managed stream 的 query userId 授权主链已经恢复。
  - 下一步如果继续做 UI 级验收，需要在这个 worktree 补齐 web 依赖环境后再跑 Playwright 真实链路，验证“发送 `你好` 后 assistant 回复无需刷新直接出现”。

## 2026-04-04 managed run 首轮长请求与实时流测试

- 做了什么：
  - 用真实 Playwright 浏览器链路复测 managed 文本首轮发送，确认 `POST /api/altus-managed/inputs` 旧实现会把 `ensureSandbox -> OSAC -> skill sync -> startRun` 串成一个长请求，前端拿不到 `runId` 前无法订阅 stream。
  - 更新 `apps/api/src/services/altus-managed-input-service.ts`，让无附件文本消息不再阻塞在 sandbox 预热后才返回；附件上传仍保留现有 sandbox 依赖。
  - 更新 `apps/api/src/services/altus-run-coordinator.ts`，把 resolved skill 的 sandbox 同步移到 `ensureSandbox(...)` 之后执行，维持技能下发边界不变。
  - 更新设计文档 `07_前端对话页与交互状态.md`，明确 `POST /api/altus-managed/inputs` 对无附件消息必须优先返回 `runId`。
  - 新增/更新 API focused tests：
    - `apps/api/tests/altus-managed-input-service.test.ts`
    - `apps/api/tests/altus-run-coordinator.test.ts`
- 遇到什么：
  - 修复首个阻塞点后，真实浏览器仍复现“页面持续显示 智能体正在处理... ”。进一步用浏览器侧 EventSource hook 证明：
    - 浏览器已经成功收到 `run_ack / run_status / assistant_delta / clarification_requested`
    - 后端 `task_session_run_events` 已存在完整 11 条事件
    - 但前端 UI 仍未把这些 stream 事件渲染到对话区
  - 这说明剩余问题已经从“stream 没连上”收敛为“前端收到 managed stream 后没有正确落到 UI 状态”。
- 计划如何解决：
  - 下一步继续聚焦 `useTaskCreationAgent.ts` 的 managed stream 消费与消息/问题状态收敛，优先检查 stream 事件和 history/cache 状态之间的覆盖关系，补一条针对 `assistant_delta + clarification_requested` 的前端回归。

## 2026-04-04 managed 前端接管与浏览器复验

- 做了什么：
  - 在 `apps/web/client/src/hooks/useTaskCreationAgent.ts` 增加 `shouldAwaitManagedRunRecoveryRunId(...)` 和 managed run refresh poll timer。
  - 调整 managed recovery：
    - 当恢复态只有 `processing=true` 且没有 `runId` 时，不再因为一次 `latest run = null` 就清空恢复态。
    - 新页面实例会轮询 `latest run`，直到拿到真实 `runId` 并接管 stream。
  - 修正 `handleManagedRunStreamEvent` 对 `loadHistory` 的时序引用，改为通过 `loadHistoryRef.current(...)` 调用，并在 `loadHistory` 初始化后再回填 ref，消除 managed 页面首次渲染的 TDZ 崩溃。
  - 新增前端 focused tests：
    - `managed-history-pending-message.test.ts` 增加 pending recovery runId 判定用例。
  - 在 `http://oneceo.ai:3000` 下完成真实浏览器复验，`oneceo.ai` 指向 `127.0.0.1`，规避了本地 `localhost` 与当前 API base 混用带来的 CORS 干扰。
- 遇到什么：
  - 本地浏览器复验先被环境问题干扰：
    - web 进程默认打到 `oneceo.ai:4000`
    - API CORS 允许源与浏览器 origin 不一致
  - 切到 `oneceo.ai:3000` 后，浏览器进一步暴露出新的前端运行时错误：`ReferenceError: Cannot access 'loadHistory' before initialization`。
- 计划如何解决：
  - 当前这一轮修复后，浏览器真实链路已经满足核心验收：
    - managed 发送 `你好` 后，不刷新页面即可直接看到 assistant 文本流入。
  - 如果继续收尾，可再补一条更强的浏览器自动化断言，锁住“assistant 首包出现于 processing 结束前也必须实时可见”。

## 2026-04-04 #25 Altus 最终交付文件返回体验优化

- 做了什么：
  - 将 `apps/api/src/services/task-session-deliverable-service.ts` 中 deliverable 读取与上传改为按附件并行执行，减少最终交付物持久化的串行等待。
  - 在 `apps/web/client/src/pages/Home.tsx` 增加 `buildManagedCompletionCardItem(...)`，只要 managed `assistant_message` 或 `status_update` metadata 已携带 `deliverables`，就立即渲染 `managed_deliverable_card`，不再硬等 `run_completed`。
  - 保留 `run_completed -> managed_artifact_card` 的网页类产物兜底逻辑，避免影响现有 web preview 卡片语义。
  - 新增 `apps/web/client/src/tests/managed-deliverable-card-timing.test.ts`，锁住“deliverable 卡片提前于 run_completed 出现”的前端展示时序。
  - 补充测试文档 `docs/单元测试文档/20260404_#25_Altus_交付文件返回体验优化测试.md`。
- 遇到什么：
  - 真实浏览器链路里，用自然语言 prompt 触发“稳定生成 deliverable 并在固定时间窗内完成”并不稳定，不适合作为这轮的唯一验收门槛。
- 计划如何解决：
  - 当前先以 focused tests 和代码链路验证收口本轮优化。
  - 下一步如果继续深挖，可补一条更可控的 smoke prompt 或测试工装，专门稳定触发 markdown/txt deliverable，用于浏览器级体验对比。
