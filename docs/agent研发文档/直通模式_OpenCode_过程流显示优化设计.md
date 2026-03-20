# 直通模式 OpenCode 过程流显示优化设计

更新时间：2026-03-17（补充 Codex / executor_event 展示规则）

## 1. 背景

在 `sandbox 直通 opencode` 模式下，oneceo 当前已经可以消费 OpenCode 的实时 SSE 与 native history，并按 `message + part` 重建对话 turn。

但继续实测发现，展示层还有一个明显体验问题：

1. 某些阶段性 `reasoning` 内容会被直接渲染成大段文本
2. 这类内容通常是模型的中间整理过程，信息密度不稳定
3. 用户真正需要的是“当前在做什么”和“做了哪些操作”，而不是整屏中间草稿
4. 这会让直通模式虽然“更像 OpenCode Web”，但阅读阻力仍明显偏高

用户已经确认本轮方向为：

1. 保留一定的过程感
2. 避免一上来就出现大段阶段性文本
3. 尽量复用 OpenCode 原始展示语义，不额外造一套新协议
4. 原子消息仍需显示，不能因为压缩 reasoning 而把细粒度过程一起隐藏
5. 大段代码类消息需要支持折叠，避免占用大量篇幅
6. SSE 文本输出需要保持流式增量语义，不能回退成整段快照刷新
7. 原子消息 hover 时需要显示解释性文本，补充完整命令、路径或变更对象

## 2. 对照上游结论

对照 `sst/opencode` 本地源码确认：

1. `packages/ui/src/components/session-turn.tsx`
2. `packages/ui/src/components/message-part.tsx`
3. `packages/ui/src/routes/settings.tsx`

可确认上游的关键展示原则：

1. `showReasoningSummaries` 默认是关闭的
2. `reasoning` part 默认不直接展示正文
3. 即使隐藏 reasoning 正文，仍会保留 `思考中` 的轻量状态感
4. 如果存在可提取的 heading，上游会显示一个简短的 thinking heading，而不是整段 reasoning 文本
5. `tool` part 仍正常展示，因为它们才是“过程流”的核心证据

因此，本轮优化应继续沿用上游思路：

1. 隐藏低价值 reasoning 正文
2. 保留轻量 thinking 状态
3. 强化 tool / step / 原子消息 的过程可见性
4. 对大段代码类消息进行折叠
5. 最终正文与中间过程分层显示

## 3. 目标

本轮目标优先覆盖 `sandbox 直通 opencode`，并补充 `codex executor_event` 的兼容展示：

1. 对话过程看起来更流畅
2. 用户能看见“正在做什么”和“做过什么”
3. 用户不再被大段中间 reasoning 文本打断
4. 原子级过程消息仍然可见
5. 大段代码/长 diff 不再撑满整个对话区
6. 页面语义继续尽量贴近 OpenCode Web
7. `Codex` 直通模式不再把 `thread.started / item.started / item.completed` 这类结构事件直接显示给用户
8. `Codex` 的控制面回执与执行正文分层显示，避免主对话区出现 `Codex 会话已建立...`、`EXECUTOR_EVENT` 等内部术语

本轮不处理：

1. 非直通模式的消息展示方案
2. 新增后端协议字段或自定义事件类型
3. 彻底重做对话 UI 结构

## 4. 设计原则

### 4.0 Executor 事件兼容原则

`Codex` 当前通过统一的 `executor_event` 进入前端，这类消息不是 OpenCode 的 `message.part.*` 结构，因此不能直接复用 OpenCode turn 还原逻辑。

本轮对 `executor_event` 采用更保守的兼容策略：

1. 保留用户真正关心的阶段信号
2. 抑制纯结构性事件
3. 保留有实际文本产出的事件
4. 控制面回执不进入主对话正文

具体规则：

1. `turn.started`
   - 显示为轻量进度胶囊 `Codex 开始执行`
2. `turn.completed`
   - 显示为终态胶囊 `Codex 执行完成`
3. `turn.failed` / `turn.interrupted`
   - 显示为错误胶囊
4. `thread.started`
   - 不显示
5. `item.started`
   - 不显示
6. `item.completed`
   - 仅当事件自身携带高价值正文时显示
   - 如果只是 `Codex 事件: item.completed` 这类占位文本，则不显示
