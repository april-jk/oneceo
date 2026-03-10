# 固定 Sandbox 会话自动修复（2026-02-24）

## 问题背景
- 任务执行阶段报错：`Guest agent 未就绪，无法下发文件`。
- KVM 显示 VM 正在运行，但固定 session 不存在，且 VM 实际绑定到另一 session。
- 绑定新 session 时返回 `VM_ALREADY_BOUND`，并提供 `owner_session_id`。

## 根因
- KVM Orchestrator 重启后丢失 session 状态，但 VM 仍被旧 session 绑定。
- 主平台固定 session 配置仍指向失效的 session id，导致调度失败。

## 修复策略
1. 固定 session 逻辑增加自愈：
   - 先按 `vmName` 查找最近的环境记录，自动切换到最新 session。
   - 若 session 不存在则创建新 session，并尝试绑定到固定 VM。
   - 若绑定返回 `VM_ALREADY_BOUND`，读取 `owner_session_id` 并切换到该 session。
   - 自动更新内存配置 `fixedSandboxConfig.sessionId` 与 metadata（`fixedSandbox.sessionId`、`osacMappingId`）。
2. 本地配置同步更新为当前有效 session id：
   - `oneceo/apps/api/.env` 中 `OSAC_FIXED_SANDBOX_SESSION_ID` 更新为 `sess_2268662a2c624117`。

## 关键改动
- `oneceo/apps/api/src/services/sandbox-agent-provision-service.ts`
  - 新增固定 session 自愈逻辑（检测 session 丢失、处理 VM_ALREADY_BOUND、自动切换 owner_session_id）。
- `oneceo/apps/api/src/db/dao/sandbox-execution-environment.dao.ts`
  - 新增 `findLatestByVmName`，用于按 VM 获取最近的 session 记录。

## 验证
- Guest agent 探活成功（`_tmp_guest_agent_probe.ts`）：`sess_2268662a2c624117` 执行 `/bin/true` 返回 `exitcode=0`。
- OSAC 监听正常（`_tmp_osac_listener_check.ts`）：端口 `18080` 监听，日志仅有未带 Token 的拒绝提示。

## 备注
- 若后续再次出现 `VM_ALREADY_BOUND` 且 `owner_session_id` 不存在，需要手动在 KVM 侧释放绑定后重试。
