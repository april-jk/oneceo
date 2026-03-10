# KVM WS Relay（OSAC）接口与开发要求 v1

日期：2026-02-20  
面向团队：KVM Orchestrator / 编排(API) / OSAC 联调  
目标：通过 KVM 提供 WS 中继，替代对宿主机端口映射(`iptables` DNAT)的强依赖，提升 sandbox -> OSAC 链路稳定性。

---

## 1. 背景与问题

当前链路不稳定的主因不在 OSAC，而在 KVM 宿主机端口映射链路：

1. 创建 sandbox 或创建端口映射时，后端命令报错 `COMMAND_ERROR`。  
2. 典型 stderr：
   - `Couldn't load match 'conntrack'`
   - `unknown option "--dport"`
3. 结果：`/v1/sandboxes`、`/v1/sandboxes/{session_id}/ports` 在部分环境失败，导致 OSAC 无法稳定接入。

结论：需要引入**不依赖端口映射**的接入路径，作为默认或降级通道。

---

## 2. 总体方案

新增 KVM WS Relay 通道：

`API(编排) -> KVM Orchestrator WS Relay -> Sandbox 内 OSAC WS(/ws)`

关键点：

1. 编排不再依赖 `host_port` 映射创建成功后才能连接 OSAC。  
2. Relay 直接在 KVM 服务端发起到 VM IP:OSAC_PORT 的内连。  
3. relay 仅做透明转发，不改写 OSAC 协议。  
4. 保留原端口映射方式作为可选路径（兼容回退）。

---

## 3. 需要新增的接口

## 3.1 创建 Relay Ticket（HTTP）

`POST /v1/sessions/{session_id}/relay/osac/ticket`

鉴权：

1. `Authorization: Bearer <TOKEN>`（`operator` 或 `admin`）

请求体（JSON）：

```json
{
  "target_path": "/ws",
  "target_port": 18080,
  "connect_timeout_ms": 5000,
  "idle_timeout_ms": 180000,
  "single_use": true
}
```

说明：

1. `target_path` 默认 `/ws`。  
2. `target_port` 默认 `18080`（OSAC 监听端口）。  
3. `connect_timeout_ms` 默认 `5000`，范围建议 `1000~15000`。  
4. `idle_timeout_ms` 默认 `180000`，最小 `60000`。  
5. `single_use` 默认 `true`（一票一次）。

成功返回（200）：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "session_id": "sess_xxx",
    "relay_id": "relay_xxx",
    "ticket": "tkt_xxx",
    "expires_at": "2026-02-20T01:35:20Z",
    "ws_url": "ws://192.168.10.172:8500/v1/ws/relay/osac?ticket=tkt_xxx",
    "target": {
      "vm_name": "sandbox_sess_xxx",
      "vm_ip": "192.168.122.115",
      "target_port": 18080,
      "target_path": "/ws"
    }
  },
  "error": null,
  "request_id": "uuid"
}
```

错误码（建议）：

1. `SESSION_NOT_FOUND`(404)  
2. `SESSION_VM_NOT_BOUND`(404)  
3. `SANDBOX_READY_GATE_FAILED`(409)  
4. `VM_IPV4_NOT_AVAILABLE`(409)  
5. `OSAC_NOT_READY`(409)  
6. `RATE_LIMITED`(429)  
7. `INTERNAL_ERROR`(500)

---

## 3.2 建立 Relay WS（WebSocket）

`GET /v1/ws/relay/osac?ticket=<TICKET>`

行为：

1. 服务端校验 `ticket`（有效期、session 绑定、single-use）。  
2. 校验通过后，KVM 服务端连接 `ws://<vm_ip>:<target_port><target_path>`。  
3. 成功后双向透明转发帧。  
4. 失败时返回标准 close code + 可机读错误（见错误码章节）。

WS 约束：

1. 支持 text/binary 双向透传。  
2. 不改写 payload，不注入业务字段。  
3. 支持 ping/pong 透传与保活。  
4. 连接关闭时输出统一审计字段（见日志字段章节）。

---

## 3.3 Relay 状态查询（可选但建议）

`GET /v1/sessions/{session_id}/relay/osac/state`

用途：

1. 编排排障与健康检查。  
2. 提供当前 active relay、最近错误、最后一次建立时间。

