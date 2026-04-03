# AltusManaged 侧 MCP 接入开发任务文档 [20260330-1027已采用]

更新时间：2026-03-30

## 1. 目标

本文件只描述 `Altus managed` 侧开发任务。

目标：

1. 在 run 启动前读取当前 session 已挂载 MCP tools
2. 将这些 tools 装配进 managed tool registry
3. 让模型在本轮 run 中真实可调用 MCP tools

## 2. 涉及文件

1. [altus-managed-setup-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-setup-service.ts)
2. [altus-managed-run-entry-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-run-entry-service.ts)
3. [altus-managed-tool-runtime.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-tool-runtime.ts)
4. [altus-managed-prompt-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-managed-prompt-service.ts)
5. [altus-run-state.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-state.ts)
6. [altus-run-coordinator.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/altus-run-coordinator.ts)

## 3. run 启动前装配

run 启动前新增步骤：

1. 读取当前 session attached connector bindings
2. 确保这些 bindings 对应的 OSAC provider 已 ready
3. 调用 `LIST_SESSION_MCP_TOOLS`
4. 冻结成 `mcpTools snapshot`
5. 将 snapshot 注入 `AltusRunState`

要求：

1. run 内能力集固定，不受中途 profile 变更影响
2. 下一轮 run 再重新读取最新 session tools

## 4. tool registry

新增概念：

1. `AltusManagedMcpToolRegistry`

职责：

1. 接收 session MCP tool catalog
2. 生成模型可见的 tool schema
3. 将 tool call 桥接到 OSAC

实现要求：

1. MCP tools 和 core tools 走同一个最终 registry
2. 不能只在 prompt 中展示，不注册实际工具

## 5. `altus-managed-tool-runtime.ts`

整改方向：

1. 当前 runtime 只支持 core tools
2. 需要支持 session MCP tools 动态注册

第一阶段最短路径：

1. 在 runtime 初始化时注入 `mcpTools`
2. 每个 MCP tool 调用统一走 `osac-agent-service`

不要做：

1. 在 Altus 里自己重建 MCP client
2. 在 Altus 里直接连远端 provider

## 6. prompt 层

`altus-managed-prompt-service.ts` 需要新增一段：

1. `# Session MCP tools`

内容：

1. provider 名称
2. tool 名称
3. 当前会话可见范围

要求：

1. prompt 只做可见性提示
2. 实际能力仍以 runtime registry 为准

## 7. 状态流

managed run 需要看到 provider 相关事件的归一化输出，例如：

1. `mcp_provider_attached`
2. `mcp_provider_failed`
3. `mcp_provider_restarting`

这些事件不一定要把 OSAC 原始事件原样透传，但必须能在 run event / SSE 里反映出来，便于前端和排障使用。

## 8. 开发顺序

1. 先改 `altus-managed-setup-service.ts`
2. 再改 `altus-managed-run-entry-service.ts`
3. 再补 `AltusManagedMcpToolRegistry`
4. 最后接 prompt 和 event projection

## 9. Altus managed 侧验收

1. run 启动前能拿到 session MCP tools
2. 模型能在 tool catalog 中看到这些 tools
3. 模型调用时能通过 OSAC 成功执行
4. run SSE 中能看到 provider attach/fail/restart 的归一化事件
