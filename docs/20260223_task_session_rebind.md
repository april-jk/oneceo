# 任务会话重绑记录（2026-02-23）

## 背景
- KVM `kvm-orchestrator` 重启后，原 `session_id` 不再可用，导致编排平台通过旧 session 访问 OSAC 时出现 `Session not found`。
- 需要新建 session 并绑定到现有 VM（`test_session_manual_use`），同步更新本地任务会话与沙盒运行环境的绑定信息。

## 处理步骤
1. 在主平台 API 侧执行脚本 `oneceo/apps/api/scripts/_tmp_rebind_fixed_session.ts`。
2. 新建 KVM session（自动生成新的 `session_id`）。
3. 绑定 VM：`test_session_manual_use`。
4. 更新任务会话与沙盒环境关联信息（包含 `sessionId`、`osacMappingId` 等）。

## 关键结果
- 新 session：`sess_2268662a2c624117`。
- 任务会话：`53523b84-48d9-427a-9252-7158ff856a1b` 重新绑定完成。
- API 校验：
  - `GET /api/task-creation/sessions/<taskSessionId>/workspace/tree` 返回 200。
  - `GET /api/task-creation/sessions/<taskSessionId>/workspace/file?path=...` 返回 200。

## 影响范围
- 仅更新任务会话与沙盒运行环境绑定。
- 不涉及 VM 侧文件变更。

## 备注
- 该脚本为一次性修复用途，后续建议在服务侧补充自动重绑/恢复策略。