成功返回示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "session_id": "sess_xxx",
    "relay_enabled": true,
    "active": {
      "relay_id": "relay_xxx",
      "conn_id": 12,
      "lifecycle_id": 34,
      "connected_at": "2026-02-20T01:36:00Z",
      "last_rx_at": "2026-02-20T01:36:08Z",
      "last_tx_at": "2026-02-20T01:36:08Z"
    },
    "last_error": null
  },
  "error": null,
  "request_id": "uuid"
}
```

---

## 4. 协议与行为要求

## 4.1 连接模型

1. 同一 `session_id` 允许最多 2 条客户端 WS 并发（支持平滑重连）。  
2. 业务转发单活由 OSAC 自身状态机控制（KVM relay 不强行做业务单活判定）。  
3. 超出上限返回 `429 RELAY_BACKPRESSURE`。

## 4.2 超时建议

1. Relay 到 VM WS 连接超时：`5s`（上限 `15s`）。  
2. 空闲超时：默认 `180s`（不低于 `60s`）。  
3. 编排侧请求中，首 token 可能 `5~10s`，不得把 relay 超时设得比这更激进。

## 4.3 重试与退避

1. Relay 内部连接 VM 失败可重试 1 次（200ms~500ms 抖动）。  
2. 不允许无限重试。  
3. 重试耗尽后返回可机读错误 `RELAY_TARGET_UNREACHABLE`。

## 4.4 背压

1. 双向写队列必须有上限（建议 1MB~4MB）。  
2. 背压触发后优先快速失败，不允许无边界积压。  
3. 错误码：`RELAY_BACKPRESSURE`，建议 HTTP/WS 对应 429/1013。

---

## 5. 错误码与恢复动作

| error.code | HTTP/WS | retryable | nextAction | 说明 |
|---|---:|---:|---|---|
| `RELAY_TICKET_INVALID` | 401 / 1008 | false | `refresh_ticket` | ticket 非法 |
| `RELAY_TICKET_EXPIRED` | 401 / 1008 | true | `refresh_ticket` | ticket 过期 |
| `RELAY_SESSION_NOT_READY` | 409 / 1013 | true | `wait_and_retry` | session 未就绪 |
| `RELAY_VM_IP_UNAVAILABLE` | 409 / 1013 | true | `wait_and_retry` | VM 无可用 IPv4 |
| `RELAY_TARGET_UNREACHABLE` | 503 / 1013 | true | `reconnect` | 无法连接 VM 内 OSAC |
| `RELAY_BACKPRESSURE` | 429 / 1013 | true | `backoff` | 转发背压 |
| `RELAY_INTERNAL_ERROR` | 500 / 1011 | true | `reconnect` | relay 内部错误 |

---

## 6. 日志与审计要求（强制）

每条关键日志必须带：

1. `requestId`
2. `sessionId`
3. `relayId`
4. `connId`
5. `lifecycleId`
6. `vmName`
7. `vmIp`
8. `targetPort`
9. `targetPath`
10. `closeCode`
11. `closeReason`
12. `transportErrorClass`

建议事件：

1. `relay_ticket_issued`
2. `relay_ws_accept`
3. `relay_target_connect_start`
4. `relay_target_connect_ok`
5. `relay_target_connect_fail`
6. `relay_backpressure`
7. `relay_disconnect`

---

## 7. 安全要求

1. Ticket TTL 默认 30 秒，最长不超过 120 秒。  
2. Ticket 默认单次消费。  
3. Ticket 绑定 `session_id`，不可跨 session 使用。  
4. 日志只打印 ticket 指纹，不打印明文。  
5. Relay 仅允许转发到该 session 绑定 VM，不允许任意目标地址。

---

## 8. 与编排(API)对接约定

编排侧会按以下方式接入：

1. `kvm-connector` 新增：
   - `createOsacRelayTicket(sessionId, options)`
   - `getOsacRelayState(sessionId)`（可选）
2. `osac-connector/osac-client` 新增连接模式：
   - `kvm-ws-relay`（建议默认）
   - `port-mapping`（兼容保留）
3. 每次重连先申请新 ticket，再发起 WS。
4. 编排继续使用 `sessionId` 作为唯一入口参数，不在业务层直连 KVM。

---

## 9. 验收标准（建议冻结）

1. 在宿主机禁用/异常端口映射场景下，Relay 链路可用。  
2. 连续 20 轮 `GET_SESSION_LIST + LLM /v1/models + chat/completions` 不出现持续黑洞。  
3. 单次抖动后，下一次重试可在秒级恢复。  
4. 错误码与 `nextAction` 一致，可被编排自动决策。  
5. 日志可通过 `requestId + sessionId + connId + lifecycleId` 完整串联。

---

## 10. 实施优先级

P0（本轮必须）：

1. `POST /v1/sessions/{session_id}/relay/osac/ticket`  
2. `GET /v1/ws/relay/osac?ticket=...`  
3. 统一错误码与日志字段  
4. 基础限流与背压

P1（下一轮建议）：

1. `GET /v1/sessions/{session_id}/relay/osac/state`  
2. Relay 指标输出（连接数、失败率、重试耗尽）  
3. WebSocket 事件流增加 relay 事件

---

## 11. 备注

1. 本文目标是让 KVM 成为稳定“中继平面”，削弱对端口映射稳定性的依赖。  
2. 该方案与 OSAC fix10 系列兼容，不要求 OSAC 协议改造。  
3. 落地后建议先在 debug 版本进行 20 轮回归，再切 release。

