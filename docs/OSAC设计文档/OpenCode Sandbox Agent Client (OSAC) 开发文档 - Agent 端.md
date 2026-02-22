
# OpenCode Sandbox Agent Client (OSAC) 开发文档 - Agent 端

## 1. 引言

本开发文档旨在为 OpenCode Sandbox Agent Client (OSAC) 的实现者提供详细的指导。OSAC 是一个运行在隔离沙盒环境中的代理程序，其核心职责是作为父智能体（Server）与 OpenCode CLI 工具之间的桥梁。它接收父智能体下发的指令，通过调用 OpenCode CLI 执行任务，并实时回传执行结果和状态。本文档将聚焦于 OSAC 内部的实现细节、与父智能体的通信接口以及各项核心功能的开发指南，确保 OSAC 能够独立开发并与父智能体无缝协作。

## 2. 架构概述

OSAC 的设计遵循模块化原则，以应对沙盒环境的特殊性（如网络隔离、资源限制）和与父智能体的单向通信需求。其核心目标是提供一个稳定、高效且可扩展的执行环境，以响应父智能体的调度。

### 2.1 模块组成

OSAC 主要由以下功能模块构成：

*   **WebSocket 服务器模块**: 负责监听指定端口，接受父智能体的 WebSocket 连接，并处理消息的接收与发送。
*   **认证模块**: 在 WebSocket 连接建立时，对父智能体进行身份验证，确保通信安全。
*   **指令解析器**: 解析从父智能体接收到的 JSON 格式指令，识别指令类型并提取 `payload`。
*   **指令调度器**: 根据解析出的指令类型，将任务分发给相应的内部处理模块（如 `OpenCode CLI 封装模块`、`配置管理模块`等）。
*   **OpenCode CLI 封装模块**: 负责在后台执行 `opencode` CLI 命令，捕获标准输出 (stdout)、标准错误 (stderr) 和退出码。
*   **会话管理器**: 利用 `opencode` 自身的会话机制，管理任务的延续和状态持久化，包括启动新会话、恢复现有会话等。
*   **配置管理器**: 负责动态管理 `opencode` 的 Skills 和 MCP 服务器配置，包括文件的读写、更新和删除。
*   **更新处理器**: 负责处理 OSAC 自身和 `opencode` CLI 的更新请求，包括下载、验证和安装更新包。
*   **自维护模块**: 周期性执行日志清理、临时文件管理、健康检查和资源监控等任务。
*   **状态回传器**: 将命令执行结果、模块状态、错误信息等封装成 JSON 消息，通过 WebSocket 发送给父智能体。

### 2.2 内部工作流程

1.  **启动与监听**: OSAC 启动时，初始化所有模块，并启动 WebSocket 服务器，监听预设端口。
2.  **连接与认证**: 父智能体主动发起 WebSocket 连接。认证模块验证父智能体的身份。成功后，建立持久连接。
3.  **指令接收与解析**: WebSocket 服务器模块接收父智能体发送的 JSON 消息，指令解析器对其进行解析。
4.  **指令分发与执行**: 指令调度器根据指令类型，将任务路由到相应的处理模块。
    *   对于 `EXECUTE_COMMAND`，OpenCode CLI 封装模块调用 `opencode` CLI，会话管理器处理 `sessionId` 或 `continueSession` 逻辑。
    *   对于 `LOAD_SKILL` 或 `ADD_MCP_SERVER`，配置管理器负责文件系统操作和 `opencode` 配置更新。
    *   对于 `INITIATE_UPDATE`，更新处理器负责更新逻辑。
    *   对于查询指令，相关管理器（如会话管理器）提供数据。
5.  **结果与状态回传**: 各处理模块将执行结果、实时输出、状态变更和错误信息通过状态回传器封装成 JSON 消息，并通过 WebSocket 发送回父智能体。
6.  **自维护**: 自维护模块在后台周期性运行，确保 OSAC 及其环境的健康和整洁，并将健康状态通过心跳消息报告给父智能体。

