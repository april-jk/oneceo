# 05 命令执行与 E2B Sandbox 体系

## 1. 基本原则

Altus managed 模式参照 Suna 的不是“使用同一套 sandbox”，而是“使用同一种工具驱动执行思想”。

oneceo 的明确差异：

- Suna：自有 sandbox/tool runtime
- oneceo：必须使用 `E2B`

因此本设计采用：

> `Suna 风格 runner + oneceo 的 E2B sandbox runtime`

## 2. 运行时分层

### 2.1 `E2BSandboxManager`

职责：

- 创建/复用 E2B sandbox
- 维护 workspace root
- 提供 sandbox binding 给 run

要求：

- 所有 sandbox 调用继续经 `apps/api/src/connectors/e2b-connector.ts`

### 2.2 `E2BSandboxToolRuntime`

职责：

- 向 runner 提供标准工具接口

标准工具建议包括：

- `shell`
- `files`
- `git`
- `browser`
- `vision`
- `upload`
- `expose`

### 2.3 `OSACBridge`

职责：

- 仅当需要访问 sandbox 内服务时使用

例如：

- sandbox 内 browser/computer service
- sandbox 内 app server
- sandbox 内长期运行的 agent service

禁止：

- 在业务路由里直接绕过 OSAC 访问 sandbox 内服务

## 3. managed 模式的命令执行形态

当前 managed 模式更像：

- 生成计划
- 再把执行丢给 OpenCode/OSAC

重构后应改为：

- 模型直接调用标准化工具
- 工具再调用 E2B / OSAC

也就是说，managed mode 不再依赖：

- `OpenCode remote service`
- `Codex remote service`
- `ClaudeCode direct executor`

作为其命令执行主干。

这些执行器继续只属于 direct mode。

## 4. 命令执行标准过程

1. Runner 发起 `shell.execute`
2. Tool runtime 通过 `e2bConnector.runCommand(...)`
3. stdout/stderr 以 `tool_call_progress` 推回前端
4. 最终结果以 `tool_call_completed` 结束
5. 若产生文件变化，附加 `artifact_updated`

## 5. 文件与工作区

managed mode 应统一使用 session 级 workspace：

- 一个 session 对应一个 managed workspace
- 不再依赖 direct executor 的 session id 来推导 workspace

这点与 direct mode 必须分离。

## 6. 浏览器与图形工具

对齐 oneceo 规则：

- 若浏览器能力依赖 sandbox 内服务，则通过 OSAC
- 若仅为文件或命令执行，则通过 E2B

因此工具分流规则为：

1. 纯文件/命令：E2B
2. sandbox 内服务：OSAC

## 7. 连接器与 sandbox 的关系

managed mode 启动 run 时，会把 session 已挂载连接器物化为：

- 环境变量
- MCP tool descriptor
- connector policy snapshot

这些能力进入 tool runtime，而不是通过 direct executor 的 runtime 注入。

## 8. 设计结论

Altus managed 的命令执行体系必须直接重建为：

- `LLM runner`
- `tool registry`
- `E2B sandbox tool runtime`

三层结构。

OpenCode / Codex / ClaudeCode 不再参与 managed mode 的命令执行，只保留在 direct mode。

## 9. Suna 代码参照

本篇参照的是 `suna` 的工具驱动执行架构，不是它的 sandbox 提供商。开发时优先回查：

- `referance/suna/backend/core/agents/runner/tool_manager.py` -> `register_core_tools()`
  - 说明工具先注册，再参与 run 执行。
- `referance/suna/backend/core/agents/pipeline/prep_tasks.py` -> `prep_tools(...)`
  - 说明 tool schema 在 run 启动阶段完成装配。
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/tool_executor.py` -> `ToolExecutor`
  - 说明模型工具调用与实际执行被封装成独立执行层。
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/response_processor.py` -> `ResponseProcessor`
  - 说明 tool 调用结果、消息落地和流式事件输出是统一处理的。
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/execution.py`
  - 说明 coordinator 在模型循环中如何切换 assistant 输出与 tool 执行。

oneceo 的差异只在底层执行器：

- `suna` 的 sandbox/tool runtime 不能照搬；
- oneceo 必须把上述结构映射到 `E2BSandboxManager + E2BSandboxToolRuntime + OSACBridge`，并继续遵守 `apps/api/src/connectors/e2b-connector.ts` 与 OSAC 边界。
