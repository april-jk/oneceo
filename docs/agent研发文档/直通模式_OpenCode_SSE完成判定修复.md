# 直通模式 OpenCode SSE 完成判定修复

更新时间：2026-03-17

## 1. 问题

当前直通模式存在三类问题：

1. 平台会在 OpenCode Web 仍然输出时，提前显示 `OpenCode 执行完成`
2. 某些异常与 fallback 路径会导致同一条 prompt 被重复发送
3. 虽然已经订阅了 OpenCode `/global/event`，但完成判定和前端 stop 规则没有按 OpenCode 实际事件语义消费

## 2. 本次确认的根因

### 2.1 `session.idle` 被过度当成“已完成”

对照上游 `sst/opencode` 源码可确认：

- `session.status` 是主状态事件
- `session.idle` 是 `session.status(type="idle")` 的 deprecated 镜像事件
- TUI 主消费的是 `message.updated`、`message.part.updated`、`message.part.delta`、`session.status`

而 oneceo 当前链路里：

1. 后端存在基于本地超时的 synthetic `session.idle`
2. 前端 `shouldStopProcessingForMessage()` 把 `session.idle` 和 `session.status(idle)` 直接视为 finished

这会导致：

- OpenCode 实际仍在流式输出或 tool/think 仍在活动时，平台提前结束“处理中”

### 2.2 native history poll 先 flush 再完成

当前 `runNativeHistoryPoll()` 会先 `flushTextStreams()`，这会把“仍处于流中”的文本直接聚合成 `message.final` 语义并触发完成链路。

这一步过早，会制造：

1. 平台已完成，但 OpenCode Web 仍在继续
2. synthetic final / native history / 真正上游 final 多源重复

### 2.3 prompt fallback 可能重复发送

当前 `osac-agent-service.sendPrompt()` 在 sandbox dispatch 失败后，会直接 fallback 到 HTTP 再发一次。

如果第一次 dispatch 实际已经被 OpenCode 接收，只是桥接层没有拿到可确认响应，那么 fallback 就会把同一条 prompt 重发一遍。

真实回放进一步确认，本地环境还存在更直接的触发条件：

1. `apps/.env` 中 `OPENCODE_PROMPT_TIMEOUT_MS=60000`
2. 旧默认分支优先走 HTTP `POST /session/:id/message`
3. 当 OpenCode 在 60 秒内没有结束这个请求时，oneceo 会把它当成 timeout/fetch failed
4. 随后 fallback 或 retry 会把同一条 prompt 再次发给 OpenCode

这正好对应了用户侧看到的“约 60 秒后重复 user turn”现象。

## 3. 修复原则

1. 不再把本地 timeout 直接翻译成“完成”
2. native history poll 只负责补齐和稳定判定，不负责先 flush 再收尾
3. 前端停止 processing 只认强信号，不认模糊 idle
4. prompt fallback 对“可能已送达”的场景不再盲目二次发送

## 4. 本次落地

### 4.1 后端

1. stream idle timeout 不再直接合成完成事件
2. native history poll 改为：
   - 读取 live snapshots
   - 同步 native history
   - 检查最新 assistant turn 是否仍有活动 part
   - 连续稳定后才触发内部 completion fallback
   - fallback 改为 synthetic `message.final`，不再使用 synthetic `session.idle`
3. direct completion 前增加 native history active-part 检查
4. direct completion 路径延后 `flushTextStreams()`，不再先把流式文本聚合成伪 final 再判定
5. prompt sandbox dispatch 增加“已发送但确认不明”语义，避免直接 HTTP fallback 重发
6. 本轮继续把前端 `messageKey` 贯穿到后端 `sendUserInput()`，作为 `clientMessageKey` 使用
7. 后端增加 user prompt 幂等缓存与持久化回查：
   - 同一 `taskSessionId + clientMessageKey` 已经桥接过时，不再再次发送到 OpenCode
   - 如果首次发送后桥接层抖动进入 retry，也优先返回已记住的 dispatch 结果，抑制第二次 prompt
8. `opencode_user_input` 落盘元数据补充 `clientMessageKey`，便于后续复盘和恢复期去重
9. `sendOpencodePrompt()` 默认改为优先使用 sandbox 内 fire-and-forget dispatch，不再默认先走易受 `OPENCODE_PROMPT_TIMEOUT_MS` 影响的 HTTP prompt 路径

### 4.2 前端

1. `session.idle` 不再直接让页面停止 processing
2. `session.status(idle)` 不再直接让页面停止 processing
3. 调试面板中 `session.idle` 文案改为“空闲”，避免误导为“执行完成”
4. 页面最终停转以 `message.final`、真正 completed/failed 状态消息为主
5. `pendingSandboxPrompt` 增加一次性 dispatch key，避免 runtime ready / reconnect / effect 重跑时重复补发同一条 `opencode_input`