## 3. 通信协议与 API 接口规范

OSAC 与父智能体之间的通信基于 WebSocket 协议，所有消息均采用统一的 JSON 格式。本节将详细列出 OSAC 作为 WebSocket 服务器时，接收和发送的消息类型及其结构。

### 3.1 消息结构约定

所有消息都必须包含 `type` 字段和 `payload` 字段：

```json
{
  "type": "<MessageType>",
  "payload": { /* 具体消息体 */ }
}
```

### 3.2 认证机制

OSAC 必须实现严格的认证机制以保护其端点。推荐使用 **预共享密钥 (PSK)** 或 **令牌 (Token)** 机制。

*   **PSK 实现**: OSAC 在启动时加载一个预配置的密钥。当父智能体发起 WebSocket 连接时，OSAC 检查 HTTP 握手请求头中的 `Authorization` 字段是否包含正确的 PSK。如果匹配，则允许连接；否则，拒绝连接。
*   **令牌实现**: OSAC 启动时配置一个用于验证令牌的公共密钥或验证服务地址。父智能体在连接时携带由认证服务签发的 JWT (JSON Web Token)。OSAC 验证 JWT 的签名和有效期。

### 3.3 OSAC 接收的指令 (来自父智能体)

OSAC 作为 WebSocket 服务器，接收父智能体发送的指令。这些指令将触发 OSAC 内部的相应操作。

#### 3.3.1 `EXECUTE_COMMAND`：执行 OpenCode CLI 命令

*   **描述**: 指示 OSAC 执行一个 `opencode` CLI 命令。
*   **`type`**: `EXECUTE_COMMAND`
*   **`payload`**:
    *   `command`: `string` - 完整的 `opencode` CLI 命令字符串，例如 `run "Hello World"`。
    *   `sessionId`: `string`, 可选 - 如果要继续现有会话，则提供会话 ID。如果提供，OSAC 应将此 ID 传递给 `opencode` 的 `-s` 或 `--session` 参数。
    *   `continueSession`: `boolean`, 可选 - 如果为 `true` 且未指定 `sessionId`，OSAC 应尝试延续 `opencode` 的上一个会话（例如，通过 `opencode run -c`）。与 `sessionId` 互斥。
    *   `options`: `object`, 可选 - 包含 `opencode` 命令特定选项的键值对。OSAC 应将这些选项转换为 `opencode` CLI 的命令行参数。例如，`{"model": "openai/gpt-4"}` 应转换为 `--model openai/gpt-4`。

#### 3.3.2 `GET_SESSION_LIST`：获取会话列表

*   **描述**: 请求 OSAC 返回其管理的 `opencode` 会话列表。
*   **`type`**: `GET_SESSION_LIST`
*   **`payload`**:
    *   `maxCount`: `number`, 可选 - 限制返回的会话数量。OSAC 应将此参数传递给 `opencode session list -n`。
    *   `format`: `string`, 可选 - 返回格式，例如 `json`。OSAC 应将此参数传递给 `opencode session list --format`。

#### 3.3.3 `GET_SESSION_DETAILS`：获取会话详情

*   **描述**: 请求 OSAC 返回特定 `opencode` 会话的详细信息。
*   **`type`**: `GET_SESSION_DETAILS`
*   **`payload`**:
    *   `sessionId`: `string` - 要获取详情的会话 ID。OSAC 应使用此 ID 调用 `opencode export <sessionId>`。

#### 3.3.4 `LOAD_SKILL`：加载技能

*   **描述**: 指示 OSAC 加载一个新的 `opencode` 技能。
*   **`type`**: `LOAD_SKILL`
*   **`payload`**:
    *   `skillName`: `string` - 技能的名称。
    *   `skillContent`: `string` - 技能的完整内容（例如 Markdown 格式）。
    *   `overwrite`: `boolean`, 可选 - 如果技能已存在，是否覆盖。默认为 `false`。OSAC 应根据此标志决定文件写入行为。

#### 3.3.5 `UNLOAD_SKILL`：卸载技能

