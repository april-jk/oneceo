# 10 Suna智能体架构与提示词研究

日期：2026-03-24

本文聚焦 `referance/suna` 中与 oneceo `Altus 接管模式` 重构直接相关的部分：

- 智能体执行架构
- 对话与 run 模型
- 提示词系统
- tool / MCP 装配
- mode 设计边界

目标不是复述全部源码，而是提炼 oneceo 可以直接复用的结构性结论。

## 1. 核心结论

`Suna` 的核心不是“多层代理链”，而是：

- `thread` 作为对话容器
- `agent_run` 作为独立执行对象
- `StatelessCoordinator` 作为单一执行管线
- `PromptManager + ToolManager + MCPManager` 在 run 启动时完成装配
- `agent_run stream` 作为唯一实时执行流

换句话说，`Suna` 是一套 `conversation container + execution run + prompt/tool assembly + stream` 架构，不是 oneceo 当前这种 `WebSocket 消息入口 + TaskCreationService + 多层 agent + executor bridge` 架构。

代码依据：

- `backend/core/agents/api.py` -> `start_agent_run(...)`、`unified_agent_start(...)`
- `backend/core/agents/runner/executor.py` -> `execute_agent_run(...)`
- `backend/core/agents/pipeline/stateless/coordinator/stateless.py` -> `StatelessCoordinator.execute(...)`
- `backend/core/agents/runner/prompt_manager.py` -> `PromptManager.build_system_prompt(...)`
- `backend/core/agents/runner/tool_manager.py` -> `ToolManager.register_core_tools()`
- `backend/core/agents/runner/mcp_manager.py` -> `MCPManager.initialize_jit_loader(...)`
- `backend/core/agents/api.py` -> `/agent-run/{agent_run_id}/stream`

## 2. Suna 的对象模型

### 2.1 `thread`

作用：

- 对话历史容器
- 用户消息与 assistant/tool 消息的长期存储

特征：

- 用户消息先进入 thread
- thread 和 run 是两个独立概念
- 同一个 thread 可以承载多次 run

这与 oneceo 当前 `task_session` 既承载聊天容器又承载执行状态的做法不同。

代码依据：

- `backend/core/threads/api.py` -> `/threads/{thread_id}/messages/add`
- `backend/core/threads/repo.py` -> `create_thread_with_message_and_run(...)`
- `backend/core/threads/repo.py` -> `create_message_full(...)`
- `backend/core/threads/repo.py` -> `get_thread_messages(...)`

### 2.2 `agent_run`

作用：

- 一次明确的执行实例
- 挂载模型、prompt、tool registry、MCP、stream、取消状态

特征：

- run 生命周期独立于 thread
- run 有单独状态：`running / completed / stopped / failed`
- 前端围绕 run 订阅事件，不直接围绕“executor session”订阅

代码依据：

- `backend/core/agents/repo.py` -> `create_agent_run_with_id(...)`
- `backend/core/agents/repo.py` -> `update_agent_run_status(...)`
- `backend/core/agents/repo.py` -> `get_agent_run_with_thread(...)`
- `apps/frontend/src/lib/api/agents.ts` -> `unifiedAgentStart(...)`
- `apps/frontend/src/lib/streaming/use-agent-stream.ts` -> `startStreaming(runId)`

### 2.3 `ThreadManager`

作用：

- 持有 thread 级工具注册表
- 负责写入消息、读取 LLM messages、执行 thread pipeline、清理 tool instance

它更像 oneceo 未来的 `AltusConversationManager`，而不是 today 的 `TaskCreationService`。

代码依据：

- `backend/core/agentpress/thread_manager/manager.py` -> `ThreadManager`
- `backend/core/agentpress/thread_manager/manager.py` -> `add_message(...)`
- `backend/core/agentpress/thread_manager/manager.py` -> `get_llm_messages(...)`
- `backend/core/agentpress/thread_manager/manager.py` -> `run_thread(...)`
- `backend/core/agentpress/thread_manager/manager.py` -> `cleanup()`

## 3. Suna 的执行架构

### 3.1 启动路径

典型路径是：

