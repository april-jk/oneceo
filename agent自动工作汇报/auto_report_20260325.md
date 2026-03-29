# 2026-03-25 工作汇报

## 今天做了什么

- 排查了 Altus managed 在“继续处理工具结果”阶段稳定复现的 `upstream_timeout / upstream_unavailable` 问题，确认失败点集中在工具结果回填后的下一轮模型调用。
- 复核了会话历史、run event、llm-proxy 请求与上游供应商切换情况，确认问题不依赖具体上层 LLM 供应商，核心风险在 managed coordinator 的协议收口不严。
- 已在 `apps/api/src/services/altus-run-coordinator.ts` 增加两类收口：
  - 工具结果后若模型返回纯文本澄清，直接转 `waiting_user`
  - 上游瞬时超时/不可用时做有界重试，避免单次抖动直接打爆 run
- 更新了 `docs/agent研发文档/Altus接管模式参照Suna重构设计/03_对话线程与AgentRun编排.md`，补充工具结果后的继续执行约束与上游瞬时故障重试规则。
- 补充了 `apps/api/tests/altus-run-coordinator.test.ts` 的定向测试，覆盖纯文本澄清分支和瞬时超时重试分支。

## 遇到什么问题

- 当前仓库 `apps/api` 全量 `type-check` 存在多处历史错误，不能直接用来判断这次 coordinator 修复是否安全。
- 上游 provider 对 tool-result 后续响应存在一定随机性，同一 payload 有时成功有时超时，因此必须靠 run 协议与定向测试把边界锁死。

## 计划如何解决

- 继续用定向测试和最小回放验证 Altus managed 的工具结果续跑链路，避免被全仓历史问题干扰。
- 后续如果线上仍出现同类失败，优先查看 run event 中是否再次出现“纯文本无 tool_call”或“超出有界重试后失败”的新模式，再决定是否继续收紧 prompt 或 tool 协议。

## 新增工作记录：API 开发态端口回收

- 排查了 `apps/api` 本地 `npm run dev` 启动失败的 `EADDRINUSE`，确认 `4000` 被同仓库残留的旧 `tsx watch src/index.ts` 进程占用。
- 已新增 `apps/api/scripts/dev-preflight.ts`，并把 `apps/api/package.json` 的 `dev` 改为“预检查端口后再启动 watch”。
- 新规则：
  - 如果 `4000` 被同一 `apps/api` 工作目录下的旧 API 进程占用，先发 `SIGTERM`，必要时再发 `SIGKILL` 回收。
  - 如果 `4000` 被其他程序占用，只输出 PID / cwd / command 并退出，不误杀外部服务。
- 同步更新了 `docs/agent研发文档/自动化测试流程.md` 的前置条件说明，避免后续调试时重复踩这个启动冲突。

## 新增工作记录：Suna 流式执行与 SSE 研究

- 按用户要求对照 `referance/suna`，重点排查了其 `agent_run` 是否使用真实 `SSE / 流式执行`，并逐段核对后端 run 执行器、协调器、Redis stream、前端 `EventSource` 与 tool output streaming。
- 结论是：`Suna` 确实是 run 内部真实流式执行，不只是有一个 SSE 路由；其缓解长耗时任务卡死的关键在于模型调用 `stream=True`、chunk 级事件生成、工具输出实时写 stream，而不是单纯延长浏览器连接。
- 同时对照了 oneceo 当前 `Altus managed`，确认我们现在虽然已有 `SSE`，但仍然只是粗粒度 run event 转发；内层 `AltusRunCoordinator.callModel(...)` 仍以 `stream: false` 阻塞等待完整模型结果，因此继续会命中 `llm-proxy` 的 `upstream_timeout`。
- 已新增研究文档 `docs/agent研发文档/Altus接管模式参照Suna重构设计/13_Suna流式执行链路与SSE事件流研究.md`，并同步更新该文档组索引 `README.md`，后续如进入代码改造，应直接按该文档列出的 Suna 源码入口逐项参照。

## 新增工作记录：Altus managed 流式模型调用第一轮落地

- 已按研究文档开始修改 `apps/api/src/services/altus-run-coordinator.ts`，把 managed 模型请求从 `stream: false` 改为 `stream: true`，直接消费 `llm-proxy` 返回的 `SSE chunk`。
- 新增了流式 chunk 解析与 `tool_call` 增量合并逻辑，当前后端已经可以在模型输出阶段发出 `tool_call_progress`，不再必须等整轮模型完整返回后才进入工具执行。
- 保持了现有 JSON fallback 路径，因此旧的非流式测试场景不回归；同时新增了真实 `text/event-stream` 测试，覆盖“流式 tool_call -> progress 事件 -> 正常执行完成”主链路。
- 已通过定向测试：
  - `DATABASE_URL=${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable} pnpm --filter api exec tsx --test tests/altus-run-coordinator.test.ts`

## 新增工作记录：API 开发态启动失败排查与修复

- 复盘了本地 `npm run dev` 启动失败链路，确认真正的问题不是 `sandbox archive` 的老数据报错，而是开发态存在多条残留 `tsx watch` 父进程，导致新子进程反复 `EADDRINUSE`；同时 `tsx watch` 重启时会复用同一进程里的全局数据库单例，旧 pool 被 `close()` 后再次启动就会触发 `Cannot use a pool after calling end on the pool`。
- 已修改 `apps/api/scripts/dev-preflight.ts`，回收逻辑从“只杀当前 listener”升级为“同时回收同仓库旧 watch 父子进程”，并等待端口释放与旧进程退出两个条件，不再让旧 watcher 把 `4000` 重新抢回去。
- 已修改 `apps/api/src/config/database.ts`，关闭数据库连接后会清理全局单例，后续 watch 重启可以重新创建 pool，不再复用已关闭连接。
- 已修改 `apps/api/src/index.ts`，开发态启动时遇到短暂端口占用会做有限重试，而不是立刻把启动过程打崩。
- 已修改 `apps/api/src/services/sandbox-archive-job.ts`，对“缺少 taskSessionId 与 workspaceRoot”的旧脏数据只做一次 `skipped_missing_context` 标记，避免启动后持续刷相同归档报错。
- 实际验证：
  - 清理残留 watch 后重新执行 `npm run dev`
  - API 成功启动并监听 `4000`
  - `curl http://127.0.0.1:4000/health` 返回 `{"status":"ok",...}`

## 新增工作记录：Altus 提示词增加任务等级与复杂任务 todo 约束

- 按用户要求修改了 `apps/api/src/services/altus-managed-prompt-service.ts`，在 managed system prompt 中新增任务等级判断规则，要求模型先区分 `simple / normal / complex`。
- 对 `complex` 任务新增硬性约束：必须先形成详细 step-by-step todo，再按顺序逐步执行和验证，不能直接跳到最终实现。
- `complex` 的判断条件已写入 prompt，包括多文件、多子系统、长调试链路、依赖不清、分阶段验证、迁移/运行时/基础设施变更等。
- 新增单测 `apps/api/tests/altus-managed-prompt-service.test.ts`，锁住这组 prompt 规则，避免后续回退。
