# OSAC Fix6 联调交付文档（编排/API -> OSAC）

日期：2026-02-19  
目标：基于 Fix5 实测结果，输出 Fix6 修复清单与验收口径

---

## 1. 本轮结论

Fix5 二进制已确认是正确 Linux ELF，且可在 VM 内启动并监听 `127.0.0.1:18111`，但链路仍不稳定，当前不可判定为可用版本。  
核心失败模式：`bridge_not_ready` 长时间存在，随后连接被 `1008/1005` 关闭，最终退化为 `bridge_disconnected`。

---

## 2. 本次测试基线

### 2.1 二进制核验
- 路径：`others/osac-linux/osac-linux-amd64_v1.1.2.fix5`
- SHA256：`81e1eb393ff3c3bd308ba1dc429ef45b5a7a004fa2acc52be77970e7c92f6706`
- 文件头：`7F 45 4C 46`（ELF）

### 2.2 回归脚本
- 脚本：`apps/api/scripts/osac_opencode_regression.ts`
- 关键参数：1 分钟超时、熔断（连续失败 2 次即停）
- 模型：`hone/claude-haiku-4-5-20251001`

### 2.3 报告文件
- `apps/api/scripts/reports/osac-opencode-regression-2026-02-18T22-22-56-384Z.json`
- `apps/api/scripts/reports/osac-opencode-regression-2026-02-18T22-27-16-694Z.json`
- `apps/api/scripts/reports/osac-opencode-regression-2026-02-18T22-33-00-343Z.json`

结果：均失败（2/2 轮 `exit=124`）。

---

## 3. 关键现场证据

### 3.1 VM 内 OSAC 进程与监听正常
- 会话示例：`sess_0c89b3bf95574a0b` / `sess_033782c6aa924229` / `sess_5924d26623ba4900`
- 进程：`/opt/.altus/opencode/osac` 存在
- 端口：`127.0.0.1:18111` 在监听
- VM 内 hash：`81e1eb393ff3c3bd308ba1dc429ef45b5a7a004fa2acc52be77970e7c92f6706`

### 3.2 业务请求失败模式
- VM 内 `curl http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"` 返回：
  - `bridge_not_ready`（早期）
  - `bridge_disconnected`（后期）

### 3.3 OSAC 日志模式
典型序列：
1. `ws connected ... connId=... lifecycleId=...`
2. 大量 `llmproxy ... code=bridge_not_ready`
3. `ws read error ... close 1008 (policy violation): bridge_not_ready` 或 `close 1005`
4. 后续 `llmproxy ... code=bridge_disconnected`

补充观测：
- 出现 `candidate rejected ... code=mapping_stale reason=candidate_exists`
- 仍有重复日志（同一行双份）
- 仍出现不可定位上下文：
  - `sessionId=unknown endpoint=unknown connId=unknown`

---

## 4. 与 Fix5 目标的差异

### 4.1 已达到
- 二进制可执行性正确（ELF）
- 增加了 `wsSwitchMode=conservative`、`lifecycleId` 等字段
- 看到 `bridge_not_ready`、`mapping_stale` 等新错误码

### 4.2 未达到
1. 抖动后秒级恢复未达标（持续 `bridge_not_ready` / `bridge_disconnected`）  
2. 仍会进入连续失败与超时（opencode `exit=124`）  
3. 关键日志上下文未完全闭合（`unknown` 字段仍出现）  
4. 重复日志仍存在  

---

## 5. 根因判断（供 Fix6 直接落地）

### P0-1 promote 卡滞/判定不闭合
现象：WS 已连接并有 pong，但仍长期 `bridge_not_ready`。  
判断：candidate->active promote 的就绪条件与状态转移存在卡滞或事件竞争。

### P0-2 candidate 生命周期清理不完整
现象：`candidate_exists` 导致新连接被拒，随后 active 又掉线。  
判断：candidate 过期/失败后的清理与回收不彻底，导致 stale candidate 占位。

### P0-3 `bridge_not_ready` 期间断链策略过于激进
现象：短窗口内直接 `1008 bridge_not_ready`/`1005` 断开，反复重连。  
判断：在未 promote 时过早关闭连接，扩大了不可用窗口。

### P1-1 观测与归因还不完整
现象：`sessionId=unknown/connId=unknown`、重复日志。  
判断：状态机各分支日志上下文传递不一致，且多路径重复落盘。

---

## 6. Fix6 修复清单（建议按优先级）

## P0（必须）
1. **修复 promote 完成条件**
- 当控制面探测（`GET_SESSION_LIST(maxCount=1, format=json)`）成功后，必须在单次事务中完成 promote。
- 给出明确状态转移日志：`candidate_admitted -> probe_ok -> promote_success`。

2. **修复 candidate 占位与超时回收**
- candidate 失败/超时/断开后立即释放占位，避免 `candidate_exists` 长时间阻塞。
- 加强 `candidate_max_age` 到期处理日志。

3. **调整 not_ready 期间连接策略**
- not_ready 窗口允许短暂重试，不要立即以 `1008` 断链终止整个桥接。
- 若需要拒绝请求，请返回明确 `503 bridge_not_ready`，但保留桥接连接继续完成 promote。

4. **修复上下文字段缺失**
- 任何 `bridge_disconnected`/`bridge_not_ready`/`mapping_stale` 日志必须带：
  - `sessionId`
  - `connId`
  - `lifecycleId`
  - `endpoint`
  - `requestId`（若有请求）

## P1（应修）
1. **去重日志**
- 同一事件只记录一次，避免双份重复。

2. **状态快照接口可核对**
- `/debug/bridge-state` 输出 active/candidate 细节，确保与日志可一一对应。

3. **错误码与状态码一致性**
- `llmproxy` 方法日志中 `status=0` 需改为真实 HTTP 状态（如 503），方便统计分析。

---

## 7. 建议 OSAC 返回的最小补充材料（Fix6 前）

1. 一份 `candidate -> active` 状态机时序图（含失败分支）。  
2. `/debug/bridge-state` 示例（active/candidate/counters）。  
3. 2 份原始日志样本：
- 一份 promote 成功闭环
- 一份 promote 失败后回收闭环  
4. 新增/变更环境变量及默认值。

---

## 8. Fix6 联调验收标准（冻结）

1. 20 轮回归无“持续不可恢复”卡死。  
2. 抖动发生后下一次重试应秒级恢复。  
3. 不再出现连续 `bridge_not_ready` 后直接崩成 `bridge_disconnected` 的长窗口失败。  
4. 日志可完整定位（不出现 `unknown` 关键字段）。  
5. 不再出现重复日志。  

---

## 9. 复现命令（供 OSAC 团队复核）

在 `apps/api` 下：

```powershell
$env:OSAC_BINARY_PATH='../../others/osac-linux/osac-linux-amd64_v1.1.2.fix5'
$env:WS_PROBE_MODE='request'
$env:ROUNDS='2'
$env:COMMAND_TIMEOUT_SECONDS='45'
$env:EXEC_TIMEOUT_SECONDS='70'
$env:ROUND_EXEC_TIMEOUT_MS='90000'
$env:MAX_CONSECUTIVE_FAILURES='2'
$env:MAX_FAILURES='2'
pnpm exec tsx scripts/osac_opencode_regression.ts
```

失败后可在对应 session 内检查：

```bash
curl -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"
tail -n 260 /opt/.altus/opencode/log/osac.log
```

