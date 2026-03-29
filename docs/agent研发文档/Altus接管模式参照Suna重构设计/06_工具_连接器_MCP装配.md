# 06 工具、连接器与 MCP 装配

## 1. 设计目标

Suna 的一个关键特点是：

- prompt 构建
- tool registry
- MCP 注册

都发生在 run 启动阶段。

Altus managed 重构后也必须采用同样策略。

## 2. Tool Registry

建议新建：

- `AltusToolRegistry`

职责：

1. 注册 managed 核心工具
2. 注册 sandbox 工具
3. 注册 connector/MCP 工具
4. 输出模型可见的 schema 列表

核心工具建议：

- `message_tool`
- `task_list_tool`
- `shell_tool`
- `file_tool`
- `git_tool`
- `browser_tool`
- `connector_tool`
- `complete_task_tool`

## 3. Prompt 装配

建议新建：

- `AltusPromptManager`

职责：

1. 读取 session 历史
2. 读取用户上下文
3. 读取 connector snapshot
4. 读取可用 tool schema
5. 生成单轮 run 的 system prompt

设计要求：

- 不再使用当前三层 Agent 各自分散的 system prompt
- 改成一个 managed agent 的统一 prompt 入口
- 对“修改文件/创建项目/生成代码”类请求，prompt 必须明确要求先走工具执行，再回传摘要
- prompt 必须明确要求先判断任务等级：
  - `simple`
  - `normal`
  - `complex`
- 对 `complex` 任务，prompt 必须明确要求先形成详细 todo，再按步骤逐项执行与验证
- `complex` 的判断条件必须至少覆盖：
  - 多文件
  - 多子系统
  - 调试链路长
  - 依赖关系不清楚
  - 需要分阶段验证
  - 涉及迁移、运行时、基础设施或环境变更
- 不允许把完整实现代码直接作为聊天正文输出并跳过 `write_file` / `shell_execute`
- managed mode 需要一个显式终止工具，语义参照 `suna` 的 `message_tool.complete(...)`
- Altus run 不应因为模型输出了一段普通 assistant 正文就直接判定完成；应由 `complete_task` 这类 terminating tool 作为唯一的正常完成信号

## 4. Connector / MCP 装配

managed mode 不重新设计 connector profile，但运行时需要按 run 快照装配。

建议新建：

- `AltusConnectorMcpManager`

职责：

1. 从 session attached connectors 读取绑定
2. 解析 profile
3. 物化为 MCP/tool runtime 可用配置
4. 输出给 `AltusToolRegistry`

## 5. 运行时隔离

run 启动时对 connector 进行快照的原因：

1. 用户在 run 期间改 connector，不影响本轮执行
2. run 重放时能得到一致能力集
3. 工具权限边界清晰

## 6. 与 direct mode 的边界

direct mode 连接器仍按现有 executor/runtime 注入方式工作。

managed mode 新设计下：

- connector 不再经 executor 注入
- connector 直接进入 tool registry / MCP registry
- tool event 在前端必须显式标识 `executor=altus` / `executionMode=managed`，避免落入 `Codex` 专用渲染链
- 发给上游模型的 tool parameter schema 必须显式收紧为标准 JSON Schema：
  - 根对象固定 `type: object`
  - 显式声明 `properties`
  - 显式声明 `required`
  - 显式声明 `additionalProperties: false`
- 当 `LLM_PROXY_UPSTREAM_API_TYPE=anthropic` 时，`llm-proxy` 不能只转换纯文本消息，必须同时完成：
  - OpenAI `tools` -> Anthropic `tools`
  - `assistant.tool_calls` -> `tool_use`
  - `tool` role -> `tool_result`
  - Anthropic `tool_use` -> OpenAI `message.tool_calls`
- 否则 Altus managed 会把需要落盘的修改直接输出成聊天内容，而不会真实调用 `write_file`/`shell_execute`

这两套装配路径完全独立。

## 7. 设计结论

Altus managed 的工具体系必须从：

- “三层 Agent 内部推理 + 少量外部调用”

改成：

- “统一 prompt + 统一 tool registry + 统一 connector/mcp assembly”

这是与 Suna 设计模式对齐的核心步骤之一。

## 8. Suna 代码参照

本篇的装配设计应直接对照 `suna` 的以下源码入口：

- `referance/suna/backend/core/agents/runner/tool_manager.py` -> `register_core_tools()`
  - 对应 oneceo 的 `AltusToolRegistry.registerCoreTools()`。
- `referance/suna/backend/core/agents/runner/mcp_manager.py` -> `initialize_jit_loader(...)`
  - 对应 run 启动时的 MCP/JIT loader 初始化。
- `referance/suna/backend/core/agents/runner/mcp_manager.py` -> `register_mcp_tools(...)`
  - 对应 connector/MCP 工具向模型暴露 schema 的过程。
- `referance/suna/backend/core/agents/runner/prompt_manager.py` -> `_append_mcp_tools_info(...)`
  - 说明 prompt 中会写入 MCP/tool 可用能力索引。
- `referance/suna/backend/core/agents/runner/prompt_manager.py` -> `_append_jit_mcp_info(...)`
  - 说明 JIT MCP 能力也在 prompt 装配阶段进入上下文。
- `referance/suna/backend/core/agents/agent_loader.py` -> `_load_suna_config(...)`
  - 说明 agent 配置、默认工具和系统提示词来自集中配置。
- `referance/suna/backend/core/cache/runtime_cache.py` -> `load_static_suna_config()`
  - 说明运行时读取的是已缓存的静态 agent 配置，而不是在执行中临时拼接。
- `referance/suna/backend/core/agents/runner/executor.py` -> `run.execute(...)` 之前的 manager 装配
  - 说明工具能力必须在真正进入模型调用前稳定注入，不能在 provider 兼容层里被丢失。
- `referance/suna/backend/core/tools/message_tool.py` -> `complete(...)`
  - 说明 `suna` 使用显式的 terminating tool 结束一次 agent run，而不是把任意 assistant 正文都当成 run 完成。
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/tool_executor.py` -> `_handle_terminating_tool(...)`
  - 说明 terminating tool 会直接触发 state complete，而不是继续等待自然文本结束。

oneceo 在实现 `AltusConnectorMcpManager` 时，只能复用这套“run 启动时快照并装配”的结构，不得继续沿用 direct mode 的 executor 注入路径。
