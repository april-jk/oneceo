# KVM 1.3.3fix5 Root 后复测快照（2026-02-20）

## 1. 结论摘要
1. 权限修复已生效：`/v1/sandboxes` 可创建成功，`/v1/sessions/{sid}/files` 与 `/v1/vms/{name}/files` 上传可完成。  
2. 当前主问题转移到网络/映射一致性：新建 sandbox 普遍卡在 `osac_ready`，`failure_reason=VM_PORT_NOT_READY`，relay 访问偶发/持续 `503`。  
3. 发现运行中 sandbox 出现重复 IPv4（`172.28.0.172` 被多台 VM 同时占用），会直接导致 ready gate 与 relay 抖动。

## 2. 版本确认
- `/health` 返回：`1.3.3fix5`

## 3. 已验证通过项
### 3.1 sandbox 创建恢复
- `POST /v1/sandboxes` 已返回 `201 SANDBOX_CREATED`。  
- 样例 request_id：
  - `81d6ea5f-3ebf-4e3a-9cb9-ded8513188d8`
  - `d5961016-12e8-46f6-bd19-435d386949e9`
  - `38467b2b-e76d-418f-8431-d664ec0032e2`

### 3.2 上传链路恢复
- `POST /v1/sessions/{sid}/files`：返回 `202 FILE_JOB_ACCEPTED`，轮询 job 到 `completed`。  
- `POST /v1/vms/{name}/files`：不再路由到 vm action，同样可完成。  
- 成功样例：
  - session: `sess_3d25ad8ffd09472c`
  - vm: `sandbox_sess_00ec3ad22c95406a`
  - 4 类上传（session/vm + guest/drop）均 `completed`。

## 4. 当前阻塞项
### 4.1 ready gate 长时间停留
- 新建 sandbox 查询结果长期为：
  - `lifecycle_state=creating`
  - `lifecycle_stage=osac_ready`
  - `ready_gate.failure_reason=VM_PORT_NOT_READY`

### 4.2 relay 对新建 sandbox 不稳定
- 在 VM 内确认 `osac` 已监听 `18080` 后，KVM relay 仍多次返回 `503`。  
- 另有 `409 mapping_not_ready`（OSAC 映射门禁）场景。

### 4.3 关键证据：运行中 VM 出现重复 IPv4
- 运行中 sandbox 列表中，以下 VM 同时报告 `172.28.0.172`：
  - `sandbox_sess_003fd14316ef4b5e`
  - `sandbox_sess_0042e555cc414cae`
  - `sandbox_sess_00ec3ad22c95406a`
  - `sandbox_sess_0310ee1bc7ee4c69`
  - `sandbox_sess_1b37b3accdf3445a`
  - `sandbox_sess_13b635d086c1494b`

## 5. 下一步建议（给 KVM 团队）
1. 修复 sandbox 网络分配唯一性，确保 running VM IPv4 唯一。  
2. 清理 stale lease 与旧映射，避免复用错误 IP。  
3. ready gate 与 relay 目标选择要与最新绑定 VM/IP 强一致；检测到 IP 冲突应返回明确机读错误，而不是长时间停留 `creating`。  
4. 提供一次 20 轮新建 sandbox 压测结果，包含：IP 分配、ready 耗时、relay 成功率。
