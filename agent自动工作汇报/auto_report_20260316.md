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

## 遇到的问题

- 旧会话里已经存在历史脏数据：同一逻辑消息过去被重复落库，且部分旧数据没有稳定的逻辑键。
- 这类旧数据在当前会话里仍可能继续显示重复内容；新逻辑主要保证“从现在开始的新消息”和“recent/history/replay/live 多来源合并”不再继续制造重复。
- 直通模式原先把 `completed` 当成“必须新建 OpenCode session”的条件，导致同一 task session 的第二轮用户输入落到新 OpenCode session，前台只看得到第一轮历史。
- 当前联调还暴露出 E2B / 数据库连接波动，导致续聊验证过程会被外部依赖中断；需要先把后端进程稳定性补齐，再做最终的 Playwright 端到端确认。
- 旧浏览器 `sessionStorage` 会把历史脏缓存重新灌回页面；需要靠缓存版本升级与噪音签名校验主动失效。
- 续聊问题并不只是 `completed` 状态判断；真正的替换点还发生在 sandbox 重建后的 session 恢复逻辑，如果不显式携带 preferred `opencodeSessionId`，恢复流程会从 workspace 中挑新的 session。

## 后续建议

- 下一步先做存储层改造，再视情况决定是否补历史脏数据迁移。
- 下一步观察是否还需要单独补“旧历史脏数据”专项清洗；当前迁移已做基础回填与同键去重，但无法自动识别所有历史时期的隐式重复。
- 待数据库与联调环境稳定后，再用一个全新会话做一次完整人工回归，确认数据库中 recent 50 与主消息表都不再产生重复。
- 下一步用 Playwright 复测“两次连续发送用户输入”场景，确认前后台与 OpenCode Web 侧都只复用同一个 `opencodeSessionId`。