1. 前端调用 `/agent/start`
2. 后端确保 thread / project / run 记录存在
3. 后端调用 `execute_agent_run(...)`
4. run 内部创建 `PipelineContext`
5. `StatelessCoordinator` 开始执行
6. 事件持续写入 `agent_run:{id}:stream`
7. 前端订阅该 run stream 渲染消息和工具状态

关键差异：

- `Suna` 的消息写入和执行启动是两步
- run 是权威执行对象
- stream 围绕 run，不围绕 websocket session

代码依据：

- `backend/core/agents/api.py` -> `start_agent_run(...)`
- `backend/core/agents/api.py` -> `_background_setup_and_execute(...)`
- `backend/core/agents/runner/executor.py` -> `execute_agent_run(...)`
- `backend/core/agents/api.py` -> `stream_agent_run(...)`
- `apps/frontend/src/lib/api/agents.ts` -> `unifiedAgentStart(...)`
- `apps/frontend/src/lib/streaming/use-agent-stream.ts` -> `startStreaming(...)`

### 3.2 `SetupManager`

`Suna` 在 run 前专门做 setup/prewarm：

- 新 thread 的缓存预填充
- 既有 thread 的用户消息写入
- 用户上下文预热
- 额度与订阅信息预热
- run record 创建

这一层很重要，因为它把“消息持久化、缓存预热、运行准备”从执行管线本身剥离出来了。

这正是 oneceo 当前 managed mode 缺少的切面。

代码依据：

- `backend/core/agents/runner/setup_manager.py` -> `prepopulate_caches_for_new_thread(...)`
- `backend/core/agents/runner/setup_manager.py` -> `append_user_message_to_cache(...)`
- `backend/core/agents/runner/setup_manager.py` -> `write_user_message_for_existing_thread(...)`
- `backend/core/agents/runner/setup_manager.py` -> `create_new_thread_records(...)`
- `backend/core/agents/runner/setup_manager.py` -> `create_agent_run_record(...)`
- `backend/core/agents/api.py` -> `_background_setup_and_execute(...)`

### 3.3 `StatelessCoordinator`

`Suna` 的 run 管线不是“意图识别 agent -> 计划 agent -> 执行计划 agent”的多层代理链。

它更接近：

- 单一 coordinator
- 在统一上下文里循环执行
- 按需调用工具
- 按统一状态流输出 reasoning / tool / assistant / status

因此，参照 `Suna` 重构 oneceo `Altus managed` 时，正确方向是：

- 废弃多层 agent 级联主路径
- 引入单一 `managed run coordinator`

而不是保留旧三层链路再加补丁。

代码依据：

- `backend/core/agents/pipeline/stateless/coordinator/stateless.py` -> `StatelessCoordinator.execute(...)`
- `backend/core/agents/pipeline/context.py` -> `PipelineContext`
- `backend/core/agents/pipeline/stateless/coordinator/initialization.py` -> `ManagerInitializer`
- `backend/core/agents/pipeline/prep_tasks.py` -> `prep_prompt(...)`、`prep_tools(...)`

## 4. Suna 的提示词系统

### 4.1 主体结构

`Suna` 的默认主 prompt 来自统一的 `CORE_SYSTEM_PROMPT`。

默认 agent 配置中集中声明：

- agent 名称
- 默认模型
- system prompt
- 默认启用的 tools

这说明 `Suna` 的默认智能体是“集中管理的默认 worker”，而不是把 prompt 零散分散在多个执行层。

代码依据：

- `backend/core/prompts/core_prompt.py` -> `CORE_SYSTEM_PROMPT`
- `backend/core/config/suna_config.py` -> `SUNA_CONFIG`
- `backend/core/cache/runtime_cache.py` -> `load_static_suna_config()`
- `backend/core/agents/agent_loader.py` -> `_load_suna_config(...)`

### 4.2 PromptManager 的装配方式

`PromptManager.build_system_prompt(...)` 的核心逻辑是：

1. 若 agent config 有自定义 `system_prompt`，优先使用
2. 否则使用统一 `core prompt`
3. 追加最小工具索引
4. 追加预加载工具 guide
5. 追加 MCP 工具信息
6. 追加 JIT MCP 信息
7. 追加 tool-calling 指令和当前时间
8. 并行拉取：
   - knowledge base 摘要
   - user context
   - user memory
   - file context