*   **描述**: 指示 OSAC 卸载指定的 `opencode` 技能。
*   **`type`**: `UNLOAD_SKILL`
*   **`payload`**:
    *   `skillName`: `string` - 要卸载的技能名称。

#### 3.3.6 `ADD_MCP_SERVER`：添加 MCP 服务器

*   **描述**: 指示 OSAC 添加新的 MCP 服务器配置到 `opencode`。
*   **`type`**: `ADD_MCP_SERVER`
*   **`payload`**:
    *   `serverName`: `string` - MCP 服务器的名称。
    *   `serverConfig`: `object` - MCP 服务器的配置对象。OSAC 需要将其写入 `~/.opencode/config.json`。
    *   `overwrite`: `boolean`, 可选 - 如果服务器已存在，是否覆盖。默认为 `false`。

#### 3.3.7 `REMOVE_MCP_SERVER`：移除 MCP 服务器

*   **描述**: 指示 OSAC 移除指定的 MCP 服务器配置。
*   **`type`**: `REMOVE_MCP_SERVER`
*   **`payload`**:
    *   `serverName`: `string` - 要移除的 MCP 服务器名称。

#### 3.3.8 `INITIATE_UPDATE`：启动更新

*   **描述**: 指示 OSAC 启动自身和/或 `opencode` 的更新过程。
*   **`type`**: `INITIATE_UPDATE`
*   **`payload`**:
    *   `updateType`: `string` - 更新类型，`client` (仅更新 OSAC), `opencode` (仅更新 OpenCode), `all` (两者都更新)。
    *   `version`: `string`, 可选 - 要更新到的目标版本。如果未指定，则更新到最新版本。
    *   `downloadUrl`: `string`, 可选 - 更新包的下载 URL。如果提供，OSAC 将尝试从该 URL 下载。
    *   `updateCommand`: `string`, 可选 - 自定义更新命令，例如 `npm install -g opencode-ai`。

### 3.4 OSAC 发送的消息 (回传给父智能体)

OSAC 作为 WebSocket 客户端，向父智能体发送状态更新、命令输出和结果。

#### 3.4.1 `COMMAND_OUTPUT`：命令输出

*   **描述**: 回传 `opencode` CLI 命令的实时标准输出 (stdout) 和标准错误 (stderr)。
*   **`type`**: `COMMAND_OUTPUT`
*   **`payload`**:
    *   `sessionId`: `string` - 关联的会话 ID。
    *   `outputType`: `string` - 输出类型，`stdout` 或 `stderr`。
    *   `content`: `string` - 输出内容。
    *   `isFinal`: `boolean` - 是否为本次命令的最终输出。当 `opencode` 进程结束时，此字段应为 `true`。

#### 3.4.2 `COMMAND_STATUS`：命令状态

*   **描述**: 通知父智能体命令的执行状态。
*   **`type`**: `COMMAND_STATUS`
*   **`payload`**:
    *   `sessionId`: `string` - 关联的会话 ID。
    *   `status`: `string` - 命令状态，例如 `running`, `completed`, `failed`, `cancelled`。
    *   `exitCode`: `number`, 可选 - 命令的退出码（仅当 `status` 为 `completed` 或 `failed` 时）。
    *   `errorMessage`: `string`, 可选 - 错误信息（仅当 `status` 为 `failed` 时）。

#### 3.4.3 `SESSION_LIST_RESPONSE`：会话列表响应

*   **描述**: 响应 `GET_SESSION_LIST` 请求，返回会话列表。
*   **`type`**: `SESSION_LIST_RESPONSE`
*   **`payload`**:
    *   `sessions`: `array` - 会话对象数组，每个对象包含 `id`, `title`, `updatedAt` 等信息。这些信息应从 `opencode session list --format json` 的输出中解析。

#### 3.4.4 `SESSION_DETAILS_RESPONSE`：会话详情响应

