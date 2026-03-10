# kvm-orchestrator 调用文档 v1（版本 1.3.2）

- 服务地址: `http://192.168.10.172:8500`
- API 版本: `v1`
- 文档更新时间: `2026-02-07`

## 1. 鉴权与公共约定

### 1.1 鉴权
- 认证头: `Authorization: Bearer <TOKEN>`
- 角色:
  - `readonly`: 只读
  - `operator`: 读写
  - `admin`: 管理（兼容读写）

### 1.2 统一返回 envelope
```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "error": null,
  "request_id": "uuid"
}
```

错误示例:
```json
{
  "code": "SESSION_NOT_FOUND",
  "message": "Session 'sess_xxx' not found",
  "data": null,
  "error": {
    "type": "not_found_error",
    "details": {
      "session_id": "sess_xxx"
    }
  },
  "request_id": "uuid"
}
```

### 1.3 幂等与追踪
- 写接口支持 `Idempotency-Key`（建议业务方在重试时复用）
- 重放返回头: `X-Idempotent-Replay: true`
- 所有响应头包含: `X-Request-ID`

---

## 2. 完整接口清单

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 否 | 健康检查 |
| GET | `/v1/vms` | readonly | VM 列表 |
| GET | `/v1/vms/{name}` | readonly | VM 状态（含 IP） |
| GET | `/v1/vms/{name}/ip` | readonly | VM IP 查询 |
| POST | `/v1/vms/{name}/{action}` | operator | VM 动作（支持 `?async=true`） |
| GET | `/v1/jobs/{job_id}` | readonly | 查询异步任务 |
| POST | `/v1/sessions` | operator | 创建会话 |
| GET | `/v1/sessions/{session_id}` | readonly | 查询会话 |
| GET | `/v1/sessions/{session_id}/quota` | readonly | 查询 session 配额 |
| PUT | `/v1/sessions/{session_id}/quota` | operator | 更新 session 配额 |
| POST | `/v1/sessions/{session_id}/bind` | operator | 绑定会话与 VM |
| GET | `/v1/sessions/{session_id}/vm` | readonly | 反查会话绑定 VM |
| POST | `/v1/sessions/{session_id}/close` | operator | 关闭会话并解绑 |
| POST | `/v1/vms/{name}/files` | operator | 向指定 VM 下发文件 |
| POST | `/v1/sessions/{session_id}/files` | operator | 通过 session 下发文件 |
| DELETE | `/v1/vms/{name}/files` | operator | 删除 VM 目标文件/目录 |
| DELETE | `/v1/sessions/{session_id}/files` | operator | 通过 session 删除文件/目录 |
| POST | `/v1/vms/{name}/exec` | operator | 通过 guest-agent 执行命令 |
| POST | `/v1/sessions/{session_id}/exec` | operator | 通过 session 执行命令 |
| POST | `/v1/sandboxes` | operator | 创建 sandbox VM（主镜像+增量盘） |
| GET | `/v1/sandboxes/{session_id}` | readonly | 查询 sandbox 信息 |
| GET | `/v1/sandboxes/{session_id}/ip` | readonly | 查询 sandbox IP |
| POST | `/v1/sandboxes/{session_id}/ports` | operator | 创建端口映射 |
| GET | `/v1/sandboxes/{session_id}/ports` | readonly | 查询端口映射 |
| DELETE | `/v1/sandboxes/{session_id}/ports` | operator | 删除端口映射 |
| POST | `/v1/sandboxes/{session_id}/restart` | operator | 重启 sandbox VM |
| DELETE | `/v1/sandboxes/{session_id}` | operator | 删除 sandbox VM |
| GET | `/v1/vms/{name}/metrics` | readonly | VM 指标 |
| GET | `/v1/vms/{name}/logs?lines=100` | readonly | VM 相关日志 |
| GET | `/v1/vms/{name}/snapshots` | readonly | 列出快照 |
| POST | `/v1/vms/{name}/snapshots/create` | operator | 创建快照 |
| POST | `/v1/vms/{name}/snapshots/{snapshot_name}/restore` | operator | 恢复快照 |
| DELETE | `/v1/vms/{name}/snapshots/{snapshot_name}` | operator | 删除快照 |
| WS | `/v1/ws/events?token=<TOKEN>&replay_last=20` | readonly | 事件订阅流 |