7. `EXECUTOR_SESSION_READY` / `EXECUTOR_INPUT_ACCEPTED`
   - 仍可作为 runtime / 调试链路存在
   - 但不在主对话区正文中显示
8. 本轮 `Codex` 兼容规则只挂在 `executor_event` 与 `executor=codex` 分支
   - 不修改 `opencode_event -> opencode_turn` 的主渲染路径
   - 不允许因为 Codex 过滤规则影响 OpenCode 的过程流展示

### 4.0.1 Codex 原子消息增强

在确认 Codex CLI 原始事件后，`item.completed` 并不只有最终答复，还包含：

1. `reasoning`
2. `agent_message`
3. `command_execution`
4. `file_change`
5. `diff`
6. `approval_request`
7. `tool_execution`

其中用户最能感知“过程正在推进”的，是 `reasoning` 与最终 `agent_message`。

本轮增强策略：

1. `reasoning` 类型
   - 保留为独立原子消息
   - 以 `Codex` 作者头部 + markdown 正文显示
   - 示例：`Searching for agents`、`Planning initial single-file game`
   - `ws模式` 下对 App Server 的 `item/reasoning/summaryTextDelta` 不直接落盘
   - 后端先按 `itemId + summaryIndex` 聚合，再投影成稳定的 `item/reasoning/summary`
   - 平台只显示聚合后的解释性消息，避免把 token 级增量通知直接泄露到主对话区
   - 聚合时必须保留原始空格和换行，不能对每个 delta 逐段 `trim`
   - 同一轮 poll 内若同一条 reasoning summary 被连续更新，只保留最后一个快照落库
   - 这样主对话区能按 Codex 原始时序看到“解释性消息 -> 工具/文件变更 -> 最终总结”，同时不会出现半截 reasoning 文本
2. `agent_message` 类型
   - 作为最终正文块显示
   - 同样使用 `Codex` 作者头部
3. `command_execution` 类型
   - 以轻量命令卡片进入主对话区
   - 默认只显示命令本身与短摘要，不展开完整输出
   - 相关字段需持久化：`itemType / command / exitCode / outputPreview`
   - 即使正文 `content` 为空，也必须保留到 history/store，因为卡片渲染依赖 metadata
   - 这样后续若要补命令卡片，不需要再次改后端存储协议
   - 前端展示时，不能继续沿用原始 `eventType=item.completed`
   - 进入工具卡片前应归一为展示态事件类型 `command.executed`
   - 否则会掉进通用 `tool` 分支，只显示单调的 `tool` 胶囊
   - 对写文件类 shell 命令（如 `cat <<EOF > file`、`tee file`、`cp`、`mv`），主卡片不再直接展示整条原始命令
   - 主卡片应优先显示：
     - 操作语义，例如 `文件修改 / 复制文件 / 移动文件`
     - 目标文件名，例如 `index.html`
   - 原始长命令只放在 tooltip / 详情弹窗中
   - 详情弹窗标题也必须继续使用语义化标题
     - 例如 `文件修改 · index.html`
     - 不允许回退成 `文件修改 · /bin/bash -lc "cat <<EOF ..."` 这种原始 shell 标题
   - 详情弹窗正文应优先显示：
     - `操作`
     - `目标文件`
     - `写入内容预览`（若命令可解析出 heredoc/写入正文）
     - 仅在无法提取写入正文时才退回 `命令摘要`
     - 而不是把完整 heredoc 直接拼进标题
   - 原因：这类命令本质仍是 `command_execution`，不是原生 diff；页面不应把整段 heredoc 当主正文
4. `file_change` 类型
   - 显示为 `新建文件 / 更新文件 / 删除文件` 卡片
   - 点击后联动右侧内容预览或变更面板
   - `item/fileChange/outputDelta` 这类底层增量通知不进入主对话区
   - 只保留最终可消费的 `fileChange` 结果卡片