*   **描述**: 响应 `GET_SESSION_DETAILS` 请求，返回特定会话的详细信息。
*   **`type`**: `SESSION_DETAILS_RESPONSE`
*   **`payload`**:
    *   `session`: `object` - 包含会话的完整信息，包括消息历史、元数据等。这些信息应从 `opencode export <sessionId>` 的输出中解析。

#### 3.4.5 `SKILL_STATUS`：技能状态

*   **描述**: 通知父智能体技能加载/卸载的状态。
*   **`type`**: `SKILL_STATUS`
*   **`payload`**:
    *   `skillName`: `string` - 技能名称。
    *   `status`: `string` - 状态，例如 `loaded`, `unloaded`, `failed_to_load`, `failed_to_unload`。
    *   `errorMessage`: `string`, 可选 - 错误信息。

#### 3.4.6 `MCP_SERVER_STATUS`：MCP 服务器状态

*   **描述**: 通知父智能体 MCP 服务器添加/移除的状态。
*   **`type`**: `MCP_SERVER_STATUS`
*   **`payload`**:
    *   `serverName`: `string` - MCP 服务器名称。
    *   `status`: `string` - 状态，例如 `added`, `removed`, `failed_to_add`, `failed_to_remove`。
    *   `errorMessage`: `string`, 可选 - 错误信息。

#### 3.4.7 `AGENT_UPDATE_STATUS`：代理更新状态

*   **描述**: 通知父智能体 OSAC 或 `opencode` 更新过程的状态。
*   **`type`**: `AGENT_UPDATE_STATUS`
*   **`payload`**:
    *   `updateType`: `string` - 更新类型，`client`, `opencode`, `all`。
    *   `status`: `string` - 更新状态，例如 `started`, `downloading`, `installing`, `completed`, `failed`。
    *   `progress`: `number`, 可选 - 更新进度百分比。
    *   `errorMessage`: `string`, 可选 - 错误信息。

#### 3.4.8 `ERROR`：通用错误

*   **描述**: 用于报告 OSAC 内部发生的通用错误。
*   **`type`**: `ERROR`
*   **`payload`**:
    *   `code`: `string`, 可选 - 错误代码。
    *   `message`: `string` - 错误描述。
    *   `details`: `object`, 可选 - 更多错误详情。

#### 3.4.9 `HEARTBEAT`：心跳

*   **描述**: OSAC 定期发送的心跳消息，用于告知父智能体其仍然活跃。
*   **`type`**: `HEARTBEAT`
*   **`payload`**:
    *   `timestamp`: `number` - 发送心跳的时间戳。
    *   `status`: `string` - OSAC 的当前状态，例如 `idle`, `busy`, `updating`。
    *   `currentSessionId`: `string`, 可选 - 如果正在处理会话，则为当前会话 ID。

## 4. 核心功能实现指南

### 4.1 OpenCode CLI 命令执行

OSAC 的核心功能是执行 `opencode` CLI 命令。这需要一个健壮的子进程管理机制，能够将父智能体下发的结构化指令转换为命令行参数，并捕获 `opencode` 的输出。

#### 4.1.1 命令构建与执行流程

当 OSAC 接收到 `EXECUTE_COMMAND` 消息时，应遵循以下步骤构建并执行 `opencode` 命令：

1.  **解析基础命令**: 从 `payload.command` 中提取基础命令字符串，例如 `run "Hello World"`。
2.  **处理会话参数**: 
    *   如果 `payload.sessionId` 存在，则将其作为 `--session <sessionId>` 参数添加到命令中。
    *   如果 `payload.continueSession` 为 `true` 且 `sessionId` 不存在，则添加 `--continue` 参数。
    *   **注意**: `sessionId` 和 `continueSession` 不应同时使用。如果两者都存在，应优先使用 `sessionId`。