---

## 3. 请求/响应示例（成功 + 失败）

### 3.1 创建会话
```bash
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sess-create-001' \
  -d '{"metadata":{"owner":"apps-api","trace":"abc"}}' \
  http://192.168.10.172:8500/v1/sessions
```

成功（201）:
```json
{
  "code": "SESSION_CREATED",
  "message": "Session created",
  "data": {
    "session_id": "sess_xxx",
    "status": "open",
    "vm_name": null,
    "metadata": {
      "owner": "apps-api",
      "trace": "abc"
    },
    "quota": {
      "max_actions_per_minute": 120,
      "max_runtime_minutes": 240,
      "max_reboots_per_hour": 20
    },
    "created_at": "2026-02-05T14:00:00Z",
    "updated_at": "2026-02-05T14:00:00Z",
    "closed_at": null
  },
  "error": null,
  "request_id": "uuid"
}
```

失败（401）:
```json
{
  "code": "AUTH_MISSING",
  "message": "Missing bearer token",
  "data": null,
  "error": {
    "type": "auth_error",
    "details": {}
  },
  "request_id": "uuid"
}
```

### 3.2 绑定会话
```bash
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"vm_name":"server2019_forTest"}' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/bind
```

自动分配示例:
```json
{"auto_allocate": true}
```

失败（409，VM 已被占用）:
```json
{
  "code": "VM_ALREADY_BOUND",
  "message": "VM is already bound to another session",
  "data": null,
  "error": {
    "type": "conflict_error",
    "details": {
      "vm_name": "server2019_forTest",
      "owner_session_id": "sess_yyy"
    }
  },
  "request_id": "uuid"
}
```

### 3.3 按 session 反查 VM
```bash
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/vm
```

### 3.4 关闭会话
```bash
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"graceful_shutdown": true}' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/close
```

失败（409，重复关闭）:
```json
{
  "code": "SESSION_ALREADY_CLOSED",
  "message": "Session is already closed",
  "data": null,
  "error": {
    "type": "conflict_error",
    "details": {
      "session_id": "sess_xxx"
    }
  },
  "request_id": "uuid"
}
```

### 3.5 VM 动作（同步 + 异步）

同步:
```bash
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/reboot
```

异步:
```bash
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  'http://192.168.10.172:8500/v1/vms/server2019_forTest/reboot?async=true'
```

异步成功（202）:
```json
{
  "code": "JOB_ACCEPTED",
  "message": "Job accepted",
  "data": {
    "job_id": "job_xxx",
    "status": "queued",
    "operation_id": "op_xxx"
  },
  "error": null,
  "request_id": "uuid"
}
```

### 3.6 查询任务
```bash
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/jobs/job_xxx
```

### 3.7 Session 配额
```bash
# 查询
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/quota

# 更新
curl -X PUT \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"max_actions_per_minute":80,"max_runtime_minutes":180,"max_reboots_per_hour":8}' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/quota
```

### 3.8 快照能力
```bash
# 列出
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/snapshots

# 创建
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"snapshot_name":"release-001","description":"before deploy"}' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/snapshots/create

# 恢复
curl -X POST \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"target_state":"running"}' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/snapshots/release-001/restore

# 删除
curl -X DELETE \
  -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/snapshots/release-001
```

### 3.9 WebSocket 事件流
- 连接地址: `ws://192.168.10.172:8500/v1/ws/events?token=<TOKEN>&replay_last=20`
- 常见 `event_type`:
  - `vm.action.accepted`, `vm.action.completed`, `vm.action.failed`
  - `vm.state.changed`
  - `session.created`, `session.bound`, `session.closed`, `session.quota.updated`
  - `snapshot.created`, `snapshot.restored`, `snapshot.deleted`
  - `vm.file.accepted`, `vm.file.completed`, `vm.file.failed`
  - `vm.exec.accepted`, `vm.exec.completed`, `vm.exec.failed`
  - `sandbox.created`
  - `sandbox.restarted`, `sandbox.deleted`

