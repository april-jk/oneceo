# OpenCode Sandbox Agent Client (OSAC) 开发文档 - Server 端

## 1. 引言

本开发文档旨在为 OpenCode Sandbox Agent Client (OSAC) 的父智能体（Server）实现者提供详细的指导。Server 端是整个 OSAC 生态系统的核心调度者，负责管理、调度和监控一个或多个运行在隔离沙盒环境中的 OSAC Agent。本文档将聚焦于 Server 端如何与 OSAC Agent 建立通信、下发指令、处理 Agent 回传的状态和结果，以及如何实现任务调度、动态配置和系统更新等核心功能，确保 Server 端能够独立开发并与 OSAC Agent 无缝协作。

## 2. 架构概述

Server 端作为父智能体，其架构设计需要考虑多 Agent 管理、高并发通信、任务调度、状态持久化和故障恢复等复杂性。它将作为 OSAC Agent 的“大脑”，提供高级别的决策和控制。

### 2.1 模块组成

Server 端主要由以下功能模块构成：

*   **Agent 连接管理器 (Agent Connection Manager)**: 负责维护与所有在线 OSAC Agent 的 WebSocket 连接，处理连接的建立、断开和心跳检测。
*   **认证与授权模块 (Authentication & Authorization Module)**: 为 OSAC Agent 提供认证凭据（如 PSK 或 Token），并在连接时验证 Agent 的合法性（如果 Agent 端也需要验证 Server）。
*   **指令生成器 (Command Generator)**: 根据父智能体的任务需求，生成符合 OSAC API 规范的 JSON 格式指令。
*   **任务调度器 (Task Scheduler)**: 负责将任务分配给合适的 OSAC Agent，管理任务队列，并处理任务的优先级和并发。
*   **状态处理器 (State Processor)**: 接收并解析来自 OSAC Agent 的 JSON 格式状态消息，更新内部状态模型，并触发相应的业务逻辑。
*   **会话管理器 (Session Manager)**: 跟踪和管理所有 OSAC Agent 上的 `opencode` 会话，包括会话 ID 的分配、状态的持久化和历史记录的查询。
*   **配置分发器 (Configuration Distributor)**: 负责将 Skills 和 MCP 服务器配置分发给指定的 OSAC Agent。
*   **更新协调器 (Update Coordinator)**: 负责协调 OSAC Agent 的更新过程，包括版本管理、更新包分发和更新状态监控。
*   **日志与监控模块 (Logging & Monitoring Module)**: 收集和存储来自 OSAC Agent 的日志和健康状态信息，提供可视化界面和告警功能。

### 2.2 内部工作流程

1.  **Agent 发现与连接**: Server 端通过预配置的 IP 地址和端口，主动向 OSAC Agent 发起 WebSocket 连接。Agent 连接管理器负责维护这些连接。
2.  **认证与握手**: 在连接建立时，Server 端提供认证凭据给 OSAC Agent 进行验证。成功后，双方建立持久通信。
3.  **任务下发**: 父智能体通过指令生成器创建 JSON 格式的指令（如 `EXECUTE_COMMAND`, `LOAD_SKILL` 等），并通过 Agent 连接管理器发送给目标 OSAC Agent。
4.  **状态接收与处理**: 状态处理器实时接收来自 OSAC Agent 的 `COMMAND_OUTPUT`, `COMMAND_STATUS`, `HEARTBEAT` 等消息，更新 Server 端的内部状态模型，并触发后续业务逻辑（如通知用户、记录日志、调整调度策略）。
5.  **会话管理**: 会话管理器根据任务需求，在下发 `EXECUTE_COMMAND` 时指定 `sessionId`，以实现任务的延续性。同时，它也负责查询和展示 Agent 上的会话历史。
6.  **动态配置**: 配置分发器根据需要向 OSAC Agent 下发 `LOAD_SKILL`, `ADD_MCP_SERVER` 等指令，动态调整 Agent 的能力。
7.  **系统更新**: 更新协调器管理 OSAC Agent 的版本，并在需要时下发 `INITIATE_UPDATE` 指令，监控更新进度和结果。
8.  **监控与告警**: 日志与监控模块持续收集 Agent 的健康数据，并在出现异常时发出告警。

## 3. 通信协议与 API 接口规范

Server 端与 OSAC Agent 之间的通信基于 WebSocket 协议，所有消息均采用统一的 JSON 格式。Server 端作为 WebSocket 客户端，主动连接 OSAC Agent 暴露的 WebSocket 服务端点。本节将详细列出 Server 端发送给 Agent 的指令和接收自 Agent 的状态消息。

### 3.1 消息结构约定

所有消息都必须包含 `type` 字段和 `payload` 字段：