3.  **转换 `options` 对象**: 遍历 `payload.options` 对象，将其中的键值对转换为 `opencode` CLI 的命令行参数。转换规则如下：
    *   **布尔值**: 如果值为 `true`，则添加 `--key` (例如 `{"thinking": true}` 转换为 `--thinking`)。如果值为 `false`，则忽略。
    *   **字符串/数字**: 添加 `--key value` (例如 `{"model": "openai/gpt-4"}` 转换为 `--model openai/gpt-4`)。
    *   **数组**: 对于数组值，每个元素都应作为单独的 `--key value` 添加 (例如 `{"file": ["a.py", "b.ts"]}` 转换为 `--file a.py --file b.ts`)。
    *   **特殊处理**: 某些 `opencode` 命令的选项可能需要特殊处理，例如 `run` 命令的 `message` 参数是位置参数，而不是通过 `--message` 传递。OSAC 应识别这些特殊情况，并正确构建命令。
4.  **组装完整命令**: 将基础命令、会话参数和转换后的 `options` 参数组合成一个完整的 `opencode` CLI 命令字符串。
5.  **子进程启动**: 使用编程语言提供的子进程库（如 Node.js 的 `child_process`，Python 的 `subprocess`）启动组装好的 `opencode` 命令。
6.  **标准流捕获**: 实时捕获子进程的 `stdout` 和 `stderr`。将捕获到的内容封装成 `COMMAND_OUTPUT` 消息，并通过 WebSocket 回传给父智能体。每次收到新的输出块时，都应发送一条消息，直到命令结束。
7.  **进程状态监控**: 监控子进程的退出码。当子进程结束时，根据退出码判断命令执行结果：
    *   如果退出码为 0，则发送 `COMMAND_STATUS` 消息，`status` 为 `completed`。
    *   如果退出码非 0，则发送 `COMMAND_STATUS` 消息，`status` 为 `failed`，并包含 `exitCode` 和捕获到的 `stderr` 作为 `errorMessage`。

#### 4.1.2 场景化命令调用示例

以下是一些常见场景下，父智能体发送的 `EXECUTE_COMMAND` 消息 `payload` 及其对应的 `opencode` CLI 调用示例：

**场景一：执行一个简单的消息**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "run \"请帮我写一个 Python 脚本来计算斐波那契数列。\""
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode run "请帮我写一个 Python 脚本来计算斐波那契数列。"
    ```

**场景二：继续上一个会话并发送消息**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "run \"继续上一个任务，并添加错误处理。\"",
      "continueSession": true
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode run --continue "继续上一个任务，并添加错误处理。"
    ```

**场景三：指定会话 ID 并使用特定模型和代理**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "run \"分析这个代码库。\"",
      "sessionId": "abcdef123456",
      "options": {
        "model": "openai/gpt-4",
        "agent": "my-custom-agent"
      }
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode run --session abcdef123456 --model openai/gpt-4 --agent my-custom-agent "分析这个代码库。"
    ```

**场景四：附加文件并以 JSON 格式输出**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "run \"请审查这个文件\"",
      "options": {
        "file": ["main.py", "utils.js"],
        "format": "json"
      }
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode run --file main.py --file utils.js --format json "请审查这个文件"
    ```

**场景五：获取会话列表**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "session list",
      "options": {
        "maxCount": 5,
        "format": "json"
      }
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode session list --max-count 5 --format json
    ```
    *   **输出处理**: OSAC 捕获此命令的 `stdout`，解析其 JSON 内容，并将其封装为 `SESSION_LIST_RESPONSE` 消息回传。

**场景六：获取会话详情**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "export",
      "sessionId": "abcdef123456"
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode export abcdef123456
    ```
    *   **输出处理**: OSAC 捕获此命令的 `stdout`，解析其 JSON 内容，并将其封装为 `SESSION_DETAILS_RESPONSE` 消息回传。

