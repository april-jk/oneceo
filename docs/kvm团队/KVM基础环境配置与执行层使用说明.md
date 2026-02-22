# KVM基础环境配置与执行层使用说明

## 1. 本次已实现内容

已在 `apps/api` 实现基础 KVM 执行环境编排能力（通过统一连接器）：

1. **主镜像 + 增量盘映射**
   - 主镜像：`KVM_BASE_IMAGE_NAME`（默认 `altus-base-ubuntu22-lts`）
   - 增量盘目录：`KVM_INCREMENTAL_STORAGE_DIR`（默认 `/var/lib/libvirt/images/incremental`）
   - 增量盘文件名：`{session_id}.qcow2`
   - 增量盘路径：`{KVM_INCREMENTAL_STORAGE_DIR}/{session_id}.qcow2`

2. **数据库持久化**
   - 新增表：`sandbox_execution_environments`
   - 存储内容：`session_id`、`vm_name`、主镜像、增量盘路径、安全策略快照、状态。

3. **安全策略落地**
   - 受保护虚拟机名单（禁止控制）：`KVM_PROTECTED_VM_NAMES`
   - 默认阻断网段：`KVM_SANDBOX_DENY_CIDRS`
   - 强制 session 优先模式：`KVM_ENFORCE_SESSION_FIRST=true`
   - 环境创建时自动下发安全配置快照并持久化。

4. **执行环境接口**
   - `POST /api/sandbox/environment/open`：创建 session、绑定 VM、写入数据库映射
   - `GET /api/sandbox/environment/:sessionId`：查询环境记录
   - `GET /api/sandbox/environment?limit=20`：查询最近环境
   - `POST /api/sandbox/environment/:sessionId/close`：关闭 session 并更新状态

---

## 2. 关键文件

- 路由：`apps/api/src/routes/sandbox-routes.ts`
- 连接器：`apps/api/src/connectors/kvm-connector.ts`
- 上游客户端：`apps/api/src/clients/kvm-orchestrator-client.ts`
- 环境服务：`apps/api/src/services/sandbox-environment-service.ts`
- 安全配置：`apps/api/src/config/sandbox-security.ts`
- DAO：`apps/api/src/db/dao/sandbox-execution-environment.dao.ts`
- Schema：`apps/api/src/db/schema.ts`
- 迁移：`apps/api/src/db/migrate.ts`

---

## 3. 环境变量配置（apps/api/.env）

```env
KVM_ORCHESTRATOR_URL=http://192.168.10.172:8500
KVM_ORCH_TOKEN=***

KVM_BASE_IMAGE_NAME=altus-base-ubuntu22-lts
KVM_INCREMENTAL_STORAGE_DIR=/var/lib/libvirt/images/incremental
KVM_PROTECTED_VM_NAMES=server2019_forTest,ssh_AND_telnet_test_Server
KVM_SANDBOX_DENY_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
KVM_SANDBOX_ALLOWED_DOMAINS=
KVM_ENFORCE_SESSION_FIRST=true
KVM_ENV_OPEN_MAX_ATTEMPTS=3
```

---

## 4. 初始化步骤

1. 运行数据库迁移（确保存在 `sandbox_execution_environments` 表）

```bash
pnpm --dir apps/api exec tsx --eval "import('./src/db/migrate.ts').then(async(m)=>{await m.runMigration();})"
```

2. 启动 API

```bash
pnpm --filter api dev
```

---

## 5. 调用方式

### 5.1 打开一个新执行环境（推荐）

```bash
curl -X POST http://localhost:4000/api/sandbox/environment/open \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: env-open-001" \
  -d '{"metadata":{"owner":"apps-api","purpose":"agent-execution"}}'
```

返回关键字段：

- `data.sessionId`
- `data.vmName`
- `data.storage.baseImage`
- `data.storage.incrementalFilePath`

说明：如果上游连续分配到受保护 VM，会自动重试，最大次数由 `KVM_ENV_OPEN_MAX_ATTEMPTS` 控制。

### 5.2 查询环境

```bash
curl http://localhost:4000/api/sandbox/environment/{sessionId}
```

### 5.3 关闭环境

```bash
curl -X POST http://localhost:4000/api/sandbox/environment/{sessionId}/close
```

---

## 6. 安全注意事项

1. 现有业务 VM 在保护名单内，不允许控制动作。
2. 若上游编排器返回受保护 VM，服务会自动关闭该 session 并标记失败。
3. 仅通过 `kvm-connector` 调用 KVM；禁止业务层绕过连接器直连。
4. 建议上游编排器支持并启用 `exclude_vm_names`，避免分配到受保护 VM。

---

## 7. 已验证事项

- 上游 `health`、`vms`、`vm详情/metrics/logs` 已可访问。
- session 创建/绑定/关闭链路可用。
- 当前受保护 VM 会被识别并阻断控制动作。

> 提示：若数据库短时不可用，`/environment/open` 会失败（因为需要持久化映射）。先恢复数据库连接后重试。