```json
{
  "type": "<MessageType>",
  "payload": { /* 具体消息体 */ }
}
```

### 3.2 认证机制

Server 端在发起 WebSocket 连接时，必须在 HTTP 握手请求中包含认证凭据，以通过 OSAC Agent 的验证。

*   **PSK 实现**: Server 端在 WebSocket 连接的 HTTP 握手请求头中，设置 `Authorization` 字段，其值为预配置的 PSK。例如：`Authorization: Bearer <YOUR_PRE_SHARED_KEY>`。
*   **令牌实现**: Server 端在 WebSocket 连接的 HTTP 握手请求头中，设置 `Authorization` 字段，其值为从认证服务获取的有效令牌。例如：`Authorization: Bearer <YOUR_AUTH_TOKEN>`。

### 3.3 Server -> OSAC API 接口 (指令下发)

Server 端向 OSAC Agent 发送的指令，用于控制 Agent 的行为和配置。

#### 3.3.1 `EXECUTE_COMMAND`：执行 OpenCode CLI 命令

*   **描述**: 指示 OSAC Agent 执行一个 `opencode` CLI 命令。
*   **`type`**: `EXECUTE_COMMAND`
*   **`payload`**:
    *   `command`: `string` - 完整的 `opencode` CLI 命令字符串，例如 `run "Hello World"`。
    *   `sessionId`: `string`, 可选 - 如果要继续现有会话，则提供会话 ID。Server 端应负责生成和管理这些会话 ID。
    *   `continueSession`: `boolean`, 可选 - 如果为 `true` 且未指定 `sessionId`，指示 Agent 尝试延续上一个会话。与 `sessionId` 互斥。
    *   `options`: `object`, 可选 - 包含 `opencode` 命令特定选项的键值对。Server 端应根据任务需求构建这些选项。

#### 3.3.2 `GET_SESSION_LIST`：获取会话列表

*   **描述**: 请求 OSAC Agent 返回其管理的 `opencode` 会话列表。
*   **`type`**: `GET_SESSION_LIST`
*   **`payload`**:
    *   `maxCount`: `number`, 可选 - 限制返回的会话数量。
    *   `format`: `string`, 可选 - 返回格式，例如 `json`。

#### 3.3.3 `GET_SESSION_DETAILS`：获取会话详情

*   **描述**: 请求 OSAC Agent 返回特定 `opencode` 会话的详细信息。
*   **`type`**: `GET_SESSION_DETAILS`
*   **`payload`**:
    *   `sessionId`: `string` - 要获取详情的会话 ID。

#### 3.3.4 `LOAD_SKILL`：加载技能

*   **描述**: 指示 OSAC Agent 加载一个新的 `opencode` 技能。
*   **`type`**: `LOAD_SKILL`
*   **`payload`**:
    *   `skillName`: `string` - 技能的名称。
    *   `skillContent`: `string` - 技能的完整内容（例如 Markdown 格式）。
    *   `overwrite`: `boolean`, 可选 - 如果技能已存在，是否覆盖。默认为 `false`。

#### 3.3.5 `UNLOAD_SKILL`：卸载技能

*   **描述**: 指示 OSAC Agent 卸载指定的 `opencode` 技能。
*   **`type`**: `UNLOAD_SKILL`
*   **`payload`**:
    *   `skillName`: `string` - 要卸载的技能名称。

#### 3.3.6 `ADD_MCP_SERVER`：添加 MCP 服务器

*   **描述**: 指示 OSAC Agent 添加新的 MCP 服务器配置到 `opencode`。
*   **`type`**: `ADD_MCP_SERVER`
*   **`payload`**:
    *   `serverName`: `string` - MCP 服务器的名称。
    *   `serverConfig`: `object` - MCP 服务器的配置对象。
    *   `overwrite`: `boolean`, 可选 - 如果服务器已存在，是否覆盖。默认为 `false`。

#### 3.3.7 `REMOVE_MCP_SERVER`：移除 MCP 服务器

*   **描述**: 指示 OSAC Agent 移除指定的 MCP 服务器配置。
*   **`type`**: `REMOVE_MCP_SERVER`
*   **`payload`**:
    *   `serverName`: `string` - 要移除的 MCP 服务器名称。

#### 3.3.8 `INITIATE_UPDATE`：启动更新

*   **描述**: 指示 OSAC Agent 启动自身和/或 `opencode` 的更新过程。
*   **`type`**: `INITIATE_UPDATE`
*   **`payload`**:
    *   `updateType`: `string` - 更新类型，`client` (仅更新 OSAC), `opencode` (仅更新 OpenCode), `all` (两者都更新)。
    *   `version`: `string`, 可选 - 要更新到的目标版本。如果未指定，则更新到最新版本。
    *   `downloadUrl`: `string`, 可选 - 更新包的下载 URL。Server 端应提供可供 Sandbox 访问的 URL。
    *   `updateCommand`: `string`, 可选 - 自定义更新命令，例如 `npm install -g opencode-ai`。

