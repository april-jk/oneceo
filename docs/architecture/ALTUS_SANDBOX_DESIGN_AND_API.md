
# KVM 管理模块 - 完整接口文档

**版本**：1.0.0  
**日期**：2026-02-05  
**作者**：Altus KVM Management Team

## 📋 目录

1. [概述](#概述)
2. [数据模型](#数据模型)
3. [KVM 管理接口](#kvm-管理接口)
4. [存储管理接口](#存储管理接口)
5. [资源配额接口](#资源配额接口)
6. [状态监控接口](#状态监控接口)
7. [错误处理](#错误处理)

---

## 概述

### 系统架构

```
┌─────────────────────────────────────────────────────┐
│          裸金属主机 (Bare Metal Host)               │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │     KVM 管理服务 (localhost:8500)            │  │
│  ├──────────────────────────────────────────────┤  │
│  │  ├── KVM 生命周期管理                        │  │
│  │  ├── 虚拟机编排                              │  │
│  │  ├── 存储管理（固定+增量）                  │  │
│  │  ├── 资源配额管理                            │  │
│  │  └── 监控和日志                              │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │     libvirt 守护进程                         │  │
│  │     QEMU/KVM 虚拟化                          │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │     存储系统                                  │  │
│  │  ├── 基础镜像 (/var/lib/libvirt/images)     │  │
│  │  ├── 增量镜像 (per-VM)                      │  │
│  │  └── 快照管理                                │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 设计原则

1. **固定+增量存储**：
   - 基础镜像：共享的 Ubuntu 20.04 LTS 模板（4GB）
   - 增量镜像：每个 KVM 独立的 CoW (Copy-on-Write) 层
   - 节省空间：100 个 KVM 仅需 ~4GB + 100 * 增量大小

2. **资源配额**：
   - 默认配置：4 核 CPU、4GB 内存
   - 可动态调整
   - 支持 CPU 和内存热扩展

3. **Session 绑定**：
   - 每个对话 Session 对应一个 KVM
   - KVM 生命周期与 Session 相同
   - 自动资源清理

4. **多 Agent 支持**：
   - 每个 Session 一个 Agent
   - Agent 持久化存储在增量镜像中
   - 支持 Agent 状态恢复

---

## 数据模型

### 1. 虚拟机配置模型

```typescript
// KVM 虚拟机配置
interface VMConfig {
  // 基本信息
  vm_id: string;                    // 唯一标识符 (UUID)
  session_id: string;               // 关联的 Session ID
  name: string;                     // VM 名称
  description?: string;             // 描述
  
  // 计算资源
  cpu_cores: number;                // CPU 核心数 (默认: 4)
  memory_mb: number;                // 内存大小 (MB，默认: 4096)
  vcpu_model?: string;              // vCPU 模型 (默认: host)
  
  // 存储配置
  base_image: string;               // 基础镜像路径
  root_disk_gb: number;             // 根磁盘大小 (GB，默认: 20)
  data_disk_gb?: number;            // 数据磁盘大小 (GB，可选)
  
  // 网络配置
  network_bridge: string;           // 网络桥接 (默认: virbr0)
  mac_address?: string;             // MAC 地址 (自动生成)
  ip_address?: string;              // IP 地址 (DHCP 或手动)
  
  // 高级配置
  kvm_type: 'kvm' | 'qemu';        // 虚拟化类型
  machine_type: string;             // 机器类型 (默认: pc)
  bios_type: 'bios' | 'uefi';      // BIOS 类型
  
  // 元数据
  created_at: string;               // 创建时间 (ISO 8601)
  updated_at: string;               // 更新时间
  tags?: Record<string, string>;    // 标签
}

// 虚拟机状态
interface VMState {
  vm_id: string;
  state: 'stopped' | 'running' | 'paused' | 'error';
  uptime_seconds: number;           // 运行时长
  cpu_usage_percent: number;        // CPU 使用率
  memory_usage_mb: number;          // 内存使用量
  disk_usage_gb: number;            // 磁盘使用量
  network_in_bytes: number;         // 网络入流量
  network_out_bytes: number;        // 网络出流量
  last_update: string;              // 最后更新时间
}
```

### 2. 存储模型

```typescript
// 存储配置
interface StorageConfig {
  // 基础镜像
  base_image: {
    path: string;                   // /var/lib/libvirt/images/ubuntu-20.04-base.qcow2
    size_gb: number;                // 4
    format: 'qcow2' | 'raw';       // qcow2
    checksum: string;               // SHA256 校验和
  };
  
  // 增量镜像存储
  incremental_storage: {
    base_dir: string;               // /var/lib/libvirt/images/incremental
    format: 'qcow2';               // 必须使用 qcow2 支持 CoW
    backing_file: string;           // 指向基础镜像
  };
}

// 镜像信息
interface ImageInfo {
  image_id: string;                 // 镜像 ID
  vm_id: string;                    // 关联的 VM
  path: string;                     // 镜像路径
  size_gb: number;                  // 实际大小
  allocated_gb: number;             // 分配大小
  format: 'qcow2' | 'raw';
  backing_file?: string;            // 后端文件（增量镜像）
  created_at: string;
  snapshots: SnapshotInfo[];        // 快照列表
}

// 快照信息
interface SnapshotInfo {
  snapshot_id: string;
  name: string;
  description?: string;
  created_at: string;
  size_gb: number;
  parent_snapshot_id?: string;      // 父快照 ID
}
```

### 3. 资源配额模型

```typescript
// 资源配额
interface ResourceQuota {
  quota_id: string;
  session_id: string;
  
  // CPU 配额
  cpu: {
    cores: number;                  // 分配的核心数
    max_cores: number;              // 最大可扩展核心数
    usage_percent: number;          // 使用百分比
  };
  
  // 内存配额
  memory: {
    mb: number;                     // 分配的内存 (MB)
    max_mb: number;                 // 最大可扩展内存
    usage_mb: number;               // 使用量
  };
  
  // 存储配额
  storage: {
    gb: number;                     // 分配的存储 (GB)
    max_gb: number;                 // 最大可扩展存储
    usage_gb: number;               // 使用量
  };
  
  // 网络配额
  network: {
    bandwidth_mbps: number;         // 带宽限制 (Mbps)
    in_bytes: number;               // 入流量
    out_bytes: number;              // 出流量
  };
  
  // 生命周期
  created_at: string;
  expires_at?: string;              // 过期时间
  auto_cleanup: boolean;            // 自动清理
}
```

### 4. 会话绑定模型

```typescript
// Session-KVM 绑定
interface SessionKVMBinding {
  binding_id: string;
  session_id: string;               // 对话 Session ID
  vm_id: string;                    // KVM VM ID
  
  // 生命周期
  created_at: string;
  started_at?: string;              // KVM 启动时间
  stopped_at?: string;              // KVM 停止时间
  
  // Agent 信息
  agent_id: string;                 // Agent 标识
  agent_version: string;            // Agent 版本
  agent_port: number;               // Agent 通信端口
  
  // 状态
  status: 'pending' | 'initializing' | 'ready' | 'terminating' | 'terminated';
  
  // 元数据
  user_id: string;                  // 用户 ID
  project_id?: string;              // 项目 ID
  tags?: Record<string, string>;
}
```

---

## KVM 管理接口

### 1. 创建虚拟机

**端点**：`POST /api/v1/kvm/create`

**请求**：
```json
{
  "session_id": "session-123456",
  "cpu_cores": 4,
  "memory_mb": 4096,
  "root_disk_gb": 20,
  "tags": {
    "user_id": "user-123",
    "project": "my-project"
  }
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "session_id": "session-123456",
    "name": "vm-abc123def456",
    "state": "stopped",
    "config": {
      "cpu_cores": 4,
      "memory_mb": 4096,
      "root_disk_gb": 20,
      "network_bridge": "virbr0"
    },
    "created_at": "2026-02-05T12:00:00Z"
  }
}
```

**错误**：
- `400`：参数错误
- `409`：Session 已绑定 KVM
- `507`：存储空间不足
- `503`：KVM 服务不可用

---

### 2. 启动虚拟机

**端点**：`POST /api/v1/kvm/{vm_id}/start`

**请求**：
```json
{
  "wait_ready": true,
  "timeout_seconds": 60
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "state": "running",
    "ip_address": "192.168.122.100",
    "started_at": "2026-02-05T12:00:30Z"
  }
}
```

**事件流**（WebSocket）：
```json
{
  "type": "vm_state_changed",
  "vm_id": "vm-abc123def456",
  "state": "running",
  "timestamp": "2026-02-05T12:00:30Z"
}
```

---

### 3. 停止虚拟机

**端点**：`POST /api/v1/kvm/{vm_id}/stop`

**请求**：
```json
{
  "force": false,
  "timeout_seconds": 30
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "state": "stopped",
    "stopped_at": "2026-02-05T12:00:45Z"
  }
}
```

---

### 4. 删除虚拟机

**端点**：`DELETE /api/v1/kvm/{vm_id}`

**请求**：
```json
{
  "force": false,
  "cleanup_storage": true
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "deleted_at": "2026-02-05T12:01:00Z",
    "storage_freed_gb": 20.5
  }
}
```

---

### 5. 获取虚拟机信息

**端点**：`GET /api/v1/kvm/{vm_id}`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "session_id": "session-123456",
    "name": "vm-abc123def456",
    "state": "running",
    "config": {
      "cpu_cores": 4,
      "memory_mb": 4096,
      "root_disk_gb": 20
    },
    "state_info": {
      "uptime_seconds": 30,
      "cpu_usage_percent": 5.2,
      "memory_usage_mb": 512,
      "disk_usage_gb": 2.1
    },
    "network": {
      "ip_address": "192.168.122.100",
      "mac_address": "52:54:00:12:34:56"
    },
    "created_at": "2026-02-05T12:00:00Z"
  }
}
```

---

### 6. 列出虚拟机

**端点**：`GET /api/v1/kvm/list?state=running&limit=10&offset=0`

**查询参数**：
- `state`：过滤状态 (running|stopped|paused|error)
- `session_id`：按 Session 过滤
- `limit`：返回数量（默认 10）
- `offset`：偏移量（默认 0）

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 42,
    "limit": 10,
    "offset": 0,
    "vms": [
      {
        "vm_id": "vm-abc123def456",
        "session_id": "session-123456",
        "state": "running",
        "cpu_cores": 4,
        "memory_mb": 4096,
        "created_at": "2026-02-05T12:00:00Z"
      }
    ]
  }
}
```

---

### 7. 调整虚拟机资源

**端点**：`POST /api/v1/kvm/{vm_id}/resize`

**请求**：
```json
{
  "cpu_cores": 8,
  "memory_mb": 8192,
  "root_disk_gb": 30
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "config": {
      "cpu_cores": 8,
      "memory_mb": 8192,
      "root_disk_gb": 30
    },
    "requires_reboot": true
  }
}
```

---

## 存储管理接口

### 1. 创建快照

**端点**：`POST /api/v1/kvm/{vm_id}/snapshot`

**请求**：
```json
{
  "name": "checkpoint-001",
  "description": "Before major update"
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "snapshot_id": "snap-xyz789",
    "vm_id": "vm-abc123def456",
    "name": "checkpoint-001",
    "created_at": "2026-02-05T12:00:00Z",
    "size_gb": 2.1
  }
}
```

---

### 2. 恢复快照

**端点**：`POST /api/v1/kvm/{vm_id}/snapshot/{snapshot_id}/restore`

**请求**：
```json
{
  "force": false
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "snapshot_id": "snap-xyz789",
    "restored_at": "2026-02-05T12:00:30Z"
  }
}
```

---

### 3. 列出快照

**端点**：`GET /api/v1/kvm/{vm_id}/snapshots`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "snapshots": [
      {
        "snapshot_id": "snap-xyz789",
        "name": "checkpoint-001",
        "created_at": "2026-02-05T12:00:00Z",
        "size_gb": 2.1
      }
    ]
  }
}
```

