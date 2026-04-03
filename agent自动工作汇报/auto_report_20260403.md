# auto report 2026-04-03

- 做了什么：已回看 `AGENTS.md`、`docs/AGENTS_GUIDE/CODEX_PROMPT.md`、`#10` 已采用 Redis 规范，以及 `#11` issue《设计会话缓存与事件流迁移方案到 Redis》。
- 做了什么：已认领 GitHub issue `#11`，并重新梳理当前代码现状，确认目前真正接入 Redis 的仍只有 Altus managed run；`workspace`、`messages/recent`、`messages/history`、`session-events` 还未迁入 Redis。
- 做了什么：已核对 `task-creation-routes.ts`、`task-creation-cache-store.ts`、`task-session-workspace-cache.dao.ts`、`task-creation-session.dao.ts`、`opencode-event-stream-service.ts` 的现状，明确当前分别依赖本地文件缓存、DB recent/fallback、以及进程内 SSE 订阅。
- 做了什么：新增设计稿 `docs/agent研发文档/20260403_会话缓存与事件流迁移到Redis设计_[尚未采用].md`，把 `#11` 范围收紧为四块：`workspace dir/tree/file`、`messages/recent`、`messages/history`、`session-events`，并明确 DB 继续作为事实来源、Redis 只做热层与短窗口回放。
- 做了什么：按你的要求再次参照仓库内已有的 `Suna` 研究文档和当前已落 Redis 能力，重新收紧 `#11` 设计稿；这次明确只吸收 `Suna` 的两点：`Redis stream -> SSE replay`、`Redis 做热层而 DB 继续做事实存储`。
- 做了什么：已把过度开发部分从文档中删掉，尤其去掉了 `history` 的 Redis 热页方案，改为只保留 `cursor:history`；同时也明确本次不引入 `StreamHub`、consumer group、统一事件总线、完整 `Suna` 风格运行平台。
- 做了什么：你已确认开始写代码，`#11` 设计文档已切换为 `[20260403-1125已采用]`，后续实现将严格以这版收紧范围为准。
- 做了什么：已新增 `apps/api/src/services/task-session-redis-cache-service.ts`，把 session 级 `workspace dir/tree/file`、`messages/recent`、`cursor:history`、`stream:session-events` 的 Redis 读写统一收口到一个最小 service，直接复用 `#10` 已落的 key/TTL 规范。
- 做了什么：`task-creation-routes.ts` 已接入第一批 Redis 读写：`workspace dir/tree/file` 改为 Redis first，`messages/recent` 会在非 opencode 优先路径下直接命中 Redis，`messages/history` 成功后会刷新 `cursor:history`；`opencode-events` SSE replay 现在优先从 Redis `stream:session-events` 回放，空时再回退当前 DB replay。
- 做了什么：`opencode-event-stream-service.ts` 已在现有 fast event 链路中追加 `session-events` Redis stream 写入；同时把 `sandbox-agent-provision-service.ts`、`opencode-remote-service.ts`、`task-creation-routes.ts` 中已有的 workspace 失效入口同步接到了 Redis 删除，避免 workspace cache 长时间残留旧值。
- 做了什么：已新增 `apps/api/tests/task-session-redis-cache-service.test.ts`，并扩展 `apps/api/tests/redis-keyspace.test.ts`、`apps/api/tests/redis-live.test.ts`；本轮已通过 fake Redis 单测和真实 Redis 集成验证，覆盖 workspace cache、recent page、history cursor、session-events stream 的新能力。
- 做了什么：继续补了接口级回归 `apps/api/tests/task-creation-deep-routes.test.ts`，新增了 `messages/recent` Redis 命中、`workspace/tree` Redis 命中、`workspace/file` Redis 命中、以及 `opencode/events` 从 Redis `session-events` replay 的验证。
- 做了什么：在补测试过程中抓到并修复了一个真实 bug：`task-creation-routes.ts` 的 `opencode/events` 路由里，Redis replay 分支使用了超出作用域的 `currentUser`，会导致运行时报 `ReferenceError`；现在已改成外层持有并安全透传。
- 做了什么：已继续把 `task-creation` 路由级 Redis 回归补完整，覆盖了 `messages/history -> cursor:history`、`workspace dir/tree/file -> Redis first`、`opencode/events -> Redis replay / DB fallback` 两条 SSE 重连路径。
- 做了什么：这轮又修掉了一个真实回放缺口：`opencode/events` 的 DB fallback 在非 timestamp 游标模式下只看 `seq`，没有把 `sessionEventSeq` 当作有效 replay cursor，导致历史 `status_update` 事件会被错误过滤；现在已改为优先使用 `sessionEventSeq`，对应路由级回归已通过。
- 做了什么：已收口 `task-creation-deep-routes.test.ts` 的 SSE 测试句柄问题。测试基建现在会强制关闭每个临时 HTTP server 的连接，并在 `after` 阶段显式断开 Redis client 与数据库连接池，整套 21 条路由级用例现在可以自然退出，不再卡在进程尾部。
- 做了什么：按“真实接口触发 + 直接检查 Redis”补了新的 live 校验文件 `apps/api/tests/task-creation-redis-route-live.test.ts`。这次不再只看 mock 行为，而是逐个触发当前 `task-creation` 实际接入 Redis 的 6 条接口：`messages/recent`、`messages/history`、`workspace/dir`、`workspace/tree`、`workspace/file`、`opencode/events`。
- 做了什么：新 live 校验会在本机 `redis://127.0.0.1:6379/15` 上逐条验证对应 key：`cache:messages:recent`、`cursor:history`、`cache:workspace:dir/tree/file`、`stream:session-events`，并直接断言 Redis 中存下来的 JSON/stream entry 与接口返回一致。
- 做了什么：已把同样的方法扩到 `altus-managed`，新增 `apps/api/tests/altus-managed-redis-route-live.test.ts`。这轮纳入 live Redis 校验的接口是：`POST /api/altus-managed/sessions/:sessionId/runs`、`GET /api/altus-managed/runs/:runId/stream`、`POST /api/altus-managed/runs/:runId/stop`。
- 做了什么：`altus-managed` 这组 live 校验会直接检查 Redis 中的 `run:state`、`run:owner`、`run:heartbeat`、`ops:runs:active`、`run:stream`、`run:stop`。`GET /sessions/:sessionId/runs/latest` 仅做 DB 汇总读取，不直接触发 Redis 写入；`POST /inputs` 是对 `startRun` 的组合包装，本轮不单独重复做一套等价 Redis 存储校验。
- 做了什么：已把 `task-creation + altus-managed` 的“接口 -> Redis key -> 验证方式 -> 当前状态”总表补回 `docs/agent研发文档/20260403_会话缓存与事件流迁移到Redis设计_[20260403-1125已采用].md`，并把当前 live 验证命令和 `9/9 pass` 结果写进文档，作为 `#11` 当前验收基线。
- 做了什么：新增系统级《调试与测试指南》，统一 oneceo 在“先设计文档再开发再测试”和“直接测试某功能”两类场景下的执行流程。
- 做了什么：已把新指南接入根 `AGENTS.md` 的必读和架构导览，后续 agent 会把它当作调试与测试入口文档使用。
- 做了什么：文档中补全了 web、api、service、db、redis、sandbox/osac/opencode 七个层级的自动测试方案，并明确 Redis/DB/事件流的证据链要求。
- 做了什么：已按你刚刚手动修改后的要求重新读取文档并继续收紧测试指南，明确“以结果为导向”是最高原则，测试前必须先写测试文档、先导出最小测试单元、再写预期输入输出和边界条件、再编写脚本逐个验证。
- 做了什么：文档中已补充强制要求：涉及数据库必须脚本触发后直连数据库核验；涉及 Redis 必须在触发后检查实际 key/value 或 stream；接口返回 200 或脚本返回 success 均不能直接判定通过；全链路测试需在底层验证完成后再征求用户确认。
- 做了什么：已补充测试资产存放规则，明确测试脚本继续放在现有目录不迁移，新的测试文档统一存放到 `docs/单元测试文档/`，并已创建该目录占位。
- 做了什么：已将 Git 相关文档拆分为“Git 操作与提交指南”和“Git 协作开发指南”两份，前者收口状态检查、同步、提交与提交说明，后者只保留多人协作、边界、冲突与跨系统约束，并已同步优化 `AGENTS.md` 引用结构。
- 遇到什么：现有缓存实现分散在本地文件、DB fallback、进程内内存三套路径里，迁移时如果不先收口边界，很容易把 Redis 扩成过大的平台缓存工程。
- 计划如何解决：下一步整理这批 `#11` 第一批实现的提交与 issue 进展；若你继续让我推进，我会开始收口剩余 route 级验收并准备提交，同时后续针对具体功能测试会直接按新测试指南先出测试文档再执行脚本与存储核验。
- 做了什么：已重新读取仓库 `AGENTS.md` 与 `docs/AGENTS_GUIDE/CODEX_PROMPT.md`，并重新收口 `#8/#9/#10/#11` 当前上下文，确认下一步 `#12` 应只做 Altus run 级运行态与恢复，不扩到平台级调度工程。
- 做了什么：已认领 `#12`，并新增设计稿 `docs/agent研发文档/20260403_Altus运行时状态在Redis中的落点与恢复机制_[尚未采用].md`。
- 做了什么：这版 `#12` 设计明确只纳入 `run:state / owner / heartbeat / stop / recovery / active-runs / run:stream`，以及 sandbox / connector runtime 的最小恢复引用；同时明确不引入通用 run center、全局 startup cleanup 框架、或 connector 大对象 Redis 缓存。
- 做了什么：已继续收紧 `#12` 设计稿中的持久化原则，明确 run / run_event / sandbox binding / connector snapshot 必须坚持“先落 DB，再写 Redis 派生热状态”，并补上了 `DB 与 Redis 冲突时永远以 DB 为准重建 Redis` 的规则，避免双真相和状态失效。
- 做了什么：已再次检查 `#12` 是否过度设计，并继续收口：去掉了“API 启动时全局恢复扫描”这类重入口，只保留新 run 启动前、stream 订阅前、latest run 查询前三个轻量恢复入口；同时把 `run:recovery.connectorRuntime` 缩成只保留 `providerIds`，不再额外保存可由 DB 直接重算的版本字段。
- 遇到什么：当前代码里 `run:state / run:stream / stop / heartbeat` 已存在，但 `run:recovery` 还未启用，active-runs 也还没有真正配套恢复入口。
- 计划如何解决：等待用户审核这版 `[尚未采用]` 设计稿。确认后再进入 `#12` 代码实现，优先补 `altus-run-recovery-service` 与 `run:recovery` 的读写和清理。
## 2026-04-03 #12 Altus 运行态 Redis 恢复实现