5. `diff` 类型
   - 若事件中已带文件列表或变更对象，显示为 `变更草案` 卡片
   - 若缺少结构化文件列表，则退回普通 markdown/文本展示
   - 对同一 turn 内连续多次 `turn/diff/updated`，主对话区只显示最后一条最终 diff 卡片
   - 若 diff 事件自身未带文件路径，可使用同一 turn 内后续 `fileChange` 的文件路径补齐标题
   - 优先显示为 `变更 Diff · index.html`，避免退化成 `变更 Diff · 文件`
   - 右侧 `最近更改` 面板不再按 Codex 底层 patch 事件逐条堆叠
   - 对 `executor=codex` 的变更预览，按 `canonicalFile` 做文件级归并
   - 同一个文件如果在一个会话中被多次连续修改，只保留该文件最新的一条预览项
   - 目标是让 `最近更改` 表示“最近改了哪些文件”，而不是“最近收到哪些 fileChange/diff 通知”
6. `turn/plan/updated`
   - 不再作为内部噪音过滤
   - 后端将 `params.plan` 或 `turn.plan` 归一进 metadata，并生成可直接展示的 markdown 摘要
   - 前端按解释性消息插入主对话流，时序位于对应 turn 的工具/文件变更之前
   - 目标是让用户看到 Codex 的“任务规划/决策说明 -> 原子执行 -> 最终总结”完整链路
7. `approval_request` 类型
   - 显示为 `需要授权` 状态胶囊
   - 同时把授权说明正文显示出来
8. `tool_execution` 类型
   - 若具备工具名/输出摘要，则按轻量工具卡片展示
   - 若缺少结构化字段，则退回普通正文块
9. `stderr.line / stdout.line`
   - 对 `executor=codex` 默认不进入主对话区
   - 例如 `codex_core::rollout::list: state db missing rollout path ...` 这类内部运行日志，不属于用户可消费消息
   - 这类内容保留在 runtime/调试层即可，不应污染主聊天流
10. 原子消息 hover 详情
   - `tool` / `command_execution` 类卡片在 hover 时显示结构化详情
   - 至少包含：工具名、命令、工作目录、目标路径或输出摘要
   - tooltip 使用多行文本，保证长命令和多字段信息仍可读
   - 当详情文本过长时，tooltip 只显示前三行摘要
   - 同时提供 `展示更多` 入口，点击后通过独立浮窗展示完整信息
   - 这样长命令、大段 shell heredoc 或大块代码不会直接塞满 hover 层
11. 内容预览展开
   - 在内容预览面板右上角 `收起` 左侧增加 `展开` 按钮
   - 点击后，内容预览占据主界面，聊天面板暂时隐藏
   - 再次点击按钮时切回 `还原`，恢复原来的聊天 + 预览并列布局
   - 仅修改页面布局，不改变预览内容、预览标签和数据加载逻辑
12. Codex 文件预览
   - `内容预览 -> 文件` 在 `executor=codex` 下不再依赖 OpenCode server
   - 后端 `workspace/tree|dir|file` 按 executor 分流：
     - `opencode` 继续走现有 OSAC/OpenCode 文件接口
     - `codex` 直接通过 E2B sandbox 文件系统读取
   - Codex 文件树、目录分页、文件读取沿用现有前端面板结构与缓存协议
   - 工作区根目录继续使用当前 `taskSessionId -> workspaceRoot` 约定，不新增路径规则
   - 本轮目标仅为“Codex 下文件面板可用”，不重做前端交互，不修改 OpenCode 已验证链路
13. Codex 文件预览缓存
   - 对 `executor=codex`，平台需要在数据库中缓存“已读取过的文件目录与有限内容预览”
   - 缓存目标：
     - sandbox 正常运行时提升文件面板打开速度
     - sandbox 关闭后，仍可看到大致目录结构和最近读取文件的有限内容预览
   - 缓存范围仅限“用户在文件面板实际读取过的数据”：
     - 已展开过的目录分页结果
     - 已读取过的文件内容
   - 不做全量工作区离线镜像，不主动遍历整个 workspace
   - 文件内容缓存采用“有限预览”原则：
     - 仅保存截断后的文本内容或可预览二进制的有限 base64
     - 不保存超大文件的完整正文
   - sandbox 关闭时的回退行为：
     - `workspace/tree|dir|file` 优先返回数据库里的最近成功缓存

### 4.0.4 处理中继续发送与停止交互

当前直通模式下，发送框在执行中仍然是固定发送态，用户无法明确中断当前执行，也无法在处理中以“立即执行”的语义发出新的消息。

这会带来两个问题：

1. 用户看不到明确的停止入口
2. 用户在处理中继续发送消息时，行为容易退化为排队或静默等待，不符合“继续对话”的直觉