### 3.4 OSAC -> Server API 接口 (状态处理)

Server 端接收来自 OSAC Agent 的状态更新、命令输出和结果，并进行相应的处理。

#### 3.4.1 `COMMAND_OUTPUT`：命令输出

*   **描述**: 接收 `opencode` CLI 命令的实时标准输出 (stdout) 和标准错误 (stderr)。
*   **`type`**: `COMMAND_OUTPUT`
*   **`payload`**:
    *   `sessionId`: `string` - 关联的会话 ID。Server 端应根据此 ID 将输出关联到相应的任务和会话。
    *   `outputType`: `string` - 输出类型，`stdout` 或 `stderr`。
    *   `content`: `string` - 输出内容。
    *   `isFinal`: `boolean` - 是否为本次命令的最终输出。Server 端应在接收到最终输出后，标记命令为完成。

#### 3.4.2 `COMMAND_STATUS`：命令状态

*   **描述**: 接收命令的执行状态。
*   **`type`**: `COMMAND_STATUS`
*   **`payload`**:
    *   `sessionId`: `string` - 关联的会话 ID。Server 端应更新其内部任务状态。
    *   `status`: `string` - 命令状态，例如 `running`, `completed`, `failed`, `cancelled`。
    *   `exitCode`: `number`, 可选 - 命令的退出码（仅当 `status` 为 `completed` 或 `failed` 时）。
    *   `errorMessage`: `string`, 可选 - 错误信息（仅当 `status` 为 `failed` 时）。

#### 3.4.3 `SESSION_LIST_RESPONSE`：会话列表响应

*   **描述**: 响应 `GET_SESSION_LIST` 请求，返回会话列表。
*   **`type`**: `SESSION_LIST_RESPONSE`
*   **`payload`**:
    *   `sessions`: `array` - 会话对象数组，每个对象包含 `id`, `title`, `updatedAt` 等信息。Server 端应将此数据用于会话管理界面或内部状态更新。

#### 3.4.4 `SESSION_DETAILS_RESPONSE`：会话详情响应

*   **描述**: 响应 `GET_SESSION_DETAILS` 请求，返回特定会话的详细信息。
*   **`type`**: `SESSION_DETAILS_RESPONSE`
*   **`payload`**:
    *   `session`: `object` - 包含会话的完整信息，包括消息历史、元数据等。Server 端应将此数据用于展示会话详情。

#### 3.4.5 `SKILL_STATUS`：技能状态

*   **描述**: 接收技能加载/卸载的状态。
*   **`type`**: `SKILL_STATUS`
*   **`payload`**:
    *   `skillName`: `string` - 技能名称。
    *   `status`: `string` - 状态，例如 `loaded`, `unloaded`, `failed_to_load`, `failed_to_unload`。
    *   `errorMessage`: `string`, 可选 - 错误信息。Server 端应更新其对 Agent 技能的内部记录。

#### 3.4.6 `MCP_SERVER_STATUS`：MCP 服务器状态

*   **描述**: 接收 MCP 服务器添加/移除的状态。
*   **`type`**: `MCP_SERVER_STATUS`
*   **`payload`**:
    *   `serverName`: `string` - MCP 服务器名称。
    *   `status`: `string` - 状态，例如 `added`, `removed`, `failed_to_add`, `failed_to_remove`。
    *   `errorMessage`: `string`, 可选 - 错误信息。Server 端应更新其对 Agent MCP 配置的内部记录。

#### 3.4.7 `AGENT_UPDATE_STATUS`：代理更新状态

*   **描述**: 接收 OSAC 或 `opencode` 更新过程的状态。
*   **`type`**: `AGENT_UPDATE_STATUS`
*   **`payload`**:
    *   `updateType`: `string` - 更新类型，`client`, `opencode`, `all`。
    *   `status`: `string` - 更新状态，例如 `started`, `downloading`, `installing`, `completed`, `failed`。
    *   `progress`: `number`, 可选 - 更新进度百分比。
    *   `errorMessage`: `string`, 可选 - 错误信息。Server 端应监控更新进度，并在完成或失败时采取相应措施。

#### 3.4.8 `ERROR`：通用错误

*   **描述**: 接收来自 OSAC Agent 的通用错误报告。
*   **`type`**: `ERROR`
*   **`payload`**:
    *   `code`: `string`, 可选 - 错误代码。
    *   `message`: `string` - 错误描述。
    *   `details`: `object`, 可选 - 更多错误详情。Server 端应记录这些错误并可能触发告警。

