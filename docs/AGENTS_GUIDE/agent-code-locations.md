# Agent 代码位置速查表

## 任务会话主入口

- 路由入口：`apps/api/src/routes/task-creation-routes.ts`
- 主编排：`apps/api/src/agents/task-creation/task-creation-service.ts`
- 状态存储：`apps/api/src/agents/task-creation/file-memory-store.ts`
- WebSocket 服务：`apps/api/src/agents/task-creation/websocket-service.ts`

推荐搜索：

- `router.post('/sessions'`
- `router.get('/sessions/:sessionId/messages/recent'`
- `router.post('/sessions/:sessionId/runtime/start'`
- `router.get('/sessions/:sessionId/opencode/events'`

## 三层 Agent

- Layer 1：`apps/api/src/agents/task-creation/layers/intent-recognition-agent.ts`
- Layer 2：`apps/api/src/agents/task-creation/layers/planning-agent.ts`
- Layer 3：`apps/api/src/agents/task-creation/layers/execution-plan-agent.ts`
- Review Gate：`apps/api/src/agents/task-creation/layers/execution-review-agent.ts`
- Playwright 判定：`apps/api/src/agents/task-creation/layers/playwright-test-detection-agent.ts`
- Prompt：`apps/api/src/agents/task-creation/prompts/system-prompts.ts`

## 执行器与 Sandbox

- E2B：`apps/api/src/connectors/e2b-connector.ts`
- OSAC：`apps/api/src/services/osac-agent-service.ts`
- OpenCode 事件：`apps/api/src/services/opencode-remote-service.ts`
- Sandbox provision：`apps/api/src/services/sandbox-agent-provision-service.ts`
- Sandbox 调试：`apps/api/src/services/sandbox-debug-service.ts`
- Sandbox 归档恢复：`apps/api/src/services/sandbox-archive-service.ts`
- MCP 恢复：`apps/api/src/services/session-mcp-recovery-service.ts`

## Altus Managed

- 路由：`apps/api/src/routes/altus-managed-routes.ts`
- 输入：`apps/api/src/services/altus-managed-input-service.ts`
- Run：`apps/api/src/services/altus-managed-run-service.ts`
- Stream：`apps/api/src/services/altus-managed-stream-service.ts`

## 连接器与 Skills

- 连接器路由：`apps/api/src/routes/connector-routes.ts`
- 用户连接器：`apps/api/src/services/user-connector-service.ts`
- 会话连接器：`apps/api/src/services/session-connector-service.ts`
- 平台 Skills 路由：`apps/api/src/routes/internal-skill-routes.ts`
- 平台 Skills 服务：`apps/api/src/services/platform-skill-service.ts`

## 用户与管理员鉴权

- 用户鉴权路由：`apps/api/src/routes/auth-routes.ts`
- 用户鉴权中间件：`apps/api/src/middleware/app-auth-middleware.ts`
- 管理端中间件：`apps/admin_management/server/middleware/admin-auth-middleware.ts`
- 管理后台 API：`apps/admin_management/server/index.ts`

## 前端入口

- 应用路由：`apps/web/client/src/App.tsx`
- 任务会话 Hook：`apps/web/client/src/hooks/useTaskCreationAgent.ts`
- API Client：`apps/web/client/src/lib/task-creation-client.ts`
- 认证 Client：`apps/web/client/src/lib/auth-client.ts`
- 登录页：`apps/web/client/src/pages/Login.tsx`
- 注册页：`apps/web/client/src/pages/Register.tsx`
- 会话页面：`apps/web/client/src/pages/Home.tsx`
- 新任务弹窗：`apps/web/client/src/components/NewTaskDialog.tsx`