### 3.10 文件下发
说明：当前实现将文件落盘至服务端 sandbox 目录（`KVM_ORCH_FILE_DROP_ROOT/<vm_name>/...`），用于后续 VM 内取用或由外部机制同步。
如需直接写入 VM 内部，可指定 `deliveryMode=guest-agent`，需提前配置 qemu-guest-agent。
```bash
# 通过 session 下发文件
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -F 'file=@./bundle.tar.gz' \
  -F 'targetPath=agent' \
  -F 'extract=true' \
  -F 'overwrite=replace' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/files

# 通过 VM 下发文件（VM 已绑定 session 时需带 sessionId）
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -F 'file=@./setup.bin' \
  -F 'targetPath=/tmp/' \
  -F 'overwrite=allow' \
  -F 'sessionId=sess_xxx' \
  http://192.168.10.172:8500/v1/vms/server2019_forTest/files

# 分片上传（chunked）
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -F 'file=@./part01' \
  -F 'chunkIndex=0' \
  -F 'totalChunks=3' \
  -F 'uploadId=up_abcdef' \
  -F 'targetPath=agent/' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/files

# 删除文件/目录（目录需 recursive=true）
curl -X DELETE -H 'Authorization: Bearer <TOKEN>' \
  "http://192.168.10.172:8500/v1/sessions/sess_xxx/files?targetPath=agent&recursive=true"

# 通过 guest-agent 直写 VM 内部
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -F 'file=@./agent.bin' \
  -F 'targetPath=/opt/agent/' \
  -F 'deliveryMode=guest-agent' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/files

# 通过 guest-agent 执行命令
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"path":"/bin/systemctl","args":["restart","my-agent"],"capture_output":true}' \
  http://192.168.10.172:8500/v1/sessions/sess_xxx/exec
```

### 3.11 创建 Sandbox（主镜像 + 增量盘）
说明：创建 overlay 并定义/启动 VM，默认自动绑定到 session。
若启用自动端口映射（默认 true），响应将包含：
- `port_mapping`：自动创建的端口映射
- `port_mapping_ready`：端口是否可访问（直连 VM + 转发均可访问）
- `port_mapping_detail`：连通性详情（`vm_port_ready` / `host_port_ready` / `vm_error` / `host_error`）
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
  http://192.168.10.172:8500/v1/sandboxes
```

### 3.12 查询 Sandbox
```bash
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/sandboxes/sess_xxx
```

### 3.12.1 查询 Sandbox IP
```bash
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/sandboxes/sess_xxx/ip
```
可选参数：`?refresh=true` 预留（当前不启用，网络由 KVM/libvirt 层配置）。

### 3.12.2 查询 VM IP
```bash
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/vms/<vm_name>/ip?refresh=true
```

### 3.13 重启 Sandbox
```bash
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"graceful_shutdown":true,"start":true}' \
  http://192.168.10.172:8500/v1/sandboxes/sess_xxx/restart
```

### 3.14 删除 Sandbox
```bash
curl -X DELETE -H 'Authorization: Bearer <TOKEN>' \
  'http://192.168.10.172:8500/v1/sandboxes/sess_xxx?deleteStorage=true'
```

### 3.15 创建端口映射
```bash
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"vm_port":8080,"host_port":18080,"protocol":"tcp"}' \
  http://192.168.10.172:8500/v1/sandboxes/sess_xxx/ports
```
响应增加字段：
- `port_ready`：是否可访问（直连 VM + 转发均可访问）
- `port_ready_detail`：连通性详情（`vm_port_ready` / `host_port_ready` / `vm_error` / `host_error`）
若未就绪：`code=PORT_MAPPING_PENDING`，`message` 会提示继续等待启动。

### 3.16 查询端口映射
```bash
curl -H 'Authorization: Bearer <TOKEN>' \
  http://192.168.10.172:8500/v1/sandboxes/sess_xxx/ports
