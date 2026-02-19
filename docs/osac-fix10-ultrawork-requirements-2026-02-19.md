# OSAC Fix10 UltraWork 需求与修复方案（面向弱网与多跳链路）

日期：2026-02-19  
适用范围：Sandbox VM 内 `OSAC` + 编排 API(OSAC Connector/LLM Proxy) + 上游 LLM Provider

## 0. 背景与目标

在 Fix1-Fix9 多轮迭代后，链路具备“可用基础”，但仍有以下高频不稳定：

1. `token_mismatch` 与 `mapping_stale` 交替出现，且同一 `sessionId` 可在短时间内从可连变不可连。  
2. `candidate -> active` 虽可成功，但 `bridge_no_ack / bridge_disconnected` 仍导致 `/v1/models` 或 `chat/completions` 快速失败。  
3. 弱网抖动（高 RTT、丢包、短断链）下会触发重连风暴，导致“可恢复错误”被放大为长时间不可用。  
4. 编排到上游 LLM 的超时与重试缺乏统一预算，容易出现排队等待和黑洞时延。

Fix10 的核心目标不是“再补一个点”，而是建立**端到端可恢复体系**：

- 单次抖动后可秒级恢复。  
- 失败快速显式化（Fail Fast），不黑洞等待。  
- 重试有边界（预算、熔断、幂等），不放大故障。  
- 日志/指标可直接定位“卡在哪一跳”。

## 1. 统一 SLO（Fix10 出货门槛）

### 1.1 可用性目标（P0）

1. WS 握手成功率（正常网络）：>= 99.5%。  
2. WS 握手成功率（弱网：RTT 200ms + 抖动 100ms + 丢包 3%）：>= 98%。  
3. 单次抖动后恢复时间（从首次失败到可成功 `GET_SESSION_LIST`）：P95 <= 3s，P99 <= 8s。  
4. `chat/completions` 首字节超时失败必须 <= 60s，且返回机读错误码。  
5. 不允许出现 > 10s 的无响应黑洞（无返回、无错误、无日志阶段迁移）。

### 1.2 质量目标（P1）

1. 4 小时 soak（并发会话 >= 20）内，无持续不可恢复会话。  
2. `token_mismatch` 不能形成持续风暴（同会话连续 >5 次）。  
3. `bridge_no_ack` 与 `bridge_disconnected` 可区分并可追溯到具体 conn/lifecycle。

## 2. Fix10 P0：状态机与路由一致性重构

## 2.1 会话路由硬绑定（消除“串线 token_mismatch”）

必须新增并贯穿以下字段：

- `mappingId`（session 与 hostPort 映射版本号）
- `mappingEpoch`（单调递增）
- `vmInstanceId`（VM/agent 实例标识）

要求：

1. WS 握手时必须校验 `sessionId + mappingId + tokenFingerprint` 一致性。  
2. 若命中旧映射，返回 `409 mapping_stale`，并附：
   - `X-OSAC-WS-Role`
   - `X-OSAC-WS-Remaining-Ms`
   - `X-OSAC-Mapping-Id`
   - `X-OSAC-Mapping-Epoch`
3. 编排侧收到 `mapping_stale` 后必须先刷新 mapping 再重连，不可盲重试同 endpoint。

## 2.2 Bridge 状态机升级（消除“僵 active”）

`active` 不再只看“连接存在”，必须满足“健康租约（lease）”：

- `lease` 续期条件：收到 `pong` 或收到有效业务帧（ACK/RESPONSE/CHUNK）。
- `lease` 过期后进入 `active_suspect`，允许 candidate 抢占 promote。

状态：

1. `candidate_admitted`
2. `candidate_probe_ok`
3. `promote_attempt`
4. `active_healthy`
5. `active_suspect`
6. `draining`
7. `closed`

强约束：

1. `active_suspect` 不可继续阻塞 candidate（否则会出现长期 `mapping_stale active_healthy` 假阳性）。  
2. promote 必须 CAS + epoch 原子切换。  
3. `candidate_max_age` 到期必须强回收，且输出完整上下文。

## 2.3 ACK 语义修复（消除 bridge_no_ack 黑洞）

新增 ACK SLA：

1. `LLM_PROXY_REQUEST` 发出后，ACK 目标 <= 1500ms（默认），上限 <= 5000ms。  
2. 超过 SLA 返回 `503 bridge_no_ack`（retryable=true，附 `retryAfterMs`）。  
3. ACK 失败后不允许继续占用 in-flight 槽位。  
4. 同 `requestId` 允许一次幂等重发（仅在未收到 ACK 时）。

## 3. Fix10 P0：弱网重试/超时/熔断统一策略

## 3.1 分层超时预算（必须统一）

建议默认预算（可配置）：

1. WS 握手：8s  
2. WS 获取连接等待（acquire）：300-800ms（失败即快返）  
3. Bridge ACK：1.5s（上限 5s）  
4. 上游首字节：25s  
5. 流式空闲超时：30s  
6. 全请求硬上限：60s

规则：

1. 子阶段超时必须早于总超时。  
2. 超时必须返回明确 `error.code` + `stage` + `retryable`。  
3. 不允许“无限等待重连后再继续同请求”。

## 3.2 OSAC <-> 编排（控制面）重试策略

1. 握手失败分类：
   - `token_mismatch`：仅重试 1 次（先 refresh mapping/token）
   - `mapping_stale`：等待 `remainingMs` 后重连，最多 3 次
   - `bridge_not_ready`：指数退避（200/500/1000ms）最多 3 次