**场景七：创建新代理**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "agent create",
      "options": {
        "description": "A code review agent",
        "mode": "primary",
        "tools": "read,write"
      }
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode agent create --description "A code review agent" --mode primary --tools read,write
    ```

**场景八：调试配置**

*   **父智能体 `payload`:**
    ```json
    {
      "command": "debug config"
    }
    ```
*   **OSAC 实际执行的命令:**
    ```bash
    opencode debug config
    ```
    *   **输出处理**: OSAC 捕获此命令的 `stdout`，通常是 JSON 格式的配置信息，直接作为 `COMMAND_OUTPUT` 回传。

#### 4.1.3 子进程管理与错误处理

*   **子进程启动**: 建议使用非阻塞方式启动子进程，以便 OSAC 能够同时处理多个命令请求或进行其他维护任务。
*   **标准流捕获**: 实时捕获 `stdout` 和 `stderr`，并进行缓冲。当缓冲区达到一定大小或遇到换行符时，发送 `COMMAND_OUTPUT` 消息。确保 `isFinal` 标志在命令结束时正确设置为 `true`。
*   **超时机制**: 为 `opencode` 命令设置合理的超时时间。如果命令在规定时间内未完成，则强制终止子进程，并发送 `COMMAND_STATUS` 消息，`status` 为 `failed`，`errorMessage` 指明超时。
*   **资源限制**: 考虑到沙盒环境的资源限制，OSAC 应监控子进程的资源使用情况（CPU、内存）。如果超出阈值，可以考虑终止进程并报告错误。
*   **错误日志**: 详细记录所有 `opencode` 命令的执行日志，包括完整的命令字符串、输出、退出码和任何错误信息，以便调试和审计。

### 4.2 会话持久化与延续

OSAC 依赖 `opencode` 自身的会话管理能力。实现时需要注意：

*   **会话 ID 传递**: 确保 `sessionId` 参数正确传递给 `opencode` 命令。例如，当 `EXECUTE_COMMAND` 消息的 `payload.sessionId` 为 `"my_session_id"` 时，`opencode` 命令应包含 `--session my_session_id`。
*   **自动延续逻辑**: 当 `payload.continueSession` 为 `true` 且 `sessionId` 不存在时，OSAC 应在 `opencode` 命令中添加 `--continue` 标志。例如，`opencode run --continue "继续我的工作"`。
*   **会话列表与详情**: 
    *   对于 `GET_SESSION_LIST` 指令，OSAC 应执行 `opencode session list --format json` 命令，解析其 JSON 输出，并将其映射到 `SESSION_LIST_RESPONSE` 消息的 `sessions` 数组中。
    *   对于 `GET_SESSION_DETAILS` 指令，OSAC 应执行 `opencode export <sessionId>` 命令，解析其 JSON 输出，并将其映射到 `SESSION_DETAILS_RESPONSE` 消息的 `session` 对象中。
    *   **注意**: `opencode export` 命令的输出可能包含敏感信息，Server 端应根据权限进行过滤或脱敏处理。

### 4.3 Skills 热加载

*   **文件系统操作**: 当接收到 `LOAD_SKILL` 消息时，OSAC 应将 `payload.skillContent` 写入到 `~/.opencode/agent/skill/<payload.skillName>.md`。当接收到 `UNLOAD_SKILL` 消息时，删除对应文件。在写入文件时，应处理 `overwrite` 标志。
*   **`opencode` 刷新**: 
    *   **理想情况**: 如果 `opencode` 未来提供类似 `opencode skill refresh` 的命令，OSAC 应在文件操作后调用此命令以立即激活技能。
    *   **当前方案**: 鉴于 `opencode` 技能通常在启动时加载，目前最稳妥的方案是，在技能文件发生变化后，OSAC 应发送 `SKILL_STATUS` 消息通知父智能体，并建议父智能体协调 `opencode` 进程的重启（通过 `INITIATE_UPDATE` 指令）。

### 4.4 MCP 热加载

*   **配置文件操作**: 当接收到 `ADD_MCP_SERVER` 或 `REMOVE_MCP_SERVER` 消息时，OSAC 需要读取 `~/.opencode/config.json` 文件，修改其中的 `mcp` 配置部分，然后将更新后的 JSON 内容写回文件。在修改 JSON 配置文件时，务必确保原子性操作，避免文件损坏（例如，先写入临时文件，成功后再替换原文件）。
*   **`opencode` 刷新**: 
    *   **理想情况**: 如果 `opencode` 未来提供类似 `opencode config refresh` 的命令，OSAC 应在文件操作后调用此命令以立即激活配置。
    *   **当前方案**: 鉴于 `opencode` MCP 配置通常在启动时加载，目前最稳妥的方案是，在 MCP 配置发生变化后，OSAC 应发送 `MCP_SERVER_STATUS` 消息通知父智能体，并建议父智能体协调 `opencode` 进程的重启（通过 `INITIATE_UPDATE` 指令）。

## 5. 更新与自维护实现

### 5.1 更新流程

*   **下载器**: 实现一个健壮的下载器，能够处理 `payload.downloadUrl`，支持断点续传和完整性校验（如果提供了哈希值）。使用 Sandbox 环境中可用的工具（如 `curl` 或 `wget`）进行下载。
*   **自更新引导**: 对于 OSAC 自身的更新 (`updateType: "client"`)，需要一个独立的引导程序来替换主程序。这通常涉及将新版本下载到临时位置，然后由引导程序执行替换并重启 OSAC 进程。此过程需要仔细设计以确保原子性和可靠性。
*   **`opencode` 更新**: 
    *   如果 `payload.updateCommand` 存在，OSAC 应直接执行该命令（例如 `opencode upgrade <version>`）。
    *   如果 `payload.downloadUrl` 存在，OSAC 需要下载更新包，解压，并替换 `opencode` 的安装目录。在替换前，确保停止所有相关的 `opencode` 进程。替换完成后，可能需要重新启动 `opencode` 进程。
*   **状态报告**: 在更新的各个阶段，通过 `AGENT_UPDATE_STATUS` 消息向父智能体报告详细状态，包括 `started`, `downloading`, `verifying`, `installing`, `completed`, `failed` 等。
*   **失败回滚**: 在更新失败时，尝试回滚到更新前的状态，并向父智能体报告错误。

### 5.2 自维护任务

*   **日志清理**: 实现一个定时任务，定期扫描 `opencode` 和 OSAC 自身的日志目录，删除过期日志文件（例如，保留最近 7 天的日志）。
*   **临时文件清理**: 识别并清理 `opencode` 和 OSAC 自身产生的临时文件，例如下载的更新包、中间处理文件等。
*   **健康检查**: 周期性执行系统检查，包括：
    *   检查 `opencode` 进程是否正常运行。
    *   检查磁盘空间使用情况，确保有足够的可用空间。
    *   检查网络连接是否正常（例如，尝试连接一个公共 DNS 服务器）。
    *   通过 `HEARTBEAT` 消息向父智能体报告 OSAC 的当前状态（`idle`, `busy`, `updating`）和任何异常情况。
*   **资源监控**: 监控 OSAC 进程的 CPU 和内存使用情况。当资源使用率超过预设阈值时，可以向父智能体发送 `ERROR` 消息进行告警。

## 6. 安全考虑

*   **认证**: 严格执行 WebSocket 连接认证，确保只有授权的父智能体能够连接。
*   **输入验证**: 对所有来自父智能体的指令 `payload` 进行严格的输入验证和消毒，防止命令注入、路径遍历或其他恶意操作。特别是 `EXECUTE_COMMAND` 中的 `command` 字符串和 `options` 对象，必须进行仔细的转义和验证。
*   **权限最小化**: OSAC 及其运行的 `opencode` 进程应以最小权限运行，限制其对沙盒环境的访问。避免使用 `root` 权限。
*   **日志审计**: 记录所有关键操作和安全事件，包括接收到的指令、执行的 `opencode` 命令、文件系统操作和更新尝试，以便追溯和审计。
*   **资源隔离**: 确保 `opencode` 进程在沙盒环境中运行时，不会影响到其他系统组件或泄露敏感信息。

## 7. 总结

OSAC 的实现需要综合考虑沙盒环境的限制、与父智能体的通信模式以及 `opencode` CLI 的特性。通过模块化设计和清晰的接口规范，并融入 `opencode` 的具体调用方法和场景化命令，可以确保 OSAC 作为一个独立的、可控的代理，高效地执行父智能体下发的任务，并支持动态扩展和持续更新。开发者应严格遵循本文档中的指南，以构建一个健壮、安全且功能完善的 OSAC Agent。

### 4.2 会话持久化与延续

OSAC 依赖 `opencode` 自身的会话管理能力。实现时需要注意：

*   **会话 ID 传递**: 确保 `sessionId` 参数正确传递给 `opencode` 命令。
*   **会话列表与详情**: 通过执行 `opencode session list --format json` 和 `opencode export <sessionId>` 命令来获取会话数据，并解析其 JSON 输出以构建 `SESSION_LIST_RESPONSE` 和 `SESSION_DETAILS_RESPONSE` 消息。

### 4.3 Skills 热加载

*   **文件系统操作**: 当接收到 `LOAD_SKILL` 消息时，将 `skillContent` 写入到 `~/.opencode/agent/skill/<skillName>.md`。当接收到 `UNLOAD_SKILL` 消息时，删除对应文件。
*   **`opencode` 刷新**: 如果 `opencode` 提供技能刷新命令，则在文件操作后调用。否则，需要通知父智能体可能需要重启 `opencode` 进程以使技能生效。

### 4.4 MCP 热加载

*   **配置文件操作**: 当接收到 `ADD_MCP_SERVER` 或 `REMOVE_MCP_SERVER` 消息时，需要读取 `~/.opencode/config.json` 文件，修改其中的 `mcp` 配置部分，然后将更新后的 JSON 内容写回文件。
*   **JSON 安全写入**: 在修改 JSON 配置文件时，务必确保原子性操作，避免文件损坏。可以先写入临时文件，成功后再替换原文件。
*   **`opencode` 刷新**: 如果 `opencode` 提供配置刷新命令，则在文件操作后调用。否则，需要通知父智能体可能需要重启 `opencode` 进程以使 MCP 配置生效。

## 5. 更新与自维护实现

### 5.1 更新流程

*   **下载器**: 实现一个健壮的下载器，能够处理 `downloadUrl`，支持断点续传和完整性校验。
*   **自更新引导**: 对于 OSAC 自身的更新，需要一个独立的引导程序来替换主程序。这通常涉及将新版本下载到临时位置，然后由引导程序执行替换并重启。
*   **`opencode` 更新**: 对于 `opencode` 的更新，优先执行 `updateCommand`。如果通过 `downloadUrl` 更新，则需要解压更新包并替换 `opencode` 的安装目录。在替换前，确保停止所有相关的 `opencode` 进程。
*   **状态报告**: 在更新的各个阶段，通过 `AGENT_UPDATE_STATUS` 消息向父智能体报告详细状态。

### 5.2 自维护任务

*   **日志清理**: 实现一个定时任务，定期扫描日志目录，删除过期日志文件。
*   **临时文件清理**: 识别并清理 `opencode` 和 OSAC 自身产生的临时文件。
*   **健康检查**: 周期性执行系统检查（如磁盘空间、内存使用、`opencode` 进程状态），并通过 `HEARTBEAT` 消息报告给父智能体。

## 6. 安全考虑

*   **认证**: 严格执行 WebSocket 连接认证。
*   **输入验证**: 对所有来自父智能体的指令 `payload` 进行严格的输入验证，防止命令注入或其他恶意操作。
*   **权限最小化**: OSAC 及其运行的 `opencode` 进程应以最小权限运行，限制其对沙盒环境的访问。
*   **日志审计**: 记录所有关键操作和安全事件，以便追溯和审计。

## 7. 总结

OSAC 的实现需要综合考虑沙盒环境的限制、与父智能体的通信模式以及 `opencode` CLI 的特性。通过模块化设计和清晰的接口规范，可以确保 OSAC 作为一个独立的、可控的代理，高效地执行父智能体下发的任务，并支持动态扩展和持续更新。