#### 3.4.9 `HEARTBEAT`：心跳

*   **描述**: 接收 OSAC Agent 定期发送的心跳消息，用于告知其仍然活跃。
*   **`type`**: `HEARTBEAT`
*   **`payload`**:
    *   `timestamp`: `number` - 发送心跳的时间戳。
    *   `status`: `string` - OSAC 的当前状态，例如 `idle`, `busy`, `updating`。
    *   `currentSessionId`: `string`, 可选 - 如果正在处理会话，则为当前会话 ID。Server 端应利用心跳消息检测 Agent 的在线状态和健康状况。

## 4. 核心功能实现指南

### 4.1 Agent 连接管理

*   **WebSocket 客户端**: 使用成熟的 WebSocket 客户端库（如 Node.js 的 `ws`，Python 的 `websocket-client`）来建立和维护与 OSAC Agent 的连接。
*   **连接池/管理**: 对于管理多个 Agent 的场景，需要实现连接池或连接管理器，以高效地管理大量并发连接。
*   **重连机制**: 实现自动重连逻辑，处理网络波动或 Agent 重启导致的连接中断。
*   **认证凭据**: 安全地存储和使用用于连接 OSAC Agent 的 PSK 或令牌。

### 4.2 任务调度与指令下发

*   **任务队列**: 实现一个任务队列，将父智能体的任务排队，并分配给可用的 OSAC Agent。
*   **指令构建**: 根据任务需求，动态构建 `EXECUTE_COMMAND` 及其他指令的 `payload`。特别是 `opencode` 命令的 `options` 字段，需要灵活地从任务参数转换为 JSON 对象。
*   **会话管理**: Server 端需要维护一个会话状态存储，记录每个任务对应的 `sessionId`，以便在后续修改需求中能够延续会话。
*   **错误处理**: 在指令下发失败时，实现重试机制或将任务标记为失败。

### 4.3 状态处理与监控

*   **消息解析**: 接收到来自 OSAC Agent 的 JSON 消息后，进行解析并根据 `type` 字段分发给不同的处理器。
*   **实时输出**: `COMMAND_OUTPUT` 消息应实时展示给用户或记录到日志中。
*   **状态更新**: 根据 `COMMAND_STATUS` 消息更新任务的执行状态，并触发相应的 UI 更新或业务逻辑。
*   **健康监控**: 持续处理 `HEARTBEAT` 消息，更新 Agent 的在线状态和健康指标。实现告警机制，当 Agent 离线或报告异常状态时通知管理员。

### 4.4 动态配置管理

*   **技能与 MCP 配置**: Server 端应提供界面或 API，允许管理员上传技能内容或配置 MCP 服务器。配置分发器将这些配置封装成 `LOAD_SKILL`, `ADD_MCP_SERVER` 等指令发送给目标 Agent。
*   **状态反馈**: 接收并处理 `SKILL_STATUS` 和 `MCP_SERVER_STATUS` 消息，更新 Server 端对 Agent 配置的内部视图。

### 4.5 更新协调

*   **版本管理**: Server 端应维护所有 OSAC Agent 的版本信息，并提供更新策略（如自动更新、手动批准更新）。
*   **更新包管理**: 提供更新包的存储和分发机制，确保 `downloadUrl` 可供 Sandbox 环境访问。
*   **更新状态监控**: 接收并处理 `AGENT_UPDATE_STATUS` 消息，实时监控更新进度，并在更新完成或失败时采取相应措施。

## 5. 安全考虑

*   **凭据管理**: 安全地生成、存储和分发用于 OSAC Agent 认证的 PSK 或令牌。避免在代码中硬编码敏感信息。
*   **输入验证**: 对所有发送给 OSAC Agent 的指令 `payload` 进行严格的输入验证，防止恶意指令注入。
*   **权限控制**: 确保只有授权用户或系统才能下发指令给 OSAC Agent。
*   **日志审计**: 记录所有与 OSAC Agent 的交互，包括指令下发、状态接收和任何异常情况，以便进行安全审计和故障排查。
*   **网络安全**: 确保 Server 端与 OSAC Agent 之间的通信通道加密（WebSocket over TLS/SSL）。

## 6. 总结

Server 端作为 OSAC 生态系统的控制中心，其设计和实现对于整个系统的稳定性和功能性至关重要。通过遵循本文档中定义的通信协议和 API 接口规范，并结合健壮的连接管理、任务调度、状态处理和安全机制，Server 端能够有效地调度和管理 OSAC Agent，从而实现父智能体对沙盒环境中 OpenCode CLI 的强大控制和灵活运用。