9. 返回：
   - `system message`
   - 可选的额外 contextual user message

关键特征：

- 主 prompt 是单一入口
- 动态信息以“装配”形式附着
- memory 和 file context 并不强行塞进主 prompt，而是可拆成附加上下文消息
- 对外部数据拉取做了并发和 timeout 控制

这比 oneceo 现有多层 prompt 级联更稳定，也更适合 managed run。

代码依据：

- `backend/core/agents/runner/prompt_manager.py` -> `build_system_prompt(...)`
- `backend/core/agents/runner/prompt_manager.py` -> `_build_base_prompt(...)`
- `backend/core/agents/runner/prompt_manager.py` -> `_append_mcp_tools_info(...)`
- `backend/core/agents/runner/prompt_manager.py` -> `_append_jit_mcp_info(...)`
- `backend/core/agents/pipeline/prep_tasks.py` -> `prep_prompt(...)`
- `backend/core/agents/pipeline/stateless/coordinator/initialization.py` -> `load_prompt_and_tools(...)`

### 4.3 Prompt 内容风格特征

`Suna` 的 core prompt 体现出几个稳定特征：

1. 强约束风格：短、直接、专业、少废话
2. 明确反对过度迎合用户情绪，强调客观技术判断
3. 强工具优先原则：先工具、再猜测
4. 强任务管理原则：高频使用 task 工具
5. 强避免过度设计：只做必要修改，不做兼容/兜底/提前抽象
6. 明确文件和命令使用边界

这说明 `Suna` 的 prompt 不是单纯“人格描述”，而是将：

- 行为准则
- tool usage policy
- code modification policy
- 输出风格

统一折叠进一个 central system prompt。

代码依据：

- `backend/core/prompts/core_prompt.py` -> `CORE_SYSTEM_PROMPT`
- `backend/core/prompts/core_prompt.py` -> `get_core_system_prompt()`

### 4.4 对 oneceo 的直接启发

oneceo `Altus managed` 应该改成：

- 一个统一的 `Altus managed system prompt`
- 外加 `PromptManager` 动态装配上下文

而不是：

- `intent recognition prompt`
- `planning prompt`
- `execution plan prompt`

分别驱动多个 agent 再拼装结果。

代码依据：

- `backend/core/agents/runner/prompt_manager.py` -> `build_system_prompt(...)`
- `backend/core/agents/pipeline/prep_tasks.py` -> `prep_prompt(...)`
- `backend/core/agents/pipeline/stateless/coordinator/initialization.py` -> `load_prompt_and_tools(...)`

## 5. Suna 的 Tool 与 MCP 架构

### 5.1 ToolManager

`ToolManager` 负责：

- 注册默认 core tools
- 根据 agent config 启用/禁用工具
- 在 thread manager 上注册工具实例

它的结构特征是：

- 工具注册是明确的一层
- tool config 来自 agent config
- 默认 worker 拥有稳定核心工具集

这意味着未来 oneceo 也应有独立的：

- `AltusToolRegistry`
- `AltusPromptManager`
- `AltusConnectorMcpManager`

而不是让 `TaskCreationService` 和 websocket service 同时负担这些职责。

代码依据：

- `backend/core/agents/runner/tool_manager.py` -> `DEFAULT_CORE_TOOLS`
- `backend/core/agents/runner/tool_manager.py` -> `register_core_tools()`
- `backend/core/agents/pipeline/stateless/coordinator/initialization.py` -> `init_managers(...)`
- `backend/core/agentpress/thread_manager/manager.py` -> `tool_registry`

### 5.2 MCPManager

`MCPManager` 负责两类事：

1. 把配置好的 MCP 立即注册进 thread tool registry
2. 初始化 JIT MCP loader，按需装配工具映射

可见 `Suna` 不是把 MCP 当成“后期补充”，而是 run 启动阶段的正式装配层。

对 oneceo 的启发：

- managed run 启动时就要把 connector/MCP snapshot 固化
- run 中途不应该根据会话外部变化漂移工具集合

代码依据：

