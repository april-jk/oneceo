# OSAC Debug 模式请求单（Fix7 联调）

日期：2026-02-19  
目标：快速定位 `token_mismatch` / `409 mapping_stale` / 端口抖动来源，缩短 Fix8 闭环时间。

---

## 1. 当前现象（已复现）

在 `v1.1.2.fix7` 下，仍未跑通编排回归：
- 回归报告：
  - `apps/api/scripts/reports/osac-opencode-regression-2026-02-19T00-48-01-187Z.json`
  - `apps/api/scripts/reports/osac-opencode-regression-2026-02-19T00-53-46-684Z.json`
  - `apps/api/scripts/reports/osac-opencode-regression-2026-02-19T01-55-25-695Z.json`
- 失败主因：
  - `OSAC WebSocket 握手失败: status=401 code=token_mismatch`
  - 间歇 `status=409`（`mapping_stale`）
- 关键补充现象：
  - 同一 `hostPort` 曾出现 `ECONNREFUSED` 与 `401 token_mismatch` 交替（疑似映射抖动/端口路由漂移）。

---

## 2. 已排除项

1. Fix7 二进制完整性正常：ELF + SHA256 一致。  
2. VM 内 `/opt/.altus/opencode/osac` 的 token 与 DB 元数据一致。  
3. OSAC 启动日志中的 `tokenFingerprint` 与 DB token 指纹一致。  
4. `probe_ok -> promote_success` 在部分会话中可见，说明状态机并非完全失效。

---

## 3. 请求 OSAC 团队开启 Debug 模式（必要字段）

请提供一个可开关的 Debug 模式，并确保以下日志字段可用：
debug模式只有在编译的时候可以指定开启或关闭，以编译出debug模式或release模式的osac程序
debug模式的二进制文件需要在正常文件名后面增加"_debug"的标识

## 3.1 WS 握手判定日志（每次握手必打）
- `requestId`
- `remoteAddr`
- `endpoint`
- `query.sessionId`
- `query.authTokenExists`（布尔）
- `authHeaderExists`（布尔）
- `providedTokenFingerprint`
- `expectedTokenFingerprint`
- `decision`（allow/reject）
- `rejectCode`（如 `token_mismatch` / `mapping_stale`）
- `mappedSessionId`
- `mappedConnId`
- `mappedLifecycleId`
- `activeSessionId`
- `activeConnId`
- `candidateSessionId`
- `candidateConnId`

## 3.2 WS 状态迁移日志（必须可串联）
- `candidate_admitted`
- `probe_ok`
- `promote_attempt`
- `promote_success`
- `promote_blocked`
- `candidate_expired`
- `disconnect`

并附带：
- `promoteBlockedReason`
- `promoteAttemptCount`
- `pongOk`
- `lastPongAt`
- `epoch`

## 3.3 /debug/bridge-state（快照）
需包含：
- `active` / `candidate` 全量
- `promoteBlockedReason`
- `promoteAttemptCount`
- `pongOk`
- `lastPingAt` / `lastPongAt`
- `switchMode`
- `epoch`

---

## 4. 联调需要的最小附加输出

1. 一份“握手成功样本”原始日志（从 connect 到 promote_success）。  
2. 一份“token_mismatch 样本”原始日志（含 expected/provided 指纹）。  
3. 一份“409 mapping_stale 样本”原始日志（含 active/candidate 上下文）。  
4. 如存在：同一 hostPort 的路由/映射变更日志（old -> new）。

---

## 5. 复现实例（本轮）

- 示例 session：`sess_76c7f7506d4643ec`
- metadata：
  - `osacEndpoint=ws://192.168.10.172:20119/ws`
  - `osacAuthToken=a637aa9c98d2938613ab37c07c4361dee25e48ef1983100d`
- VM `/etc/environment`：
  - `OSAC_AUTH_TOKEN='a637aa9c98d2938613ab37c07c4361dee25e48ef1983100d'`
- OSAC 启动 token 指纹：
  - `6ae07dd23380`（与 DB token 指纹一致）

---

## 6. 目标

请以“可直接定位 `token_mismatch` 根因”为目标提供 Debug 输出：
- 能明确判断是
  1) token 比对逻辑异常，
  2) hostPort 映射漂移到其他实例，
  3) 或连接并未落到预期 VM OSAC。