- 做了什么：
  - 开始实现 `#12`，新增 `apps/api/src/services/altus-run-recovery-service.ts`，把 Altus run 的恢复入口收敛到 `startRun`、`runs/latest`、`run stream subscribe` 三处。
  - 在 `apps/api/src/services/altus-run-redis-state-service.ts` 增加 `run:recovery`、`clearStopRequest`、`clearRecoverySnapshot`、`listActiveRuns`、`hasLiveHeartbeat` 等能力，并在 run event 追加后同步刷新 recovery 的 stream 游标。
  - 在 `apps/api/src/services/altus-managed-run-entry-service.ts`、`apps/api/src/services/altus-managed-stream-service.ts`、`apps/api/src/services/altus-run-lifecycle-service.ts` 接入 DB-first 的 recovery 同步与终态清理。
  - 更新设计文档状态为已采用，并补齐 `redis-keyspace`、`redis-live`、`altus-managed-redis-route-live` 三组测试对 `run:recovery` 和 `latest-run` 恢复入口的覆盖。
- 遇到什么：
  - `RedisCommandPort` 新增 `listSetMembers` 后，测试桩需要同步补齐，否则只能静态改代码，无法验证 active-runs 的真实读取行为。
  - 之前的 live Redis 测试只覆盖到 `run:state / run:stream / stop`，没有覆盖 `run:recovery`，无法验证 `#12` 的核心落点。
