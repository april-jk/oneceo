# auto report 2026-04-09

- 做了什么：
  - 认领并处理 Issue #43（历史 session 续聊时工作区文件未恢复）。
  - 全链路排查了文件保存/归档/恢复流程，定位到 `Altus managed` 的两个关键缺口：
    1. `ensureSandbox` 旁路复用导致暂停沙箱误判可用。
    2. `write_file/shell_execute/附件写入` 未标记 dirty，归档任务可能跳过最新增量。
  - 已完成修复：
    1. `altus-managed-setup-service.ensureSandbox` 统一接入 `sandboxAgentProvisionService.provisionWithLock`。
    2. `altus-managed-tool-runtime` 的 `shell_execute`、`write_file`、`mcp tool` 成功后标记 `markSandboxDirty`。
    3. `altus-managed-input-service` 附件写入后改为 `markSandboxDirty`。
    4. `osac-agent-service.callSessionMcpTool` 增加触达与成功后 dirty 标记。
  - 补充了对应单元测试并更新了恢复设计文档中的 Issue #43 修复记录。
- 遇到什么：
  - `Altus` 启动链路存在与 `sandbox-agent-provision-service` 并行的历史旁路实现，容易与现有恢复策略漂移。
- 计划如何解决：
  - 执行 API 侧相关测试与 type-check，确认恢复门禁与 dirty 归档信号在回归场景稳定。
  - 基于测试结果更新 Issue #43 评论，附上修复点与验证命令。
