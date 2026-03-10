# 增量变更说明（1.3.2fix5）

本文件用于编排团队快速了解本次增量修改与需要适配的行为。

## 1) 端口映射可用性返回（不阻塞）
- **创建端口映射** `POST /v1/sandboxes/{session_id}/ports`
  - 响应新增：
    - `port_ready`：直连 VM + 转发是否均可访问
    - `port_ready_detail`：
      - `vm_port_ready` / `host_port_ready`
      - `vm_error` / `host_error`
  - 若未就绪：`code=PORT_MAPPING_PENDING`，`message` 提示继续等待启动
  - 不阻塞、不强制等待

- **自动端口映射**（sandbox 创建时）
  - 响应新增：
    - `port_mapping`
    - `port_mapping_ready`
    - `port_mapping_detail`（同上）

## 2) 端口映射刷新与持久化
- 端口映射持久化到 `port-mappings.json`
- 服务重启后自动恢复并周期性刷新（默认 20s）
- GET `/v1/sandboxes/{session_id}/ports`
  - `refresh=true`（默认）：刷新并修复映射
  - `verify=true`：返回附加连通性探测结果
  - `wait_seconds`：等待探测（0–60）

## 3) 自动端口映射范围调整
- `KVM_ORCH_AUTO_PORT_RANGE` 默认 `20000-21999`
- 当前环境设置为 `20000-30000`

## 4) 端口转发链路修复
- 规则覆盖 `PREROUTING + OUTPUT + FORWARD`，保证本机与外部均可达
- 内网回包放行（ESTABLISHED/RELATED）

## 5) 主镜像扩容
- 新主镜像：`ubuntu-22.04-base-v5.qcow2`（20G）
- 旧 v1–v4 已标记并清理

## 6) Exec 参数容错
- `path` 含空格时自动拆分为 `path + args`（兼容编排端历史调用）