- 计划如何解决：
  - 下一步继续把 `#12` 的接口验收矩阵补进文档，并整理提交。
  - 后续再进入 `#13`，针对 connector / guide / session runtime 的多用户隔离继续做回归。

## 2026-04-03 #12 真实 DB + Redis 联调验证

- 做了什么：
  - 按 `AGENTS.md` 要求重新执行了 `#12` 的最小闭环验证：`redis-keyspace.test.ts`、`redis-live.test.ts`、`altus-managed-redis-route-live.test.ts`，结果 `9/9 pass`。
  - 额外执行了一次真实 DAO/service 联调脚本，不 mock 数据库，只把 `altusRunCoordinator.execute` 截成 no-op，验证 `startRun -> DB run/session/event 落盘 -> Redis state/recovery/active-runs/stream 写入 -> 删除 Redis 后 latestRun 按 DB 重建 -> markCompleted 终态清理` 整条链路。
  - 联调脚本中已直接核对 DB 记录和 Redis 记录：`task_creation_sessions.user_id`、`task_session_runs.status`、`task_session_run_events.event_type`，以及 `run:state / run:recovery / run:stop / ops:runs:active / run:stream`。
  - 真实联调结束后已清理测试 session 与 Redis key，并确认 `redis db15` 没有残留验证数据。
