# kvm-orchestrator 进一步开发文档

## 目标
当前 `apps/api` 已接入应用版 KVM Orchestrator（`/health`, `/v1/vms`, `/v1/vms/{name}`, `/v1/vms/{name}/{action}`）。
下一步需要把能力补齐到可支撑 Session-KVM 调度与自动化运维。

---

## 一、你这边优先补齐的能力（按优先级）

### P0（必须先做）
1. **会话与KVM绑定能力**
   - `POST /v1/sessions`（创建会话并返回 session_id）
   - `GET /v1/sessions/{session_id}`
   - `POST /v1/sessions/{session_id}/bind`（绑定指定 VM 或自动分配）
   - `POST /v1/sessions/{session_id}/close`（优雅关闭并解绑）
2. **按 session 反查 VM**
   - `GET /v1/sessions/{session_id}/vm`
3. **统一错误码与错误体**
   - 稳定输出：`code/message/error.type/error.details`
   - 明确 401/404/409/500/504 触发条件

### P1（强烈建议）
4. **异步任务机制（长操作）**
   - 对 start/shutdown/reboot 等支持任务模式：
     - `POST ...?async=true` 返回 `job_id`
     - `GET /v1/jobs/{job_id}` 查询状态
5. **监控接口**
   - `GET /v1/vms/{name}/metrics`（cpu/memory/disk/net）
   - `GET /v1/vms/{name}/logs?lines=100`
6. **幂等性支持**
   - 写操作支持 `Idempotency-Key`

### P2（后续增强）
7. **快照能力**
   - 创建/列出/恢复/删除快照
8. **配额能力**
   - session 级 quota 查询与更新
9. **WebSocket 监控流**
   - VM 状态变更事件推送（start/shutdown/error/reboot 完成）

---

## 二、接口设计建议（避免耦合）

1. **资源名稳定**
   - 使用 `name` 还是 `vm_id` 要固定，不要混用。
2. **动作枚举固定**
   - `start | shutdown | reboot | suspend | resume`。
3. **分页统一**
   - `limit/offset` + `total/items`。
4. **时间字段统一 ISO8601**
   - 如 `created_at/updated_at/started_at`。
5. **返回体统一 envelope**
   - `code/message/data/error`。

---

## 三、认证与安全（请在新文档明确）

1. Bearer Token 是否支持轮换（双 token 过渡期）。
2. 是否支持按来源 IP 白名单。
3. 是否支持读写权限拆分 token（readonly/operator/admin）。
4. 504 超时阈值与可配置项（例如 virsh timeout）。

---

## 四、可观测性（请在新文档明确）

1. 每个请求返回 `request_id`。
2. 每个控制动作返回 `operation_id`（便于排查）。
3. 错误日志是否可按 `vm name/session_id/operation_id` 检索。

---

## 五、给我的“新调用文档”请至少包含这些信息

1. **完整接口清单**（含路径、方法、鉴权要求）。
2. **每个接口的请求/响应示例**（成功 + 失败）。
3. **字段字典**（字段含义、类型、可选/必选）。
4. **错误码约定**（含业务冲突码如 409）。
5. **异步任务模型**（如有 job）。
6. **限流策略**（QPS、并发上限、429 返回体）。
7. **版本策略**（如 `/v1` -> `/v2` 兼容承诺）。

---

## 六、当前我这边已准备好的适配位置

- 连接器：`apps/api/src/connectors/kvm-connector.ts`
- 传输层 client：`apps/api/src/clients/kvm-orchestrator-client.ts`
- API 路由：`apps/api/src/routes/sandbox-routes.ts`

你补完接口后，我会只改这三层，保持业务层无感升级。
