# kvm-orchestrator（应用版 / 对外使用，版本 1.3.2）

本文档用于对外交付，说明如何直接接入服务。  
开发维护说明见：`/home/user/kvm/kvm-orchestrator/README.dev.md`。

## 1) 服务地址与认证
- KVM_ORCH_TOKEN=WDyCWjNwEAE_ziylBN8BuJ37VRzJqp-q6wsyrq4uDdg
- LIBVIRT_URI=qemu:///system
- HOST=0.0.0.0
- PORT=8500
- Base URL: `http://192.168.10.172:8500`
- OpenAPI: `http://192.168.10.172:8500/docs`
- 认证方式: Bearer Token
- 请求头: `Authorization: Bearer <TOKEN>`
- 角色权限:
  - `readonly`: 只读接口
  - `operator`: 读写接口（会话、控制动作）
  - `admin`: 保留（兼容 operator）
- 文件下发相关环境变量:
  - `KVM_ORCH_UPLOAD_ROOT`（可选，上传临时目录，默认 `./_uploads`）
  - `KVM_ORCH_FILE_DROP_ROOT`（可选，目标落盘根目录，默认 `./file-drop`）
  - `KVM_ORCH_MAX_UPLOAD_MB`（可选，上传大小限制，默认 512）
  - `KVM_ORCH_FILE_DELIVERY_MODE`（可选，`file-drop`/`guest-agent`，默认 `file-drop`）

## 2) 核心接口
- 健康检查（无需鉴权）: `GET /health`
- VM 查询:
  - `GET /v1/vms`
  - `GET /v1/vms/{name}`
  - `GET /v1/vms/{name}/ip`
- VM 控制:
  - `POST /v1/vms/{name}/{action}`
  - `action`: `start | shutdown | reboot | suspend | resume`
  - 异步模式: `POST /v1/vms/{name}/{action}?async=true`
- Session 编排:
  - `POST /v1/sessions`
  - `GET /v1/sessions/{session_id}`
  - `POST /v1/sessions/{session_id}/bind`
  - `GET /v1/sessions/{session_id}/vm`
  - `POST /v1/sessions/{session_id}/close`
  - `POST /v1/sandboxes`（基于主镜像+增量盘创建 VM）
  - `GET /v1/sandboxes/{session_id}`
  - `GET /v1/sandboxes/{session_id}/ip`
  - `POST /v1/sandboxes/{session_id}/restart`
  - `DELETE /v1/sandboxes/{session_id}`
- Session 配额:
  - `GET /v1/sessions/{session_id}/quota`
  - `PUT /v1/sessions/{session_id}/quota`
- 文件下发:
  - `POST /v1/vms/{name}/files`
  - `POST /v1/sessions/{session_id}/files`
  - `DELETE /v1/vms/{name}/files`
  - `DELETE /v1/sessions/{session_id}/files`
  - `POST /v1/vms/{name}/exec`
  - `POST /v1/sessions/{session_id}/exec`
  - 目标落盘: `KVM_ORCH_FILE_DROP_ROOT/<vm_name>/...`（由外部机制同步到 VM 或在 VM 内拉取）
  - 直写 VM 内部: `deliveryMode=guest-agent`（需 VM 内启用 qemu-guest-agent）
  - Sandbox 可基于主镜像 + 增量层（QCOW2 backing）创建并复用 session 关联 VM

## 2.1) Sandbox 远程管理（主镜像 + 增量层）
- 每个 sandbox VM 建议命名为 `sandbox_<session_id>`
- 通过 kvm-orchestrator 绑定后即可远程管理（文件下发/删除/exec/动作）
- 默认使用隔离网络 `sandbox-net`（NAT 出口，可访问互联网，内网段已被阻断）
```bash
# 绑定已有 sandbox VM
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"vm_name":"sandbox_<session_id>","auto_allocate":false}' \
  http://<kvm-orchestrator>/v1/sessions/<session_id>/bind
```

创建 sandbox（主镜像 + 增量盘）:
```bash
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id":"sess_xxx",
    "vm_name":"sandbox_sess_xxx",
    "base_image":"/var/lib/libvirt/images/base-images/ubuntu-22.04-base.qcow2",
    "memory_mb":2048,
    "vcpus":2,
    "network":"default",
    "os_variant":"ubuntu22.04",
    "auto_bind":true,
    "start":true
  }' \
  http://<kvm-orchestrator>/v1/sandboxes
```
- Job 查询（异步任务）:
  - `GET /v1/jobs/{job_id}`
- 监控接口:
  - `GET /v1/vms/{name}/metrics`
  - `GET /v1/vms/{name}/logs?lines=100`
- 快照能力:
  - `GET /v1/vms/{name}/snapshots`
  - `POST /v1/vms/{name}/snapshots/create`
  - `POST /v1/vms/{name}/snapshots/{snapshot_name}/restore`
  - `DELETE /v1/vms/{name}/snapshots/{snapshot_name}`
- WebSocket 事件流:
  - `WS /v1/ws/events?token=<TOKEN>&replay_last=20`

## 3) 快速调用示例
```bash
# 健康检查
curl http://192.168.10.172:8500/health

# 列出 VM
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/vms

# 创建 session
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sess-create-001' \
  -d '{"metadata":{"owner":"apps-api"}}' \
  http://192.168.10.172:8500/v1/sessions

# 异步重启 VM
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/reboot?async=true
```

## 4) 返回体与错误
- 所有接口统一返回 envelope:
  - `code`: 业务码
  - `message`: 描述
  - `data`: 成功数据（失败时为 `null`）
  - `error.type/error.details`: 失败细节
  - `request_id`: 请求追踪 ID
- 常见 HTTP 状态码: `200/201/202/400/401/404/409/429/500/504`

## 5) 详细调用文档
- 完整接口清单、请求/响应示例、字段字典、错误码、异步任务、限流、版本策略：
  - `/home/user/kvm/kvm-orchestrator/kvm-orchestrator-调用文档-v1.md`