本轮统一交互规则如下：

1. 作用范围
   - 适用于直通模式下的全部执行器
   - 包括 `opencode / claudecode / codex`
   - 不修改非直通模式
2. 按钮状态
   - 当当前会话处于处理中且输入框为空时，发送按钮切换为 `停止`
   - 当用户开始输入新消息时，按钮立即恢复为 `发送`
   - 这样用户可以显式选择“停止当前执行”或“发送新消息覆盖当前执行”
3. 处理阶段分层
   - 当前“处理中”并不只有执行器阶段
   - 还包括消息先进入意图识别 agent，再由其决定是否/如何发给执行器的阶段
   - 因此停止和继续发送的语义必须区分：
     - `intent_processing`
     - `executor_processing`
4. 停止语义
   - 点击 `停止` 必须触发真实中断
   - 不允许只修改前端状态
   - 若当前消息仍停留在 `intent_processing`
     - 必须立即停止意图识别 agent
     - 同时阻塞该消息后续继续发往执行器
     - 不允许出现“用户已停止，但旧消息稍后仍被发给执行器”
   - 若当前消息已经进入 `executor_processing`
     - 必须直接向当前执行器发送中断信号
   - interrupt 成功后，对话流应收到对应的 `interrupted`/失败终态事件
5. 处理中继续发送
   - 当当前会话正在处理中、且用户输入了新的消息并点击 `发送` 时，行为必须按当前阶段分流
   - 若旧消息仍停留在 `intent_processing`
     - 先停止旧的意图识别 agent
     - 阻塞旧消息继续发往执行器
     - 保留 `旧消息 + 新消息`
     - 再将这两条消息一起交给意图识别 agent 重新加工
     - 由意图识别 agent 统一整理后再发给执行模块
   - 若旧消息已经进入 `executor_processing`
     - 先中断当前执行器
     - 再立即发送新的消息
   - 不允许把新消息排队到当前运行结束之后
6. Codex 特殊要求
   - `codex + sdk模式`
     - 继续沿现有 executor interrupt 能力
   - `codex + ws模式`
     - 新消息发送时必须中断当前 app-server turn
     - 然后在同一个会话、同一个 Codex thread 上立即创建新的 turn
     - 不允许继续沿用当前“排队等待上一个 turn 完成”的语义
7. 前端交互细则
   - 点击 `停止` 时，输入框内容不被清空
   - 输入框为空且正在处理中：
     - Enter 不触发发送
     - 点击按钮触发停止
   - 输入框有内容且正在处理中：
     - Enter 触发“按当前阶段分流处理”
     - 点击按钮同样执行该动作
8. 状态机约束
   - `isProcessing=true + draft为空` -> 按钮显示 `停止`
   - `isProcessing=true + draft非空` -> 按钮显示 `发送`
   - `interrupting=true` 时按钮进入短暂 disabled/loading，避免重复点击
   - 停止成功后，对话主视图必须立即插入一条原子消息：
     - `消息发送被中止，等待进一步指令`
   - 该消息用于替代“用户点了停止但页面没有反馈”的空窗
   - 展示为普通原子消息，不使用 toast 代替
9. 后端接口约束
   - 新增明确的 `interrupt` 路由
   - 不允许前端通过伪造消息类型来实现停止
   - interrupt 必须按当前阶段和 session 当前 executor 分流：
     - `intent_processing`
       - 中断意图识别 agent
       - 阻塞意图识别 agent 既有发送流程
     - `executor_processing`
       - `opencode` 走现有中断链路
       - `codex sdk` 走现有 executor interrupt
       - `codex ws` 走 app-server turn/job interrupt
