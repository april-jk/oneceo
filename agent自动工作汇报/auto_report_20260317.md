# 2026-03-17 自动工作汇报

## 已完成

- 梳理 `设置 -> 模型设置 -> codex` 的现状，确认前端已存在 `codex` 枚举，但后端 runtime、SSE、历史恢复仍是 OpenCode-only。
- 对照 `siteboon/claudecodeui` 的 Codex 会话恢复、流式事件、权限模式与设置管理实现，提炼出 oneceo 可复用的模式。
- 新增《设置 - 模型设置 - Codex 模式切换流程设计》，明确“新会话生效、运行中会话不静默热切换、后端需抽象 executor 分发链路”的方案。
- 根据新增要求，设计文档已补充 session 级 `driver` 身份标识，要求历史会话重开时必须沿用 `altus/opencode/codex/claudecode` 原身份，禁止被当前全局设置覆盖。
- 已将 `OSAC_client` 拉到仓库根目录并加入 `.gitignore`，开始评估其现有协议和服务端实现是否足以承载 Codex 的会话控制与事件回传。
- 已新增 OSAC 设计文档《OSAC Codex / Executor 扩展设计》，明确保留现有 WS/ACK 骨架，新增 `EXECUTOR_*` 通用协议与独立 Codex manager，而不是继续把能力塞进 `OPENCODE_*`。
- OSAC_client 已补最小可用 `EXECUTOR_*` 协议骨架和 Codex CLI manager，并完成本机 `go build` 与 Linux amd64 交叉编译。
- OSAC_client 已修复测试兼容问题，当前 `go test ./...` 已通过。
- 已产出 Linux 交付版本：
  - `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix22`
  - `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix22_debug`
- 已在主仓库 docs 下新增《OSAC Codex / Executor 扩展设计与交付》，用于记录 OSAC 设计和交付状态。
- oneceo 主仓库第一阶段已开始落地：
  - `file-memory-store.ts` 已增加 `driver` 与 `runtime.executorSessionId`
  - `websocket-service.ts` 已接入 `sandbox-executor-registry` 分发骨架
  - `osac-agent-service.ts` 已补 `EXECUTOR_*` 请求封装
  - `task-creation-routes.ts` 已开始返回/归一 `driver`
- oneceo 主仓库第二阶段已开始落地：
  - `codex-remote-service.ts` 已真正接上 `osac-agent-service.EXECUTOR_*`
  - 已开始处理 `EXECUTOR_EVENT / EXECUTOR_ERROR` 并通过 websocket 回传
  - `osac-connection-manager.ts` 已把 `EXECUTOR_*` 计入 sandbox activity
- 已确认 oneceo 主仓库当前最小接入点：
  - `apps/api/src/agents/task-creation/file-memory-store.ts` 仍缺 `driver / executorSessionId`
  - `apps/api/src/agents/task-creation/websocket-service.ts` 仍固定走 `handleOpencodeInput -> opencodeRemoteService.sendUserInput()`
  - `apps/api/src/routes/task-creation-routes.ts` 的 detail/recent/history 恢复逻辑仍按 `opencode` 写死
- 已重新编译交付 OSAC 二进制：
  - `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix22`
  - `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix22_debug`

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

- 当前仓库里的 `codex` 仅存在于设置枚举和 session executor 字段，runtime 结构仍硬编码 `opencodeSessionId`，后续接入如果不先抽象会继续放大耦合。
- oneceo 不能照搬 claudecodeui 的“服务端直接执行 codex sdk/cli”方式，必须改造成“sandbox 内运行 Codex，API 侧经 OSAC 编排访问”的形态。
- 仅保留 `mode/executor` 还不够，历史会话恢复时缺少单一身份锚点，容易被当前全局设置误覆盖，造成链路混用。
- 当前 `OSAC_client` 的控制面明显以 OpenCode 为中心，协议和状态结构都没有现成的 Codex session/stream 抽象，直接接入会继续放大 provider-specific 耦合。
- `EXECUTE_COMMAND` 虽然能跑命令，但它是一轮一命令的 stdout/stderr 模式，不适合作为 Codex 多轮可恢复会话的主链路。
- Codex 现阶段先走 CLI transport，真实 `resume/stream` 语义还依赖 sandbox 内 Codex CLI 版本，后续仍需实机联调验证。
- `OSAC_client/` 被主仓库忽略后，源码和 binary 不会进入主仓库 `git status`，部署交付必须显式引用版本号和产物路径。
- 主仓库当前只是“字段和分发骨架已落地”，Codex 真实 runtime 仍未接入，路由层恢复逻辑也还没去 OpenCode 化完成。
- `codex-remote-service.ts` 现在已能走最小发送链路，但 sandbox provision 仍沿用现有 OpenCode-oriented 流程，真实 Codex template/bootstrap 尚未切换。
- oneceo 主仓库还没有开始消费 `EXECUTOR_*`；目前只是 OSAC 侧先具备了最小可用控制面。

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
- Codex template 内没有 `opencode` 可执行文件，导致旧版 OSAC 的 probe/`GET_SESSION_LIST` 在 Codex-only sandbox 中直接报错，必须显式降级为“空列表而非失败”。
- Codex CLI 实际消费的是 `CODEX_API_KEY`；仅有 `OPENAI_API_KEY` 时会在 sandbox 内返回 401，需要在 sandbox env 构建时做兼容镜像。
- Codex template 默认不可写目录与现有 OpenCode 约定不一致，OSAC bridge 的二进制、锁文件、日志目录都要切到 `/home/user` 系列路径。

