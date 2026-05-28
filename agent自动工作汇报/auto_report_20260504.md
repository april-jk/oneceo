# 2026-05-04 自动工作汇报

## 会话标题首条消息锁定修复

- 做了什么：审计会话标题从前端发送、草稿创建、普通会话创建、WebSocket `user_input`、会话列表和 DB metadata 的完整流程；新增统一后端标题策略服务；修复“非明确指令仍显示待识别”和“标题等回复后才更新”的问题。
- 遇到什么：原实现把标题规则分散在 routes、WebSocket 和前端条件判断中，且 DB metadata 只同步了 `title`，没有同步 `titleLocked/titleSource/titleState/titleResolvedAt`，容易导致刷新和列表查询标题分叉。
- 计划如何解决：已收敛到 `task-session-title-service.ts`，并补充单元测试覆盖首条非明确消息、明确任务提炼和已锁定不覆盖；后续如出现误判，可只调整该服务内规则。
- 2026-05-04: 优化侧边栏刷新首屏稳定性，默认展开普通项目组，改为首屏骨架占位并收口展开态读取，避免刷新后项目/最近会话列表抖动。

## Google Super Composio MCP 设计

- 做了什么：根据用户确认的“直接接入 Google Super，高风险工作用户确认一遍”要求，新增 `docs/features/connectors/google_super_composio_mcp_oauth_doc_[尚未采用].md` 设计文档。
- 遇到什么：当前工作区已有其他未提交改动，且 `rg` 在本地执行被拒绝；已改用 PowerShell 原生命令查阅现有 Composio MCP 文档和服务实现。
- 计划如何解决：等待用户评审设计文档；用户明确采用后，再将文档状态更新为已采用并进入代码实现。

## Google Super 评审确认项

- 做了什么：将用户确认项写回设计文档：toolkit slug 使用 `googlesuper`，connectorKey 使用 `google_super`，UI 名称为 `Google Workspace`，tools 全量可见/可用但不一次性灌入全部 schema，高风险操作执行前一次性确认，新增 `task_session_mcp_tool_confirmations`。
- 遇到什么：用户已确认关键策略，但尚未明确要求进入代码实现阶段。
- 计划如何解决：保持设计文档状态为 `[尚未采用]`；用户明确开始实现后再更新为已采用并按文档改代码。

## Google Super 代码实现

- 做了什么：用户明确要求按 Google Super 方案实现后，已将设计文档状态更新为 `[20260504-1118已采用]`，并开始接入 `google_super` Composio OAuth、API broker runtime、确认表与一次性确认服务。
- 遇到什么：当前分支已有连接器相关未提交改动；实现时只追加 Google Super 相关逻辑，不回退既有改动。
- 计划如何解决：补齐前后端文案、确认路由和最小测试后执行 API/Web 校验。
