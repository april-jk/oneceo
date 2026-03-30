# API 侧 OSAC 驱动 Altus 模式 MCP 开发任务文档 [20260330-1027已采用]

更新时间：2026-03-30

## 1. 目标

本文件只描述 `apps/api` 侧开发任务。

目标：

1. 把 `Altus mode` 的 MCP attach 主链路从 OpenCode `/mcp` 切到 `OSAC provider lifecycle`
2. 让 API 能生成 provider register payload
3. 让 API 能通过 OSAC 控制链路注册、更新、挂载、移除 provider
4. 让 Altus managed run 在启动前拿到当前 session 的 MCP tool catalog

## 2. 本期涉及文件

核心文件：

1. [osac-agent-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/osac-agent-service.ts)
2. [osac-routes.ts](/Users/watson/codingProj/oneceo/apps/api/src/routes/osac-routes.ts)
3. [session-connector-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/session-connector-service.ts)
4. [altus-managed-setup-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-setup-service.ts)
5. [altus-managed-run-entry-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-run-entry-service.ts)
6. [altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts)
7. [altus-managed-prompt-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts)
8. [schema.ts](/Users/watson/codingProj/oneceo/apps/api/src/db/schema.ts)
9. [migrate.ts](/Users/watson/codingProj/oneceo/apps/api/src/db/migrate.ts)

## 3. 任务拆分

## 3.1 `osac-agent-service.ts`

新增方法：

1. `registerMcpProvider`
2. `updateMcpProviderEnv`
3. `attachMcpProviderToSession`
4. `detachMcpProviderFromSession`
5. `removeMcpProvider`
6. `listSessionMcpTools`

实现要求：

1. 每次请求生成 `requestId`
2. 支持等待指定响应消息
3. 错误码统一映射为 API 层异常

验收：

1. 能通过现有 OSAC 链路发送 provider lifecycle 指令
2. 能解析 `MCP_PROVIDER_STATUS`
3. 能解析 `SESSION_MCP_TOOLS_RESPONSE`

## 3.2 `osac-routes.ts`

新增调试/运维路由：

1. `POST /:sessionId/mcp/providers`
2. `PUT /:sessionId/mcp/providers/:providerId/env`
3. `POST /:sessionId/mcp/providers/:providerId/attach`
4. `POST /:sessionId/mcp/providers/:providerId/detach`
5. `DELETE /:sessionId/mcp/providers/:providerId`
6. `GET /:sessionId/mcp/session-tools`

说明：

1. 这些路由不是主业务入口
2. 主要用于排障、联调、管理后台验证

## 3.3 `session-connector-service.ts`

整改重点：

1. attach 不再依赖 OpenCode `/mcp`
2. session binding -> OSAC provider payload

新增方法：

1. `buildOsacProviderPayload`
2. `attachViaOsacProvider`
3. `detachViaOsacProvider`
4. `refreshProviderEnv`
5. `syncRuntimeProviderStatus`

删除主假设：

1. attach 成功等于 `/mcp` 返回 200
2. runtime status 只从 OpenCode `/mcp` 回读

## 3.4 `altus-managed-setup-service.ts`

新增方法：

1. `ensureSessionMcpProviders`
2. `captureSessionMcpToolSnapshot`

职责：

1. run 前确保 provider ready
2. 从 OSAC 拉当前 session tool catalog
3. 冻结为 run snapshot

## 3.5 `altus-managed-run-entry-service.ts`

整改：

1. `AltusRunState` 注入 `mcpTools`
2. 记录 `mcpProviderSnapshotId`

`startRun()` 顺序调整：

1. session ownership
2. connector snapshot
3. MCP tool snapshot
4. build run state
5. execute coordinator

## 3.6 `altus-managed-tool-runtime.ts`

本期最短路径：

1. 保留 core tools
2. 增加动态 MCP tool registry 注入
3. MCP tool 调用统一桥接到 OSAC

不要做：

1. API 侧自己模拟远端 MCP client
2. API 侧直接执行 provider command

## 3.7 `altus-managed-prompt-service.ts`

新增：

1. `# Session MCP tools`

作用：

1. 告诉模型当前 session 有哪些 provider tools
2. 不承担实际注册职责

## 3.8 数据迁移

### `task_session_connector_bindings`

新增字段：

1. `runtime_provider_id`
2. `runtime_env_version`
3. `runtime_transport`
4. `runtime_attached_tools_json`
5. `runtime_last_started_at`
6. `runtime_last_stopped_at`

### 新表

1. `task_session_connector_runtime_events`
2. `task_session_mcp_tool_snapshots`

## 4. 开发顺序

1. 先改 `osac-agent-service.ts`
2. 再改 `session-connector-service.ts`
3. 再补数据库字段和新表
4. 再接 `altus-managed-setup-service.ts`
5. 最后接 `altus-managed-run-entry-service.ts` 和 `altus-managed-tool-runtime.ts`

## 5. API 侧验收

1. attach profile 时能注册 OSAC provider
2. binding 能记录 `runtime_provider_id`
3. run 启动前能拿到当前 session MCP tools
4. managed tool runtime 能真实桥接 MCP tool call
