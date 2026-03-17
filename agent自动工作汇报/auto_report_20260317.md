# 2026-03-17 自动工作汇报

## 已完成

- 排查直通模式 OpenCode 早完成问题，确认本地 `session.idle` synthetic completion 与 native history poll 提前 `flushTextStreams()` 是主要触发点。
- 对照上游 OpenCode session/message 实现，补齐了基于原生 assistant message/part 状态的活动判定，并把 direct completion 收尾改为“确认稳定后再 flush”。
- 收紧 OpenCode prompt sandbox dispatch fallback，增加“已发送但确认不明”语义，避免桥接不确定时直接 HTTP 重发同一 prompt。
- 用真实会话复现 `帮我开发2048小游戏，使用html开发`，确认 OpenCode native history 中确实出现了两条相同 user turn，平台 `/messages/history` 因偏向 native history 而同步暴露该重复。
- 后端已把前端 `messageKey` 贯穿为 `clientMessageKey`，补了 prompt 幂等缓存和持久化回查，避免 pending/retry 窗口把同一逻辑输入再次桥接到 OpenCode。
- 继续真实联调后确认：本地 `OPENCODE_PROMPT_TIMEOUT_MS=60000` 配合旧 HTTP prompt 默认分支，会把已经被 OpenCode 接收的 `/session/:id/message` 当成 timeout，再次 fallback/retry 发送同一条 prompt。
- `sendOpencodePrompt()` 默认已切到 sandbox fire-and-forget dispatch，后续新 prompt 在 OpenCode native 中只出现 1 次。
- 继续排查 recent 50 时，确认 `task_session_recent_messages` 在 recent rebuild 与 native snapshot 回填并发下会撞 `(session_id, message_key)` 唯一键。
- recent snapshot 重建与替换已改为事务内 upsert，避免 recent 持久化因唯一键冲突失败。
- `/sessions/:id` 与会话摘要已补 direct sandbox session 的 stage 归一，避免实际执行中仍显示 `collecting`。
- 前端 `pendingSandboxPrompt` 已增加一次性 dispatch key，防止 runtime ready / reconnect / effect 重跑时重复补发。
- recent 时间线已统一优先使用 `metadata.timestamp` 生成 `createdAt`，降低 recent/history 对账时的 8 小时错位问题。
- 前端处理态 stop 规则已调整为只认强完成信号，`session.idle / session.status(idle)` 不再单独停转，并补了对应单测。
- 继续真实两轮消息联调后，`/messages/recent` 对 sandbox/opencode session 已直接切到 resolved recent，并回写 recent snapshot，recent/history 现在都只保留 4 条核心 native 消息。
- 已补 native completion 恢复检查；即使 API 重启或 file-memory 丢失，`/sessions/:id` 也会用 OpenCode native 最新 assistant turn 补偿为 `completed/completed`。
- 页面刷新路径已修复：recent 请求 timeout/abort 后会继续 fallback 到 `/messages/history`，主面板不会再只剩“完成”状态但无会话正文。
- 检查任务创建相关现有 UX 文档与前端布局实现，定位首页 `Home` 和弹窗 `NewTaskDialog/TaskCreationChat` 的滚动容器层级。
- 调整聊天模式布局：对话区和内容预览区改为固定高度容器，滚动收敛到消息列表与预览面板内部。
- 收敛首页对话底部输入区定位方式，避免依赖 `sticky` 导致整页随内容一起滚动。
- 弹窗版任务创建对话同步改为固定框体，避免首页与弹窗在滚动行为上不一致。
- 更新 `docs/task-creation-ux-design.md`，补充“固定窗口、内部滚动”的布局约束。
- 首页聊天态已改为流式主内容宽度，不再受固定 `container` 限宽影响，减少中间区域空白。
- 桌面端对话区与预览区已改为可拖拽分栏，右侧预览支持通过左侧拖拽柄调整宽度。
- 左侧导航栏补充了更严格的 `overflow-hidden / truncate` 约束，长标题和会话名不会再顶出固定宽度。
- 聊天态视口已加根级滚动锁定；鼠标位于三块内容区之外的留白区域时，滚轮不再触发整页滚动。
- 继续全局排查后，已在聊天态对 `html/body/#root` 同时追加根级滚动锁定，防止浏览器根节点兜底接管滚轮事件。
- 侧栏滚动内容区已补滚动条安全边距，并将任务会话行、全部任务入口改为更严格的网格截断布局，减少右侧被遮挡的概率。
- 继续按反馈收紧三块区域间距：聊天态主内容左右 padding 缩小，对话区和预览区之间的分栏间隙进一步压缩。
- 预览分栏拖动热区已改为隐藏式，不再显示拖动柄；同时将内容预览最小宽度上调，避免拖得过窄。
- 对照 `sst/opencode` 的 `event-reducer`、`message-timeline`、`session-turn/message-part` 源码，确认 oneceo 当前问题核心是“把结构化 SSE 压成摘要文本”。
- native history 归一已补结构化 `message.updated / message.part.updated / message.final` 元数据，前端直通模式开始按 message+part 重建 turn，而不是继续逐条显示摘要事件。
- `Home` 已新增直通 OpenCode turn 渲染路径：同一 user turn 下聚合 assistant text / reasoning / tool，并在运行中展示“思考中”状态。
- 继续修复同 session 续聊：实时 `opencode_status` 已与 history 回放统一归一为 `status_update`，前端状态推导改为只看“最新 user turn 之后”的消息窗口，避免上一轮 completed/clarification 误伤下一轮。
- 直通 turn 渲染补齐 `apply_patch` 工具卡片去重，保持与旧渲染器一致，相关前端单测已通过。
- 已新增《直通模式 OpenCode 过程流显示优化设计》，明确直通模式下默认隐藏长篇 reasoning 正文、保留 `思考中 + heading + tool` 的展示策略，等待设计确认后再进入开发。
- 根据新增要求，设计文档已补充“原子消息仍需显示”的约束，后续实现会区分“低价值 reasoning/占位文本”和“应保留的细粒度过程消息”。
- 进一步补充了“长代码类消息默认折叠、按需展开”的设计约束，后续实现会采用“原子消息保留 + 大体积内容折叠”的方式控制对话区篇幅。
- 直通模式前端渲染已完成第一阶段优化：assistant turn 默认隐藏 reasoning 正文，保留 `thinking heading` 与原子文本消息，同时给大段 fenced code block、长 patch / diff 增加了折叠展示。
- 新增直通模式前端单测，覆盖 reasoning 隐藏、thinking heading 保留、原子消息保留、长代码折叠等核心行为。
- 继续修复直通模式 SSE 文本流：后端文本流归一现在会对连续 full-text snapshot 反推出 delta，SSE 路由也已改为对文本/思考流优先使用这条归一后的实时消息，避免页面表现成“整段整段刷新”。
- 补充了原子消息 hover 说明的设计约束：主卡片保持简洁，悬停时展示完整命令、完整文件路径、补丁目标文件等解释性文本。

