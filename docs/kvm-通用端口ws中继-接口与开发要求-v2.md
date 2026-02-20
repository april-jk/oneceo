# KVM 通用端口 WS 中继接口与开发要求 v2

日期：2026-02-20  
面向团队：KVM Orchestrator / 编排(API)  
状态：用于替代不稳定的 `iptables` 端口转发链路（hostPort DNAT）

> 本文是对 `docs/kvm-ws-relay-osac-接口与开发要求-v1.md` 的修正与扩展。  
> v2 的目标不是“只转发 OSAC 的 WS”，而是“通过 WS 中继打通 sandbox 任意目标 TCP 端口”。

---

## 1. 目标（修正版）

KVM 需要提供一个**通用端口中继能力**：

1. 编排服务不再依赖 `create port mapping + iptables`。  
2. 编排可通过 KVM 的 WS 通道，连接到 sandbox VM 内任意目标端口（如 `18080`、`18111`、`22`、`3389` 等）。  
3. OSAC 端口(`18080`)只是一个使用场景，不是唯一场景。  

核心模式：`TCP over WebSocket`（L4 透明字节流中继）。

---

## 2. 架构

链路：

`API -> KVM(WS Relay) -> VM_IP:TARGET_PORT`

说明：

1. KVM 服务端在握手通过后，主动拨号 VM 内 `target_port`。  
2. WebSocket 二进制帧承载 TCP 字节流，双向透传。  
3. 不再依赖宿主机 DNAT/PREROUTING/FORWARD 规则。  

---

## 3. 新增接口（P0 必做）

## 3.1 创建中继票据（ticket）

`POST /v1/sessions/{session_id}/relay/tcp/ticket`

鉴权：

1. `Authorization: Bearer <TOKEN>`（`operator/admin`）。

请求体：

```json
{
  "target_port": 18080,
  "target_host": "vm", 
  "connect_timeout_ms": 5000,
  "idle_timeout_ms": 180000,
  "ticket_ttl_ms": 30000,
  "single_use": true
}
```

字段约定：

1. `target_host` 先只支持 `vm`（即当前 session 绑定 VM 的主 IP）。  
2. `target_port` 必填。  
3. `ticket_ttl_ms` 建议范围 `5000~120000`。  
4. `single_use` 默认 `true`。  

