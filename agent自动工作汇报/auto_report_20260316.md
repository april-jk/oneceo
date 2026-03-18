# 2026-03-16 自动工作汇报

## 已完成

- 更新文档《直通模式最近50条消息热缓存与增量历史加载设计》，补充 `messageKey` 与滚动锚点恢复方案。
- 后端历史消息、generation 边界、SSE replay / live payload 增加稳定 `messageKey`。
- 前端 `AgentMessage`、历史 merge、实时 merge、React 渲染 key 全部切换为 `messageKey`。
- 前端滚动恢复从纯 `scrollTop` 升级为 `anchorMessageKey + anchorOffsetTop + scrollTop fallback`。
- 本地乐观插入的用户消息增加客户端生成的 `messageKey`，避免后端持久化后再次出现一条“相同内容的新消息”。
- 根据新增要求，文档方向已调整为“存储层去重优先”：`conversation_messages` 与 recent cache 都要按逻辑消息 upsert。
- 根据新增要求，OpenCode SSE 文本后续只持久化 final aggregate，不再把 checkpoint 完整快照写入数据库正式消息表。
- 已完成数据库 schema / migrate 改造：为主消息表和 recent cache 增加 `message_key`、`timeline_cursor`、`runtime_generation` 等字段。
- 已完成 DAO 改造：主消息写入改为按 `(session_id, message_key)` upsert，recent 50 改为从主消息表按 `timeline_cursor` 重建。
- 已完成 OpenCode checkpoint 持久化调整：checkpoint 只做实时通知，不再落数据库；final 事件补齐 `partId/streamKey`，保证逻辑消息身份一致。
- 已修正 OpenCode 续聊语义：同一 task session 在上一轮 `completed` 后再次发送用户输入时，默认继续复用当前 `opencodeSessionId`，不再因为 `completed` 强制新建 OpenCode session。
- 已补发送前状态回切：续聊时会先把 task session 状态恢复为 `in_progress/executing`，避免 UI 仍停留在上一轮完成态。
- 已补 `sandbox-activity-service` 的数据库瞬时异常降级，避免 `runtime/touch` / dirty 标记因为数据库抖动直接把 API 进程打挂。
- 已将 `opencode/events` 的若干 `409` 场景降级为短 SSE bridge 响应，减少前端在 runtime 恢复期的错误噪音。
- 已将前端历史视图缓存版本提升，并增加旧噪音缓存识别逻辑；命中 `[Message] ...` / 空 `opencode_event` / 空 `status_update` 时直接作废本地缓存。
- 已定位并修正续聊时的一个核心恢复缺陷：sandbox 重建后的 `sendUserInput()` 现在会把上一代已验证可用的 `opencodeSessionId` 作为 preferred 值传给恢复逻辑，避免第二轮对话被错误切到新的 OpenCode session。
- 已进一步放宽过于激进的 fresh-session 策略：`failed` 不再默认强制新建 OpenCode session，而是先尝试恢复旧 session，只有恢复失败时才创建新 session。
- 已在 OpenCode 每轮完成分支补主动归档：direct / managed `completed` 前都会调用 `archiveSandboxWorkspace()`，确保 `.opencode` 与工作区在 sandbox 被回收前就已写入 R2。
- 已定位并修复“closed sandbox 续聊卡在智能体正在处理”的直接原因：前端原先在 `runtimeStatus=closed` 时仍沿用旧 `orchestratorSessionId` 直接发送 `opencode_input`，现在改为进入 pending 队列并先自动 `runtime/start`，待 runtime 可发送后再补发。
- 已补空消息清理：
  - 后端拒绝写入空 `opencode_event`
  - `/messages/recent`、`/messages/history` 返回前统一过滤旧的空 `opencode_event` / 空 `status_update`
  - 前端历史缓存版本提升到 `v4`
- 已补刷新抖动收敛：
  - `AbortError` 不再被当成 recent/history 失败链路处理
  - 刷新会话页时不再因为超时/取消立即触发 fallback 和错误日志噪音

## 遇到的问题

