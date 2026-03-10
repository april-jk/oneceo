# OSAC 联调第一轮沟通稿（Fix5 目标）

## 1. 背景
我们在 `2026-02-18` 的回归中确认：链路可用但不稳定，表现为“偶发桥接断开 + 间歇 `token_mismatch` + 快速恢复后又可用”。

本地回归报告：
- `apps/api/scripts/reports/osac-opencode-regression-2026-02-18T11-36-30-378Z.json`（失败）
- `apps/api/scripts/reports/osac-opencode-regression-2026-02-18T11-41-56-250Z.json`（2/2 通过）
- `apps/api/scripts/reports/osac-opencode-regression-2026-02-18T11-46-58-567Z.json`（5 轮 4 成功 1 失败）

## 2. 关键证据
同一 session 出现如下序列：

`ws connected(connId=1) -> ws connected(connId=2) -> LLM bridge remap -> close 1005 -> llmproxy bridge_disconnected(connId=0)`

并伴随 API 侧：`401 code=token_mismatch`（间歇，随后恢复）。

## 3. 当前判断
主因偏向 OSAC bridge 状态机稳定性，不是 opencode 模型配置问题。  
编排侧缓存/重试可能放大窗口，但不是根因。

## 4. P0 修复侧重点（请优先）
1. Bridge 切换改为“两阶段提交”  
新 WS 连接先进入 `candidate`，仅在鉴权成功且 ready 条件满足后才 promote 为 `active`；旧 active 在 promote 前不得被踢掉。
2. 禁止非原子 remap  
出现第二条连接时，不要立即覆盖 active；要么拒绝新连接，要么延迟切换，避免 `remap -> 1005 -> bridge_disconnected`。
3. 明确 bridge 状态与错误码  
至少区分：`bridge_not_ready`、`bridge_disconnected`、`token_mismatch`、`mapping_stale`。
4. 降低无上下文错误  
`bridge_disconnected` 日志不得再出现 `connId=0/sessionId=` 这种不可定位信息。
5. 重连窗口行为  
重连期间请求可快速失败，但必须保证“短窗口内可恢复”，避免长时间黑洞等待。

## 5. P1 优化建议
1. 增加 `/debug/bridge-state`（或等价）输出当前 active/candidate、sessionId、connId、lastPing/lastPong。
2. 指标化输出  
每分钟输出 `ws_connect/ws_disconnect/token_mismatch/remap/bridge_disconnected` 计数。
3. close 1005 归因增强  
补充触发方、前序事件、socket 生命周期 ID。

## 6. 请 OSAC 团队回复这 8 个问题
1. 当前 bridge registry 的 key 是什么（sessionId/token/endpoint/connId 的组合）？
2. 现在 remap 的触发条件是什么？是否会在“新连接未 ready”时覆盖旧连接？
3. `close 1005` 在你们侧常见触发路径是什么？
4. 能否按上面 P0-1 改成 `candidate -> active` 原子切换？
5. 能否保证 remap 日志都带完整 sessionId/connId/requestId？
6. `token_mismatch` 是否可能由旧 mapping / stale token 竞争触发？
7. 是否可提供一个 Fix5 开关参数，控制“禁止激进 remap”？
8. 预计 Fix5 交付时间和回归用例清单是什么？

## 7. 我们这边已配合完成的改动
API 侧已改为“重连窗口快速失败 + 并发重试友好 + 回归脚本避免同 session 双 WS 探针冲突”，避免误判。  
所以当前剩余核心问题在 OSAC 侧切换与重连状态机。

## 8. 验收标准（建议共同确认）
1. 20 轮回归无长时间卡死，失败可在下一次重试快速恢复。
2. `bridge_disconnected` 出现时必须可定位到具体 session/conn。
3. 不再出现“新连接覆盖旧连接后立即 1005 导致整段不可用”。
4. `token_mismatch` 仅允许瞬时，且不应导致持续不可用。