- 遇到什么：
  - 直接在 shell 中拼接长 `tsx` 脚本时容易被引号和模板字符串展开干扰，第一次诊断脚本因为命令展开失败，后续已改为 heredoc 方式执行。
- 计划如何解决：
  - 如果后续继续推进 `#12/#13`，就把这一套“真实 DB + Redis 双证据链”的脚本思路扩展到更多用户态深水区接口，而不是只停留在路由 mock 测试。

## 2026-04-03 #13 connector / guide / session runtime 多用户隔离校验

- 做了什么：
  - 在当前 `22f5` worktree 重新启动 `#13`，并新增已采用设计稿 `docs/agent研发文档/20260403_connector_guide_session_runtime多用户隔离校验_[20260403-2028已采用].md`。
  - 先核对当前代码事实，确认这份 worktree 不包含前面 Redis 基础层，因此把 `#13` 的 Redis 结论收紧为“这三条链路当前无直接 Redis 状态，测试必须验证不产生额外 Redis 写入”。
  - 收紧 `apps/api/src/routes/internal-connector-guide-routes.ts`：`ONECEO_INTERNAL_TOKEN` 未配置时直接 `403`，不再默认放行内部 guide 接口。
  - 新增 `apps/api/tests/internal-connector-guide-routes.test.ts`，覆盖内部 token 未配置、缺 token、正确 token 三种管理边界。
  - 新增 `apps/api/tests/connector-guide-runtime-isolation-live.test.ts`，对 `connector profile -> session attach`、`guide 投影`、`runtime recovery` 三条链路做真实 DB + 本机 Redis 联调。
  - 本机安装并启动了 PostgreSQL 16，创建 `oneceo_test` 数据库；同时复用本机 Redis `db15` 做“无直接 Redis 写入”核验。
  - live test 中额外补了最小测试建表与 UUID 默认值校正，避免把整套迁移系统引进 `#13`。
- 遇到什么：
  - 当前 worktree 是 detached HEAD，且远端 `task-creation-agent` 已领先，不能直接推送，需要后续基于远端最新分支重新 cherry-pick。
  - 本机最初没有 PostgreSQL，导致 live DB 测试先后遇到 `ECONNREFUSED 127.0.0.1:5432` 和测试连接串用户不匹配的问题，后续已改为使用本机实际用户 `watson`。
  - `oneceo_test` 的自动迁移结果没有完全覆盖 `connector_guide_* / task_session_connector_*` 需要的默认值，导致第一次 live test 因 `id default uuid` 不完整失败，已在测试中补最小修正。
- 计划如何解决：
  - 下一步把这轮 `#13` 提交 cherry-pick 到 `origin/task-creation-agent` 最新基础上并推送。
  - 随后更新 `#13` 和母任务 `#8` 的 issue 进展，明确当前 worktree 下的验证结论：授权结果、DB 归属字段、以及“无直接 Redis 写入”的隔离效果都已符合预期。

## 2026-04-03 #14 多用户 + Redis 稳定性、回放与恢复测试方案

- 做了什么：
  - 已认领 `#14`，并回看 issue 范围、`#11`、`#12`、`#13` 当前产物。
  - 新增设计稿 `docs/agent研发文档/20260403_多用户与Redis稳定性_回放_恢复测试方案_[尚未采用].md`。
  - 这版方案已明确：`#14` 只负责统一测试矩阵和当前真实缺口，不扩成新的测试平台。
  - 文档已把验收对象收成四类：多用户隔离稳定性、Redis 稳定性、SSE / stream 回放、Altus / connector 恢复。
  - 也已经把与 `#7` 的衔接口径写清楚：`#14` 先给统一证据链，`#7` 再基于它补 connector guide 细化场景。
- 遇到什么：
  - 当前仓库里已有测试资产较多，`#14` 最大风险不是“缺测试”，而是重复发明一套新框架导致过度开发。
