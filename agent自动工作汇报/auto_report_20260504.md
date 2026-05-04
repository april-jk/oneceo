# 2026-05-04 自动工作汇报

## 会话标题首条消息锁定修复

- 做了什么：审计会话标题从前端发送、草稿创建、普通会话创建、WebSocket `user_input`、会话列表和 DB metadata 的完整流程；新增统一后端标题策略服务；修复“非明确指令仍显示待识别”和“标题等回复后才更新”的问题。
- 遇到什么：原实现把标题规则分散在 routes、WebSocket 和前端条件判断中，且 DB metadata 只同步了 `title`，没有同步 `titleLocked/titleSource/titleState/titleResolvedAt`，容易导致刷新和列表查询标题分叉。
- 计划如何解决：已收敛到 `task-session-title-service.ts`，并补充单元测试覆盖首条非明确消息、明确任务提炼和已锁定不覆盖；后续如出现误判，可只调整该服务内规则。