## 遇到的问题

- OpenCode `/global/event` 虽已订阅，但 oneceo 当前把 idle 类事件当成强完成信号，导致平台与 OpenCode Web 的节奏出现偏差。
- 直通模式完成分支存在“先 flush 流式文本，再判断是否真的完成”的次序问题，会制造 synthetic final 和重复消息。
- sandbox prompt dispatch 在“请求可能已送达但未拿到短响应头”的场景下缺少中间语义，容易落入重复发送。
- `/messages/history` 在 sandbox+opencode 下优先使用 native history，导致“展示重复”和“实际发送重复”会叠在一起，需要先拆开定位。
- recent cache 的 `createdAt` 与 `metadata.timestamp` 之前不统一，真实会话里出现了 8 小时错位，干扰对账判断。
- recent 50 表的重建此前使用“先删后插”，在 event stream 与 native history 回填并发时会直接触发唯一键冲突，导致 recent 面板和刷新恢复不稳定。
- 真实 SSE 已经可用，但 detail/status 的 stage 映射此前会被 file-memory 中的旧 `collecting` 残留覆盖，页面刷新后容易误判执行态。
- `/messages/recent` 现在优先走 native resolve 后，单次请求耗时比旧 recent cache 更长，前端如果把 abort 直接吞掉，会导致刷新后消息区空白。
- 首页聊天模式已有 `h-full/min-h-0`，但外层仍保留整体滚动空间，导致左右面板不能稳定锁定在视口内。
- 弹窗版 `DialogContent` 之前允许整窗 `overflow-y-auto`，会放大“整个对话区域跟着滚”的问题。
- `WorkspaceLayout` 的 `container` 会在聊天页继续限制主内容宽度，导致即使关闭预览，中间对话区也无法真正占满剩余空间。
- 左侧导航栏部分节点虽然已有 `truncate`，但父级按钮没有完整的 `min-w-0 / overflow-hidden` 配套，长文本仍可能与状态元素挤压重叠。
- 仅依赖内部面板的 `overscroll-contain` 还不够；当鼠标落在非面板内容区时，根布局仍可能成为滚动源。
- 进一步确认后发现，根布局之外浏览器根节点也可能保留可滚动上下文，因此仅锁组件容器不足以彻底阻断空白区域滚轮。
- `ScrollArea` 的纵向滚动条会覆盖在内容视口上，如果侧栏内部元素按满宽排布，右侧最后一段文本会视觉上落到滚动条下方。
- oneceo 前端历史上把 `message.updated` 和大部分 `session.status` 当成“不可显示噪音”直接丢弃，这会让后续想复用上游 turn/message-part 结构时缺少关键骨架事件。
- native history 现有归一函数只回传扁平 assistant 文本和工具摘要，刷新后无法恢复出和 OpenCode Web 一致的 part 结构。
- 续聊时前端原先按“全局最后一个 terminal message”推导当前状态，导致第二轮消息刚发送时仍可能被上一轮 completed 回推为已结束。
- 实时 websocket 的 `opencode_status` 与 history restore 走了两套逻辑，续聊时容易出现“后端已接收，但前端仍停在旧状态”的错位。
- 当前直通模式虽然已经能按 OpenCode `message + part` 重建 turn，但阶段性 reasoning 文本仍可能直接落到主对话区，阅读负担偏高。
- 继续核对后发现，SSE 链路与 websocket 链路对文本流的归一方式并不一致，前端一旦切到 SSE 优先就会更容易表现为整段快照更新。