### 4.3 时间线一致性

真实会话复现中还确认了一个展示层问题：

1. `/messages/history` 在 sandbox + opencode 下优先返回 OpenCode native history，因此如果 native history 里已经有重复 user turn，平台历史会原样复现
2. `/messages/recent` 来自本地 recent cache，但此前 `createdAt` 同时混用了数据库字段和 `metadata.timestamp`
3. 某些数据库 `createdAt` 与事件时间存在 8 小时错位，导致 recent 面板虽然排序主要靠 `sessionEventSeq`，但展示时间和局部顺序对账容易混淆

本轮已把 `mapStoredMessagesToTimeline()` 的 `createdAt` 统一优先归一到 `metadata.timestamp`，减少 recent/history 之间的时间线错觉

### 4.4 recent 50 与状态映射补充修复

真实联调还确认了两处次级问题：

1. `task_session_recent_messages` 在 recent 重建和 native snapshot 回填并发时，会因为“先删后插”撞上 `(session_id, message_key)` 唯一键，导致 recent snapshot 更新失败
2. 某些直通 session 在 API 重启或 file-memory 残留时，`status=in_progress` 但 `stage` 仍保留为 `collecting`，与实际正在执行的 SSE/OpenCode 流不一致

本轮补充修复：

1. recent window rebuild 与 snapshot replace 改为事务内 `delete + insert onConflictDoUpdate`
2. `/sessions/:id` 与会话摘要对已有 sandbox/opencode session 增加实时 stage 归一：
   - `completed -> completed`
   - `failed -> failed`
   - `waiting_user -> clarifying`
   - `in_progress + sandbox/opencode + 已有用户输入 -> executing`

### 4.5 real session 对账补充修复

继续用两轮真实会话：

1. `帮我使用html开发2048小游戏`
2. `帮我使用nodejs对其进行优化`

做三端对账后，又补了三处关键修复：

#### 4.5.1 `/messages/recent` 直接对齐 native renderable timeline

此前 `/messages/history` 会优先走 native history，但 `/messages/recent` 仍然可能返回本地 recent cache，因此会出现：

1. history 已经干净，但 recent 仍残留 synthetic noise
2. 刷新后页面先拿 recent，短时间内看到的内容与 history 不一致

本轮已改为：

1. 对 sandbox + opencode session，`/messages/recent` 直接走 `resolveRenderableTimelineMessages()`
2. 返回 `source: resolved_recent`
3. 如果 recent cache 与 resolved recent 不一致，异步回写 `task_session_recent_messages`

结果是：

1. `/messages/recent` 与 `/messages/history` 在真实会话上都只保留 4 条核心消息
2. recent 也不再混入 `session.diff`、review summary、`OpenCode 执行完成` 之类的旧 synthetic 噪音

#### 4.5.2 API 重启 / 页面刷新后的 native completion 补偿

真实刷新场景里还确认：

1. OpenCode native 已经完成
2. 数据库 session 可能仍是旧的 `in_progress`
3. file-memory 重启后拿不到完整运行态，页面刷新会继续误判“还在执行”

本轮已补：

1. `inspectNativeSessionProgress()`：直接检查 OpenCode native 最新 assistant turn
2. `/sessions/:id` 与 session meta 解析阶段引入 `reconcileRecoveredOpencodeCompletion()`
3. 如果 native 已有可渲染 assistant reply 且没有活动 part，则直接把 session 补偿到 `completed/completed`

这样即使在 API 重启、SSE 断流、页面刷新后重新加载，也能从 native truth 恢复真实完成态。

#### 4.5.3 前端 recent timeout 后自动 fallback history

在真实页面刷新时，还发现一个单独的前端问题：

1. 初始加载先请求 `/messages/recent`
2. recent 现在会走 native resolve，耗时可能超过前端 2.5s timeout
3. 旧逻辑把 abort-like recent failure 直接吞掉，不继续请求 `/messages/history`
4. 结果是刷新后侧栏状态正常，但主会话内容为空

本轮已把 `loadInitialHistory()` 调整为：

1. recent 请求失败或 timeout 后继续 fallback `/messages/history`
2. 只有 fallback 本身也 abort 才停止
3. 并持续把当前 `messages` 写入 history view cache，减小刷新空窗

真实回归中，页面刷新后会重新看到两轮 user/assistant 对话，主面板与 sidebar 状态都能恢复。

### 4.6 直通模式消息镜像渲染补充