---

### 4. 删除快照

**端点**：`DELETE /api/v1/kvm/{vm_id}/snapshot/{snapshot_id}`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "snapshot_id": "snap-xyz789",
    "deleted_at": "2026-02-05T12:00:30Z",
    "storage_freed_gb": 2.1
  }
}
```

---

## 资源配额接口

### 1. 获取配额信息

**端点**：`GET /api/v1/quota/{session_id}`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "quota_id": "quota-123",
    "session_id": "session-123456",
    "cpu": {
      "cores": 4,
      "max_cores": 8,
      "usage_percent": 25.5
    },
    "memory": {
      "mb": 4096,
      "max_mb": 8192,
      "usage_mb": 1024
    },
    "storage": {
      "gb": 20,
      "max_gb": 100,
      "usage_gb": 5.2
    }
  }
}
```

---

### 2. 更新配额

**端点**：`PUT /api/v1/quota/{session_id}`

**请求**：
```json
{
  "cpu_cores": 8,
  "memory_mb": 8192,
  "storage_gb": 50
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "quota_id": "quota-123",
    "cpu_cores": 8,
    "memory_mb": 8192,
    "storage_gb": 50,
    "updated_at": "2026-02-05T12:00:00Z"
  }
}
```

---

## 状态监控接口

### 1. 获取实时状态

