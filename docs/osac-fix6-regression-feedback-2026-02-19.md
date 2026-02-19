# OSAC Fix6 回归反馈（供 Fix7 开发）

日期：2026-02-19  
结论：`v1.1.2.fix6` 仍未达到可用门槛，主故障点仍在 WS `candidate -> active` promote 状态机。

---

## 1. 测试对象与基线

- 二进制：`others/osac-linux/osac-linux-amd64_v1.1.2.fix6`
- SHA256：`92e66af1104edf9748364e9f9b55ac8c56341f10d38833c274244e6c3a495845`
- 回归脚本：`apps/api/scripts/osac_opencode_regression.ts`
- 报告：`apps/api/scripts/reports/osac-opencode-regression-2026-02-19T00-06-05-853Z.json`

已核验 VM 内二进制：
- `/opt/.altus/opencode/osac` SHA256 与上述一致。
- 进程与监听正常（`pgrep -a osac`、`127.0.0.1:18111` LISTEN）。

---

## 2. 本轮实测结果

## 2.1 回归脚本结果
- 结果：失败
- 失败点：`ws-ready timeout (120000ms)`
- 统计：
  - `rounds=3`
  - `roundsExecuted=0`
  - `aborted=true`
  - `persistentBridgeReady=false`

## 2.2 关键错误模式
- API 侧出现：
  - `OSAC WebSocket 握手失败: status=401 code=token_mismatch`（间歇）
  - `OSAC WebSocket ping 超时`
- VM OSAC 日志出现：
  - `candidate rejected ... code=mapping_stale reason=candidate_exists`
  - 大量 `candidate probe_ok`
  - 仍有双份重复日志
  - 未观察到 `promote_success`

---

## 3. 关键证据（Fix6 仍未闭环）

## 3.1 即使 `probeOk=true` 也无法 promote
在保持 WS 长连接期间轮询 `/debug/bridge-state`，得到：

1. `debug1`：`candidate` 存在，`probeOk=false`，`stateReason=bridge_not_ready`
2. `debug2`：同一 `candidate` 已 `probeOk=true`，仍是 `stateReason=bridge_not_ready`
3. `debug3`：`candidate` 消失（epoch 变化），仍无 `active`，状态仍 `bridge_not_ready`

这说明：
- Fix6 虽然打通了 `probe_ok` 事件，
- 但 `probe_ok -> promote_success` 仍未完成闭环，
- 候选连接最终到期回收，导致持续 not_ready。

## 3.2 手动补 `sessionId` 后仍失败
手动连接（URL 带 `?sessionId=<sid>`）后：
- 日志 `sessionId` 字段可以正确出现；
- 仍只看到 `candidate probe_ok`，看不到 `promote_success`；
- 业务请求仍无可用 `active` 桥接。

结论：
- 这不是单纯的“未传 sessionId”问题；
- 核心仍是 OSAC promote 状态机没有在 `probeOk` 后完成切换。

---

## 4. 根因判断（Fix7 重点）

## P0-1 Promote 判定/执行链路仍有缺口
- 现象：`candidate.probeOk=true` 但不 promote。
- 推测：promote 仍依赖未满足或未触发的附加条件（例如 pong 状态写入/事件竞态），导致候选连接过期。

## P0-2 Candidate 过期策略仍会放大不可用窗口
- 在无 `active` 的情况下，`candidate` 到期后直接清理，状态回到 `bridge_not_ready`。
- 上层持续重连会触发 `candidate_exists` / `mapping_stale` 噪声，造成抖动。

## P1-1 可观测性仍不足以直接定位 promote 阻塞点
- `/debug/bridge-state` 目前缺少 promote 阻塞原因字段（例如 `waitingForPong`、`lastPongAt`、`promoteBlockedReason`）。

---

## 5. 给 OSAC 的 Fix7 落地建议

## P0（必须）
1. 当 `candidate.probeOk=true` 且当前无健康 `active` 时，必须原子 promote（CAS+epoch），并输出 `promote_success` 日志。  
2. 明确输出 promote 阻塞原因（结构化字段），至少包含：
   - `probeOk`
   - `pongOk/lastPongAt`
   - `promoteBlockedReason`
   - `promoteAttemptCount`
3. 在“无 active”场景下，不应让 candidate 直接到期后清空到 not_ready；应优先保障可恢复（可延迟回收或快速重试 promote）。
4. `candidate_exists` 出现时输出当前 active/candidate 的完整生命周期上下文，避免只看到拒绝结果。

## P1（应修）
1. 消除重复日志（同事件双份输出）。  
2. `/debug/bridge-state` 扩展为稳定调试面，至少返回：
   - `active/candidate` 全量状态
   - `lastPingAt/lastPongAt`
   - `promoteDeadline`
   - `promoteBlockedReason`
3. 保留并强化 `status/healthz` 的 readyReason 一致性（当前已可用）。

---

## 6. 验收门槛（Fix7）

1. 20 轮回归中，不得出现“`probeOk=true` 但无 promote，最终 candidate 过期回收”闭环。  
2. 抖动后应秒级恢复，且不再长期停留 `bridge_not_ready`。  
3. `candidate_exists/mapping_stale` 仅允许瞬时，不得导致持续不可用。  
4. 日志与 `/debug/bridge-state` 可直接定位 promote 阻塞原因。  
5. 不再出现双份重复日志。