- 计划如何解决：
  - 等用户审核这份 `[尚未采用]` 设计稿。
  - 如果确认开始实现，就严格按文档顺序只补真实缺口：先总表，再 Redis 不可用 / 清空后的 rebuild 验证，最后整理统一验收命令。

## 2026-04-03 #14 第一批实现

- 做了什么：
  - 用户已确认开始，`#14` 文档已切换为已采用：`20260403_多用户与Redis稳定性_回放_恢复测试方案_[20260403-1308已采用].md`。
  - 在文档中补了当前统一验收总表，明确已有测试资产、这轮新增缺口测试、统一执行命令和通过标准。
  - 新增 `apps/api/tests/altus-run-recovery.service.test.ts`，覆盖 `reconcileLatestRun()` 在 Redis 清空后的 DB rebuild，以及 terminal 状态下 stale stop/recovery 清理。
  - 扩展 `apps/api/tests/redis-keyspace.test.ts`，覆盖 Redis endpoint 不可达时 `RedisClientService` 的安全回退。
- 遇到什么：
  - `#14` 当前最容易过度开发的地方是把已有 live 测试再写一遍；这轮实现刻意只补真实缺口，没有重写已有 route/live harness。
- 计划如何解决：
  - 继续跑 `#14` 当前最小闭环测试。
  - 如果通过，再决定是否继续补“Redis 清空后的 task-creation replay”这类下一层缺口。

## 2026-04-03 #14 下一层缺口补齐

- 做了什么：
  - 继续扩展 `apps/api/tests/task-creation-redis-route-live.test.ts`。
  - 新增 `history cursor` 被删除后，`messages/history` 仍按 DB timeline 返回并重新写回 cursor 的 live 用例。
  - 新增 `session-events stream` 被删除后，`opencode/events` 会回退 DB replay，且不会继续回放已删除的 stale Redis 事件。
  - 同步把这两条新缺口纳入 `#14` 已采用文档的总表和统一执行命令。
- 遇到什么：
  - 这两条场景本身已有 route 级 mock 覆盖，新的价值在于 live Redis 下验证“key 被清空后的真实行为”，而不是重复授权测试。
- 计划如何解决：
  - 继续运行 `task-creation-redis-route-live` 与 `#14` 当前统一命令，确认 replay / rebuild 全链路成立。

## 2026-04-03 #14 统一验收收口

- 做了什么：
  - 按 `#14` 已采用文档里的统一验收命令整组执行了 9 组测试，覆盖多用户隔离、Redis 不可用、Redis 清空后的 rebuild、session replay、Altus recovery、connector/guide/runtime 隔离。
  - 先定位出 3 个失败项，其中 2 个来自 `apps/api/tests/altus-managed-stream-service.test.ts` 没有跟上 `subscribe()` 新增的 `reconcileRunById()` 前置调用；已最小化补齐 mock，不改业务实现。
  - 复跑后统一验收已全部通过，确认 `altus-managed`、`task-creation`、`connector guide/runtime` 当前纳入 `#14` 的测试矩阵全部成立。
- 遇到什么：
  - `altus-managed-stream-service` 这类 service 级测试对 recovery 前置依赖较敏感，如果只 mock `listRunEvents` 而不 mock recovery，会误把真实 DB 查询失败当作功能回归。
  - Redis 不可达用例会产生预期内 warning 日志，当前结果可以接受，但后续如要继续扩展总表，需要保持“允许 warning、禁止主流程失败”的验收口径一致。
- 计划如何解决：
  - 下一步可直接整理并提交 `#14` 当前测试收口结果。
  - 如果继续推进母任务 `#8`，后续就转入与 `#7` 衔接的 connector guide 细化测试，而不再重复建设新的 Redis 测试框架。

## 2026-04-03 Redis 显式启用规则复核

- 做了什么：
  - 按你的要求重新检查了仓库里所有生产代码的 Redis 使用点，并把“只有显式配置 `ONECEO_REDIS_ENABLED=true` 且提供 `REDIS_URL` 才允许启用 Redis”写入 `AGENTS.md`。
  - 逐个核对了 `apps/api/src/services/redis-client-service.ts`、`altus-run-redis-state-service.ts`、`task-session-redis-cache-service.ts`，以及它们在 `task-creation-routes.ts`、`altus-managed-*`、`opencode-*`、`sandbox-agent-provision-service.ts`、`opencode-remote-service.ts` 中的调用链。
  - 同时检查了仓库默认环境样例，确认 `apps/.env.example` 当前默认是 `ONECEO_REDIS_ENABLED=false`，不会把 Redis 作为默认开发依赖打开。
  - 复跑了 `apps/api/tests/redis-keyspace.test.ts`，确认“只配 `REDIS_URL` 但未显式开启 `ONECEO_REDIS_ENABLED` 时，Redis client 仍然保持禁用”这条断言继续成立。