**端点**：`GET /api/v1/kvm/{vm_id}/state`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "state": "running",
    "uptime_seconds": 3600,
    "cpu_usage_percent": 12.5,
    "memory_usage_mb": 2048,
    "disk_usage_gb": 5.2,
    "network": {
      "in_bytes": 1024000,
      "out_bytes": 512000
    },
    "last_update": "2026-02-05T12:00:00Z"
  }
}
```

---

### 2. WebSocket 实时监控

**端点**：`WS /api/v1/kvm/{vm_id}/monitor`

**消息格式**：
```json
{
  "type": "state_update",
  "vm_id": "vm-abc123def456",
  "timestamp": "2026-02-05T12:00:00Z",
  "data": {
    "cpu_usage_percent": 12.5,
    "memory_usage_mb": 2048,
    "disk_usage_gb": 5.2
  }
}
```

---

### 3. 获取日志

**端点**：`GET /api/v1/kvm/{vm_id}/logs?lines=100&follow=false`

**查询参数**：
- `lines`：返回行数（默认 100）
- `follow`：持续跟踪（默认 false）

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "vm_id": "vm-abc123def456",
    "logs": [
      "[2026-02-05 12:00:00] VM started",
      "[2026-02-05 12:00:01] Network configured"
    ]
  }
}
```

---

## 错误处理

### 错误响应格式

```json
{
  "code": 400,
  "message": "Bad Request",
  "error": {
    "type": "INVALID_PARAMETER",
    "details": "cpu_cores must be between 1 and 32",
    "field": "cpu_cores"
  }
}
```

### 错误代码

| 代码 | 含义 | 说明 |
| :--- | :--- | :--- |
| 0 | SUCCESS | 成功 |
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未授权 |
| 403 | FORBIDDEN | 禁止访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突 |
| 429 | RATE_LIMITED | 速率限制 |
| 500 | INTERNAL_ERROR | 内部错误 |
| 503 | SERVICE_UNAVAILABLE | 服务不可用 |
| 507 | INSUFFICIENT_STORAGE | 存储不足 |

---

## 实现建议

### 技术栈

```
后端框架：FastAPI / aiohttp
虚拟化：libvirt Python bindings
存储：QEMU/KVM CoW 镜像
监控：psutil + custom metrics
数据库：SQLite / PostgreSQL
消息队列：Redis / RabbitMQ
```

### 部署架构

```
┌──────────────────────────────┐
│   KVM 管理服务               │
│   (localhost:8500)           │
├──────────────────────────────┤
│  - REST API                  │
│  - WebSocket 监控            │
│  - 后台任务处理              │
└──────────────────────────────┘
         ↓
┌──────────────────────────────┐
│   libvirt 守护进程           │
│   (unix:///system)           │
├──────────────────────────────┤
│  - VM 生命周期管理           │
│  - 存储管理                  │
│  - 网络管理                  │
└──────────────────────────────┘
         ↓
┌──────────────────────────────┐
│   QEMU/KVM                   │
│   (内核虚拟化)               │
└──────────────────────────────┘
```

### 高可用设计

1. **状态持久化**：所有 VM 配置存储在数据库
2. **自动恢复**：服务重启后自动恢复 VM 状态
3. **健康检查**：定期检查 VM 和 libvirt 健康状态
4. **故障转移**：支持多个 KVM 主机的故障转移

---

## 总结

本文档定义了完整的 KVM 管理接口，支持：

✅ 虚拟机生命周期管理  
✅ 固定+增量存储方案  
✅ 资源配额管理  
✅ Session-KVM 绑定  
✅ 实时监控和日志  
✅ 快照和恢复  
✅ 错误处理和重试  

下一步将实现 Agent Client 远程通信接口。


# Agent Client 远程通信接口 - 完整文档

**版本**：1.0.0  
**日期**：2026-02-05  
**基础**：OpenCode 架构 + Manus 通信模式

## 📋 目录