本轮继续按 `sst/opencode` Web 端源码对齐后，确认 oneceo 之前还有一个根本差异：

1. OpenCode Web 不是直接把 SSE 事件摘要渲染到对话区
2. 它会先消费 `message.updated / message.part.updated / message.part.delta / session.status`
3. 再在前端维护 message + part store，最后由 turn/message-part 组件渲染

而 oneceo 之前的链路是：

1. 后端把 native history 扁平化成文本/工具摘要
2. 前端把 SSE 进一步压成 `opencode_event + content`
3. 页面再按普通消息列表渲染

这会导致：

1. 实时 SSE 即使完整到达，也只能显示成“事件摘要流”
2. 页面刷新后 recent/history 无法恢复成与 OpenCode Web 一致的 part 结构
3. reasoning、tool、text、thinking 状态无法按原始 turn 语义稳定对齐

本轮补充修复：

1. native history 归一时不再只产出扁平 assistant 文本，而是同时产出可重建的结构化事件：
   - `message.updated`
   - `message.part.updated`
   - `message.final`
2. 结构化事件 metadata 补齐：
   - `messageId`
   - `partId`
   - `role`
   - `properties.info / properties.message / properties.part`
3. 前端不再把这类结构化事件一律丢弃，而是保留到本地消息流中
4. `Home` 对话渲染新增“直通 OpenCode turn 重建”路径：
   - 以 user turn 为锚点
   - 按 assistant `message + part` 聚合 text / reasoning / tool
   - 优先用结构化 part 更新同一 turn，而不是继续追加摘要文本
   - 在有真实 reasoning / tool 运行态时显示思考中状态
5. 只有在出现 OpenCode 事件时才启用该镜像渲染路径，其余模式后续单独设计

结果是：

1. sandbox 直通 opencode 模式会优先消费原始 SSE/native part 语义
2. 前端展示更接近 OpenCode Web 的 turn 结构，而不是 oneceo 自己的摘要消息流
3. 页面刷新后 recent/history 也能恢复到同一套结构化渲染路径

## 5. 预期结果

1. OpenCode Web 仍在输出时，平台不会提前显示完成
2. 同一条 prompt 不会因为 fallback 被轻易重发
3. 即使前端 pending prompt effect 或桥接 retry 抖动，同一逻辑输入也不会再次打进 OpenCode
4. recent/history/SSE 与 OpenCode Web 的显示节奏更接近
5. recent 50 热缓存不会因为并发 rebuild 撞唯一键而失效
6. detail / 刷新后的 stage 能更接近当前真实执行态
7. `/messages/recent` 与 `/messages/history` 在直通模式下保持更高一致性
8. 页面刷新后，即使 recent 超时，也能回退到 history 恢复消息内容
9. sandbox 直通 opencode 模式下，实时 SSE 与刷新后的历史恢复都尽量对齐 OpenCode Web 的 message/part 对话结构

### 4.7 同 Session 续聊修复补充

在消息镜像渲染补齐后，继续实测发现一个续聊问题：

1. 第一轮完成后，oneceo 页面继续发送第二条消息
2. 目标应是继续向同一个 `opencodeSessionId` 发送 prompt
3. 但前端本地状态仍可能被上一轮 `completed`/旧澄清消息回推到终态
4. 同时实时 websocket 的 `opencode_status` 没有和历史回放一样归一成 `status_update`

这会带来两个直接后果：

1. 历史/回放逻辑可能把“上一轮完成信号”错误应用到“下一轮刚发出的用户消息”
2. 实时 `OpenCode 已接收输入` 无法稳定把前端运行态切回 `executing`

本轮修复按上游 OpenCode 的 session 续聊语义收敛：

1. 实时 websocket / SSE 收到的 `opencode_status` 统一归一为 `status_update`
   - 语义与 history restore 完全一致
   - `OpenCode 已接收输入` 视为当前 turn 的 `executing`
2. 前端不再用“全局最后一个 completed/clarification”回推当前状态
   - 改为只在“最新 user turn 之后”的消息窗口内推导 stop/runtime/question
   - 避免上一轮 `completed` 误伤下一轮 follow-up
3. 直通 turn 渲染路径补齐 `apply_patch` 工具卡片去重
   - 与旧渲染器已有逻辑保持一致
   - 避免重复 patch 事件在同一 turn 中出现双卡片

这样修完后，前端续聊模型会更接近 OpenCode Web：

1. 同一 session 的下一轮输入会把本地状态切回当前 turn 的执行态
2. 旧 turn 的 terminal/clarification 不再跨 turn 污染新一轮
3. 实时消息和历史恢复继续走同一套 turn/message-part 语义
