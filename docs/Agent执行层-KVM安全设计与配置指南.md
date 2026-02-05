# Altus Agent 执行层 KVM 安全策略与配置指南

## 1. 文档目标

本指南用于规范 oneceo.ai 在 Agent 执行层使用 KVM 的安全设计与实施方式，重点防止：

- 虚拟机逃逸影响宿主机
- 横向访问内网资产
- 会话间数据泄露
- 凭证泄露与越权调用

本指南适用于：

- `kvm-orchestrator`（KVM 编排服务）
- `apps/api` 连接器层（`kvm-connector`）
- Agent 执行运行时（Session 绑定 VM）

---

## 2. 安全设计原则

1. **默认拒绝（Default Deny）**：网络、权限、系统调用均从拒绝开始，按需放行。
2. **最小权限（Least Privilege）**：服务账户、Token、工具能力仅授予必要权限。
3. **分层隔离（Defense in Depth）**：虚拟化、存储、网络、应用、审计多层防护。
4. **短生命周期（Ephemeral by Default）**：Session 结束即清理，降低长期驻留风险。
5. **可追踪（Auditable）**：每次关键操作可定位到 request/session/vm/operator。

---

## 3. 架构安全边界

### 3.1 控制面与执行面分离

- 控制面：`apps/api` + `kvm-orchestrator`
- 执行面：KVM 虚拟机内 Agent Runtime

要求：

- `apps/api` 仅通过 `kvm-connector` 调用 KVM 服务；禁止直接 `virsh/libvirt`。
- `kvm-orchestrator` 仅暴露受控 API，不暴露宿主机管理接口。

### 3.2 Session 与 VM 1:1 隔离

- 每个 Session 对应单独 VM 和独立增量盘。
- 严禁多个 Session 共享同一执行环境。

---

## 4. 虚拟化层安全配置（宿主机）

### 4.1 libvirt / qemu 基线

- 使用 `qemu:///system`，由 systemd 管理 libvirtd。
- 开启 sVirt（SELinux/AppArmor）隔离 qemu 进程。
- 禁止高危直通：
  - 禁用 PCI passthrough（默认）
  - 禁用 USB passthrough（默认）
  - 禁用宿主目录任意挂载

### 4.2 资源限制

默认配额（可配置）：

- CPU：4 核
- 内存：4GB
- 磁盘：20GB（增量盘）

高负载任务可提升，但必须通过配额接口并写审计日志。

### 4.3 禁止宿主敏感资产映射

严禁映射到 VM：

- `/var/run/docker.sock`
- `/root/.ssh`
- 云厂商 metadata 凭据目录
- 宿主机业务源码目录

---

## 5. 存储安全策略

### 5.1 镜像策略

- Base Image：只读、版本化、签名校验（建议 SHA256）
- 增量盘：每 Session 单独 qcow2（backing file 指向 base）

路径建议：

- Base: `/var/lib/libvirt/images/altus-base-ubuntu22.qcow2`
- Incremental: `/var/lib/libvirt/images/incremental/{session_id}.qcow2`

### 5.2 快照策略

- 关键节点快照：`before_task`、`before_apply`、`after_success`
- 回滚需记录操作人、原因、快照 ID

### 5.3 清理策略

- Session 关闭后：
  1) 停机
  2) 删除增量盘
  3) 清理临时快照
  4) 清理运行日志索引

---

## 6. 网络安全策略（重点）

### 6.1 出站默认拒绝

VM 出站采用白名单放行，仅允许必要目标（例如：

- LLM API 域名
- 包管理仓库（可选）
）

### 6.2 内网隔离

默认阻断以下网段：

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

如业务必须访问内网，须申请明确白名单且可审计。

### 6.3 横向访问隔离

- 禁止 VM 之间互通
- 禁止 VM 访问宿主控制接口（libvirt、管理端口）

---

## 7. 执行层（Agent Runtime）安全策略

### 7.1 工具能力最小化

默认关闭高风险能力：

- 任意端口暴露/转发
- 未授权浏览器自动化
- 未授权远程下载执行

### 7.2 命令执行策略

- 命令白名单优先，黑名单兜底（禁止内核/网络配置类命令）
- 每次执行强制：
  - 超时限制
  - CPU/内存限制
  - 工作目录限制

### 7.3 文件访问策略

- 仅允许工作区目录读写
- 禁止访问系统关键路径（如 `/etc`, `/proc`, `/sys`）

---

## 8. 认证、鉴权与密钥管理

### 8.1 API 鉴权

`kvm-orchestrator` 使用 Bearer Token，支持角色：

- `readonly`
- `operator`
- `admin`（兼容 operator）

### 8.2 Token 管理要求

- 不在代码仓库硬编码 Token
- Token 定期轮换
- 支持最短生存期与吊销

### 8.3 凭证注入原则

- 使用环境变量或密钥管理服务注入
- VM 内不落地长期密钥

---

## 9. 审计与可观测性

### 9.1 必要追踪字段

所有关键接口日志需包含：

- `request_id`
- `session_id`
- `vm_id`
- `operation_id`
- `operator_role`

### 9.2 关键事件审计

- Session 创建/绑定/关闭
- VM 启停/重启/快照/回滚
- 配额变更
- 异常失败（401/409/504/500）

### 9.3 安全告警

触发条件示例：

- 多次认证失败
- 访问被阻断内网地址
- 高频高危命令命中策略
- 资源异常飙升

---

## 10. 失败与恢复策略

1. 控制动作优先异步执行（返回 job_id）
2. 后端操作超时必须明确返回 504
3. VM 崩溃可自动重试一次，仍失败则标记隔离
4. 恢复动作必须有审计记录（恢复前状态、恢复后状态）

---

## 11. 落地配置清单（执行前核查）

### 宿主机

- [ ] libvirtd 正常运行，`qemu:///system` 可用
- [ ] SELinux/AppArmor 已启用
- [ ] Base image 只读并完成校验
- [ ] 增量盘目录权限最小化
- [ ] 防火墙默认拒绝 + 白名单已配置

### 编排服务

- [ ] Token 鉴权开启
- [ ] 角色权限生效（readonly/operator/admin）
- [ ] request_id / operation_id 可追踪
- [ ] 统一错误 envelope 生效

### API 连接器层

- [ ] 所有 KVM 接口必须经过 `kvm-connector`
- [ ] 不在业务代码中直连 KVM 服务
- [ ] 参数与响应转换统一在连接器完成

---

## 12. 与当前仓库对应的实施约束

- `apps/api/src/connectors/kvm-connector.ts` 为唯一 KVM 入口。
- `apps/api/src/routes/sandbox-routes.ts` 只能调用连接器，不得直接请求上游。
- 后续接入执行层任务时，先绑定 Session->VM，再开放工具执行。

---

## 13. 后续建议

1. 引入 eBPF/审计增强（进程与网络行为观测）
2. 引入策略引擎（OPA）进行执行前策略判定
3. 引入镜像签名与供应链扫描（SBOM）
4. 引入多宿主机调度与故障转移策略
