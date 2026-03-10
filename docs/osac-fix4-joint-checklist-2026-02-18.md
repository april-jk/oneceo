# OSAC 联合修复清单（Fix4 候选）

日期：2026-02-18  
目标：解决 sandbox 内 opencode 经 OSAC 转发链路的间歇性失败，达到可稳定回归。

## 1. 当前问题结论

P0 问题：
- WS 握手存在间歇性 `401 Unauthorized`，同一 session/endpoint/token 也会偶发失败。
- OSAC 本地代理可监听（`18080/18111` 正常）但上层仍出现 `bridge_disconnected`。
- 同一条 opencode run 会触发多路并发 `/v1/chat/completions`，易出现超时/卡死。

P1 问题：
- Provision 过程偶发超长，超过 240s（已在我方回归脚本中熔断）。

## 2. 证据与现象（本轮联调）

关键报告（apps/api）：
- `scripts/reports/osac-opencode-regression-2026-02-18T09-05-55-946Z.json`：`1/1` 通过。
- `scripts/reports/osac-opencode-regression-2026-02-18T09-14-36-403Z.json`：连续两轮 `round-exec timeout (240000ms)`，触发熔断。
- `scripts/reports/osac-opencode-regression-2026-02-18T09-19-15-150Z.json`：`provision timeout (240000ms)`。
- `scripts/reports/osac-opencode-regression-2026-02-18T09-22-20-549Z.json`：单轮失败，随后出现 `Unexpected server response: 401` 重连错误。

运行态日志特征：
- VM 内 `curl http://127.0.0.1:18111/v1/models` 有时返回 `bridge_disconnected`。
- VM 内 `osac.log` 大量出现 `read error: websocket: close 1005 (no status)`。
- API 侧一次 opencode run 常见 3 条并发 `LLM_PROXY_REQUEST`（同一时段）。

## 3. OSAC 侧待修复项（按优先级）

### P0-1 握手 401 可诊断化与一致性
- 强制在握手失败时输出结构化原因码（body + header 一致）：
  - `auth_missing`
  - `auth_format_invalid`
  - `token_mismatch`
  - `mapping_not_ready`
  - `session_not_ready`
- 日志必须带：`requestId`、`sessionId`、`endpoint`、`connId`、`tokenFingerprint`。
- 校验 `hostPort -> session` 映射唯一性，避免旧连接或旧映射污染导致偶发 401。

### P0-2 Bridge 长连接稳定性
- 服务端增加心跳与空闲保持（建议 server ping 周期 15s，空闲超时 >= 120s）。
- 对 `close 1005` 补充内部原因日志（谁主动关闭、关闭前最后一条消息类型、是否鉴权通过）。
- Bridge 断开后要明确快速失败，不允许请求黑洞等待。

### P0-3 并发请求下的代理稳定
- 对同 session 并发 `chat/completions` 增加队列/背压（至少可配置并发上限）。
- 增加阶段耗时日志：`recv -> bridge_send -> bridge_ack -> first_byte -> end/error`。
- 区分超时类型并返回明确 code：
  - `bridge_no_ack`
  - `bridge_disconnected`
  - `upstream_timeout_first_byte`
  - `upstream_timeout_stream_idle`

### P1-1 VM 内 OSAC 进程可靠启动
- 保证单实例（避免重复启动多个 osac 进程）。
- 保证重启后自动拉起，避免 session 重启后 `18111` 失效。
- 启动时打印最终生效配置摘要（脱敏），包括监听地址、token 指纹、proxy 配置。

## 4. 复现方式（建议 OSAC 团队直接执行）

1) 启动 API 单实例。  
2) 在 `apps/api` 执行：

```powershell
$env:ROUNDS='3'
$env:COMMAND_TIMEOUT_SECONDS='120'
$env:EXEC_TIMEOUT_SECONDS='150'
$env:ROUND_EXEC_TIMEOUT_MS='240000'
$env:TOTAL_BUDGET_MS='900000'
$env:MAX_CONSECUTIVE_FAILURES='2'
$env:MAX_FAILURES='2'
npx tsx scripts/osac_opencode_regression.ts
```

3) 若失败，立刻抓取：
- `scripts/reports/osac-opencode-regression-*.json`
- VM: `/opt/.altus/opencode/log/osac.log`
- API 进程日志（`OSAC_AUDIT` 与 `OSAC_RECONNECT_ERROR`）

## 5. Fix4 验收标准

必须全部满足：
- 握手压测 100 次，`401` 失败率为 0（或可归因且比例 < 1%，且必须有明确 reason code）。
- 回归脚本 10 轮：`failed=0`、`aborted=false`。
- 在 30 分钟 soak 下不出现 `bridge_disconnected` 与请求黑洞。
- `opencode run` 在 `COMMAND_TIMEOUT_SECONDS=120` 下稳定完成，不再出现大面积 `exit=124`。

## 6. 我方已完成的配套改造（便于协同）

- 新增强超时+熔断回归脚本：`apps/api/scripts/osac_opencode_regression.ts`
- 新增回归流程文档：`docs/osac-opencode-sandbox-regression-playbook.md`
- 连接管理默认用 ping 健康检查，避免误判：`apps/api/src/services/osac-connection-manager.ts`
- OSAC 连接器认证模式可配置：`apps/api/src/connectors/osac-connector.ts`