- `backend/core/agents/runner/mcp_manager.py` -> `register_mcp_tools(...)`
- `backend/core/agents/runner/mcp_manager.py` -> `initialize_jit_loader(...)`
- `backend/core/agents/pipeline/stateless/coordinator/initialization.py` -> `init_managers(...)`
- `backend/core/agents/runner/prompt_manager.py` -> `_append_mcp_tools_info(...)`
- `backend/core/agents/runner/prompt_manager.py` -> `_append_jit_mcp_info(...)`

## 6. Suna 的 mode 是什么

### 6.1 mode 的本质

`Suna` 有大量前端 mode：

- slides
- data
- docs
- canvas
- image
- video
- research

但这些 mode 的主要作用是：

- 前端产品模式选择
- 模板/样式/输出格式的结构化输入
- 向最终用户 prompt 追加模式相关 Markdown
- 作为 thread/project 的 mode metadata 保存

mode 不是：

- 独立后端智能体架构
- 第二套 runner
- 第二套 stream 协议

代码依据：

- `apps/frontend/src/stores/suna-modes-store.ts` -> `selectedMode` 与各 mode-specific selections
- `apps/frontend/src/components/dashboard/suna-modes-panel.tsx` -> mode 选择 UI
- `apps/frontend/src/components/thread/chat-input/chat-input.tsx` -> `generateDataOptionsMarkdown()`
- `apps/frontend/src/components/thread/chat-input/chat-input.tsx` -> `generateSlidesTemplateMarkdown()`
- `apps/frontend/src/components/thread/chat-input/chat-input.tsx` -> 提交时将 mode markdown 拼入 `message`
- `backend/core/agents/api.py` -> `start_agent_run(..., mode=...)`
- `backend/core/agents/runner/setup_manager.py` -> `prepopulate_caches_for_new_thread(..., mode=...)`

### 6.2 mode 数据流

前端使用 `suna-modes-store` 保存：

- 选中的 mode
- mode 对应的模板、图表、样式等选项

在提交时：

- 这些 mode 选项被转成附加 Markdown 或 prompt 片段
- 一并发送到 `/agent/start`

因此 `Suna` 的 mode 本质是：

- 产品输入层
- prompt shaping 层
 
代码依据：

- `apps/frontend/src/stores/suna-modes-store.ts` -> 持久化 mode 与 template/chart/style selections
- `apps/frontend/src/components/thread/chat-input/chat-input.tsx` -> `generateDataOptionsMarkdown()`
- `apps/frontend/src/components/thread/chat-input/chat-input.tsx` -> `generateSlidesTemplateMarkdown()`
- `apps/frontend/src/components/thread/chat-input/chat-input.tsx` -> `onSubmit(message, ...)`
- `apps/frontend/src/hooks/threads/use-optimistic-agent-start.ts` -> `pendingIntent.mode`
- `backend/core/agents/api.py` -> `start_agent_run(..., mode=...)`
- `backend/core/agents/runner/setup_manager.py` -> 项目 metadata 中写入 `mode`

而不是执行架构层。

### 6.3 对 oneceo 的边界约束

Altus managed 重构时必须明确：

- managed mode 是架构层
- 业务 mode 是输入产品层

不能把两者混在一起，否则后续会再次走回“每个 mode 一套隐式执行链”的老路。

## 7. oneceo 可以直接借鉴的点

### 7.1 必须借鉴

1. `session(thread-like) + run` 分离
2. run 级单一 stream
3. setup/prewarm 层
4. 单一 prompt manager 装配
5. 独立 tool registry
6. 独立 connector/MCP manager
7. mode 作为前端输入层，而非后端架构分支

### 7.2 可以保留 oneceo 差异的点

1. sandbox 基座继续用 `E2B`
2. 凡是访问 sandbox 内服务，继续走 `OSAC`
3. 连接器体系继续沿用 oneceo 当前 `profile + session binding + runtime materialization`
4. direct mode 仍保留 `OpenCode / Codex / ClaudeCode`

## 8. oneceo 不能照搬的点

oneceo 不应直接照搬 `Suna` 的部分包括：

1. sandbox 运行时实现
2. 其现有 Composio/MCP 假设
3. 前端产品 modes 的具体品类
4. 其账号、计费、缓存与 Redis 细节实现

