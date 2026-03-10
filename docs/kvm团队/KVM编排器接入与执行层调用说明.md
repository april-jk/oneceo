# KVM编排器接入与执行层调用说明（只读验证版）

## 1. 当前状态

已完成 KVM 编排器联通验证（只读操作）：

- 健康检查：`GET /health` 成功
- 虚拟机列表：`GET /v1/vms` 成功
- 单机状态：`GET /v1/vms/{name}` 成功
- 监控指标：`GET /v1/vms/{name}/metrics` 成功
- 日志查询：`GET /v1/vms/{name}/logs?lines=5` 成功

> 说明：按你的要求，**未执行任何 start/shutdown/reboot/suspend/resume 操作**。

---

## 2. 保护约束（已遵守）

你提示当前两台虚拟机有其他用途：

- `server2019_forTest`
- `ssh_AND_telnet_test_Server`

执行层集成阶段将遵循：

1. 不对以上现有 VM 做控制动作。
2. 执行层只使用新创建的会话/专用 VM。
3. 生产前在调度策略中加入“保护名单”。

---

## 3. 环境变量（apps/api）

已写入 `apps/api/.env`：

```env
KVM_ORCHESTRATOR_URL=http://192.168.10.172:8500
KVM_ORCH_TOKEN=WDyCWjNwEAE_ziylBN8BuJ37VRzJqp-q6wsyrq4uDdg
```

---

## 4. 在 oneceo API 内的调用入口

为避免耦合，统一由连接器转发：

- 连接器：`apps/api/src/connectors/kvm-connector.ts`
- 上游客户端：`apps/api/src/clients/kvm-orchestrator-client.ts`
- 对外路由：`apps/api/src/routes/sandbox-routes.ts`

当前可用的对外路由（oneceo API）：

- `GET /api/sandbox/health`
- `GET /api/sandbox/vms`
- `GET /api/sandbox/vms/:name`
- `POST /api/sandbox/vms/:name/:action?async=true|false`
- `GET /api/sandbox/vms/:name/metrics`
- `GET /api/sandbox/vms/:name/logs?lines=100`
- `GET /api/sandbox/vms/:name/snapshots`
- `POST /api/sandbox/vms/:name/snapshots/create`
- `POST /api/sandbox/vms/:name/snapshots/:snapshotName/restore`
- `DELETE /api/sandbox/vms/:name/snapshots/:snapshotName`
- `POST /api/sandbox/sessions`
- `GET /api/sandbox/sessions/:sessionId`
- `POST /api/sandbox/sessions/:sessionId/bind`
- `GET /api/sandbox/sessions/:sessionId/vm`
- `POST /api/sandbox/sessions/:sessionId/close`
- `GET /api/sandbox/sessions/:sessionId/quota`
- `PUT /api/sandbox/sessions/:sessionId/quota`
- `GET /api/sandbox/jobs/:jobId`

---

## 5. 推荐调用流程（Agent执行层）

### 步骤 A：创建 session（幂等）

```bash
curl -X POST http://localhost:4000/api/sandbox/sessions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: session-create-001" \
  -d '{"metadata":{"owner":"apps-api","purpose":"agent-execution"}}'
```

### 步骤 B：绑定 VM（自动或指定）

```bash
curl -X POST http://localhost:4000/api/sandbox/sessions/{sessionId}/bind \
  -H "Content-Type: application/json" \
  -d '{"auto":true}'
```

### 步骤 C：查询会话对应 VM

```bash
curl http://localhost:4000/api/sandbox/sessions/{sessionId}/vm
```

### 步骤 D：需要动作时执行控制（建议 async）

```bash
curl -X POST "http://localhost:4000/api/sandbox/vms/{vmName}/start?async=true"
```

### 步骤 E：查询异步任务状态

```bash
curl http://localhost:4000/api/sandbox/jobs/{jobId}
```

### 步骤 F：执行结束后关闭 session

```bash
curl -X POST http://localhost:4000/api/sandbox/sessions/{sessionId}/close \
  -H "Content-Type: application/json" \
  -d '{"graceful":true}'
```

---

## 6. 下一步落地建议

1. 在 `kvm-connector` 增加保护名单校验（阻止对现有两台 VM 发控制动作）。
2. 将执行层默认切换为 session 驱动（禁止直接对任意 VM 名称操作）。
3. 将审计字段写入日志：`requestId/sessionId/vmName/action`。

---

## 7. 备注

- 当前验证阶段未改动现有业务 VM。
- 后续执行层联调优先使用新 session 分配的专用 VM，避免影响现网用途实例。