10. 正确性验收
   - 同一会话处理中点击 `停止`，当前任务应停止
   - 若停止发生在 `intent_processing`，旧消息不得继续发往执行器
   - 同一会话处理中输入新消息并发送：
     - 若在 `intent_processing`，旧消息与新消息必须被一起重新提交给意图识别 agent
     - 若在 `executor_processing`，新消息应立即开始执行
   - 对 `codex ws`，新的消息必须继续使用同一个 `executorSessionId/threadId`
   - 不允许出现“前端显示已发送，但后端仍在排队等待旧任务完成”
     - 响应需明确标记 `stale=true`
     - 若数据库无缓存，再返回“执行环境已关闭，请重新启动”
   - 目录缓存需要和文件缓存分开：
   - 目录缓存用于恢复“看见有哪些文件/目录”
   - 文件缓存用于恢复“最近打开过的文件预览”
   - 本轮只为 Codex 增加这套缓存链路
   - 不修改 OpenCode 已验证通过的 workspace cache 行为
   - 运行时安全约束：
     - 若部署环境尚未执行 `task_session_workspace_cache` 的数据库迁移，缓存链路必须自动降级为“缓存不可用”
     - 缺表时只允许返回空缓存并记录告警，禁止因为缓存查询失败导致 API 进程崩溃
   - Codex `workspace/dir` 路由要求：
     - 目录读取主路径与 DB fallback 必须使用同一个 `tenantKey`
     - 禁止在请求主流程里引用未定义的 `tenantKey`，否则会把文件列表读取直接打成 500

### 4.0.3 Codex 解释性消息动态展示

用户进一步确认，`ws模式` 下的解释性消息不能只作为普通静态 markdown 渲染，还需要体现 Codex 正在思考/规划的过程感。

本轮新增交互目标：

1. 解释性消息在“处理中”阶段，以渐进式逐字刷新展示
2. 解释性消息结束后，不保留整段正文
3. 结束后只保留该条解释性消息的标题/heading
4. 解释性消息与原子消息仍按 Codex 原始时序插入，不允许重排

具体规则：

1. 适用范围
   - 仅挂在 `executor=codex + transport=app_server` 的 `reasoning` / `turn/plan/updated` 解释性消息分支
   - 不影响 OpenCode turn 展示
   - 不影响 Codex 的 `agent_message / command_execution / file_change / diff`
2. 处理中状态
   - 对正在增量更新的解释性消息，前端保留完整正文
   - 使用逐字滚动刷新效果，体现“正在思考/规划”
   - 动效只作用于当前仍在更新的那一条消息，不扩散到已完成历史消息
3. 完成后折叠
   - 一旦该条解释性消息不再更新，页面将正文折叠掉
   - 仅保留 heading / 第一行标题
   - 终态直接显示为普通一行文本，不使用胶囊、边框或额外包裹
   - 示例：
     - `Planning 2048 mini game`
     - `Optimizing tile behavior`
     - `Updating the plan sequentially`
4. heading 提取规则
   - 优先使用 markdown 第一行 heading / strong heading
   - 若不存在结构化 heading，则使用第一句短文本
   - 若仍无法提取，则回退到截断后的前 1 行文本
5. 与最终总结的关系
   - 最终 `agent_message` 仍完整显示
   - 只有解释性过程消息在完成后折叠为标题
6. 与计划消息的关系
   - `turn/plan/updated` 若为结构化计划摘要，处理中可完整展示
   - 完成后保留计划标题与 todo list
   - 仅隐藏计划说明性正文，不隐藏步骤列表
7. 交互边界
   - 本轮不增加“展开查看完整历史解释性正文”的交互
   - 目标是压缩聊天主视图，突出时序感、科技感和执行结果
8. 当前实现落点
   - 前端新增 `agent_explanation` 聊天项类型
   - `reasoning` 与 `turn/plan/updated` 统一走解释性消息分支
   - 仅最后一条解释性消息保持展开，之前的解释性消息全部自动折叠为标题
   - 标题优先取 markdown heading / strong heading / 第一行文本
   - 折叠后的标题使用与普通消息一致的字号和字色，避免解释性标题视觉权重过高
   - `turn/plan/updated` 在折叠态下额外保留 todo list
   - 连续的 Codex 文本消息只在首条显示 `Codex` 作者头，后续连续消息省略作者头，直到被其他类型消息打断

这样处理后，主对话区的理想形态是：

1. 处理中时：
   - 看到解释性消息逐字刷新
   - 紧接着看到工具/文件/变更事件
2. 处理完成后：
   - 解释性消息自动收缩为简短标题
   - 原子消息和最终总结保留完整内容

### 4.0.2 Codex 多轮历史一致性

实测发现 Codex 续聊不仅有执行层问题，还有历史层问题：

1. 对已存在 session 再次调用 `/sessions` 时，不能继续把 `initialMessage` 作为新的 `user_input` 落库
2. Codex 的真实用户输入应以 `codex_user_input` 为准，并在 history 中映射回 `user_input`
3. `executor_event` 必须带稳定 `messageKey`
   - 否则实时 WS 与 `loadHistory(reconcile)` 会把同一条消息当成两条不同记录
