# Agent 代码修改快速指南

本文档用于当前仓库真实实现的快速定位，不再沿用旧版“三个独立 HTTP 智能体接口”的说明。

## 1. 任务会话主编排

适用场景：

- 新建任务
- 历史会话续聊
- 会话标题解析
- 消息历史与状态恢复

优先查看：

- 路由：`apps/api/src/routes/task-creation-routes.ts`
- 服务：`apps/api/src/agents/task-creation/task-creation-service.ts`
- 状态存储：`apps/api/src/agents/task-creation/file-memory-store.ts`
- WebSocket：`apps/api/src/agents/task-creation/websocket-service.ts`

可搜索关键词：

- `router.post('/sessions'`
- `router.get('/sessions/:sessionId/messages/recent'`
- `router.post('/sessions/:sessionId/runtime/start'`
- `updateSessionState`
- `sendPhaseStatus`

## 2. 三层任务创建 Agent

适用场景：

- 意图识别不准确
- 澄清逻辑异常
- 任务描述结构化不对
- 执行计划生成质量问题

核心文件：

- `apps/api/src/agents/task-creation/layers/intent-recognition-agent.ts`
- `apps/api/src/agents/task-creation/layers/planning-agent.ts`
- `apps/api/src/agents/task-creation/layers/execution-plan-agent.ts`
- `apps/api/src/agents/task-creation/layers/execution-review-agent.ts`
- `apps/api/src/agents/task-creation/layers/playwright-test-detection-agent.ts`
- `apps/api/src/agents/task-creation/prompts/system-prompts.ts`

## 3. Sandbox / OSAC / OpenCode / Codex

适用场景：

- 运行时未启动
- OSAC 无法执行
- OpenCode 事件异常
- Codex/ClaudeCode 执行模式切换
- 调试页或工作区异常

核心文件：

- `apps/api/src/connectors/e2b-connector.ts`
- `apps/api/src/services/sandbox-agent-provision-service.ts`
- `apps/api/src/services/osac-agent-service.ts`
- `apps/api/src/services/opencode-remote-service.ts`
- `apps/api/src/services/sandbox-debug-service.ts`
- `apps/api/src/services/sandbox-archive-service.ts`
- `apps/api/src/services/session-mcp-recovery-service.ts`
- `apps/api/src/services/sandbox-skill-sync-service.ts`

可搜索关键词：

- `ensureSandboxReady`
- `provision`
- `listSessionMcpTools`
- `archive`
- `restore`
- `pending_recover`

## 4. Altus Managed Run

适用场景：

- managed 输入提交
- run 流式事件订阅
- 停止 run
- 输入附件问题

核心文件：

- `apps/api/src/routes/altus-managed-routes.ts`
- `apps/api/src/services/altus-managed-input-service.ts`
- `apps/api/src/services/altus-managed-run-service.ts`
- `apps/api/src/services/altus-managed-stream-service.ts`

## 5. 连接器、隐式 Skills 与 MCP

适用场景：

- GitHub 等连接器 profile / OAuth / default profile
- 会话绑定连接器失败
- 隐式 Skills 管理或同步异常
- MCP provider 恢复问题

核心文件：

- `apps/api/src/routes/connector-routes.ts`
- `apps/api/src/services/user-connector-service.ts`
- `apps/api/src/services/session-connector-service.ts`
- `apps/api/src/routes/internal-skill-routes.ts`
- `apps/api/src/services/platform-skill-service.ts`
- `apps/api/src/services/platform-skill-import-service.ts`
- `apps/api/src/services/platform-skill-import-job-service.ts`

## 6. 用户鉴权与管理员鉴权

用户端：

- 路由：`apps/api/src/routes/auth-routes.ts`
- 中间件：`apps/api/src/middleware/app-auth-middleware.ts`
- 服务：`apps/api/src/services/app-auth-service.ts`

管理端：

- API 中转：`apps/api/src/routes/internal-admin-auth-routes.ts`
- 管理后台中间件：`apps/admin_management/server/middleware/admin-auth-middleware.ts`
- 管理后台入口：`apps/admin_management/server/routes/admin-auth-routes.ts`

## 7. 前端定位

用户端：

- 路由入口：`apps/web/client/src/App.tsx`
- 任务聊天：`apps/web/client/src/components/TaskCreationChat.tsx`
- 新建任务入口：`apps/web/client/src/components/NewTaskDialog.tsx`
- 会话 Hook：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- API Client：`apps/web/client/src/lib/task-creation-client.ts`
- 登录注册：`apps/web/client/src/pages/Login.tsx`、`apps/web/client/src/pages/Register.tsx`
- 鉴权客户端：`apps/web/client/src/lib/auth-client.ts`

管理后台：

- 页面入口：`apps/admin_management/web/src/App.tsx`
- API 入口：`apps/admin_management/server/index.ts`

## 8. 修改建议

1. 先从路由确认入口，再向下看 service。
2. 涉及状态机时，同时检查：
   - 数据库存储
   - file memory store
   - 前端 EventSource / WebSocket 消费逻辑
3. 涉及 Sandbox 恢复时，不只检查 workspace，还要检查：
   - runtime metadata
   - MCP provider
   - connector binding
   - deliverable / archive 状态
4. 涉及身份问题时，不要只修前端 header，要回看真实 session / cookie / userId 绑定链路。