成功响应（200）：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "session_id": "sess_xxx",
    "relay_id": "relay_xxx",
    "ticket": "tkt_xxx",
    "expires_at": "2026-02-20T02:00:00Z",
    "ws_url": "ws://192.168.10.172:8500/v1/ws/relay/tcp?ticket=tkt_xxx",
    "subprotocol": "kvm.tcp.v1",
    "target": {
      "vm_name": "sandbox_sess_xxx",
      "vm_ip": "192.168.122.115",
      "target_port": 18080
    }
  },
  "error": null,
  "request_id": "uuid"
}
```

---

## 3.2 建立 TCP over WS 数据通道

`GET /v1/ws/relay/tcp?ticket=<ticket>`

要求：

1. 客户端必须带 `Sec-WebSocket-Protocol: kvm.tcp.v1`。  
2. 仅允许 binary frame；text frame 直接关闭并给 `1003`。  
3. 每个 WS 连接只绑定一个目标 TCP 连接。  

转发规则：

1. `client WS binary -> target TCP write`。  
2. `target TCP read -> client WS binary`。  
3. 任一侧关闭，另一侧有序关闭。  

关闭语义建议：

1. target 连接失败：HTTP 503（upgrade 前失败）+ `RELAY_TARGET_UNREACHABLE`。  
2. 运行中 target 断开：WS close `1011` + reason `RELAY_TARGET_CLOSED`。  
3. 空闲超时：WS close `1001` + reason `RELAY_IDLE_TIMEOUT`。  
4. 背压触发：WS close `1013` + reason `RELAY_BACKPRESSURE`。  

---

## 3.3 Relay 状态查询（建议 P1）

`GET /v1/sessions/{session_id}/relay/tcp/state`

返回：

1. active relay 数量  
2. 最近错误  
3. 连接计数与关闭原因分布  

---

## 4. 可选接口（兼容已有 OSAC WS 客户端）

如果希望编排无侵入复用现有 WS 客户端，可补一个“WS 反代模式”：

`POST /v1/sessions/{session_id}/relay/ws/ticket`

`GET /v1/ws/relay/ws?ticket=...`

该模式用于“目标端口本身是 WS 协议”的场景（如 OSAC `/ws`）。  
但它不能覆盖所有 TCP 协议，所以**主能力仍应是 3.x 的 TCP over WS**。

---

## 5. 错误码（必须机读）

| code | HTTP/WS | retryable | nextAction | 说明 |
|---|---:|---:|---|---|
| `RELAY_SESSION_NOT_FOUND` | 404 | false | `fix_session` | session 不存在 |
| `RELAY_VM_NOT_BOUND` | 404 | false | `fix_session` | 未绑定 VM |
| `RELAY_VM_NOT_RUNNING` | 409 | true | `start_vm` | VM 未运行 |
| `RELAY_VM_IP_UNAVAILABLE` | 409 | true | `wait_and_retry` | VM 没有可用 IPv4 |
| `RELAY_TARGET_UNREACHABLE` | 503 | true | `reconnect` | 无法连接目标端口 |
| `RELAY_TICKET_INVALID` | 401 | false | `refresh_ticket` | ticket 非法 |
| `RELAY_TICKET_EXPIRED` | 401 | true | `refresh_ticket` | ticket 过期 |
| `RELAY_BACKPRESSURE` | 429/1013 | true | `backoff` | 背压 |
| `RELAY_INTERNAL_ERROR` | 500/1011 | true | `reconnect` | 内部错误 |

---

## 6. 超时、重试、并发（建议默认值）

1. 连接目标端口超时：`5s`（上限 `15s`）。  
2. 空闲超时：`180s`（不低于 `60s`）。  
3. relay 内部拨号重试：最多 `1` 次，退避 `200~500ms`。  
4. 每 session 默认并发 relay 数：`8`（可配置）。  
5. 全局并发上限：必须有硬上限（防止雪崩）。

---

## 7. 背压与内存保护（强制）

1. 每连接双向缓冲区必须有上限（建议 `1MB~4MB`）。  
2. 触发背压时不能无限排队，必须失败返回 `RELAY_BACKPRESSURE`。  
3. 必须记录背压触发日志（含 session/conn/lifecycle）。

---

## 8. 日志字段（强制）

每条关键日志最少包含：

1. `requestId`
2. `sessionId`
3. `relayId`
4. `connId`
5. `lifecycleId`
6. `vmName`
7. `vmIp`
8. `targetPort`
9. `event`
10. `closeCode`
11. `closeReason`
12. `transportErrorClass`

建议事件：

1. `relay_ticket_issued`
2. `relay_ws_accept`
3. `relay_target_connect_start`
4. `relay_target_connect_ok`
5. `relay_target_connect_fail`
6. `relay_data_backpressure`
7. `relay_closed`

---

## 9. 安全约束

1. ticket 必须绑定：`session_id + target_port + mode`。  
2. ticket 默认单次消费。  
3. ticket 明文不得写日志，仅记录指纹。  
4. 目标端口可配置白名单（建议先放开到 sandbox 内端口范围，再逐步收紧）。  
5. relay 只允许连到当前 session 绑定 VM，不允许任意 IP。

---

## 10. 与编排对接约定

编排将新增连接策略：

1. `kvm-tcp-relay`（默认优先）
2. `port-mapping`（降级兼容）

行为：

1. 每次连接先申请 ticket。  
2. ticket 过期或连接失败时重新申请。  
3. 仍以 `sessionId` 作为唯一入口，不在业务层直连 KVM。

---

## 11. 验收标准（冻结建议）

1. 在关闭/破坏 iptables 端口映射条件下，relay 仍可稳定连接 sandbox 目标端口。  
2. 连续 20 轮测试（含抖动注入）无持续黑洞。  
3. 失败可在 1~2 次重试内恢复。  
4. 错误码可机读并驱动自动重试策略。  
5. 日志可通过 `requestId + sessionId + connId + lifecycleId` 完整串联。

---

## 12. 本轮 KVM 团队交付清单

P0：

1. `POST /v1/sessions/{session_id}/relay/tcp/ticket`
2. `GET /v1/ws/relay/tcp?ticket=...`
3. 错误码、超时、背压、日志字段完整落地

P1：

1. `GET /v1/sessions/{session_id}/relay/tcp/state`
2. 指标导出（连接数、失败率、背压次数、重试耗尽）