4. history 合并逻辑不能只“跳过已存在 key”，还应允许用同 key 的新版本覆盖旧版本 metadata

因此本轮补充规则：

1. 已存在 sandbox session 再发消息时，不再通过 `/sessions initialMessage` 重复落用户消息
2. `codex_user_input` 进入 history 时要正常显示为用户消息
3. Codex 的实时消息与持久化消息使用统一 `messageKey` 规则
4. reconcile/history 合并按 key 做 upsert，而不是单纯 append
5. `codex_user_input` 持久化时优先复用前端 `clientMessageKey`
   - 这样乐观显示的用户消息与后端确认后的用户消息能合并成同一条
6. `executor_event` 的前端去重不能只看 `eventType + content`
   - 因为多个不同 Codex 原子 item 会共享：
     - `eventType = item.completed`
     - `content = Codex 事件: item.completed`
   - 去重必须同时纳入 `itemId + itemType`
   - 否则会把第二条及之后的 `command_execution / file_change / agent_message` 误吞掉

这样处理的目的不是让 Codex “更吵”，而是把真正有阅读价值的原子步骤稳定显示出来，同时把纯控制信号与低价值命令噪音继续留在调试层。

### 4.1 复用上游 message-part 语义

仍以现有的 OpenCode 结构化事件为主：

1. `message.updated`
2. `message.part.updated`
3. `message.part.delta`
4. `message.final`
5. `session.status`

展示优化优先基于已有 `part.kind`、`part.title`、`thinkingLabel`、tool 信息完成，不新增一套 oneceo 自定义消息体系。

这也意味着：

1. 对 `message.part.delta`
2. 对可由 `message.part.updated` 推导出的增量文本

都应尽量按流式语义消费，而不是只把最新 full text 当作整段替换。

### 4.2 默认隐藏 reasoning 正文

当 assistant turn 中存在 `reasoning` part 时：

1. 默认不把 reasoning 正文直接插入对话流
2. 不展示类似 `Structuring the project` 下方整段展开文本
3. 避免用户在处理中被大段中间草稿淹没

### 4.3 保留轻量 thinking 状态

隐藏 reasoning 正文后，仍保留：

1. `思考中`
2. 从现有 reasoning 文本中提取出的简短 heading

示例：

1. `思考中`
2. `Structuring the project`

这部分属于“过程感”，但不展开其后续长文。

### 4.4 优先展示工具过程

在同一 assistant turn 下，优先让用户看到：

1. `read`
2. `write`
3. `edit`
4. `apply_patch`
5. `bash`
6. `grep`
7. `glob`
8. 其他 OpenCode 已有 tool part

也就是说，过程展示的主体从“长篇 reasoning 文本”切换为“原子操作消息 + 工具卡片 + 简短 thinking heading”。

### 4.5 保留原子消息

这里的“原子消息”指能直接表达一步具体动作或具体状态推进的细粒度消息，不等同于长篇 reasoning 文本。

应保留的原子消息包括但不限于：

1. 工具调用本身
2. 工具调用结果或结果摘要
3. step/heading 类状态推进
4. diff / patch / 文件变更提示
5. 其他能清楚表达“刚刚发生了什么”的短消息

处理原则：

1. 原子消息默认显示
2. 原子消息应优先于长篇 reasoning 正文
3. 只有低价值、不可读、重复性的占位文本才应被抑制
4. 如果某条消息既短又能表达清晰动作，则应保留

### 4.5.1 原子消息解释性文本

原子消息主视图仍保持简洁，但 hover 时应补充解释性文本。

适用示例：

1. `Shell`
   - hover 显示实际执行命令
2. `读取 / 写入 / 编辑`
   - hover 显示完整文件路径
3. `补丁 / Diff`
   - hover 显示涉及的目标文件
4. `搜索 / 匹配`
   - hover 显示 pattern、路径或其他关键参数

处理原则：

1. 主卡片文案保持短
2. hover 文本尽量展示“用户最关心的完整上下文”
3. 若没有高价值上下文，则不强行显示 tooltip
4. 继续复用现有 tooltip 组件，不新增独立交互体系

### 4.6 大段代码类消息折叠

