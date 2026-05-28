# Home 历史增量加载 Edge 与 Firefox 滚动差异排查 [尚未采用]

创建时间：2026-05-26 13:53

## 问题背景

Home 页面聊天历史向上滚动时，会通过 older history 增量接口在列表顶部 prepend 更早消息。当前观察到一个跨浏览器差异：

- Firefox：历史消息刷新后位置基本稳定，不出现明显二次跳动。
- Edge：历史消息刷新后会先显示到正确位置，随后又突然向下跳一下。

这说明问题不一定是通用的数据拼接错误，也可能是 Chromium/Edge 的滚动锚定、布局结算、动画 transform 或 loading 节点移除时机与前端恢复逻辑之间存在兼容性差异。

## 当前状态

上一轮较宽泛的历史滚动修复已经暂存到 Git stash：

- `stash@{0}: codex-history-scroll-prepend-fixes-20260526`

该 stash 已添加备注：这批改动偏宽泛，后续不应直接整体恢复，应先单独检查 Edge/Chromium 为什么在 prepend 后二次跳动，再做更窄的兼容性修复。

当前工作区已回到提交：

- `763468e4 [修复] 补齐 MCP 确认历史状态；避免回放重复待确认`

## 需要重点复现的现象

1. 打开同一个长历史会话。
2. 从底部向上滚动，触发第一次 older history 增量加载。
3. 继续向上滚动，触发第二次 older history 增量加载。
4. 比较 Firefox 与 Edge：
   - 是否先显示正确位置；
   - 是否在 loading 提示消失后跳动；
   - 是否跳回第一次加载附近；
   - 是否连续触发多次 history 请求；
   - 是否消息 DOM 顺序、key、cursor 拼接正常。

## 待验证假设

### 假设 A：Edge 原生 Scroll Anchoring 二次介入

Edge/Chromium 可能在前端手动恢复 `scrollTop` 后，又基于自身选中的锚点执行一次原生滚动锚定。Firefox 的锚点选择或触发时机不同，因此不复现。

验证方式：

- 在 Edge 中临时对滚动容器和子树加 `overflow-anchor: none`，只保留最小改动，观察是否不再二次跳。
- 对照 Firefox，确认禁用后是否无负面影响。

### 假设 B：loading 节点移除导致二次布局变化

历史请求完成后，消息先 prepend 渲染，随后 `isLoadingOlderHistory=false` 移除顶部 loading 提示。Edge 可能在该节点移除后重新结算滚动位置。

验证方式：

- 记录 `messages` 更新、`isLoadingOlderHistory` 变化、loading DOM 移除、`scrollTop` 变化的时间顺序。
- 临时延后恢复到 loading 节点移除之后，观察 Edge 是否稳定。

### 假设 C：Framer Motion 入场 transform 影响锚定

新增历史消息或 managed activity group 使用 `motion.div` 入场动画，Edge 可能在 transform/opacity 过渡期间重新计算锚点，导致恢复后再跳。

验证方式：

- 只在 prepend 活跃期间禁用新增消息节点的 `initial/animate` transform 或 CSS transition。
- 对比 Edge 与 Firefox 的跳动差异。

### 假设 D：消息瀑布流拼接或 cursor 异常

第二次分页可能返回了重叠页、cursor 未前进，或合并时复用了旧闭包消息列表，导致 UI 看似 prepend 但实际 DOM 位置回到上一页附近。

验证方式：

- 对每次 `/messages/history` 请求记录 `before`、`nextBeforeCursor`、返回 messageKey 集合、当前已有 messageKey 集合。
- 确认每次分页都至少包含新 messageKey，且 `nextBeforeCursor < before`。
- 确认合并基线使用当前最新消息列表，而不是请求发起时闭包捕获的旧 `messages`。

## 测试矩阵

| 浏览器 | 必测项 |
| --- | --- |
| Firefox | 基线行为：连续两次 older history 加载是否稳定 |
| Edge | 复现二次跳动，记录跳动发生在消息插入、loading 移除、动画结束还是后台刷新返回之后 |
| Chromium/Chrome | 判断问题是 Edge 特有，还是 Chromium 家族通用 |

## 建议排查顺序

1. 先在当前干净提交上复现 Firefox 与 Edge 差异，不恢复 stash。
2. 给前端加临时日志或 Playwright 观察脚本，只记录：
   - `scrollTop`
   - `scrollHeight`
   - `isLoadingOlderHistory`
   - older history 请求 `before/nextBeforeCursor`
   - 当前第一条可见 `data-message-key`
3. 先验证是否是 Edge 原生 scroll anchoring 二次介入。
4. 再验证 loading 节点移除时机。
5. 最后再考虑恢复 stash 中的个别小改动，禁止整体恢复。

## 修复约束

- 不做大范围重构。
- 不直接恢复 `stash@{0}` 的整批改动。
- Firefox 不复现的前提下，优先做 Edge/Chromium 最小兼容修复。
- 每次只改一个变量，并用 Edge 与 Firefox 同时复测。
- 如果最终确认是 Chromium scroll anchoring 差异，应将 `overflow-anchor` 控制限制在 prepend 恢复窗口内，不能永久关闭整个消息列表的原生锚定能力。

## 验收标准

- Edge 中连续两次向上触发 older history 加载，不出现“先正确显示，随后向下跳”的现象。
- Firefox 行为不退化。
- older history 请求不会在同一顶部触发区连续触发多次。
- 每次分页返回数据可以证明是新消息，且 cursor 向更早方向推进。
- 修复 diff 保持窄范围，能解释具体浏览器差异来源。