## 后续建议

- 先等 Codex 模式设计文档评审，确认“设置保存策略、运行中会话切换边界、Codex bridge 采用 SDK 还是 CLI”后再进入开发。
- 进入开发时优先做 executor 分发抽象、session `driver` 持久化和 runtime 元数据去 OpenCode 化，不要先从 SettingsDialog 表层开关入手。
- 如果继续沿用现有 OSAC，建议只复用其 WS 连接管理、ACK/流式转发骨架，并新增独立的 Codex bridge 协议，而不是把 Codex 生塞进 `OPENCODE_*` 消息族。
- 后续若要开始开发，建议先在 OSAC_client 内补协议与 manager 设计评审，再同步 oneceo 主仓库的 `codex-remote-service` 和 session `driver` 实现。
- 下一步建议尽快让 oneceo 主仓库开始消费 `EXECUTOR_*`，否则 OSAC 的 Codex 能力还接不上任务创建链路。
- 真正进入开发时，优先落 `file-memory-store.ts` 的 `driver + executorSessionId`、`websocket-service.ts` 的 executor 分发，以及 `task-creation-routes.ts` 的恢复逻辑，不要先从前端设置开关表层入手。
- 下一步继续按阶段推进时，优先实现 `codex-remote-service.ts -> osac-agent-service.EXECUTOR_*` 的真正调用，再补 `task-creation-routes.ts` 的 Codex history/status 恢复。
- 下一步继续按阶段推进时，优先补 `task-creation-routes.ts` 的 Codex history/status 恢复，以及 `sandbox-agent-provision-service.ts` 的 executor-aware template/bootstrap。
- 若进入开发阶段，建议优先顺序调整为：
  1. 主仓库补 `session.driver + runtime.executorSessionId`
  2. `websocket-service` 改成 executor 分发入口
  3. `osac-agent-service` 接 `EXECUTOR_*`
  4. 最后再接 detail/recent/history 的 Codex 恢复

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
- 现在“直通 codex 可用并且功能正常”的核心链路已经打通，下一步优先补真实前端页面回归，而不是继续扩展底层协议。
- 建议下一轮先做：
  1. oneceo 页面端真实发送一轮 `codex` 会话，核对 websocket 时间线和页面完成态
  2. 补 `task-creation-routes.ts` 的 Codex history/status/native workspace 对账
  3. 再决定是否把 CLI transport 升级为 SDK bridge

- Codex 直通主链路本轮已补到 sandbox/bootstrap 层：
  - `sandbox-agent-provision-service.ts` 已按 `executor` 区分 `opencode/codex`
  - `codex` 会选择 `E2B_CODEX_TEMPLATE`，并在 E2B sandbox 内启动 OSAC bridge
  - provision 完成后会把 `osacEndpoint / osacAuthToken / sandboxExecutor` 写回 environment metadata