- 旧会话里已经存在历史脏数据：同一逻辑消息过去被重复落库，且部分旧数据没有稳定的逻辑键。
- 这类旧数据在当前会话里仍可能继续显示重复内容；新逻辑主要保证“从现在开始的新消息”和“recent/history/replay/live 多来源合并”不再继续制造重复。
- 直通模式原先把 `completed` 当成“必须新建 OpenCode session”的条件，导致同一 task session 的第二轮用户输入落到新 OpenCode session，前台只看得到第一轮历史。
- 当前联调还暴露出 E2B / 数据库连接波动，导致续聊验证过程会被外部依赖中断；需要先把后端进程稳定性补齐，再做最终的 Playwright 端到端确认。
- 已定位并修正一个新的续聊误判：当本地 runtime 已被判定为 `closed`，但详情接口仍短暂返回同一 `orchestratorSessionId` 的旧 `ready` 快照时，前端原先会直接把 `opencode_input` 发给已失效 sandbox，导致页面长期卡在“智能体正在处理...”；现在改为优先信任本地 terminal 状态，继续走 pending + runtime 恢复。
- 已定位到一个新的状态收敛断点：OpenCode 已经返回 assistant 文本，但 direct `completed` 分支在等待 native history 补齐时可能错过内存里的 live text stream，导致页面长期停在“正在同步智能体回复...”；现已在 native history poll 前强制再做一次 `flushTextStreams()`，拿到最终文本后立即补发 synthetic `session.idle` 推进完成态。
- 已进一步定位到导致 `MIGRATE-A2/A3` 卡住的更深层根因：`OPENCODE_PROMPT_ACCEPTED` 事件可能晚于流式文本到达，旧逻辑会在这里再次清空同一 run 的 `textStreams` 并重置 `promptedAt`，把已经收到的 assistant 回复痕迹擦掉；现已改成同一 runKey 已初始化时只补 runtime 绑定，不再重置内存状态。
- 旧浏览器 `sessionStorage` 会把历史脏缓存重新灌回页面；需要靠缓存版本升级与噪音签名校验主动失效。
- 续聊问题并不只是 `completed` 状态判断；真正的替换点还发生在 sandbox 重建后的 session 恢复逻辑，如果不显式携带 preferred `opencodeSessionId`，恢复流程会从 workspace 中挑新的 session。
- 另一个替换点在于 `failed` 会话原先被一律判定为 fresh-session，这会把很多可恢复的中断场景也错误切到新 OpenCode session。

## 后续建议

- 下一步先做存储层改造，再视情况决定是否补历史脏数据迁移。
- 下一步观察是否还需要单独补“旧历史脏数据”专项清洗；当前迁移已做基础回填与同键去重，但无法自动识别所有历史时期的隐式重复。
- 待数据库与联调环境稳定后，再用一个全新会话做一次完整人工回归，确认数据库中 recent 50 与主消息表都不再产生重复。
- 下一步用 Playwright 复测“两次连续发送用户输入”场景，确认前后台与 OpenCode Web 侧都只复用同一个 `opencodeSessionId`。

## status/stage 一致性补充

- 已修复文件态状态机的 terminal 阻断：`allowBackward: true` 现在允许 `completed/failed -> in_progress`，并在只有非终局 `stage/phase` 时自动推断 `status=in_progress`。
- 已修复前端续聊预检逻辑：不再因为详情接口返回 `completed/failed` 就清空 `opencodeSessionId` 或强制 `runtime/start`。
- Playwright 复测已确认：
  - 新版前端续聊时不再触发 `runtime/start`，只保留 `runtime/touch`。
  - `opencodeSessionId` 仍保持复用。
- 当前残余问题集中在桥接层稳定性：
  - `opencode/events` 偶发 `sandbox port is not open` / SSE 重连抖动。
  - 这会造成前台“运行中”和详情接口状态的短时收敛不稳定，但已不再是“前端主动重启 runtime 导致的新会话/新状态”。

## 首条消息慢启动补发补充

- 已在前端 `sendChatInput` 上增加 sandbox 首条消息的 pending 机制：
  - runtime 未 ready 时，不立即发送 `opencode_input`
  - 先保存原始 `messageKey/sessionId/prePersistedUserInput`
  - 由前端持续拉起 `runtime/start + refreshRuntimeStatus`
  - runtime ready 后自动补发同一条输入
- 已把以下错误收敛为“可恢复慢启动”，不再直接当成终态失败展示：
  - `执行环境启动较慢，请稍后再试`
  - `OpenCode 服务未就绪`
  - `sandbox port is not open`
- 用全新会话 `ac67add6-de27-40d5-a65d-3fac1474fecd` 做了回归：
  - 首条消息 `请只回复 AUTO-FIRST-2` 初次提交后，平台先只保存用户输入
  - 稍后 runtime 成功启动，自动补发到 OpenCode
  - 最终平台 detail / recent cache / OSAC 原始事件 / OpenCode Web 四边一致
  - 统一落在同一个 `opencodeSessionId = ses_309a34026ffee8JLUae7hOA6Ks`
  - OpenCode 最终回复 `AUTO-FIRST-2`