对于代码、长 diff、长 patch、长日志类消息，本轮不主张直接整段铺开。

处理原则：

1. 保留该消息本身，不能直接隐藏
2. 默认折叠正文，只展示摘要头部
3. 需要时用户可主动展开查看完整内容
4. 折叠后的头部仍应属于原子消息流的一部分

适用对象包括但不限于：

1. 长代码块
2. 长 diff / patch
3. 大段文件内容
4. 较长工具输出片段

展示建议：

1. 头部展示消息类型
2. 头部展示简短摘要，例如文件名、语言、变更规模、行数
3. 提供“展开/收起”交互
4. 展开后仍在当前 turn 内查看，不跳出上下文

该策略的目标不是减少信息，而是避免大体积内容直接淹没对话主线。

### 4.7 最终正文与中间过程分层

assistant 真正的文本回答仍然保留，但要和中间过程分层：

1. 处理中优先显示 thinking + tool
2. 真正产出 `text` part 时，再显示正文
3. 避免“先吐大段草稿，再给最终答案”的阅读跳变

### 4.8 抑制低价值占位消息

当前 oneceo 的 fallback / 摘要链路里，可能还会出现一些低价值状态文本，例如：

1. `[Text] updated`
2. `[Reasoning] 思考中`
3. `[Step] 开始执行`

在直通模式的主对话区中，这类消息不应作为正文展示主体。

处理原则：

1. 若已存在结构化 turn 渲染，则优先走 turn 渲染
2. 低价值占位文本仅作为调试/兼容路径保留
3. 主对话区默认不再突出渲染这些噪音文本
4. 但具有明确动作语义的原子消息，不属于此类噪音，不能误过滤

## 5. 展示策略

### 5.1 第一阶段默认策略

本轮先落一个默认展示策略，不先引入新的用户设置项：

1. user 消息照常显示
2. assistant processing 中：
   - 显示 `思考中`
   - 显示简短 thinking heading
   - 显示原子消息
   - 显示 tool cards
3. assistant `reasoning` 正文默认隐藏
4. 长代码类原子消息默认折叠
5. assistant 最终 `text` 正文正常显示

这是最接近 OpenCode Web 默认行为、且改动面最可控的一版。

### 5.3 SSE 流式输出补充

直通模式下，前端实时显示应继续遵循：

1. 优先消费增量文本
2. 同一 `partId` 在同一 turn 内持续追加
3. 只有 checkpoint / final 才允许回退到 full text

如果上游只给 `message.part.updated` 的 full text snapshot，则后端应先按前文推导出 delta，再发给前端，避免 oneceo 页面退化成“整段整段跳变”。

### 5.2 第二阶段可扩展项

如第一阶段稳定，后续可增加显示级别切换：

1. `精简`
   - 只看关键原子消息、关键工具过程和最终结果
2. `过程`
   - 看 thinking heading + 原子消息 + tool cards + 最终结果
3. `详细`
   - 再允许展开 reasoning summaries，并按需展开长代码块

本轮只在设计中预留，不作为必须开发项。

## 6. 实现落点

预计主要影响前端：

1. `apps/web/client/src/pages/Home.tsx`
2. `apps/web/client/src/hooks/useTaskCreationAgent.ts`

具体方向：

1. `Home.tsx`
   - 调整直通 OpenCode turn 渲染逻辑
   - 对 `reasoning` part 改为默认隐藏正文
   - 保留 `thinkingLabel`
   - 保留原子消息节点
   - 为长代码/长 diff 类消息增加折叠态
   - 为原子消息补 hover 解释性文本
   - 继续展示 tool part
2. `useTaskCreationAgent.ts`
   - 继续保留结构化事件
   - 对纯占位型摘要文本做更严格的主视图过滤
   - 避免把原子消息误判成噪音文本
    - 避免 `[Text] updated` 之类消息进入主对话展示路径

后端本轮预期不做协议变更；如需额外处理，也应以“减少噪音映射”为主，而不是新增事件语义。

## 7. 风险与权衡

### 7.1 用户可能觉得“思考内容变少”

隐藏 reasoning 正文后，部分用户会觉得“看不到模型到底想了什么”。

本轮权衡：

1. 默认优先流畅度
2. 保留 heading、原子消息和 tool 过程，避免完全黑盒
3. 后续如有需要，再增加 `详细` 级别开关