## 后续建议

- 用真实直通会话再做一轮双端对账，重点核对 oneceo SSE、recent/history、OpenCode Web 三处的完成时机是否一致。
- 若后续仍有边缘错位，可继续补 session detail/OSAC 原始消息采样，确认是否还有上游 `session.status` 与 message.parts 的时序差。
- 在本轮幂等键修复上线后，再用新会话复跑一次 2048 场景，重点核对 OpenCode native history 是否只剩单个 user turn。
- 如果仍有重复，再进一步在 WebSocket 服务和 runtime start 链路补发送侧打点，确认是否存在更早的前端双发入口。
- 新会话继续按“两轮消息 + 刷新 + OpenCode 对账”回归，重点确认 `帮我使用html开发2048小游戏` 与 `帮我使用nodejs对其进行优化` 在当前新进程下都只保留单条 native user turn。
- 若 recent 50 仍有边缘抖动，继续查看 `task_session_recent_messages` 与 `conversation_messages` 的 rebuild 时序，必要时再补更细粒度锁或队列串行化。
- 下一轮若要把“recent 50 可用”做成硬证据，建议补一个 DAO/集成用例，直接压入 55 条 timeline message 验证数据库最终只保留最近 50 条。
- 用首页和弹窗两个入口分别回归，确认消息增长、Diff 预览和部署日志都只在各自内部滚动。
- 如需进一步固化体验，可补一个针对聊天模式固定面板的 Playwright 视觉回归用例。
- 后续可考虑把预览区宽度记忆到本地存储，保留用户上一次拖拽后的面板比例。
- 用真实直通会话继续做一轮三端对账：oneceo 页面、OpenCode Web、native history，重点确认 text/reasoning/tool 的顺序与最终显示是否一致。
- 若需要进一步逼近 OpenCode Web，可继续把 turn 内的 thinking heading / retry / diff 区块样式也抽成更接近上游 `session-turn` 的组件层。
- 下一步建议直接跑一轮真实 oneceo 页面 + OpenCode Web 双端续聊对账，重点确认第二轮 prompt 在同一 `opencodeSessionId` 下的发送、实时显示和刷新恢复都一致。
- 设计确认后，下一步优先只改前端直通 turn 渲染，默认隐藏 reasoning 正文，保留 thinking heading 与 tool 过程卡片，再补最小渲染单测。
- 下一步建议直接跑一轮真实直通会话，对照 oneceo 页面与 OpenCode Web，重点确认 SSE 文本输出现在是否已经按同一 `partId` 连续增量追加，而不是按整段跳变。
