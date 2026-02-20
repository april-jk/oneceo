# 协调工单：KVM WS Relay 联调阻塞与修复方案（2026-02-20）

日期：2026-02-20  
面向：KVM 团队 / 编排(API)团队 / OSAC 团队  
目标：完成“编排通过 KVM WS Relay 稳定连接 sandbox 内 OSAC 与其他端口”的可用闭环。

---

## 1. 当前结论（先看）

1. **KVM 通用 TCP-over-WS relay 能力已上线并可用**（KVM `v1.3.3`）。  
2. **编排侧已完成 relay 接入**（默认可切到 `OSAC_CONNECTION_MODE=kvm-tcp-relay`）。  
3. 当前仍阻塞在 **KVM 创建 sandbox 与 VM 就绪收敛**，不是 relay 协议本身问题。  

---

## 2. 已验证通过项

1. KVM 健康版本：`v1.3.3`。  
2. ticket 接口可用：`POST /v1/sessions/{session_id}/relay/tcp/ticket`。  
3. relay 数据面可用：`GET /v1/ws/relay/tcp?ticket=...` + `Sec-WebSocket-Protocol: kvm.tcp.v1`。  
4. 实测成功样例：通过 relay 访问 VM 内 `19090`，返回 `HTTP/1.0 200 OK`。  

---

## 3. 当前阻塞问题（含证据）

## 3.1 `/v1/sandboxes` 创建仍失败（P0）

现象：编排 `provision` 在 createSandbox 阶段失败。  
错误：`400 command execution failed`。  
最近样本 requestId：`07f0dd14-003e-4f41-9749-0dca08809ab4`（2026-02-20）。  

历史同类 stderr（已抓到）：

1. `iptables ... Couldn't load match 'conntrack'`
2. `iptables ... unknown option "--dport"`

判断：KVM sandbox 创建流程中仍有依赖宿主机 iptables 规则的路径，在当前宿主机环境不稳定/不兼容。

---

## 3.2 auto_allocate 可能分配到“不就绪 VM”（P0）

现象：`bindSessionVm(auto_allocate)` 后，分配的 VM 可能：

1. 未 running
2. 无 IPv4
3. QGA 未连接

导致后续：

1. relay ticket 创建返回 `VM has no available IPv4 address`（409）
2. guest exec 返回 `QEMU guest agent is not connected` 或超时

判断：当前 creating/ready 状态与真实 VM 就绪状态仍不一致，自动分配未严格按 ready gate 过滤。

---

## 3.3 Relay 目标不可达时错误语义需稳定（P1）

现象：ticket 成功，但 connect 返回 503（目标端口不可达）。  
这本身合理，但需要保证错误码与日志字段稳定，便于编排快速重试或切换目标。

---

## 4. 编排侧已完成改造（供知晓）

已提交：

1. `8407267` `feat(api): support kvm tcp-over-ws relay for osac transport`
2. `38a273e` `fix(api): avoid duplex closed property clash in relay socket`

主要变更：

1. `kvm-orchestrator-client` 增加 relay ticket/state 接口调用。  
2. `osac-client` 增加 TCP-over-WS 隧道 socket（在 relay 内发起 inner OSAC WS 握手）。  
3. `osac-connector` 增加 `kvm-tcp-relay` 模式与自动 ticket 申请。  

---

## 5. 需要 KVM 团队修改项（明确工单）

## P0-1：彻底解除 sandbox 创建对 iptables DNAT 的硬依赖

要求：

1. `/v1/sandboxes` 主流程不得因为 host 端口映射规则失败而整体失败。  
2. 在 relay 模式下，端口映射应变为可选能力，不得阻塞 sandbox 创建成功。  
3. 如仍需规则操作，需做环境探测（nf_tables/legacy/模块存在性），失败时降级而非硬失败。

交付口径：

1. 创建 sandbox 成功条件：VM 创建 + 绑定 + 启动流程成功。  
2. port-mapping 失败应独立体现在 `ready_gate/last_error`，不影响 session 存活。

---

## P0-2：修复 auto_allocate 的 ready gate 选择逻辑

要求：

1. auto_allocate 必须优先选择 `running + qga_connected + ipv4_available` 的 VM。  
2. 若无可用 VM，需明确返回可重试错误（而不是绑定到半死状态 VM）。  
3. `lifecycle_state/lifecycle_stage/ready_gate` 必须与真实状态一致。

建议 ready gate 最小字段：

1. `vm_running`
2. `qga_connected`
3. `ipv4_available`
4. `osac_pid_ready`（若目标是 OSAC）

---

## P0-3：relay 错误码与日志字段对齐

要求：

1. 失败码必须稳定返回：`RELAY_VM_IP_UNAVAILABLE`、`RELAY_TARGET_UNREACHABLE` 等。  
2. 关键日志统一字段：`requestId/sessionId/relayId/connId/lifecycleId/vmName/vmIp/targetPort/closeCode/closeReason`。  
3. 失败样本可直接按 requestId 串联。

---

## 6. 需要 OSAC 团队配合项

1. 无需协议变更。  
2. 保持 `/ws` 握手兼容（header/query token）并输出清晰 `X-OSAC-Auth-Code`。  
3. 在 relay 场景继续保留 fix10p5 debug 字段，便于三方判责。

---

## 7. 联调验收标准（冻结）

1. 连续 20 次 `provision` 不出现 createSandbox 阶段硬失败。  
2. 连续 20 次 relay 连接到 OSAC 端口可建立并返回 `GET_SESSION_LIST`。  
3. 连续 20 次 `curl /v1/models`（sandbox 内走 OSAC 本地代理）成功率 >= 95%。  
4. 若失败，错误必须是机读且可恢复，不得出现无上下文黑洞超时。  

---

## 8. 复现脚本建议（KVM 团队本地）

1. 先测 relay 基础：target_port=22，读取 SSH banner。  
2. 再测业务端口：target_port=18080，验证 WS 握手状态码。  
3. 再测端到端：创建 sandbox -> 启动 OSAC -> relay 访问 `/ws` -> `GET_SESSION_LIST`。  

---

## 9. 建议排期

1. P0 修复与自测：0.5 天  
2. 三方联调：0.5 天  
3. 共计：1 天给 fix 版本与交付说明