```
可选参数：
- `refresh=true|false`（默认 true）：刷新并修复映射
- `verify=true|false`：返回附加连通性探测结果
- `wait_seconds`：等待探测（0-60）

### 3.17 删除端口映射
```bash
curl -X DELETE -H 'Authorization: Bearer <TOKEN>' \
  'http://192.168.10.172:8500/v1/sandboxes/sess_xxx/ports?host_port=18080&protocol=tcp'
```

---

## 4. 字段字典

### 4.1 通用字段
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | string | 是 | 业务状态码 |
| message | string | 是 | 可读描述 |
| data | object/null | 是 | 成功数据 |
| error.type | string/null | 否 | 错误分类 |
| error.details | object/null | 否 | 错误详情 |
| error.details.retryable | bool | 否 | 是否建议重试 |
| request_id | string | 是 | 请求追踪 ID |

### 4.2 Session 字段
| 字段 | 类型 | 说明 |
|---|---|---|
| session_id | string | 会话 ID（`sess_` 前缀） |
| status | string | `open` / `closed` |
| vm_name | string/null | 绑定 VM 名 |
| metadata | object | 业务扩展字段 |
| quota | object | session 级配额 |
| created_at | string | ISO8601 UTC |
| updated_at | string | ISO8601 UTC |
| closed_at | string/null | ISO8601 UTC |

### 4.3 Session Quota 字段
| 字段 | 类型 | 说明 |
|---|---|---|
| max_actions_per_minute | int | 每分钟最大动作次数 |
| max_runtime_minutes | int | 最大运行分钟数 |
| max_reboots_per_hour | int | 每小时最大重启次数 |

### 4.4 Job 字段
| 字段 | 类型 | 说明 |
|---|---|---|
| job_id | string | 任务 ID（`job_` 前缀） |
| status | string | `queued/running/completed/failed` |
| type | string | `vm_action` / `file_transfer` / `file_delete` / `guest_exec` |
| target | object | 任务目标（vm/action 或 file target） |
| operation_id | string | 动作追踪 ID |
| result | object/null | 成功结果 |
| error | object/null | 失败信息 |
| created_at/updated_at | string | ISO8601 UTC |

### 4.5 Snapshot 字段
| 字段 | 类型 | 说明 |
|---|---|---|
| snapshot_name | string | 快照名 |
| vm_name | string | VM 名 |
| operation_id | string | 操作追踪 ID |
| created_at/restored_at/deleted_at | string | ISO8601 UTC |
| disk_only | bool | 是否磁盘快照 |
| quiesce | bool | 是否静默快照 |

### 4.6 WebSocket 事件字段
| 字段 | 类型 | 说明 |
|---|---|---|
| event_id | string | 事件 ID（`evt_` 前缀） |
| event_type | string | 事件类型 |
| source | string | 事件来源（api/job/poller） |
| created_at | string | 事件时间 |
| data | object | 事件内容 |

### 4.7 文件下发字段（FormData）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | file | 是 | 上传文件 |
| targetPath | string | 否 | 目标路径（默认当前目录，路径会被限制在 sandbox 根目录内） |
| overwrite | string | 否 | `deny/allow/replace` |
| mkdirs | bool | 否 | 目标目录不存在时自动创建（默认 true） |
| extract | bool | 否 | 是否解压（zip/tar.gz） |
| sha256 | string | 否 | 完整性校验 |
| chunkIndex | int | 否 | 分片序号（0 开始） |
| totalChunks | int | 否 | 分片总数 |
| uploadId | string | 否 | 分片上传 ID |
| sessionId | string | 否 | VM 下发时用于绑定校验 |
| chmod | string | 否 | 目标权限（八进制字符串，如 `644`） |
| owner | string | 否 | 目标 owner（`user` 或 `user:group`） |
| deliveryMode | string | 否 | 传输方式：`file-drop` / `guest-agent` |

### 4.8 文件删除字段（Query）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| targetPath | string | 是 | 删除目标路径（sandbox 内） |
| recursive | bool | 否 | 目录删除需设为 true（默认 false） |
| ignoreMissing | bool | 否 | 目标不存在时忽略（默认 false） |
| sessionId | string | 否 | VM 删除时用于绑定校验 |
| deliveryMode | string | 否 | 传输方式：`file-drop` / `guest-agent` |

### 4.9 guest-exec 字段（JSON）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| path | string | 是 | 绝对路径（如 `/bin/systemctl`） |
| args | string[] | 否 | 参数数组 |
| capture_output | bool | 否 | 是否返回输出（默认 true） |
| timeout_seconds | int | 否 | 超时时间（1-600 秒） |
| env | object | 否 | 环境变量（key/value） |

### 4.10 Sandbox 创建字段（JSON）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| session_id | string | 否 | 关联 session（不填则自动创建） |
| vm_name | string | 否 | VM 名（默认 `sandbox_<session_id>`） |
| base_image | string | 否 | 主镜像路径（默认环境变量） |
| memory_mb | int | 否 | 内存 MB（默认 2048） |
| vcpus | int | 否 | vCPU 数（默认 2） |
| network | string | 否 | libvirt 网络（默认 `sandbox-net`） |
| os_variant | string | 否 | OS 变种（默认 `ubuntu22.04`） |
| auto_bind | bool | 否 | 是否自动绑定 session（默认 true） |
| start | bool | 否 | 是否启动 VM（默认 true） |
| metadata | object | 否 | 自动创建 session 时的元数据 |

### 4.11 Sandbox 查询字段
| 字段 | 类型 | 说明 |
|---|---|---|
| session_id | string | session ID |
| vm_name | string | VM 名 |
| vm_exists | bool | VM 是否存在 |
| overlay_path | string | overlay 路径 |
| overlay_exists | bool | overlay 是否存在 |
| state | string/null | VM 状态 |
| ip_addresses | string[] | IP 地址列表（含前缀） |

### 4.11.1 VM 查询字段（补充）
| 字段 | 类型 | 说明 |
|---|---|---|
| ip_addresses | string[] | IP 地址列表（含前缀） |

### 4.12 Sandbox 重启字段（JSON）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| graceful_shutdown | bool | 否 | 是否优雅关机（默认 true） |
| start | bool | 否 | 是否启动（默认 true） |

### 4.13 Sandbox 删除字段（Query）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| deleteStorage | bool | 否 | 是否删除 overlay（默认 true） |

### 4.14 端口映射字段（JSON）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| vm_port | int | 是 | VM 内端口 |
| host_port | int | 是 | 宿主机端口 |
| protocol | string | 否 | `tcp` / `udp` |
| host_ip | string | 否 | 绑定宿主机 IP（可选） |

### 4.15 端口映射删除字段（Query）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| host_port | int | 是 | 宿主机端口 |
| protocol | string | 否 | `tcp` / `udp` |
| host_ip | string | 否 | 绑定宿主机 IP（可选） |
| vm_port | int | 否 | VM 内端口（不填则等于 host_port） |

---

## 5. 错误码约定

| HTTP | code | 触发条件 |
|---|---|---|
| 400 | `INVALID_ACTION` | action 不在支持列表 |
| 400 | `INVALID_BIND_REQUEST` | bind 既未指定 vm_name 且未启用 auto_allocate |
| 400 | `VIRSH_ERROR` / `COMMAND_ERROR` | 后端命令执行失败 |
| 400 | `INVALID_OVERWRITE_POLICY` | overwrite 不合法 |
| 400 | `INVALID_TARGET_PATH` | 目标路径不合法 |
| 400 | `INVALID_CHUNK_REQUEST` / `INVALID_CHUNK_INDEX` | 分片上传参数不合法 |
| 400 | `INVALID_ARCHIVE` | 压缩包格式不支持 |
| 400 | `CHECKSUM_MISMATCH` | 校验失败 |
| 400 | `TARGET_IS_DIR` | 删除目录需启用 recursive |
| 400 | `INVALID_DELIVERY_MODE` | deliveryMode 不合法 |
| 400 | `INVALID_EXEC_PATH` | exec path 必须是绝对路径 |
| 401 | `AUTH_MISSING` / `AUTH_FAILED` | token 缺失或错误 |
| 401 | `AUTH_INSUFFICIENT_ROLE` | token 角色权限不足 |
| 401 | `IP_NOT_ALLOWED` | 客户端 IP 不在白名单 |
| 403 | `CHOWN_DENIED` / `CHMOD_DENIED` | 目标权限/属主修改失败 |
| 404 | `VM_NOT_FOUND` | VM 不存在 |
| 404 | `SANDBOX_BASE_NOT_FOUND` | sandbox 主镜像不存在 |
| 404 | `SESSION_NOT_FOUND` | session 不存在 |
| 404 | `SESSION_VM_NOT_BOUND` | session 尚未绑定 VM |
| 404 | `JOB_NOT_FOUND` | job 不存在 |
| 404 | `UPLOAD_NOT_FOUND` | 上传文件不存在 |
| 404 | `TARGET_NOT_FOUND` | 删除目标不存在 |
| 409 | `SESSION_ALREADY_BOUND` | session 已绑定 VM |
| 409 | `VM_ALREADY_EXISTS` | sandbox VM 名称已存在 |
| 409 | `VM_ALREADY_BOUND` | VM 被其他 session 占用 |
| 409 | `SESSION_ALREADY_CLOSED` / `SESSION_CLOSED` | 会话关闭冲突 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一 Idempotency-Key 对应不同请求体 |
| 409 | `TARGET_ALREADY_EXISTS` | 目标已存在且禁止覆盖 |
| 409 | `SESSION_REQUIRED` / `SESSION_BINDING_MISMATCH` | 绑定校验失败 |
| 429 | `RATE_LIMITED` | 超过限流阈值 |
| 500 | `CONFIG_ERROR` / `INTERNAL_ERROR` | 服务端配置或未处理异常 |
| 500 | `GUEST_AGENT_ERROR` | guest-agent 调用失败 |
| 504 | `VIRSH_TIMEOUT` / `COMMAND_TIMEOUT` | 后端超时 |
| 504 | `GUEST_AGENT_TIMEOUT` | guest-agent 执行超时 |

---

## 6. 异步任务模型

- 触发方式: `POST /v1/vms/{name}/{action}?async=true`
- 返回: `202 + job_id`
- 查询: `GET /v1/jobs/{job_id}`
- 状态流转: `queued -> running -> completed/failed`
- 保证: 同步/异步均返回 `operation_id` 便于关联排障

---

## 7. WebSocket 与事件模型

- 订阅地址: `WS /v1/ws/events?token=<TOKEN>&replay_last=20`
- `replay_last`:
  - 可选，0-200，表示连接后先回放最近 N 条事件
- 事件来源:
  - API 写操作实时推送
  - job 完成/失败推送
  - 轮询器检测 VM 状态变化推送（间隔由 `KVM_ORCH_STATE_POLL_INTERVAL` 控制）

---

## 8. 限流策略

- 当前策略: 按客户端 IP 计数
- 默认阈值: `120 req/min/IP`
- 配置项: `KVM_ORCH_RATE_LIMIT_PER_MIN`
- 命中后: 返回 `429 + RATE_LIMITED`

---

## 9. 版本策略

- 当前主版本: `/v1`
- 兼容承诺:
  - `/v1` 内新增字段保持向后兼容
  - 移除字段/变更语义通过 `/v2` 发布
- 建议客户端实践:
  - 基于 `code` 而非 `message` 做逻辑判断
  - 对未知字段保持容忍

---

## 10. 与 apps/api 对接建议

- connector 层统一注入:
  - `Authorization`
  - `Idempotency-Key`（对写请求）
  - `X-Request-ID`（可选，若业务侧已有链路追踪）
- 对异步动作:
  - 先接收 `job_id`
  - 轮询 `/v1/jobs/{job_id}` 至终态
- 需要实时态时:
  - 订阅 `/v1/ws/events`，以 `event_type` 分发处理逻辑