oneceo 只能照搬其结构原则，不能把具体实现强行复制进 managed mode。

## 9. 最终结论

`Suna` 的本质是：

- `thread + run + prompt assembly + tool/MCP assembly + stream`

它的智能体特征是：

- 单一主 prompt
- 动态上下文拼装
- run 级状态与事件流
- 工具优先执行
- mode 只做产品输入增强

因此，oneceo `Altus 接管模式` 的正确重构方向已经可以确定为：

1. 把当前 `managed` 从 `TaskCreationService + 三层 agent + websocket bridge` 重构成 `session + run + managed runner`
2. 把提示词体系重构为 `统一主 prompt + PromptManager`
3. 把工具、connector、MCP 装配前移到 run 启动阶段
4. 把前端对话页切到“创建 run / 订阅 run stream”模型
5. direct mode 保持原状，不与 managed runner 混用

## 10. 开发时快速源码索引

下面这组路径是后续实现 Altus managed 重构时最应该常开的 `suna` 文件。

### 10.1 对话与 run

- `referance/suna/backend/core/agents/api.py`
  - `start_agent_run(...)`
  - `_background_setup_and_execute(...)`
  - `unified_agent_start(...)`
  - `stream_agent_run(...)`
- `referance/suna/backend/core/agents/repo.py`
  - `create_agent_run_with_id(...)`
  - `update_agent_run_status(...)`
  - `get_agent_run_with_thread(...)`
- `referance/suna/backend/core/threads/repo.py`
  - `create_thread_with_message_and_run(...)`
  - `create_message_full(...)`
- `referance/suna/backend/core/threads/api.py`
  - `/threads/{thread_id}/messages/add`

### 10.2 执行管线

- `referance/suna/backend/core/agents/runner/executor.py`
  - `execute_agent_run(...)`
- `referance/suna/backend/core/agents/pipeline/context.py`
  - `PipelineContext`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/stateless.py`
  - `StatelessCoordinator.execute(...)`
- `referance/suna/backend/core/agents/pipeline/stateless/coordinator/initialization.py`
  - `ManagerInitializer.init_managers(...)`
  - `ManagerInitializer.load_prompt_and_tools(...)`
- `referance/suna/backend/core/agents/runner/setup_manager.py`
  - 新 thread 预热、写消息、建 run、写 image context

### 10.3 提示词系统

- `referance/suna/backend/core/prompts/core_prompt.py`
  - `CORE_SYSTEM_PROMPT`
- `referance/suna/backend/core/config/suna_config.py`
  - `SUNA_CONFIG`
- `referance/suna/backend/core/cache/runtime_cache.py`
  - `load_static_suna_config()`
- `referance/suna/backend/core/agents/agent_loader.py`
  - `_load_suna_config(...)`
- `referance/suna/backend/core/agents/runner/prompt_manager.py`
  - `build_system_prompt(...)`

### 10.4 Tools / MCP

- `referance/suna/backend/core/agents/runner/tool_manager.py`
  - `DEFAULT_CORE_TOOLS`
  - `register_core_tools()`
- `referance/suna/backend/core/agents/runner/mcp_manager.py`
  - `register_mcp_tools(...)`
  - `initialize_jit_loader(...)`
- `referance/suna/backend/core/agentpress/thread_manager/manager.py`
  - `ThreadManager`

### 10.5 前端 run 与 stream

- `referance/suna/apps/frontend/src/lib/api/agents.ts`
  - `unifiedAgentStart(...)`
  - run stream EventSource 建立逻辑
- `referance/suna/apps/frontend/src/lib/streaming/use-agent-stream.ts`
  - `startStreaming(runId)`
- `referance/suna/apps/frontend/src/hooks/messages/useAgentStream.ts`
  - 对话页 stream hook 封装

### 10.6 前端 modes

- `referance/suna/apps/frontend/src/stores/suna-modes-store.ts`
- `referance/suna/apps/frontend/src/components/dashboard/suna-modes-panel.tsx`
- `referance/suna/apps/frontend/src/components/thread/chat-input/chat-input.tsx`
- `referance/suna/apps/frontend/src/hooks/threads/use-optimistic-agent-start.ts`
