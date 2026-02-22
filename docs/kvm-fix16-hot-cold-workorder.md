# KVM 工单：Fix16 热/冷启动并行修复（默认热启动）

- 工单日期：2026-02-20
- 对接系统：oneceo `apps/api` + KVM Orchestrator
- 当前 KVM 版本：`1.3.3fix15`
- 目标版本：`1.3.3fix16`

## 1. 目标（必须）
1. 同时保留两种启动方式：
- 热启动：`/v1/pool/sandboxes/claim`
- 冷启动：`/v1/sandboxes`（或现有冷启动链路）
2. 默认策略：优先热启动。
3. 热启动不可用时，必须可快速回退冷启动，不能长时间挂起。

## 2. 现状问题（已复现）

### P0-1 claim 未严格遵守 timeout_ms
现象：
- `timeout_ms=0`，实际约 15~16 秒才返回。
- `timeout_ms=8000`，实际也约 15 秒才返回。
- 返回码多为 `409 POOL_EMPTY_TEMPORARY`。

已复现样本（2026-02-20）：
- `elapsedMs=15943`，`timeout_ms=0`
- `elapsedMs=15062`，`timeout_ms=8000`

结论：服务端实际等待时间与请求参数不一致，违反接口契约。

### P0-2 Pool 无 ready 成员，creating 大量超时失败
现象：
- `/v1/pool/sandboxes/status` 长时间 `ready=0`。
- 成员持续从 `creating` 转 `failed`。
- `last_error` 统一为：
  - `code=POOL_READY_GATE_FAILED`
  - `reason_code=CREATING_TTL_EXCEEDED`
  - `failed_stage=creating`

结论：pool refill 与 ready gate 收敛失败，热启动不可用。

### P0-3 429 限流影响主链路（热/冷都被阻断）
现象：
- `provision` 流程多次返回 `Rate limit exceeded`。
- 关闭热启动后（仅冷启动）仍出现 429。

结论：当前限流策略影响基础编排链路可用性。

### 已确认修复有效点（保留）
- `pool ensure` 已改为异步快速返回（实测十几毫秒）。该行为正确，请保留。

## 3. Fix16 必改项

### P0-1 修复 claim 超时语义（强约束）
要求：
1. `timeout_ms <= 0`：立即返回（建议 <= 200ms），不得等待。
2. `timeout_ms > 0`：服务端等待上限必须严格等于该值（允许少量系统误差）。
3. 返回体增加可机读诊断字段：
- `effective_timeout_ms`
- `waited_ms`
- `ready_count_at_start`
- `ready_count_at_end`

建议错误码：
- 参数无效：`POOL_CLAIM_TIMEOUT_INVALID`
- 无可用 ready：`POOL_EMPTY_TEMPORARY`

### P0-2 修复 pool 收敛（creating -> ready）
要求：
1. 解决 `CREATING_TTL_EXCEEDED` 持续堆积。
2. pool 后台补池必须最终收敛到 `ready >= target_size`（允许短暂波动）。
3. 失败成员必须及时替换，不能卡死在失败堆积。
4. ready gate 分阶段输出明确原因（至少）：
- `vm_starting_timeout`
- `guest_agent_not_ready`
- `osac_not_listening`
- `relay_probe_failed`

### P0-3 调整限流，不得阻断编排核心链路
要求：
1. 对内部编排 token 或内网来源使用独立限流桶。
2. 将 `/v1/pool/*` 与 `/v1/sandboxes*` 分桶计数，避免互相误伤。
3. 命中限流时返回：
- `retry_after_ms`
- `bucket`
- `reason_code`

### P1-1 热/冷并行策略固定
要求：
1. 保留并稳定支持：热启动与冷启动。
2. 默认策略：热启动优先。
3. 当热启动不可用时，快速返回可重试错误，编排层可立即回退冷启动，不等待长超时。

## 4. 接口契约（请冻结）

### 4.1 热启动 claim
`POST /v1/pool/sandboxes/claim`

输入：
```json
{
  "purpose": "osac",
  "timeout_ms": 8000
}
```

失败返回（示例）：
```json
{
  "code": "POOL_EMPTY_TEMPORARY",
  "error": {
    "details": {
      "retryable": true,
      "retry_after_ms": 1000,
      "effective_timeout_ms": 8000,
      "waited_ms": 7998
    }
  }
}
```

### 4.2 冷启动
保持现有 `/v1/sandboxes` 能力，确保在热启动失败后可独立成功。

### 4.3 ensure
`POST /v1/pool/sandboxes/ensure` 必须异步快速返回（当前行为正确）。

## 5. 验收标准（必须全部通过）

1. claim 超时语义
- `timeout_ms=0`：`<= 300ms` 返回。
- `timeout_ms=8000`：`7.5s ~ 8.5s` 返回。

2. pool 收敛
- 启动后 3 分钟内，`ready >= 3`；5 分钟内，`ready >= target_size(5)`。
- 不再持续出现 `CREATING_TTL_EXCEEDED` 堆积。

3. 热启动可用性
- 连续 20 轮：`claim -> relay ticket(18080) -> release` 成功率 >= 95%。

4. 冷启动可用性
- 连续 10 轮：冷启动创建与回收成功率 >= 95%。

5. 混合模式
- 默认热启动 + 冷启动回退场景下，单请求不得长时间黑洞等待（上限由 timeout_ms 决定）。

6. 限流
- 正常编排流量下不出现误伤性 429；命中 429 时必须带 `retry_after_ms` 与分桶信息。

## 6. 交付要求
1. 二进制/服务版本：`1.3.3fix16`
2. 提交号（commit hash）
3. 变更清单（按 P0/P1）
4. 20 轮回归报告（含失败样本 request_id）
5. 关键日志片段（claim/ready_gate/refill/rate_limit）

## 7. 编排侧配合说明
- 编排将继续保持：默认热启动，失败快速回退冷启动。
- 当前编排侧已做超时熔断保护（避免 pool claim 长时间阻塞）。