### 7.2 某些 turn 只有 reasoning，没有 tool

极端情况下，如果某个 turn 暂时没有 tool，且 reasoning 正文被隐藏，页面可能只剩：

1. `思考中`
2. 一条简短 heading

这符合上游默认行为，也比直接展示大段中间草稿更稳定。

### 7.3 长代码折叠的边界判定

“多长才折叠”需要有稳定规则，否则会造成同类消息展示不一致。

本轮建议：

1. 先采用保守阈值
2. 优先对明显的大代码块、长 diff、长日志折叠
3. 短代码片段仍可直接显示

具体阈值应在实现时以现有消息结构和真实样本再校准一次。

### 7.4 兼容旧 fallback 摘要路径

当前 oneceo 仍保留部分摘要/fallback 逻辑，若完全删除会增大风险。

本轮不删除旧路径，只调整：

1. 主视图优先级
2. 噪音消息过滤
3. 结构化 turn 渲染覆盖范围

## 8. 验收标准

满足以下条件即可认为本轮优化达标：

1. 在 `sandbox 直通 opencode` 模式下，处理中的 assistant turn 不再直接展示大段 reasoning 正文
2. 页面仍能显示 `思考中` 与简短 heading
3. 原子消息继续正常显示，不被误过滤
4. 工具过程卡片继续正常显示
5. 大段代码/长 diff/长日志消息默认折叠，但可展开查看
6. 原子消息 hover 时能看到解释性文本，例如 shell 命令、完整路径、补丁目标文件
7. 最终 assistant 正文仍能正常显示，不被误隐藏
8. 刷新后 recent/history 恢复出的 turn 仍遵循同一展示规则
9. 不引入新的重复消息或空白 turn 问题
10. 展示效果整体与 OpenCode Web 默认行为更接近，同时更适合 oneceo 的长篇对话阅读

## 9. 开发建议

建议按以下顺序开发：

1. 先只改前端直通 turn 渲染
2. 再补最小单测，覆盖：
   - reasoning 默认隐藏
   - thinking heading 仍显示
   - 原子消息仍显示
   - 长代码类消息默认折叠
   - 折叠消息可展开
   - 原子消息 tooltip 文案正确
   - tool part 仍显示
   - final text 仍显示
3. 如测试和实测稳定，再考虑是否补“显示级别切换”

## 10. 结论

本方案的核心不是“减少过程”，而是把过程从“长段中间文本”切换为“简短 thinking heading + 原子消息 + 工具流”，并把大体积代码内容收纳为可展开的折叠块。

这样既能保留 OpenCode 的执行透明度，也能避免用户在处理中看到大量阶段性草稿文本，整体方向与上游 OpenCode Web 的默认处理方式保持一致。

## 11. 当前落地状态

2026-03-17 第一阶段已落地，当前实现状态如下：

1. 直通模式 assistant turn 默认不再直接渲染 reasoning 正文
2. `thinking heading` 仍然保留，用于配合 `思考中` 展示轻量过程感
3. 原子文本消息仍然显示，不会随 reasoning 一起被隐藏
4. 大段 fenced code block 已支持折叠展示
5. 长 patch / diff 类纯文本消息已支持折叠展示
6. 对应前端单测与 `web` 类型检查已通过
7. SSE 实时文本流已改为优先走归一后的增量语义：
   - 文本/思考流不再直接消费原始 `message.part.updated` 快照
   - 后端会对连续 full-text snapshot 反推出 delta
   - SSE 路由改为优先复用归一后的实时文本流消息
8. `Codex` 原子消息已进一步增强：
   - `file_change` 会显示为 `新建文件 / 更新文件 / 删除文件` 卡片
   - 点击文件变更卡片会联动右侧内容预览的 `更改` 面板
   - 右侧预览面板会为 `file_change` 生成最小结构化 diff 项，即使没有原生 patch 文本也能看到目标文件
   - `command_execution` 会按命令语义补轻量分类，如 `目录检查 / 搜索 / 文件查看 / 文件修改`
   - 以上规则只挂在 `executor=codex` 分支，不影响 `OpenCode` 现有展示

后续如需继续增强，可在此基础上补：

1. 折叠阈值微调
2. 更细粒度的日志消息折叠
3. `精简 / 过程 / 详细` 三档显示级别
