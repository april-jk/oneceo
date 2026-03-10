# OSAC Fix8 Debug 回归结论（2026-02-19）

## 结论摘要
- 当前阻塞点已收敛到 **OSAC WS bridge 状态机**，不是模型配置问题。
- `fix8_debug` 下可复现：
  - 首次握手 `allow`，但 candidate 长时间不 promote，期间持续 `mapping_stale/candidate_exists`。
  - 或者 promote 后很快出现连接重建窗口，再次进入 `mapping_stale` 风暴。
- API 侧已完成一轮降噪修复（避免提前占位和强制断链），但 OSAC 侧仍存在 P0 问题，导致端到端回归仍未通过。

## API 侧已完成修复（本轮）
1. 关闭 provision 阶段默认 eager bridge（避免提前占住 candidate）。
   - 文件：`apps/api/src/services/sandbox-agent-provision-service.ts`
   - 新开关：`OSAC_PROVISION_EAGER_BRIDGE`，默认 `false`。
2. ping 超时不再强制 `terminate()`（避免触发 server 侧 stale active/candidate 窗口）。
   - 文件：`apps/api/src/clients/osac-client.ts`
3. 健康检查遇到 ping timeout 改为降级告警，不立即 drop/reconnect。
   - 文件：`apps/api/src/services/osac-connection-manager.ts`
4. 回归脚本提高 ws ping 默认超时（`5s -> 15s`），减少误判。
   - 文件：`apps/api/scripts/osac_opencode_regression.ts`

## 关键复现证据

### 会话 A：`sess_5c6f8891d1744b4e`（端口 `20125`）
- `03:47:28` 首次握手 `allow`，进入 `candidate_admitted`。
- 随后多次新握手被拒：`mapping_stale reason=candidate_exists`，且日志显示 `activeConnId=0 candidateConnId=1`。
- `03:47:48` 记录 `ws candidate promote pending ... reason=bridge_not_ready`。
- `03:48:28` `candidate_expired` + `closedBy=candidate_max_age`（约 60s 占位）。
- 之后新连接再次 `allow`，约 6 秒后才 `probe_ok -> promote_success`。

### 会话 B：`sess_fc9f1444ce3b449c`（端口 `20128`）
- `03:58:27` 首次握手 `allow`，`candidate_admitted`。
- `03:58:47` `promote pending reason=bridge_not_ready`。
- 到 `03:59:07` 才出现 `probe_ok(trigger=ticker) -> promote_success`（约 40s 窗口）。
- 窗口期间客户端重连全部被 `mapping_stale/candidate_exists` 拒绝。

### 会话 C：`sess_c8deed00f6254d4c`（端口 `20127`）
- 首次可 `allow` 且 `promote_success`。
- 后续出现 `closedBy=server_ping_error`，`write: connection reset by peer`，进入重连窗口。

## 对 OSAC Fix9 的建议（P0）
1. candidate 占位窗口不可长时间阻塞
   - 目标：`candidate_admitted -> promote_success` 常态 < 5s，P95 < 10s。
   - `bridge_not_ready` 不应持续到 `candidate_max_age` 才释放。
2. candidate_exists 拒绝策略需要带“可恢复信号”
   - 在 `409 mapping_stale` 响应中返回可机读字段：`role=candidate|active`、`remainingMs`、`reason`。
   - 便于编排侧做正确退避，不做无效重连风暴。
3. probe/ticker 触发链路提前
   - 当前多个样本是依赖 `probe_ticker` 延迟触发 promote，应允许更早触发（握手后即刻 probe）。
4. 连接状态一致性
   - 出现 `activeConnId=0` 但长时间 `candidate_exists`，建议补状态一致性检查与自动回收。
5. ping/pong 可观测增强
   - 在 `ws_state` 或断链日志中增加最近 `ping/pong` 时间差、触发方、transport 错误分类，便于区分 client reset 与 server close。

## 回归脚本与报告
- 脚本：`apps/api/scripts/osac_opencode_regression.ts`
- 最新报告：
  - `apps/api/scripts/reports/osac-opencode-regression-2026-02-19T03-59-32-247Z.json`
  - `apps/api/scripts/reports/osac-opencode-regression-2026-02-19T03-49-01-116Z.json`
  - `apps/api/scripts/reports/osac-opencode-regression-2026-02-19T03-43-15-900Z.json`

## 当前状态
- API 侧已降低重连风暴与提前占位问题。
- 端到端仍未通过，阻塞在 OSAC fix8 状态机（candidate/promote 时序）需 fix9 修复。