- 遇到什么：
  - 当前需要警惕的不是生产代码绕开开关，而是后续新增 Redis 能力时有人直接在业务代码里 `new Redis(...)`。这次已经通过 `AGENTS.md` 明确禁止。
- 计划如何解决：
  - 后续凡是新增 Redis 缓存或 stream，都继续复用 `redis-client-service.ts` 统一开关，不允许在业务层重复接环境变量。
## 2026-04-03 #6 ClaudeCode 风格 connector guide runtime 强约束实现

- 做了什么：
  - 已认领 GitHub issue `#6`，并重新对照 `referance/claudecode_src/CLAUDECODE_MCP_SKILLS_REFERENCE.md` 检查当前实现，确认此前只完成了 prompt 注入和 relevant guides surfaced，仍缺 runtime blocking requirement。
  - 在 `connector-guide-service.ts` 增加 `getActiveGuideForConnector`，供运行时一次性读取当前 session 下某 connector 的 active guide 文本。
  - 在 `altus-managed-shared.ts` 新增内建工具 `load_connector_guide`，在 `altus-managed-prompt-service.ts` 明确要求：命中 active connector guide 后，先调用 `load_connector_guide`，再调用该 connector 的 MCP 工具。
  - 在 `altus-managed-tool-runtime.ts` 落地 ClaudeCode 风格的首次调用阻断：如果某 connector 在当前 session 有 active guide、但当前 run 尚未加载该 guide，则首次 MCP 调用直接阻断；guide 加载成功后，同一 run 内该 connector 的 MCP 工具恢复放行。
  - 已补 `apps/api/tests/altus-managed-tool-runtime.test.ts` 两条定向测试，覆盖“guide 加载后放行”和“未加载前阻断”两条主路径；同时更新采用文档，去掉“runtime preflight 放第二阶段”的旧描述。
- 遇到什么：
  - 当前仓库已经有一批并行中的 connector guide 多用户隔离改动，不能覆盖用户现有工作区，只能在现有 adopted 文档基础上做边界内更新。
- 计划如何解决：
  - 下一步继续做真实会话联调，直接验证 GitHub connector attach 后，Altus 在首次 MCP 工具调用前会命中 `load_connector_guide` / 阻断日志，而不是只停留在单测。

## 2026-04-03 #6 GitHub connector guide 真实会话联调阻塞排查

- 做了什么：
  - 按最真实路径执行了一轮联调：真实创建 task session、真实 `ensureSandbox`、真实 GitHub attach、真实 managed run 生命周期、真实 OSAC/MCP provider 恢复与工具快照读取。
  - 首次联调在新 session 的 attach 阶段被 `githubConnectorRepositoryService.assertProfileAuthorized()` 直接拦住；进一步核对后确认当前 GitHub profile `623e7547-d8a5-4c26-a82a-e43ba11f76c2` 已被系统标记为 `needs_auth`，`user_connector_profiles.secret_ciphertext` 为空，access token / refresh token 都不存在。
  - 为避免误判，又继续尝试复用历史上真实 attached 的 GitHub session（`daff72f6-2717-41fe-a325-17573932cab8` 与 `aac2ac06-9173-4eb8-8861-332a2d093da5`），确认 sandbox/OSAC 可以被恢复，但 `captureMcpToolSnapshot()` 最终返回 `0 provider`，说明历史 GitHub MCP runtime 也已经不存在，无法继续做真实 tool 调用链路验证。
  - 已对本轮联调过程中启动/恢复的 sandbox 做清理，实际 kill 了 `i7nr7pku8q91fxv4bpl1z`、`ilgkd142w9i7ru02vcp4h`、`i92xz5t7ywqskh6rllqk8`，并把对应 session 的 sandbox binding 标记为 `closed`，避免继续产生 E2B 计费。