- `osac-connector.ts` 已解除 E2B 模式硬拦截；只要 metadata 中存在 `osacEndpoint`，API 就可以通过 OSAC WebSocket 向 sandbox 内的 Codex 发送 `EXECUTOR_*`
- `codex-remote-service.ts` 与 `sandbox-executor-registry.ts` 已补前端兼容别名：Codex 事件会同时回传 `executorSessionId`，并保留 `opencodeSessionId` 兼容字段，降低现有前端恢复逻辑的错配风险。
- `task-creation-routes.ts` 已开始按 `executor/codex_*` 信号推导 sandbox session，不再只靠 `opencode_*`。
- 已读取 `apps/.env` 并使用真实 `E2B_API_KEY + OPENAI_API_KEY` 完成 Codex 联调。
- 已确认 `codex` template sandbox 内：
  - `codex-cli 0.101.0` 可执行
  - `/home/user` 可写，`/opt` 不可写
  - OSAC bridge 需部署到可写目录，不能沿用 `/opt/.altus/opencode`
- `sandbox-agent-provision-service.ts` 已补：
  - `executor=codex` 时选择 `E2B_CODEX_TEMPLATE`
  - 自动把 `OPENAI_API_KEY` 镜像到 `CODEX_API_KEY`
  - 在 sandbox 内启动 OSAC bridge，并把 `osacEndpoint / osacAuthToken / sandboxExecutor` 写回 metadata
- OSAC_client 在真实 Codex template 中暴露出 `GET_SESSION_LIST/probe` 仍硬依赖 `opencode` 的问题；已在忽略仓库内修到 `v1.1.2.fix23`：
  - `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix23`
  - `OSAC_client/dist/osac-linux-amd64_v1.1.2.fix23_debug`
- 真实底层 smoke 已通过：
  - `pnpm exec tsx -r dotenv/config scripts/_tmp/_tmp_codex_executor_smoke.ts 20000`
  - 已收到 `thread.started -> turn.started -> item.completed(OK) -> turn.completed`
- 真实 oneceo service smoke 也已通过：
  - `pnpm exec tsx -r dotenv/config scripts/_tmp/_tmp_codex_remote_service_smoke.ts 22000`
  - session `driver=codex`
  - `runtime.executorSessionId` 已从本地占位值提升为真实 Codex thread id
  - file-memory 与 DB 都已落到 `completed/completed`
  - `conversation_messages` 已落到 `codex_user_input + executor_event`
- 继续做页面级联调后，已补两类稳定性修复：
  - 前端新 session 首条消息在 `runtime` 尚未存在时，会立即按当前 `sessionId` 触发 `ensureRuntime(sessionId)`，不再只依赖后续 effect 追赶
  - `sandbox-agent-provision-service.ts` 已把 Codex 相关 LLM env 一并镜像进 sandbox：`CODEX_API_KEY / CODEX_BASE_URL / CODEX_MODEL`，并补 `OPENAI_*` 与 `OPENCODE_*` 之间的兼容映射
- 最新页面 smoke 已通过：
  - `pnpm exec tsx client/src/tests/_tmp_codex_direct_ui_smoke.ts`
  - 可证明“设置切为 codex -> 新会话 -> 首条消息 -> 远程 sandbox Codex 执行 -> history/status 完成 -> 刷新后恢复”主链路成立
- 本轮继续收口 Codex 消息显示：
  - 后端 `codex-remote-service.ts` 已从 `EXECUTOR_EVENT.event.item.text` 提取真实正文，不再把 `item.completed` 一律写成 `Codex 事件: item.completed`
  - 已过滤 `thread.started`、控制面回执、重复 `turn.completed(status=completed)` 等低价值事件
  - 前端 `useTaskCreationAgent.ts` / `Home.tsx` 已把 `executor_event` 单独归一成“正文 + 终态胶囊”，并忽略 `codex_user_input`
  - 顶部运行环境提示已去掉 `EXECUTOR_EVENT` 这类内部类型名
- 边界验证：
  - 使用用户提供的 `dd19b43a-c146-4b06-826d-7d2fc5a81549` 导出日志做 `buildChatItems` 回放
  - 输出仍稳定为 `opencode_turn`，未出现 Codex 胶囊，说明本轮修改没有串到 OpenCode 直通展示路径
- 继续增强 Codex 原子消息展示：
  - 已确认 Codex `item.completed` 原始事件会返回 `reasoning / agent_message / command_execution`
  - `reasoning` 与最终 `agent_message` 现在会在前端按 `Codex` 作者头部 + markdown 正文显示
  - 后端已把 `executor / itemType / itemId / itemStatus / itemText / command / outputPreview / exitCode` 写入 metadata，并进入 DB/API history slim metadata
  - 当前命令类 `command_execution` 先只保留元数据，不默认铺到主对话区，避免过程流再次变吵
