# OSAC + OpenCode Sandbox 回归与排障固化（2026-02-18）

## 目标
确保 OpenCode 在 sandbox 内通过 OSAC 本地转发（`127.0.0.1:18111`）调用 LLM 正常可用，并形成可复用的回归流程。

## 标准回归入口
在 `apps/api` 目录执行：

```bash
npx tsx scripts/osac_opencode_regression.ts
```

可选环境变量（默认值在脚本内）：
- `SID`：指定已有 session；不传则自动新建 sandbox。
- `ROUNDS`：回归轮数（默认 `10`）。
- `COMMAND_TIMEOUT_SECONDS`：单次 opencode 命令超时（默认 `60`）。
- `EXEC_TIMEOUT_SECONDS`：KVM exec 超时（默认 `90`）。
- `RESTART_ON_GA_ERROR`：遇到 guest-agent 错误时是否自动重启恢复（默认 `true`）。
- `TOTAL_BUDGET_MS`：整批回归总预算（默认 `1800000`，即 30 分钟）。
- `MAX_CONSECUTIVE_FAILURES`：连续失败熔断阈值（默认 `3`）。
- `MAX_FAILURES`：总失败熔断阈值（默认 `rounds*0.5` 向上取整）。
- `PROVISION_STAGE_TIMEOUT_MS`：provision 阶段超时（默认 `180000`）。
- `READY_STAGE_TIMEOUT_MS`：sandbox ready 阶段超时（默认 `180000`）。
- `WS_STAGE_TIMEOUT_MS`：WS 探活阶段超时（默认 `90000`）。
- `WS_PROBE_MODE`：WS 探活模式（默认 `ping`，可选 `request`）。
- `WS_PING_TIMEOUT_MS`：`WS_PROBE_MODE=ping` 时单次 ping 超时（默认 `5000`）。
- `RECOVER_STAGE_TIMEOUT_MS`：guest-agent 恢复阶段超时（默认 `180000`）。
- `ROUND_EXEC_TIMEOUT_MS`：单轮执行硬超时（默认 `max((EXEC_TIMEOUT_SECONDS+30)s,120s)`）。

输出：
- 控制台逐轮 JSON 结果。
- 报告文件：`apps/api/scripts/reports/osac-opencode-regression-*.json`。

## 固化流程（必须按顺序）
1. 确认 API 在线：`GET /health`。
2. 进入回归脚本：优先“新建 sandbox + 测试”，避免沿用长时间运行旧 session。
3. 回归前强制检查：
- sandbox 状态必须是 `running`。
- 端口映射必须 `vmPortReady=true` 且 `hostPortReady=true`。
4. 先做 WS 探活：默认使用 `ping`，若环境需要协议级验证再切换 `WS_PROBE_MODE=request`。
5. 在执行轮次前，必须建立并保持 session 的 persistent bridge（`ensurePersistent` 成功）。
6. 逐轮执行 opencode：
- 命令使用绝对路径 `/opt/.altus/opencode/opencode`。
- 外层使用 `timeout`，单次最长 60s。
7. 每轮执行后判断熔断条件：
- 连续失败达到阈值，立即停止本批测试并输出 `abortReason`。
- 总失败达到阈值，立即停止本批测试并输出 `abortReason`。
8. 每个阶段必须受超时保护（provision/ready/ws/bridge/exec/recover），任何阶段超时都要快速失败，禁止无上限等待。
9. 出现 guest-agent 异常时：
- 自动执行 `restartSandbox`。
- 等待 sandbox/port mapping ready 后重试当前轮次。

## 本次已确认的失败模式与处理

### 1) Sandbox 退化为 `shut off`
表现：
- `getSandbox` 返回 `state: "shut off"`。
- `listSandboxPorts` 显示 `vmPortReady=false`、`hostPortReady=false`。
- `execSession` 无法稳定执行。

处理：
- 调用 `restartSandbox(sessionId, { graceful:false, wait:true })`。
- 轮询 `getSandbox + listSandboxPorts(refresh+verify)`，直到 ready。

### 2) Guest agent 不可用
表现：
- job 错误包含：`Guest agent is not responding` / `QEMU guest agent is not available`。
- `execSession` 返回 `status=failed`，stdout/stderr 可能为空。

处理：
- 重启 sandbox。
- 等待 ready 后重试 exec。
- 若重复出现，放弃当前 session，直接新建 sandbox。

### 3) KVM 暂时不可用或超时
表现：
- `KVM 服务暂时不可用`。
- `KVM 服务请求超时`（504）。

处理：
- 减少单批轮数（例如 5 轮一批）。
- 批间 sleep 1~3 秒并重试。
- 避免单次超长/超大命令；优先逐轮小命令。

### 4) OSAC 链路 ACK/桥接异常（历史问题）
表现（看 VM 内 `/opt/.altus/opencode/log/osac.log`）：
- `timeout_ack` / `bridge_no_ack`。
- `bridge_disconnected`。

处理：
- 优先确认编排侧 ACK 是否及时回包。
- 若频发，提交 OSAC/编排联调日志（requestId + stage）定位。

## 验收标准
- 至少一轮完整回归通过（建议 `ROUNDS>=10`）。
- 无连续失败；若出现失败，可通过“自动恢复或新建 sandbox”恢复并继续通过。
- 报告文件中 `aborted=false` 且 `failed=0` 才视为该轮验收通过。

## 备注
- 旧 session 长时间压测后更容易进入非 ready 状态，建议每次回归优先新建 sandbox。
- 回归要点不是“单次成功”，而是“失败可快速归因 + 自动恢复 + 稳定复测”。
