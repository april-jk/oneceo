# kvm-orchestrator 新增下发文件功能清单

本文档用于描述 kvm-orchestrator 需要新增的“向指定 VM 下发文件”能力的功能清单与接口要求，供设计与开发实现参考。

## 1. 能力范围

- 向指定 VM 下发文件（通过 sessionId 或 vmName 定向）
- 支持单文件与目录（目录通过 zip/tar.gz 打包下发）
- 支持覆盖/替换/禁止覆盖策略
- 支持文件夹不存在时自动创建
- 可选：删除已下发文件、清理目录

## 2. 认证与权限

- 复用现有 Bearer Token 鉴权
- 仅允许 `operator` / `admin` 角色使用
- 必须校验 sessionId 与 vmName 的绑定关系（禁止越权）

## 3. API 形态（建议）

### 3.1 上传文件（VM）

`POST /v1/vms/{name}/files`

### 3.2 上传文件（Session）

`POST /v1/sessions/{sessionId}/files`

### 3.3 任务查询

`GET /v1/jobs/{jobId}`

> 建议所有上传均返回 `jobId`，并提供查询与日志接口。

## 4. 传输方式

- 支持分片上传（chunked），用于大文件
- 支持断点续传（resume）
- 支持压缩包上传（zip/tar.gz）
- 支持超时与重试

## 5. 目标路径与权限

- 允许指定目标路径（默认工作目录）
- 目标路径需通过白名单或沙盒目录限制
- 可选：指定文件权限（chmod）与 owner（若支持）

## 6. 完整性校验

- 客户端提供 `sha256`（或其他 hash）
- 服务端校验后才算完成
- 返回校验结果与差异说明

## 7. 任务模型

- 异步执行：返回 `jobId`
- 任务状态：`queued` / `running` / `completed` / `failed`
- 失败必须返回明确错误信息（含可重试建议）

## 8. 安全与审计

- 记录审计字段：
  - `request_id`
  - `session_id`
  - `vm_name`
  - `file_name`
  - `file_size`
  - `operator`
  - `timestamp`
- 禁止写入系统敏感路径：
  - `/etc`
  - `/root`
  - `/proc`
  - `/sys`
  - `/var/lib/libvirt`

## 9. VM 侧执行机制（候选）

需要明确 VM 内实际落盘机制（以下任选其一或组合）：

1. guest-agent（推荐）
2. SSH 传输（需要证书/密钥管理）
3. VM 内预置 Agent 拉取

要求：
- 能准确报告执行失败原因
- 支持超时控制与回滚

## 10. 典型调用示例

```bash
# 通过 session 下发文件
curl -X POST -H 'Authorization: Bearer <TOKEN>' \
  -F 'file=@./bundle.tar.gz' \
  -F 'targetPath=/home/ubuntu/agent' \
  http://<kvm-orchestrator>/v1/sessions/<sessionId>/files

# 查询任务状态
curl -H 'Authorization: Bearer <TOKEN>' \
  http://<kvm-orchestrator>/v1/jobs/<jobId>
```

---

## 11. 可选扩展（如需）

- 反向回传文件（VM → Orchestrator）
- 目录同步（rsync-like）
- 上传速率限制
- 全量/增量 checksum