- 遇到什么：
  - 这轮无法继续验证 `load_connector_guide -> GitHub MCP tool retry` 的真实 run 链路，不是因为 connector guide/runtime 代码路径有新错误，而是因为当前 GitHub 授权状态已经被系统判定失效，且 secret 已经被清空；历史 session 里的 GitHub provider 也已消失，无法作为替代执行面。
- 计划如何解决：
  - 下一步必须先完成 GitHub 重新授权，直到 `user_connector_profiles.auth_status = authorized` 且 secret 恢复存在，再重新跑真实 attach + run 联调。
  - GitHub 恢复后，优先复测目标证据链：`tool_call_failed(connector_guide_blocked:github)` -> `tool_call_completed(load_connector_guide)` -> `tool_call_completed(github MCP tool)`。

## 2026-04-03 #6 GitHub connector guide 真实会话联调已通过

- 做了什么：
  - 改用当前浏览器真实登录用户 `c2f3b1e7-fcea-4585-a37d-b7aa6490addc` 的最新 GitHub profile `f9c0bbaf-fdf8-4b0a-8894-dfec1e54813d` 继续联调，确认该 profile 处于 `authorized` 且 secret 存在。
  - 通过真实前端登录态调用 `/api/task-creation/sessions` 创建了真实 session `1bbe31ef-8608-4f5d-a0b8-c27ed0e7e52d`，再通过真实 attach 路由把 GitHub connector 挂到该 session；随后核对 `task_session_connector_guides` 已写入 `github` 对应的 policy/revision 记录。
  - 使用真实 `/api/altus-managed/inputs` 发起 managed run `f083414d-39eb-4658-948a-c3343569665e`，要求 Altus 直接使用 GitHub 连接器做一次最小读操作；实际事件链路表现为：先 `tool_call_completed(load_connector_guide)`，再 `tool_call_completed(mcp__search_repositories__...)`，最后 `complete_task` 收尾。
  - 同步抓取 `data/connector-debug.log`，已确认 `CONNECTOR_GUIDE_PROMPT_SECTIONS_READY`、`ALTUS_RUN_PROMPT_READY`、`CONNECTOR_GUIDE_RUNTIME_LOADED` 均命中该真实 session / run。
  - 联调结束后已 kill 本轮新启动的 sandbox `igwfxxny8xe59wn31cnnk`，避免继续产生 E2B 计费。
- 遇到什么：
  - 这次真实模型没有先“错误地直接打 GitHub MCP 然后被 runtime block”，而是直接遵守 prompt 指令，先调用了 `load_connector_guide`，因此没有出现 `connector_guide_blocked:github` 这条失败事件。
- 计划如何解决：
  - 当前第一阶段目标已经达成：真实 session 下 guide 自动挂载、prompt 注入、运行时显式加载、GitHub MCP 随后执行这条闭环已成立。
  - 如果后续要强制验出 `connector_guide_blocked:github`，需要再补一条可控联调路径，让模型或测试驱动先直接发起 GitHub MCP tool，再观察 runtime block；这属于第二层“防误用”验证，不影响当前闭环成立。

## 2026-04-03 #6 connector guide 防误用链路自动化补测

- 做了什么：
  - 在 `apps/api/tests/altus-run-coordinator.test.ts` 补了一条协调器级回归测试：第一轮模型直接调用 GitHub MCP `search_repositories`，第二轮根据 `tool_call_failed(connector_guide_blocked:github)` 改为调用 `load_connector_guide`，第三轮重试同一个 GitHub MCP tool，最后 `complete_task` 收尾。
  - 顺手修正了同文件里历史 `appendRunEvent` mock 的参数签名，避免事件类型被旧测试基线错误记录成 `userId`。
  - 重新跑通 `tests/altus-run-coordinator.test.ts` 与 `tests/altus-managed-tool-runtime.test.ts`，现在两套测试都覆盖了 prompt 注入、runtime block、guide 加载、retry 放行三层行为。
- 遇到什么：
  - 旧测试基线与当前 `appendRunEvent(runId, sessionId, userId, eventType, payload)` 签名不一致，导致一整批旧断言假失败；这次已一并收口。
- 计划如何解决：
  - 当前 connector guide 模块的第一阶段功能需求已经由“真实会话联调 + 协调器级 block/retry 回归测试 + runtime 单测”三层证据闭环。
  - 后续再继续推进时，优先扩展到 `Supabase / Vercel` 两个 connector 的同类真实联调，而不是继续在 GitHub 上重复加同类测试。
