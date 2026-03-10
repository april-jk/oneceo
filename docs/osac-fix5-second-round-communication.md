# OSAC 第二轮确认（Fix5 落地口径）

你们第一轮回复我们已对齐，感谢。下面给出我们对你们 3 个协同问题的明确选择，以及 Fix5 交付前必须锁定的接口与验收口径。

## 1. 对你们 3 个问题的明确答案

1. 同一 `sessionId` 的 WS 并发策略  
我们要求：**严格单活 active**。  
允许 1 条 `candidate` 临时存在用于切换，但业务转发只能走 active，禁止双活转发。

2. candidate promote 判定条件  
我们选择：**鉴权成功 + 首次 pong + 控制面可用**（例如 `GET_SESSION_LIST` 成功或等价轻量探测成功）。  
不等待首条业务消息，避免冷启动被业务流量触发切换。

3. `mapping_stale` 场景处理  
我们选择分支策略：  
- 若 active 健康：candidate **立即拒绝**，返回 `409 mapping_stale`；  
- 若无健康 active：允许 candidate 进入等待，但超时后返回 `503 bridge_not_ready`。  
不要让请求长时间挂起。

## 2. Fix5 必须补齐的工程约束

1. 所有 `bridge_disconnected` 日志禁止出现 `connId=0/sessionId=`。
2. remap/promote/reject 必须带 `sessionId/connId/lifecycleId/endpoint/requestId(若有)`。
3. 切换逻辑需 CAS/epoch 保护，防止并发 attach 竞态。
4. 默认 `OSAC_WS_SWITCH_MODE=conservative`。
5. 请确认并修复当前日志重复打印问题（我们观测到同一行重复输出）。

## 3. 交付物要求（Fix5）

1. 二进制 + SHA256 + 构建时间。
2. 文档：状态机说明（含 `candidate -> active` 时序图）。
3. 新增环境变量及默认值。
4. `/debug/bridge-state` 返回 JSON 示例。
5. 错误码表（HTTP 状态 + `error.code` + 触发条件）。

## 4. 联调验收门槛（建议）

1. 20 轮回归中，不出现持续黑洞等待。
2. 若出现抖动，下一次重试应在短窗口恢复（秒级）。
3. 不再出现“新连接覆盖旧连接后立即 1005 导致整段不可用”。
4. `token_mismatch` 可瞬时出现，但不能造成持续不可用。
