# 直通模式 OpenCode 过程流显示优化设计

更新时间：2026-03-17

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

本轮目标仅限 `sandbox 直通 opencode` 模式：

1. 对话过程看起来更流畅
2. 用户能看见“正在做什么”和“做过什么”
3. 用户不再被大段中间 reasoning 文本打断
4. 原子级过程消息仍然可见
5. 大段代码/长 diff 不再撑满整个对话区
6. 页面语义继续尽量贴近 OpenCode Web

本轮不处理：

1. 非直通模式的消息展示方案
2. 新增后端协议字段或自定义事件类型
3. 彻底重做对话 UI 结构

## 4. 设计原则

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

后续如需继续增强，可在此基础上补：

1. 折叠阈值微调
2. 更细粒度的日志消息折叠
3. `精简 / 过程 / 详细` 三档显示级别
