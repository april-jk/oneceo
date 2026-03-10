# KVM 修复工单模板（creating/ready 一致性与 ready gate）

工单编号：`<填写>`  
优先级：`P0`  
提出日期：`<YYYY-MM-DD>`  
期望完成日期：`<YYYY-MM-DD>`  
提出团队：`编排/API`  
承接团队：`KVM Orchestrator`

## 1. 工单标题（可直接用）
`[P0] 修复 sandbox creating/ready 状态与真实 VM/OSAC/端口可用性一致性`

## 2. 背景
当前联调中出现以下问题：
1. 编排侧记录为 `creating/ready`，但 KVM 侧会话不存在或未绑定 VM。
2. 编排侧显示 `ready`，但 VM 内 OSAC 进程不存在或 `127.0.0.1:18111` 不可用。
3. hostPort 映射存在但不可达，导致上层请求失败（如 `ECONNREFUSED`）。
4. 服务重启后状态未自动收敛，遗留脏会话导致后续调度污染。

## 3. 目标
1. `creating/ready` 状态必须与真实运行态一致。
2. `ready` 必须通过硬性 ready gate，不允许“假 ready”。
3. KVM 重启后自动收敛历史脏状态。
4. 提供可机读错误码和可观测字段，便于编排自动恢复与判责。

## 4. 修改范围
`In Scope`
1. sandbox 生命周期状态机
2. session-vm 绑定一致性
3. ready gate 判定与输出
4. 端口映射探测与刷新
5. 重启后 reconcile 任务
6. 错误码与日志字段补齐

`Out of Scope`
1. OSAC 二进制内部逻辑修改
2. 上游 LLM 供应商网络质量问题
3. 编排侧业务策略变更（除接口对接适配外）

## 5. 必改项（开发任务拆分）
### 任务 A：状态机真值化
1. 引入并对外暴露生命周期状态：`creating -> binding -> vm_starting -> guest_agent_ready -> osac_ready -> port_ready -> ready`，失败进入 `failed`。
2. 任一步失败必须记录 `reason_code` 和 `failed_stage`。
3. 严禁长期停留在 `creating`（超时必须收敛为 `failed` 或触发补偿）。

### 任务 B：绑定一致性与补偿
1. `create session -> bind vm -> start vm` 增加补偿逻辑。
2. 若出现 `SESSION_NOT_FOUND`/`SESSION_VM_NOT_BOUND`，自动修复或标记失败并清理。
3. 对孤儿记录执行清理，禁止 DB 与 KVM 状态漂移。

### 任务 C：ready gate 硬门禁
`ready` 仅在以下全部满足时返回：
1. VM 状态 `running`
2. session 已绑定 VM
3. guest-agent 可用
4. VM 内 OSAC 进程存在
5. VM 内 `18080`/`18111` 可连
6. hostPort 映射可连（含探测）

### 任务 D：端口映射有效性
1. `GET /v1/sandboxes/{session_id}/ports?verify=true&refresh=true` 返回实时探测结果。
2. 增加字段：`vm_port_ready`、`host_port_ready`、`vm_error`、`host_error`、`mapping_epoch`、`last_checked_at`。
3. VM IP 变化后自动刷新映射，防止 stale hostPort。

### 任务 E：重启后 reconcile
1. 服务启动后自动扫描最近会话并收敛状态。
2. 规则示例：
`ready` 但 OSAC 不在 -> 降级 `creating` 或 `failed`。  
`creating` 但 session 不存在 -> `failed`。  
`creating` 但可修复 -> 自动补绑/重启/重建映射。

### 任务 F：错误码与可观测性
建议新增错误码：
1. `SANDBOX_READY_GATE_FAILED`
2. `SANDBOX_STALE_CREATING`
3. `SANDBOX_PORT_NOT_READY`
4. `SANDBOX_BINDING_MISSING`

日志与事件最小字段：
1. `request_id`
2. `session_id`
3. `vm_name`
4. `job_id`
5. `lifecycle_state`
6. `reason_code`
7. `host_port`
8. `mapping_epoch`

## 6. 接口交付要求
### `GET /v1/sandboxes/{session_id}`
必须包含：
1. `lifecycle_state`
2. `ready_gate`（结构化详情）
3. `last_error`（结构化对象）

### `GET /v1/sandboxes/{session_id}/ports`
在 `verify=true` 时必须包含：
1. `vm_port_ready`
2. `host_port_ready`
3. `vm_error`
4. `host_error`
5. `mapping_epoch`
6. `last_checked_at`

## 7. 验收标准（硬门槛）
1. 连续 20 轮创建流程中，`creating` 最终全部收敛到 `ready` 或 `failed`，无悬挂。
2. 不再出现“接口返回 ready，但 VM 内 `NO_OSAC_PID` 或 `18111` 拒连”。
3. KVM 重启后 5 分钟内，历史会话状态自动校准完成。
4. 端口映射 `verify` 结果与真实连通性一致。
5. 任意失败样本可通过 `request_id + session_id` 快速定位根因。

## 8. 回归测试建议
1. 冷启动场景：新建 20 个 sandbox，统计 `ready/failed` 收敛时间与分布。
2. 抖动场景：重启 KVM 服务后执行 20 轮创建与调用。
3. 漂移场景：模拟 VM IP 变化，验证端口映射自动刷新。
4. 压测场景：并发创建与销毁，验证无新增悬挂 `creating`。

## 9. 交付物清单
1. 代码分支/提交记录
2. 接口变更说明（字段与错误码）
3. 回归报告（20 轮结果与失败分布）
4. 样例日志（成功链路与失败链路各至少 1 组）

## 10. 风险与回滚
风险：
1. gate 变严格后短期 `failed` 比例可能上升（暴露真实问题）。
2. reconcile 逻辑可能误伤边界状态，需灰度与白名单。

回滚：
1. 保留开关：`ready_gate_strict`（临时可降级为 soft gate）。
2. 发布回滚策略：回退到上一个稳定 tag。

## 11. 负责人
KVM Owner：`<填写>`  
联调 Owner（编排）：`<填写>`  
群组/频道：`<填写>`

## 12. 附件（提交工单时附上）
1. 编排侧失败样本（含 request_id/session_id）
2. OSAC 日志字段对照表（fix10p5）
3. 当前 KVM API 文档（v1.3.2）