- 当前剩余问题不是丢消息，而是 fresh session 首次启动仍然偏慢；如果继续优化，应补“启动中/连接中”的前台状态提示，而不是再改补发链路。
- 旧 sandbox 关闭后 `archive_status = missing` 的问题已定位到“完成后未及时归档”；本轮已补同步归档，下一步需要再次做“完成一轮 -> 回收 sandbox -> 续聊”闭环验证。
- `ensureRuntime()` 的预检返回条件也已收紧：只有 authoritative runtime 处于 sendable 状态才直接复用；如果是 `closed/failed/terminated`，则继续走 runtime 重启流程。
- 继续定位“同一 OpenCode session 下多轮续聊卡在 collecting”问题后，确认根因是 `finalizedRuns` 用 `taskSessionId + opencodeSessionId` 作为 key，上一轮完成标记会污染下一轮。
- 已修复：`OPENCODE_PROMPT_ACCEPTED` 现在无论是否已有当前轮次 artifact，都会先清除同一 `runKey` 的 finalized/native-history poll 标记，避免 `session.idle` 被上一轮状态短路。
- 继续追到 native-history 补偿链路后，又确认了第二个问题：late `PROMPT_ACCEPTED` 会把 `promptedAt` 刷到比真实 assistant 回复更晚的时间，导致回补过滤掉正确消息。
- 已修复：run artifact 初始化现在优先从最近一次已持久化 `opencode_user_input/user_input` 推导 `promptedAt`，不再盲目使用 late `PROMPT_ACCEPTED` 时间。
- 继续复测后确认了第三个问题：late `PROMPT_ACCEPTED` 在 completed 之后还会无条件把 session 状态重置成 `in_progress/executing`。
- 已修复：若该 `runKey` 在 prompt accepted 到来前已经 finalized，则 prompt accepted 只保留 runtime 绑定补偿，不再回退 `status/stage`。
- 继续跟日志后又确认：late `PROMPT_ACCEPTED` 如果先把 finalized 标记清掉，后续 `session.idle` 仍会把这一轮再次当成未完成 run 处理。
- 已修复：对已 completed 的 late prompt accepted，直接短路返回，不再清 `finalizedRuns/native-history poll`。
- 继续复测 `FINAL-CHECK-7` 后确认，`message.final` 已落库但 `status/stage` 仍卡在 `in_progress/collecting`，问题不在 OpenCode 回复，而在 direct completion 分支等待归档。
- 已修复：`archiveCompletedTurn()` 改为后台执行，不再阻塞 `completed` 状态回写；direct / managed completed 分支先收敛状态，再异步归档。
- 在稳定进程上复测 `FINAL-CHECK-8` 后，已确认同一 `opencodeSessionId` 下续聊能正常收敛到 `completed/completed`。
- 同时暴露 recent 50 重建的历史脏数据问题：旧 `conversation_messages` 中存在重复 `message_key`，导致 `task_session_recent_messages` 重建时撞唯一键。
- 已修复：recent window 重建和 snapshot 替换前先按 `message_key` 去重，保留最新 `timeline_cursor` 项，避免后台重复报错。

## OpenCode 状态目录迁移补充

- 已确认性能根因不是平台展示层，而是当前把 OpenCode 状态目录放在工作区内，导致 OpenCode 自己持续 watch / diff 自己的 `opencode.db`、WAL、snapshot、log。
- 已把设计修正为 `workspaceRoot` / `stateRoot` 双目录：
  - `workspaceRoot=/home/user/opencode/workspaces/{taskSessionId}`
  - `stateRoot=/home/user/opencode/state/{taskSessionId}`
- 已完成代码改造：
  - OpenCode server 启动统一改为 `XDG_DATA_HOME=stateRoot`
  - metadata 增加 `opencodeStateRoot`
  - archive/restore 升级为双目录归档，并兼容旧 v2 单目录快照
  - 恢复后若发现旧快照仍把 `.opencode` 放在工作区，会自动迁移到 `stateRoot`
- 已用定向单测验证 archive/restore 兼容层：
  - `tests/sandbox-archive.service.test.ts` 通过
- 实测过程中又暴露了两个运行态问题：
  - 最初的双目录 tar 命令会打出错误结构，已改成“临时 bundle + symlink + tar -h”
  - sandbox 被回收后，native-history poll 的 `NotFoundError` 会直接打崩 API，已补 catch 并收敛为 `runtime closed`
- 当前剩余阻塞不在目录迁移逻辑本身，而在 E2B `runtime/start` 外部启动链路抖动；完整闭环验证还需要等这条链路稳定返回。