2. 超过上限触发短熔断（5-15s），避免重连风暴。
3. 熔断期间对新请求快速失败，返回 `retryAfterMs`，不阻塞线程。

## 3.3 编排 -> 上游 LLM（数据面）重试策略

1. 仅在“未收到首字节”时允许重试。  
2. 可重试错误：
   - 网络错误（connect reset/timeout）
   - HTTP 429/502/503/504
3. 不可重试错误：
   - 401/403（认证问题）
   - 400/404（配置或模型错误）
4. 重试参数：
   - 次数：最多 2 次
   - 退避：250ms + jitter, 800ms + jitter
   - 必须携带相同 `requestId` / `idempotencyKey`
5. 若进入流式并已输出 token，不做自动重试，直接显式失败。

## 3.4 多线程与高效重试（你方重点诉求）

要求：

1. 编排层在 `reconnect_in_progress` 时不阻塞工作线程等待长重连；应快速返回可重试错误。  
2. opencode 侧重试应可并发排队（受 `max_inflight_per_session` 限制），而非串行等待上一条超时结束。  
3. 每会话并发上限默认 `2-4`，超过返回 `429 bridge_backpressure` + `retryAfterMs`。

## 4. Fix10 P1：可观测性与诊断闭环

## 4.1 强制日志字段（所有关键事件）

必须包含：

- `sessionId`
- `requestId`
- `connId`
- `lifecycleId`
- `mappingId`
- `mappingEpoch`
- `endpoint`
- `tokenFingerprint`
- `stage`
- `retryable`

## 4.2 新增/强化事件

1. `routing_resolved`（映射命中详情）  
2. `active_lease_expired`  
3. `promote_takeover`（candidate 抢占）  
4. `bridge_ack_timeout`  
5. `upstream_retry`（第几次、原因、耗时）  
6. `circuit_open` / `circuit_half_open` / `circuit_close`

## 4.3 Debug 接口

保留并扩展 `/debug/bridge-state`：

1. `active/candidate` 全量  
2. `leaseExpireAt`、`lastBusinessAt`  
3. `mappingId/mappingEpoch`  
4. `retryBudget`、`circuitState`  
5. 最近 N 条状态迁移事件（建议 100 条环形缓冲）

## 4.4 指标（Prometheus 或等价）

1. `osac_ws_handshake_total{result,code}`
2. `osac_promote_latency_ms`
3. `osac_bridge_ack_latency_ms`
4. `osac_bridge_no_ack_total`
5. `osac_mapping_stale_total{role}`
6. `osac_upstream_retry_total{reason,attempt}`
7. `osac_circuit_state{sessionId}`

## 5. 错误码与恢复动作（必须机读化）

每个错误返回：

- `error.code`
- `stage`
- `retryable` (bool)
- `retryAfterMs` (int)
- `nextAction` (`refresh_mapping|reconnect|backoff|fix_config|fail_fast`)

最低覆盖：

1. `token_mismatch`
2. `mapping_stale`
3. `bridge_not_ready`
4. `bridge_disconnected`
5. `bridge_no_ack`
6. `bridge_backpressure`
7. `upstream_timeout_first_byte`
8. `upstream_timeout_stream_idle`
9. `upstream_5xx`
10. `upstream_auth_error`

## 6. 回归测试矩阵（Fix10 必测）

## 6.1 功能回归

1. 20 轮建连 + `GET_SESSION_LIST`，无持续 401/409 风暴。  
2. VM 内 `curl -m 60 http://127.0.0.1:18111/v1/models`，无黑洞。  
3. `chat/completions` 流式长会话，验证 `first_byte` 与 `idle` 超时分型。

## 6.2 弱网回归（netem）

1. `delay 200ms 100ms distribution normal`  
2. `loss 3%`  
3. `loss 10% 25%`（突发）  
4. `reorder 25% 50%`  
5. 短断链 2s/5s/10s

验收：

1. 不出现持续不可恢复。  
2. 恢复时间满足 SLO。  
3. 错误码分布与日志链路一致。

## 6.3 压测/浸泡

1. 20+ 并发 session，4 小时。  
2. 每 session 持续混合请求（models + chat stream）。  
3. 统计：
   - 成功率
   - P95/P99 延迟
   - 各错误码比例
   - 熔断触发次数

## 7. 交付清单（Fix10 必须）

1. `fix10` release/debug 二进制 + SHA256 + 构建时间。  
2. 状态机时序图（candidate/active/lease/retry）。  
3. 全量配置项与默认值表。  
4. 错误码与 `nextAction` 映射表。  
5. 回归报告（JSON）+ 关键日志切片（可对齐 requestId）。

## 8. 实施优先级与节奏建议

### P0（先做，阻塞解除）

1. 路由硬绑定（mappingId/mappingEpoch）  
2. active lease + suspect 抢占  
3. ACK SLA 与幂等重发  
4. 统一超时预算 + 快速失败 + retry hint

### P1（随后做，稳定性提升）

1. 熔断器 + retry budget  
2. 观测面增强（指标/事件/调试接口）  
3. 弱网专项压测与自动化回归

## 9. 与 OSAC 团队的明确要求（可直接下发）

1. Fix10 不接受“仅调参数”的修复，必须包含状态机与恢复机制改造。  
2. 所有可恢复错误必须返回机读恢复指令（`retryable/retryAfterMs/nextAction`）。  
3. 任何重试都必须有预算、有退避、有熔断；禁止无边界重试。  
4. 交付前必须完成弱网矩阵回归并提交原始结果。  
5. 出货门槛以本文 SLO 与测试矩阵为准，未达标不进入下一轮。