1. [概述](#概述)
2. [通信协议](#通信协议)
3. [消息格式](#消息格式)
4. [Agent 生命周期](#agent-生命周期)
5. [工具调用接口](#工具调用接口)
6. [文件操作接口](#文件操作接口)
7. [终端接口](#终端接口)
8. [浏览器控制接口](#浏览器控制接口)
9. [错误处理](#错误处理)

---

## 概述

### 系统架构

```
┌────────────────────────────────────────────────────────┐
│              Agent Client (OpenCode 二次开发)          │
│              (运行在本地或远程)                        │
├────────────────────────────────────────────────────────┤
│  ├── 核心 Agent 引擎                                   │
│  ├── 工具管理器                                        │
│  ├── 文件系统接口                                      │
│  ├── 终端管理器                                        │
│  ├── 浏览器控制器                                      │
│  └── 远程通信模块 (新增)                              │
└────────────────────────────────────────────────────────┘
         ↓ (WebSocket/HTTP)
┌────────────────────────────────────────────────────────┐
│        KVM 中的 Agent Runtime (localhost:9000)         │
│        (Sandbox Runtime 的扩展)                        │
├────────────────────────────────────────────────────────┤
│  ├── 消息路由器                                        │
│  ├── 工具执行器                                        │
│  ├── 文件系统                                          │
│  ├── 终端模拟器                                        │
│  ├── 浏览器驱动                                        │
│  └── 资源管理                                          │
└────────────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────────────┐
│              KVM 内部执行环境                          │
│  ├── 文件系统 (/home/ubuntu)                          │
│  ├── 终端 (bash/zsh)                                  │
│  ├── 浏览器 (Chromium)                                │
│  └── 其他工具                                          │
└────────────────────────────────────────────────────────┘
```

### 设计原则

1. **高效通信**：使用二进制协议减少开销
2. **异步处理**：支持异步消息和事件流
3. **可靠传输**：消息确认和重试机制
4. **流式传输**：支持大文件和长时间运行的任务
5. **错误恢复**：自动重连和状态恢复

---

## 通信协议

### 1. 连接建立

**初始化流程**：

```
Client                          Server (KVM)
  │                               │
  ├─── WebSocket Connect ────────→│
  │                               │
  │←── Connection Accepted ───────┤
  │                               │
  ├─── Hello Message ────────────→│
  │    {
  │      type: "hello",
  │      agent_id: "agent-123",
  │      version: "1.0.0"
  │    }
  │                               │
  │←── Ready Message ─────────────┤
  │    {
  │      type: "ready",
  │      server_version: "1.0.0"
  │    }
  │                               │
  └─── Ready ────────────────────→│
```

**端点**：`WS://kvm-host:9000/ws/agent/{agent_id}`

**认证**：
```
Header: Authorization: Bearer {token}
Header: X-Agent-ID: {agent_id}
Header: X-Session-ID: {session_id}
```

### 2. 连接管理

**心跳检测**：
```json
// 客户端 → 服务器 (每 30 秒)
{
  "type": "ping",
  "timestamp": "2026-02-05T12:00:00Z",
  "sequence": 1
}

// 服务器 → 客户端
{
  "type": "pong",
  "timestamp": "2026-02-05T12:00:00Z",
  "sequence": 1
}
```

**重连策略**：
- 指数退避：1s, 2s, 4s, 8s, 16s, 32s (最大)
- 最大重试：10 次
- 自动状态恢复

---

## 消息格式

### 1. 基础消息结构

```typescript
interface Message {
  // 必需字段
  id: string;                      // 消息 ID (UUID)
  type: string;                    // 消息类型
  timestamp: string;               // 时间戳 (ISO 8601)
  
  // 可选字段
  session_id?: string;             // Session ID
  agent_id?: string;               // Agent ID
  correlation_id?: string;         // 关联 ID (用于请求-响应配对)
  
  // 数据
  data?: Record<string, any>;      // 消息数据
  
  // 元数据
  metadata?: {
    priority?: 'low' | 'normal' | 'high';
    timeout_ms?: number;
    retry_count?: number;
  };
}
```

### 2. 消息类型

| 类型 | 方向 | 说明 |
| :--- | :--- | :--- |
| `hello` | C→S | 初始化连接 |
| `ready` | S→C | 服务器就绪 |
| `ping` | C→S | 心跳 |
| `pong` | S→C | 心跳响应 |
| `tool_call` | C→S | 工具调用请求 |
| `tool_result` | S→C | 工具调用结果 |
| `file_read` | C→S | 文件读取请求 |
| `file_write` | C→S | 文件写入请求 |
| `file_data` | S→C | 文件数据 |
| `terminal_exec` | C→S | 终端命令执行 |
| `terminal_output` | S→C | 终端输出 |
| `browser_action` | C→S | 浏览器操作 |
| `browser_result` | S→C | 浏览器操作结果 |
| `status` | S→C | 状态更新 |
| `error` | S→C | 错误消息 |
| `close` | C→S | 关闭连接 |

### 3. 请求-响应配对

```json
// 请求
{
  "id": "msg-001",
  "type": "tool_call",
  "correlation_id": "req-001",
  "data": {
    "tool": "search",
    "args": {"query": "python tutorial"}
  }
}

// 响应
{
  "id": "msg-002",
  "type": "tool_result",
  "correlation_id": "req-001",
  "data": {
    "result": {...},
    "status": "success"
  }
}
```

---

## Agent 生命周期

### 1. 初始化

**端点**：`POST /api/v1/agent/init`

**请求**：
```json
{
  "session_id": "session-123456",
  "vm_id": "vm-abc123def456",
  "agent_type": "build",
  "config": {
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 4096
  }
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "agent_id": "agent-xyz789",
    "session_id": "session-123456",
    "vm_id": "vm-abc123def456",
    "ws_url": "ws://kvm-host:9000/ws/agent/agent-xyz789",
    "token": "eyJhbGc...",
    "initialized_at": "2026-02-05T12:00:00Z"
  }
}
```

### 2. 消息处理

**WebSocket 消息流**：

```
Client                          Server
  │                               │
  ├─ Hello ─────────────────────→ │
  │                               │
  │ ← Ready ────────────────────── │
  │                               │
  ├─ Tool Call ──────────────────→ │
  │  (search)                      │
  │                               │
  │ ← Tool Result ─────────────── │
  │  (search results)              │
  │                               │
  ├─ File Read ──────────────────→ │
  │                               │
  │ ← File Data ───────────────── │
  │  (file contents)               │
  │                               │
  ├─ Terminal Exec ──────────────→ │
  │                               │
  │ ← Terminal Output ─────────── │
  │  (command output)              │
  │                               │
  └─ Close ──────────────────────→ │
```

### 3. 终止

**端点**：`POST /api/v1/agent/{agent_id}/terminate`

**请求**：
```json
{
  "graceful": true,
  "timeout_seconds": 10
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "agent_id": "agent-xyz789",
    "terminated_at": "2026-02-05T12:00:30Z",
    "final_state": "completed"
  }
}
```

---

## 工具调用接口

### 1. 工具调用请求

**消息格式**：
```json
{
  "id": "msg-001",
  "type": "tool_call",
  "correlation_id": "req-001",
  "data": {
    "tool": "search",
    "args": {
      "query": "python tutorial",
      "type": "info"
    },
    "timeout_ms": 30000
  }
}
```

### 2. 工具调用结果

**成功响应**：
```json
{
  "id": "msg-002",
  "type": "tool_result",
  "correlation_id": "req-001",
  "data": {
    "status": "success",
    "result": {
      "results": [
        {
          "title": "Python Tutorial",
          "url": "https://...",
          "description": "..."
        }
      ]
    },
    "execution_time_ms": 1234
  }
}
```

**错误响应**：
```json
{
  "id": "msg-003",
  "type": "tool_result",
  "correlation_id": "req-001",
  "data": {
    "status": "error",
    "error": {
      "code": "TOOL_TIMEOUT",
      "message": "Tool execution timeout after 30000ms"
    }
  }
}
```

### 3. 支持的工具

| 工具 | 说明 | 参数 |
| :--- | :--- | :--- |
| `search` | 网络搜索 | query, type (info\|image\|news\|api\|data\|research) |
| `browser_navigate` | 浏览器导航 | url, intent (navigational\|informational\|transactional) |
| `browser_click` | 点击元素 | index 或 coordinates |
| `browser_input` | 输入文本 | index, text, press_enter |
| `browser_scroll` | 滚动页面 | direction, target, to_end |
| `file_read` | 读取文件 | path, range |
| `file_write` | 写入文件 | path, text |
| `file_edit` | 编辑文件 | path, edits (find/replace) |
| `shell_exec` | 执行命令 | command, timeout |
| `generate_image` | 生成图像 | prompt, style |
| `generate_video` | 生成视频 | prompt, duration |
| `slides_create` | 创建幻灯片 | content, style |

---

## 文件操作接口

### 1. 文件读取

**请求**：
```json
{
  "id": "msg-010",
  "type": "file_read",
  "correlation_id": "req-010",
  "data": {
    "path": "/home/ubuntu/test.txt",
    "range": [1, 100],
    "encoding": "utf-8"
  }
}
```

**响应**：
```json
{
  "id": "msg-011",
  "type": "file_data",
  "correlation_id": "req-010",
  "data": {
    "path": "/home/ubuntu/test.txt",
    "content": "...",
    "size_bytes": 1024,
    "encoding": "utf-8",
    "is_complete": true
  }
}
```

### 2. 文件写入

**请求**：
```json
{
  "id": "msg-012",
  "type": "file_write",
  "correlation_id": "req-012",
  "data": {
    "path": "/home/ubuntu/output.txt",
    "content": "Hello, World!",
    "encoding": "utf-8",
    "mode": "w"
  }
}
```

**响应**：
```json
{
  "id": "msg-013",
  "type": "file_data",
  "correlation_id": "req-012",
  "data": {
    "path": "/home/ubuntu/output.txt",
    "bytes_written": 13,
    "status": "success"
  }
}
```

### 3. 文件编辑

**请求**：
```json
{
  "id": "msg-014",
  "type": "file_edit",
  "correlation_id": "req-014",
  "data": {
    "path": "/home/ubuntu/config.py",
    "edits": [
      {
        "find": "DEBUG = True",
        "replace": "DEBUG = False"
      },
      {
        "find": "PORT = 8000",
        "replace": "PORT = 9000"
      }
    ]
  }
}
```

**响应**：
```json
{
  "id": "msg-015",
  "type": "file_data",
  "correlation_id": "req-014",
  "data": {
    "path": "/home/ubuntu/config.py",
    "edits_applied": 2,
    "status": "success"
  }
}
```

---

## 终端接口

### 1. 命令执行

**请求**：
```json
{
  "id": "msg-020",
  "type": "terminal_exec",
  "correlation_id": "req-020",
  "data": {
    "command": "ls -la /home/ubuntu",
    "cwd": "/home/ubuntu",
    "timeout_ms": 30000,
    "env": {
      "PATH": "/usr/local/bin:/usr/bin"
    }
  }
}
```

**响应（流式）**：
```json
// 输出开始
{
  "id": "msg-021",
  "type": "terminal_output",
  "correlation_id": "req-020",
  "data": {
    "output": "total 48\n",
    "stream": "stdout",
    "is_final": false
  }
}

// 更多输出...

// 完成
{
  "id": "msg-022",
  "type": "terminal_output",
  "correlation_id": "req-020",
  "data": {
    "output": "",
    "stream": "stdout",
    "exit_code": 0,
    "is_final": true,
    "execution_time_ms": 1234
  }
}
```

### 2. 交互式终端

**请求（打开终端）**：
```json
{
  "id": "msg-030",
  "type": "terminal_open",
  "data": {
    "terminal_id": "term-001",
    "shell": "bash",
    "rows": 24,
    "cols": 80
  }
}
```

**请求（发送输入）**：
```json
{
  "id": "msg-031",
  "type": "terminal_input",
  "data": {
    "terminal_id": "term-001",
    "input": "python3 script.py\n"
  }
}
```

**响应（输出）**：
```json
{
  "id": "msg-032",
  "type": "terminal_output",
  "data": {
    "terminal_id": "term-001",
    "output": "Running script...\n",
    "stream": "stdout"
  }
}
```

---

## 浏览器控制接口

### 1. 导航

**请求**：
```json
{
  "id": "msg-040",
  "type": "browser_action",
  "correlation_id": "req-040",
  "data": {
    "action": "navigate",
    "url": "https://example.com",
    "intent": "informational",
    "timeout_ms": 30000
  }
}
```

**响应**：
```json
{
  "id": "msg-041",
  "type": "browser_result",
  "correlation_id": "req-040",
  "data": {
    "status": "success",
    "url": "https://example.com",
    "title": "Example Domain",
    "content_length": 1234,
    "screenshot": "data:image/webp;base64,..."
  }
}
```

### 2. 点击元素

**请求**：
```json
{
  "id": "msg-042",
  "type": "browser_action",
  "correlation_id": "req-042",
  "data": {
    "action": "click",
    "index": 5
  }
}
```

**响应**：
```json
{
  "id": "msg-043",
  "type": "browser_result",
  "correlation_id": "req-042",
  "data": {
    "status": "success",
    "action": "click",
    "element_found": true
  }
}
```

### 3. 输入文本

**请求**：
```json
{
  "id": "msg-044",
  "type": "browser_action",
  "correlation_id": "req-044",
  "data": {
    "action": "input",
    "index": 10,
    "text": "search query",
    "press_enter": true
  }
}
```

### 4. 滚动

**请求**：
```json
{
  "id": "msg-046",
  "type": "browser_action",
  "correlation_id": "req-046",
  "data": {
    "action": "scroll",
    "target": "page",
    "direction": "down",
    "to_end": false
  }
}
```

---

## 错误处理

### 1. 错误消息格式

```json
{
  "id": "msg-100",
  "type": "error",
  "correlation_id": "req-001",
  "data": {
    "code": "TOOL_NOT_FOUND",
    "message": "Tool 'unknown_tool' not found",
    "details": {
      "available_tools": ["search", "browser_navigate", ...]
    }
  }
}
```

### 2. 错误代码

| 代码 | 含义 | 说明 |
| :--- | :--- | :--- |
| `INVALID_MESSAGE` | 无效消息 | 消息格式错误 |
| `TOOL_NOT_FOUND` | 工具未找到 | 请求的工具不存在 |
| `TOOL_TIMEOUT` | 工具超时 | 工具执行超时 |
| `TOOL_ERROR` | 工具错误 | 工具执行失败 |
| `FILE_NOT_FOUND` | 文件未找到 | 指定的文件不存在 |
| `PERMISSION_DENIED` | 权限拒绝 | 没有权限执行操作 |
| `TERMINAL_ERROR` | 终端错误 | 终端执行失败 |
| `BROWSER_ERROR` | 浏览器错误 | 浏览器操作失败 |
| `CONNECTION_LOST` | 连接丢失 | 与服务器连接丢失 |
| `INTERNAL_ERROR` | 内部错误 | 服务器内部错误 |

### 3. 重试机制

```
请求发送
    ↓
等待响应 (timeout: 30s)
    ↓
超时或错误？
    ├─ 是 → 重试 (指数退避)
    │       重试次数 < 3？
    │       ├─ 是 → 重试
    │       └─ 否 → 返回错误
    └─ 否 → 返回结果
```

---

## 实现指南

### OpenCode 集成点

```typescript
// 在 OpenCode Agent 中添加远程通信模块
class RemoteAgentClient {
  private ws: WebSocket;
  private messageHandlers: Map<string, Handler>;
  
  async connect(url: string, token: string) {
    // 建立 WebSocket 连接
    // 发送 hello 消息
    // 等待 ready 消息
  }
  
  async callTool(tool: string, args: any) {
    // 发送 tool_call 消息
    // 等待 tool_result 消息
    // 返回结果
  }
  
  async readFile(path: string) {
    // 发送 file_read 消息
    // 接收 file_data 消息
    // 返回文件内容
  }
  
  async executeCommand(command: string) {
    // 发送 terminal_exec 消息
    // 流式接收 terminal_output 消息
    // 返回完整输出
  }
  
  async browserAction(action: string, args: any) {
    // 发送 browser_action 消息
    // 等待 browser_result 消息
    // 返回结果
  }
}
```

### KVM 服务实现

```typescript
// 在 KVM 中的 Agent Runtime 中实现
class RemoteAgentServer {
  private clients: Map<string, WebSocket>;
  
  handleConnection(ws: WebSocket) {
    // 验证连接
    // 注册客户端
    // 设置消息处理
  }
  
  handleMessage(ws: WebSocket, message: Message) {
    // 路由消息到相应处理器
    // 执行工具/文件/终端/浏览器操作
    // 返回结果
  }
  
  handleDisconnection(ws: WebSocket) {
    // 清理资源
    // 保存 Agent 状态
  }
}
```

---

## 总结

本文档定义了完整的 Agent Client 远程通信接口，支持：

✅ WebSocket 双向通信  
✅ 异步消息处理  
✅ 工具调用  
✅ 文件操作  
✅ 终端交互  
✅ 浏览器控制  
✅ 错误处理和重试  
✅ 连接管理和恢复  

下一步将实现 Session-KVM 调度接口。


# Session-KVM 调度接口 - 完整文档

**版本**：1.0.0  
**日期**：2026-02-05  
**核心概念**：每个 Session 对应一个独立的 KVM，Agent 运行在 KVM 中

## 📋 目录

1. [概述](#概述)
2. [调度流程](#调度流程)
3. [Session 管理接口](#session-管理接口)
4. [KVM 绑定接口](#kvm-绑定接口)
5. [生命周期管理](#生命周期管理)
6. [资源管理](#资源管理)
7. [故障恢复](#故障恢复)
8. [监控和日志](#监控和日志)

---

## 概述

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                 对话系统 (Conversation)                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Session #1 (User A)                             │  │
│  │  ├── Agent ID: agent-001                         │  │
│  │  ├── KVM ID: vm-001                              │  │
│  │  ├── Status: running                             │  │
│  │  └── Created: 2026-02-05 12:00:00                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Session #2 (User B)                             │  │
│  │  ├── Agent ID: agent-002                         │  │
│  │  ├── KVM ID: vm-002                              │  │
│  │  ├── Status: running                             │  │
│  │  └── Created: 2026-02-05 12:01:00                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Session #3 (User C)                             │  │
│  │  ├── Agent ID: agent-003                         │  │
│  │  ├── KVM ID: vm-003                              │  │
│  │  ├── Status: idle (等待任务)                     │  │
│  │  └── Created: 2026-02-05 12:02:00                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│          KVM 管理服务 (localhost:8500)                  │
├─────────────────────────────────────────────────────────┤
│  ├── VM 池管理                                          │
│  ├── 资源调度                                           │
│  ├── 存储管理                                           │
│  └── 监控告警                                           │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│       裸金属主机 (Bare Metal Host)                      │
├─────────────────────────────────────────────────────────┤
│  ├── KVM/QEMU 虚拟化                                   │
│  ├── libvirt 管理                                       │
│  └── 存储系统                                           │
└─────────────────────────────────────────────────────────┘
```

### 设计原则

1. **1:1 绑定**：每个 Session 对应一个 KVM
2. **生命周期同步**：Session 创建时创建 KVM，Session 关闭时销毁 KVM
3. **资源隔离**：每个 KVM 有独立的文件系统、内存、CPU
4. **自动调度**：自动选择合适的 KVM 主机
5. **故障恢复**：自动检测和恢复故障 KVM

---

## 调度流程

### 1. 完整的 Session 创建流程

```
用户发起对话
    ↓
创建 Session
    ↓
分配 KVM (从池中选择或创建新的)
    ↓
初始化 Agent
    ↓
等待 Agent 就绪
    ↓
返回 Session 信息
    ↓
用户开始交互
```

### 2. 详细的状态转换

```
Session 状态转换：
┌─────────────┐
│  PENDING    │  (等待 KVM 分配)
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ INITIALIZING│  (初始化 Agent)
└──────┬──────┘
       │
       ↓
┌─────────────┐
│   READY     │  (就绪，等待用户输入)
└──────┬──────┘
       │
       ├─→ ACTIVE (用户交互中)
       │
       ├─→ IDLE (空闲，等待用户输入)
       │
       └─→ TERMINATING (终止中)
           ↓
        ┌──────────┐
        │ TERMINATED│  (已终止)
        └──────────┘
```

### 3. KVM 状态转换

```
KVM 状态转换：
┌──────────┐
│ CREATING │  (创建中)
└────┬─────┘
     │
     ↓
┌──────────┐
│ STARTING │  (启动中)
└────┬─────┘
     │
     ↓
┌──────────┐
│ RUNNING  │  (运行中)
└────┬─────┘
     │
     ├─→ PAUSED (暂停)
     │
     ├─→ STOPPING (停止中)
     │   ↓
     │  ┌────────┐
     │  │ STOPPED│
     │  └────────┘
     │
     └─→ ERROR (错误)
```

---

## Session 管理接口

### 1. 创建 Session

**端点**：`POST /api/v1/session/create`

**请求**：
```json
{
  "user_id": "user-123",
  "project_id": "project-456",
  "agent_type": "build",
  "config": {
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 4096,
    "timeout_minutes": 60
  },
  "resource_quota": {
    "cpu_cores": 4,
    "memory_mb": 4096,
    "storage_gb": 20
  },
  "tags": {
    "environment": "development",
    "priority": "normal"
  }
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "user_id": "user-123",
    "project_id": "project-456",
    "agent_id": "agent-xyz789",
    "vm_id": "vm-123456",
    "status": "initializing",
    "agent_ws_url": "ws://kvm-host:9000/ws/agent/agent-xyz789",
    "agent_token": "eyJhbGc...",
    "created_at": "2026-02-05T12:00:00Z",
    "expires_at": "2026-02-05T13:00:00Z"
  }
}
```

**错误场景**：
- `400`：参数错误
- `507`：资源不足
- `503`：KVM 服务不可用

---

### 2. 获取 Session 信息

**端点**：`GET /api/v1/session/{session_id}`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "user_id": "user-123",
    "project_id": "project-456",
    "agent_id": "agent-xyz789",
    "vm_id": "vm-123456",
    "status": "ready",
    "agent_status": "connected",
    "vm_status": "running",
    "created_at": "2026-02-05T12:00:00Z",
    "expires_at": "2026-02-05T13:00:00Z",
    "last_activity": "2026-02-05T12:05:30Z",
    "resource_usage": {
      "cpu_percent": 15.5,
      "memory_mb": 1024,
      "storage_gb": 2.3
    }
  }
}
```

---

### 3. 列出 Session

**端点**：`GET /api/v1/session/list?user_id=user-123&status=ready&limit=10`

**查询参数**：
- `user_id`：用户 ID
- `project_id`：项目 ID
- `status`：Session 状态
- `limit`：返回数量
- `offset`：偏移量

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 5,
    "limit": 10,
    "offset": 0,
    "sessions": [
      {
        "session_id": "session-abc123def456",
        "user_id": "user-123",
        "status": "ready",
        "vm_id": "vm-123456",
        "created_at": "2026-02-05T12:00:00Z"
      }
    ]
  }
}
```

---

### 4. 更新 Session

**端点**：`PUT /api/v1/session/{session_id}`

**请求**：
```json
{
  "config": {
    "timeout_minutes": 120
  },
  "tags": {
    "priority": "high"
  }
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "updated_at": "2026-02-05T12:10:00Z"
  }
}
```

---

### 5. 关闭 Session

**端点**：`POST /api/v1/session/{session_id}/close`

**请求**：
```json
{
  "graceful": true,
  "timeout_seconds": 30,
  "save_state": true
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "status": "terminated",
    "vm_id": "vm-123456",
    "vm_status": "stopped",
    "closed_at": "2026-02-05T12:30:00Z",
    "duration_seconds": 1800,
    "resource_freed": {
      "cpu_cores": 4,
      "memory_mb": 4096,
      "storage_gb": 20
    }
  }
}
```

---

## KVM 绑定接口

### 1. 绑定 KVM 到 Session

**端点**：`POST /api/v1/session/{session_id}/bind-kvm`

**请求**：
```json
{
  "vm_id": "vm-123456",
  "auto_start": true,
  "wait_ready": true
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "binding_id": "binding-xyz789",
    "session_id": "session-abc123def456",
    "vm_id": "vm-123456",
    "agent_id": "agent-xyz789",
    "status": "ready",
    "bound_at": "2026-02-05T12:00:30Z"
  }
}
```

---

### 2. 解绑 KVM

**端点**：`POST /api/v1/session/{session_id}/unbind-kvm`

**请求**：
```json
{
  "cleanup": true,
  "force": false
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "vm_id": "vm-123456",
    "unbound_at": "2026-02-05T12:30:00Z"
  }
}
```

---

### 3. 获取绑定信息

**端点**：`GET /api/v1/session/{session_id}/binding`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "binding_id": "binding-xyz789",
    "session_id": "session-abc123def456",
    "vm_id": "vm-123456",
    "agent_id": "agent-xyz789",
    "status": "ready",
    "bound_at": "2026-02-05T12:00:30Z",
    "vm_info": {
      "state": "running",
      "ip_address": "192.168.122.100",
      "cpu_usage": 15.5,
      "memory_usage_mb": 1024
    }
  }
}
```

---

## 生命周期管理

### 1. 自动超时管理

**配置**：
```json
{
  "session_timeout_minutes": 60,
  "idle_timeout_minutes": 30,
  "cleanup_delay_minutes": 5
}
```

**流程**：
```
Session 创建
    ↓
活跃时间戳更新 (每次用户交互)
    ↓
检查空闲时间
    ├─ 空闲 > 30 分钟？
    │  ├─ 是 → 标记为 IDLE
    │  └─ 否 → 继续
    │
    ├─ 总时间 > 60 分钟？
    │  ├─ 是 → 关闭 Session
    │  └─ 否 → 继续
    │
    └─ 继续监控
```

### 2. 优雅关闭

**端点**：`POST /api/v1/session/{session_id}/graceful-shutdown`

**请求**：
```json
{
  "timeout_seconds": 30,
  "save_state": true,
  "notify_user": true
}
```

**流程**：
```
1. 通知 Agent 准备关闭
2. 等待当前任务完成 (最多 30 秒)
3. 保存 Agent 状态
4. 关闭 Agent
5. 停止 KVM
6. 清理资源
```

---

## 资源管理

### 1. 资源配额管理

**端点**：`GET /api/v1/session/{session_id}/quota`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "quota": {
      "cpu": {
        "allocated": 4,
        "used": 0.6,
        "percent": 15
      },
      "memory": {
        "allocated_mb": 4096,
        "used_mb": 1024,
        "percent": 25
      },
      "storage": {
        "allocated_gb": 20,
        "used_gb": 2.3,
        "percent": 11.5
      }
    }
  }
}
```

### 2. 资源告警

**告警条件**：
```
CPU 使用率 > 80% → 警告
内存使用率 > 90% → 警告
存储使用率 > 95% → 错误
```

**告警消息**：
```json
{
  "type": "resource_alert",
  "session_id": "session-abc123def456",
  "severity": "warning",
  "resource": "memory",
  "current_usage_percent": 92,
  "threshold_percent": 90,
  "timestamp": "2026-02-05T12:15:00Z"
}
```

---

## 故障恢复

### 1. 自动故障检测

**检测机制**：
```
每 30 秒检查一次：
├── Agent 连接状态
├── KVM 运行状态
├── 磁盘空间
├── 内存可用性
└── 网络连接
```

### 2. 故障恢复策略

| 故障类型 | 恢复策略 |
| :--- | :--- |
| Agent 连接丢失 | 自动重连 (3 次) |
| KVM 崩溃 | 自动重启 KVM |
| 磁盘满 | 清理临时文件，告警 |
| 内存不足 | 扩展内存或告警 |
| 网络中断 | 自动重连 |

### 3. 恢复接口

**端点**：`POST /api/v1/session/{session_id}/recover`

**请求**：
```json
{
  "force": false,
  "keep_data": true
}
```

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "recovered_at": "2026-02-05T12:20:00Z",
    "recovery_type": "agent_reconnect",
    "data_preserved": true
  }
}
```

---

## 监控和日志

### 1. 实时监控

**端点**：`WS /api/v1/session/{session_id}/monitor`

**消息格式**：
```json
{
  "type": "status_update",
  "session_id": "session-abc123def456",
  "timestamp": "2026-02-05T12:00:00Z",
  "data": {
    "session_status": "ready",
    "agent_status": "connected",
    "vm_status": "running",
    "resource_usage": {
      "cpu_percent": 15.5,
      "memory_mb": 1024,
      "storage_gb": 2.3
    }
  }
}
```

### 2. 事件日志

**端点**：`GET /api/v1/session/{session_id}/events?limit=100`

**响应**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "session_id": "session-abc123def456",
    "events": [
      {
        "event_id": "evt-001",
        "type": "session_created",
        "timestamp": "2026-02-05T12:00:00Z",
        "details": {...}
      },
      {
        "event_id": "evt-002",
        "type": "agent_connected",
        "timestamp": "2026-02-05T12:00:05Z",
        "details": {...}
      }
    ]
  }
}
```

### 3. 审计日志

**记录内容**：
- Session 创建/关闭
- Agent 连接/断开
- 资源配额变更
- 错误和告警
- 用户操作

---

## 实现建议

### 技术栈

```
后端框架：FastAPI / aiohttp
消息队列：Redis / RabbitMQ
数据库：PostgreSQL / SQLite
监控：Prometheus + Grafana
日志：ELK Stack / Loki
```

### 部署架构

```
┌──────────────────────────────────┐
│   Session 管理服务               │
│   (localhost:8000)               │
├──────────────────────────────────┤
│  - REST API                      │
│  - WebSocket 监控                │
│  - 调度引擎                      │
└──────────────────────────────────┘
         ↓
┌──────────────────────────────────┐
│   KVM 管理服务                   │
│   (localhost:8500)               │
├──────────────────────────────────┤
│  - VM 生命周期                   │
│  - 资源管理                      │
│  - 存储管理                      │
└──────────────────────────────────┘
         ↓
┌──────────────────────────────────┐
│   Agent Runtime (KVM 内部)       │
│   (localhost:9000)               │
├──────────────────────────────────┤
│  - Agent 执行                    │
│  - 工具调用                      │
│  - 文件操作                      │
└──────────────────────────────────┘
```

### 高可用设计

1. **多 KVM 主机支持**：支持多个裸金属主机
2. **负载均衡**：自动分配 Session 到不同主机
3. **故障转移**：主机故障时自动迁移 Session
4. **状态持久化**：Session 状态存储在数据库
5. **快速恢复**：支持快速恢复故障 Session

---

## 总结

本文档定义了完整的 Session-KVM 调度接口，支持：

✅ Session 生命周期管理  
✅ KVM 自动分配和绑定  
✅ 资源配额管理  
✅ 自动故障检测和恢复  
✅ 实时监控和日志  
✅ 优雅关闭和清理  
✅ 多 Agent 支持  
✅ 高可用设计  

这三个接口文档（KVM 管理、Agent 通信、Session 调度）共同构成了完整的 Altus Sandbox 管理系统。
