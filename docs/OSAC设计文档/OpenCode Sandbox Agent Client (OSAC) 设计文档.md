# OpenCode Sandbox Agent Client (OSAC) 设计文档

## 1. 概述

OpenCode Sandbox Agent Client (OSAC) 旨在将 OpenCode CLI 工具封装为一个可受父智能体调度的沙盒代理。OSAC 运行在隔离的沙盒环境中，负责接收父智能体的指令，通过调用 OpenCode CLI 执行任务，并回传执行结果和状态。本设计文档将详细阐述 OSAC 的核心架构、通信协议、API 接口、会话管理、技能与 MCP 热加载机制，以及更新与自维护策略，以满足父智能体对任务调度、状态持久化、动态配置和系统更新的需求。

## 2. OSAC 核心架构

OSAC 的核心架构围绕其在沙盒环境中的特殊定位和与父智能体的单向通信需求而设计。它是一个轻量级的常驻进程，主要职责是作为父智能体与 OpenCode CLI 之间的桥梁。

### 2.1 模块组成

OSAC 主要由以下模块组成：

*   **通信模块 (Communication Module)**: 负责建立和维护与父智能体的 WebSocket 连接，以及消息的序列化与反序列化。
*   **指令解析与调度模块 (Command Parsing & Dispatch Module)**: 接收并解析父智能体下发的指令，将其映射到 OSAC 内部功能或 OpenCode CLI 命令。
*   **OpenCode CLI 封装模块 (OpenCode CLI Wrapper)**: 负责调用 `opencode` CLI 命令，捕获其标准输出、标准错误和退出码，并将其转换为结构化数据。
*   **会话管理模块 (Session Management Module)**: 利用 `opencode` 自身的会话机制，实现任务的延续和状态持久化。
*   **配置管理模块 (Configuration Management Module)**: 负责管理 OSAC 自身的配置，以及动态加载和卸载 Skills 和 MCP 配置。
*   **更新与自维护模块 (Update & Self-Maintenance Module)**: 处理 OSAC 自身和 `opencode` CLI 的更新，以及执行日志清理、临时文件管理等自维护任务。
*   **安全模块 (Security Module)**: 负责认证和授权，确保只有合法的父智能体才能与 OSAC 交互。

### 2.2 运行环境

OSAC 运行在一个隔离的沙盒环境中，其特点包括：

*   **网络隔离**: OSAC 无法主动发起外部网络连接，只能接受父智能体的主动连接。
*   **文件系统隔离**: OSAC 拥有独立的、受限的文件系统访问权限，以确保任务和配置的安全性。
*   **资源限制**: 沙盒环境可能对 CPU、内存等资源进行限制，OSAC 需设计为资源高效型。

### 2.3 工作流程

1.  **启动**: OSAC 启动后，初始化各个模块，并监听一个预设或动态分配的端口，等待父智能体的 WebSocket 连接。
2.  **连接与认证**: 父智能体主动连接 OSAC 的 WebSocket 服务端点，并进行身份认证。认证成功后，建立持久化连接。
3.  **指令接收**: OSAC 通过 WebSocket 接收父智能体下发的 JSON 格式指令。
4.  **指令处理**: 指令解析与调度模块解析指令类型和内容：
    *   如果是 `EXECUTE_COMMAND`，则调用 OpenCode CLI 封装模块执行 `opencode` 命令。
    *   如果是 `LOAD_SKILL` 或 `ADD_MCP_SERVER`，则由配置管理模块处理，动态修改相关配置。
    *   如果是 `INITIATE_UPDATE`，则由更新与自维护模块处理。
    *   如果是查询类指令（如 `GET_SESSION_LIST`），则由会话管理模块处理并返回结果。
5.  **状态回传**: OSAC 将命令执行的实时输出、状态更新、错误信息以及查询结果等，通过 WebSocket 以 JSON 格式回传给父智能体。
6.  **自维护**: OSAC 周期性执行自维护任务，并向父智能体报告健康状态。

## 3. 通信协议与 API 接口规范

OSAC 与父智能体之间的通信是实现其核心功能的基础。考虑到 Sandbox 环境的隔离性，OSAC 无法主动连接外部服务器，因此通信模型设计为由父智能体主动连接 OSAC，并建立持久化连接进行指令下发和状态回传。

### 3.1 通信模型：WebSocket

为了支持实时指令下发、状态更新和事件通知，OSAC 将采用 **WebSocket** 作为主要的通信协议。父智能体作为客户端，主动连接 OSAC 暴露的 WebSocket 服务端点。一旦连接建立，双方即可进行全双工通信。

**连接流程:**
1.  OSAC 启动后，监听一个预设或动态分配的端口，并暴露 WebSocket 服务端点。
2.  父智能体通过 OSAC 的 IP 地址和端口，发起 WebSocket 连接请求。
3.  OSAC 接收连接请求，并进行身份验证（详见 3.2.1 节）。
4.  身份验证成功后，建立持久化的 WebSocket 连接，双方可以开始交换消息。

### 3.2 消息结构

所有通过 WebSocket 传输的消息都将采用统一的 **JSON 格式**，以确保数据传输的灵活性和可扩展性。每条消息都包含 `type` 字段用于标识消息类型，以及 `payload` 字段承载具体数据。

```json
{
  "type": "<MessageType>",
  "payload": { /* 消息体 */ }
}
```

#### 3.2.1 认证机制

由于 Sandbox 环境的特殊性，OSAC 暴露的服务端点需要严格的认证机制。建议采用 **预共享密钥 (Pre-shared Key, PSK)** 或 **令牌 (Token)** 机制。

*   **PSK 认证:** 父智能体在连接请求的 HTTP 头中携带预配置的密钥。OSAC 验证密钥的有效性。密钥应定期更换，并安全分发。
*   **令牌认证:** 父智能体通过带外方式获取一个短期有效的令牌，并在连接请求中携带。OSAC 验证令牌的有效性。令牌可以由一个独立的认证服务签发。

**示例 (PSK 认证):**
父智能体在 WebSocket 连接握手时，在 `Authorization` 头中发送 PSK。

### 3.3 父智能体 -> OSAC API 接口 (指令下发)

以下是父智能体向 OSAC 下发指令的主要消息类型及其 `payload` 结构。

#### 3.3.1 `EXECUTE_COMMAND`：执行 OpenCode CLI 命令

用于在 Sandbox 中执行任意 `opencode` CLI 命令。

*   **`type`**: `EXECUTE_COMMAND`
*   **`payload`**:
    *   `command`: `string` - 要执行的 `opencode` 命令，例如 `run "Hello World"`。
    *   `sessionId`: `string`, 可选 - 如果要继续现有会话，则提供会话 ID。
    *   `continueSession`: `boolean`, 可选 - 如果为 `true`，则尝试继续上一个会话。与 `sessionId` 互斥。
    *   `options`: `object`, 可选 - 包含 `opencode` 命令特定选项的键值对。例如：
        ```json
        {
          "model": "openai/gpt-4",
          "agent": "my-custom-agent",
          "file": ["/path/to/file1.txt", "/path/to/file2.py"],
          "title": "My New Session",
          "variant": "high",
          "thinking": true
        }
        ```

#### 3.3.2 `GET_SESSION_LIST`：获取会话列表

用于父智能体查询 OSAC 中存储的所有会话列表。

*   **`type`**: `GET_SESSION_LIST`
*   **`payload`**:
    *   `maxCount`: `number`, 可选 - 限制返回的会话数量。
    *   `format`: `string`, 可选 - 返回格式，例如 `json`。

#### 3.3.3 `GET_SESSION_DETAILS`：获取会话详情

用于父智能体获取特定会话的详细信息，包括消息历史和元数据。

*   **`type`**: `GET_SESSION_DETAILS`
*   **`payload`**:
    *   `sessionId`: `string` - 要获取详情的会话 ID。

#### 3.3.4 `LOAD_SKILL`：加载技能

用于父智能体向 OSAC 热加载新的技能。OSAC 接收到技能定义后，应将其保存到指定目录并使其对 `opencode` 可用。

*   **`type`**: `LOAD_SKILL`
*   **`payload`**:
    *   `skillName`: `string` - 技能的名称。
    *   `skillContent`: `string` - 技能的完整内容（例如 Markdown 格式）。
    *   `overwrite`: `boolean`, 可选 - 如果技能已存在，是否覆盖。默认为 `false`。

#### 3.3.5 `UNLOAD_SKILL`：卸载技能

用于父智能体从 OSAC 卸载指定的技能。

*   **`type`**: `UNLOAD_SKILL`
*   **`payload`**:
    *   `skillName`: `string` - 要卸载的技能名称。

#### 3.3.6 `ADD_MCP_SERVER`：添加 MCP 服务器

用于父智能体向 OSAC 添加新的 MCP 服务器配置。

*   **`type`**: `ADD_MCP_SERVER`
*   **`payload`**:
    *   `serverName`: `string` - MCP 服务器的名称。
    *   `serverConfig`: `object` - MCP 服务器的配置对象，例如：
        ```json
        {
          "type": "remote",
          "url": "https://example.com/mcp",
          "oauth": {
            "clientId": "your-client-id",
            "clientSecret": "your-client-secret"
          }
        }
        ```
    *   `overwrite`: `boolean`, 可选 - 如果服务器已存在，是否覆盖。默认为 `false`。

#### 3.3.7 `REMOVE_MCP_SERVER`：移除 MCP 服务器

用于父智能体从 OSAC 移除指定的 MCP 服务器配置。

*   **`type`**: `REMOVE_MCP_SERVER`
*   **`payload`**:
    *   `serverName`: `string` - 要移除的 MCP 服务器名称。

#### 3.3.8 `INITIATE_UPDATE`：启动更新

用于父智能体指示 OSAC 启动自身和/或 `opencode` 的更新过程。由于 Sandbox 无法主动连接外部，更新包需要通过父智能体提供或指定下载链接。

*   **`type`**: `INITIATE_UPDATE`
*   **`payload`**:
    *   `updateType`: `string` - 更新类型，例如 `client` (仅更新 OSAC), `opencode` (仅更新 OpenCode), `all` (两者都更新)。
    *   `version`: `string`, 可选 - 要更新到的目标版本。如果未指定，则更新到最新版本。
    *   `downloadUrl`: `string`, 可选 - 更新包的下载 URL。如果提供，OSAC 将尝试从该 URL 下载。
    *   `updateCommand`: `string`, 可选 - 自定义更新命令，例如 `npm install -g opencode-ai`。

### 3.4 OSAC -> 父智能体 API 接口 (状态回传)

以下是 OSAC 向父智能体回传状态和结果的主要消息类型及其 `payload` 结构。

#### 3.4.1 `COMMAND_OUTPUT`：命令输出

用于回传 `opencode` CLI 命令的实时标准输出 (stdout) 和标准错误 (stderr)。

*   **`type`**: `COMMAND_OUTPUT`
*   **`payload`**:
    *   `sessionId`: `string` - 关联的会话 ID。
    *   `outputType`: `string` - 输出类型，`stdout` 或 `stderr`。
    *   `content`: `string` - 输出内容。
    *   `isFinal`: `boolean` - 是否为本次命令的最终输出。

#### 3.4.2 `COMMAND_STATUS`：命令状态

用于通知父智能体命令的执行状态。

*   **`type`**: `COMMAND_STATUS`
*   **`payload`**:
    *   `sessionId`: `string` - 关联的会话 ID。
    *   `status`: `string` - 命令状态，例如 `running`, `completed`, `failed`, `cancelled`。
    *   `exitCode`: `number`, 可选 - 命令的退出码（仅当 `status` 为 `completed` 或 `failed` 时）。
    *   `errorMessage`: `string`, 可选 - 错误信息（仅当 `status` 为 `failed` 时）。

#### 3.4.3 `SESSION_LIST_RESPONSE`：会话列表响应

响应 `GET_SESSION_LIST` 请求，返回会话列表。

*   **`type`**: `SESSION_LIST_RESPONSE`
*   **`payload`**:
    *   `sessions`: `array` - 会话对象数组，每个对象包含 `id`, `title`, `updatedAt` 等信息。

#### 3.4.4 `SESSION_DETAILS_RESPONSE`：会话详情响应

响应 `GET_SESSION_DETAILS` 请求，返回特定会话的详细信息。

*   **`type`**: `SESSION_DETAILS_RESPONSE`
*   **`payload`**:
    *   `session`: `object` - 包含会话的完整信息，包括消息历史、元数据等。

#### 3.4.5 `SKILL_STATUS`：技能状态

通知父智能体技能加载/卸载的状态。

*   **`type`**: `SKILL_STATUS`
*   **`payload`**:
    *   `skillName`: `string` - 技能名称。
    *   `status`: `string` - 状态，例如 `loaded`, `unloaded`, `failed_to_load`, `failed_to_unload`。
    *   `errorMessage`: `string`, 可选 - 错误信息。

#### 3.4.6 `MCP_SERVER_STATUS`：MCP 服务器状态

通知父智能体 MCP 服务器添加/移除的状态。

*   **`type`**: `MCP_SERVER_STATUS`
*   **`payload`**:
    *   `serverName`: `string` - MCP 服务器名称。
    *   `status`: `string` - 状态，例如 `added`, `removed`, `failed_to_add`, `failed_to_remove`。
    *   `errorMessage`: `string`, 可选 - 错误信息。

#### 3.4.7 `AGENT_UPDATE_STATUS`：代理更新状态

通知父智能体 OSAC 或 `opencode` 更新过程的状态。

*   **`type`**: `AGENT_UPDATE_STATUS`
*   **`payload`**:
    *   `updateType`: `string` - 更新类型，`client`, `opencode`, `all`。
    *   `status`: `string` - 更新状态，例如 `started`, `downloading`, `installing`, `completed`, `failed`。
    *   `progress`: `number`, 可选 - 更新进度百分比。
    *   `errorMessage`: `string`, 可选 - 错误信息。

#### 3.4.8 `ERROR`：通用错误

用于报告 OSAC 内部发生的通用错误。

*   **`type`**: `ERROR`
*   **`payload`**:
    *   `code`: `string`, 可选 - 错误代码。
    *   `message`: `string` - 错误描述。
    *   `details`: `object`, 可选 - 更多错误详情。

#### 3.4.9 `HEARTBEAT`：心跳

OSAC 定期发送的心跳消息，用于告知父智能体其仍然活跃。

*   **`type`**: `HEARTBEAT`
*   **`payload`**:
    *   `timestamp`: `number` - 发送心跳的时间戳。
    *   `status`: `string` - OSAC 的当前状态，例如 `idle`, `busy`, `updating`。
    *   `currentSessionId`: `string`, 可选 - 如果正在处理会话，则为当前会话 ID。

### 3.5 接口文档总结

通过上述消息类型和结构，父智能体可以实现对 OSAC 的全面控制和状态监控。OSAC 内部的实现将负责解析这些指令，调用 `opencode` CLI，捕获其输出和状态，并通过 WebSocket 回传给父智能体。

## 4. Skills 与 MCP 热加载机制

为了增强 OpenCode Sandbox Agent Client (OSAC) 的灵活性和适应性，需要实现 Skills 和 MCP (Model Context Protocol) 服务器的“热加载”机制，即在不重启 OSAC 或底层 `opencode` 进程的情况下，动态地添加、更新或移除这些配置。

### 4.1 Session 机制的持久化与延续

OSAC 充分利用 `opencode` 自身提供的会话管理能力，确保任务的连续性和可追溯性。当父智能体下发 `EXECUTE_COMMAND` 指令时，OSAC 将根据指令中的 `sessionId` 或 `continueSession` 标志来决定如何处理会话。

*   **会话延续**: 如果 `EXECUTE_COMMAND` 消息中包含 `sessionId`，OSAC 会将该 ID 作为参数传递给 `opencode run -s <sessionId>` 命令，使 `opencode` 在指定会话的上下文中执行任务。这允许父智能体对同一个任务进行多次修改和迭代。
*   **自动延续**: 如果 `EXECUTE_COMMAND` 消息中包含 `continueSession: true` 且未指定 `sessionId`，OSAC 将尝试查找并延续 `opencode` 的上一个会话。这适用于父智能体希望在不显式管理会话 ID 的情况下，保持任务连续性的场景。
*   **会话存储**: `opencode` 内部负责会话数据的持久化（通常存储在 `~/.opencode/data/session` 目录下）。OSAC 无需额外处理会话数据的存储，只需正确调用 `opencode` 命令即可。

### 4.2 Skills 热加载机制

Skills 是 `opencode` 代理执行特定任务的关键扩展。OSAC 能够动态加载和管理这些技能，以适应父智能体不断变化的需求。

#### 4.2.1 技能文件管理

*   **接收**: 当 OSAC 收到父智能体发送的 `LOAD_SKILL` 消息时，它会从 `payload` 中提取 `skillName` 和 `skillContent`。
*   **存储路径**: OSAC 会将技能内容保存到 Sandbox 环境中 `opencode` 可访问的特定目录，例如 `/home/ubuntu/.opencode/agent/skill/<skillName>.md`。这个路径是 `opencode` 默认扫描技能定义的目录之一。
*   **文件操作**: OSAC 将 `skillContent` 写入到对应的 Markdown 文件中。如果 `overwrite` 标志为 `true` 且文件已存在，则覆盖现有文件；否则，如果文件已存在且 `overwrite` 为 `false`，则返回错误或忽略操作。
*   **卸载**: 当 OSAC 收到 `UNLOAD_SKILL` 消息时，它会删除对应路径下的技能文件。

#### 4.2.2 `opencode` 技能发现与激活

`opencode` 内部通过扫描特定目录来发现可用的技能。为了实现“热加载”，OSAC 需要确保 `opencode` 在技能文件发生变化后能够重新加载这些技能。

*   **重新扫描**: 理想情况下，`opencode` 应该提供一个内部 API 或命令（例如 `opencode skill refresh`）来触发技能目录的重新扫描。如果存在，OSAC 在文件操作完成后调用此命令。
*   **代理重启/重载**: 如果 `opencode` 没有提供直接的技能刷新机制，那么为了使新技能生效，可能需要重新启动 `opencode` 进程，或者如果 `opencode` 支持，重新加载其内部的代理模块。考虑到 `opencode` 的设计，通常在启动时加载所有可用技能，因此，在生产环境中，最稳妥的方式是通知父智能体，并可能需要父智能体协调 `opencode` 进程的重启（这通常通过 OSAC 的更新机制实现，详见 5.1 节）。
*   **状态反馈**: OSAC 会通过 `SKILL_STATUS` 消息向父智能体报告技能加载/卸载的结果，包括成功、失败或错误信息。

### 4.3 MCP 热加载机制

MCP 服务器配置允许 `opencode` 与外部模型上下文协议服务集成。OSAC 能够动态管理这些配置。

#### 4.3.1 MCP 配置管理

*   **接收**: 当 OSAC 收到父智能体发送的 `ADD_MCP_SERVER` 消息时，它会从 `payload` 中提取 `serverName` 和 `serverConfig`。
*   **存储位置**: MCP 配置通常存储在 `opencode` 的主配置文件 `~/.opencode/config.json` 中。OSAC 需要读取、修改并保存这个 JSON 文件。
*   **文件操作**: OSAC 将 `serverConfig` 添加或更新到 `config.json` 文件的 `mcp` 字段下，以 `serverName` 作为键。如果 `overwrite` 标志为 `true` 且配置已存在，则覆盖现有配置；否则，如果配置已存在且 `overwrite` 为 `false`，则返回错误或忽略操作。
*   **移除**: 当 OSAC 收到 `REMOVE_MCP_SERVER` 消息时，它会从 `config.json` 中删除对应的 MCP 服务器配置。

#### 4.3.2 `opencode` MCP 配置发现与激活

`opencode` 在启动时会加载 `config.json` 中的 MCP 配置。为了实现“热加载”，OSAC 需要确保 `opencode` 能够感知到配置文件的变化。

*   **配置刷新**: 类似于技能，理想情况下 `opencode` 应该提供一个配置刷新机制（例如 `Config.refresh()`）。如果存在，OSAC 在修改 `config.json` 后调用此机制。
*   **进程重启**: 如果没有直接的配置刷新机制，为了使新的 MCP 配置生效，最可靠的方法是重新启动 `opencode` 进程。OSAC 可以通过 `MCP_SERVER_STATUS` 消息通知父智能体，并建议重启 `opencode` 进程。
*   **状态反馈**: OSAC 会通过 `MCP_SERVER_STATUS` 消息向父智能体报告 MCP 服务器添加/移除的结果，包括成功、失败或错误信息。

## 5. 更新与自维护机制

鉴于 OSAC 运行在隔离的 Sandbox 环境中，无法主动连接外部服务器，其更新和自维护机制的设计至关重要。更新过程必须由父智能体发起，并且需要考虑到更新包的传输、安装、验证以及失败回滚等环节。

### 5.1 更新机制

OSAC 的更新机制旨在确保其自身和所管理的 `opencode` CLI 能够及时获取最新版本，修复漏洞，并引入新功能。整个更新流程由父智能体驱动。

#### 5.1.1 更新触发与指令

*   **触发**: 父智能体通过 WebSocket 连接向 OSAC 发送 `INITIATE_UPDATE` 消息，启动更新过程。此消息包含更新类型 (`updateType`)、目标版本 (`version`) 和更新包的下载 URL (`downloadUrl`) 或自定义更新命令 (`updateCommand`)。
*   **更新类型**: 支持更新 OSAC 自身 (`client`)、`opencode` CLI (`opencode`) 或两者同时更新 (`all`)。

#### 5.1.2 更新包获取

*   **下载 URL**: 当 `INITIATE_UPDATE` 消息中包含 `downloadUrl` 时，OSAC 将使用 Sandbox 环境中允许访问的公共网络接口（例如 `curl` 或 `wget`）从该 URL 下载更新包。该 URL 必须是 Sandbox 可达的，例如公共 CDN 链接或预签名的对象存储链接。
*   **自定义命令**: 如果提供了 `updateCommand`，OSAC 将直接执行该命令。这适用于 `opencode` 自身支持通过包管理器（如 `npm`, `bun`, `brew` 等）进行更新的场景，例如 `opencode upgrade`。

#### 5.1.3 更新包验证 (推荐)

为了确保更新的安全性，OSAC 在下载更新包后应进行验证：

*   **完整性校验**: 检查更新包的哈希值（例如 SHA256），并与父智能体提供的预期哈希值进行比对。如果哈希值不匹配，则拒绝安装并报告错误。
*   **真实性验证**: 如果条件允许，更新包应进行数字签名，OSAC 使用预置的公钥验证签名的真实性。这可以防止恶意篡改的更新包被安装。

#### 5.1.4 更新安装

*   **OSAC 自身更新**: 如果是 OSAC 自身的更新，OSAC 需要将下载的新版本可执行文件替换掉当前运行的旧版本。这通常需要一个自更新引导程序 (self-updating bootstrap) 来完成，即由一个小型引导程序下载新版本，替换主程序，然后启动新主程序。
*   **OpenCode CLI 更新**: 如果是 `opencode` CLI 的更新，OSAC 将执行以下操作：
    *   如果 `updateCommand` 存在，则直接执行该命令（例如 `opencode upgrade <version>`）。
    *   如果 `downloadUrl` 存在，OSAC 需要解压更新包，并替换 `opencode` 的安装目录。这可能涉及到停止当前正在运行的 `opencode` 进程，替换文件，然后重新启动。

#### 5.1.5 更新状态报告

在整个更新过程中，OSAC 会通过 `AGENT_UPDATE_STATUS` 消息向父智能体报告详细的状态信息，包括：

*   **`started`**: 更新过程已启动。
*   **`downloading`**: 正在下载更新包，可附带进度百分比。
*   **`verifying`**: 正在验证更新包。
*   **`installing`**: 正在安装更新。
*   **`completed`**: 更新成功完成。
*   **`failed`**: 更新失败，附带错误信息。

#### 5.1.6 失败回滚与恢复

*   **原子性更新**: 尽量采用原子性更新策略，确保更新要么完全成功，要么完全失败并回滚到之前的稳定状态。例如，在替换文件前先备份旧文件，如果新文件安装失败，则恢复备份。
*   **错误报告**: 任何更新失败都应通过 `AGENT_UPDATE_STATUS` 消息详细报告给父智能体，以便父智能体进行干预或重试。

### 5.2 自维护任务

除了更新，OSAC 还应执行一些基本的自维护任务，以确保其长期稳定运行。

*   **日志管理**: 定期清理旧的日志文件，防止日志文件过大占用磁盘空间。可以配置日志保留策略（例如保留最近 7 天的日志）。
*   **临时文件清理**: 清理由 `opencode` 或 OSAC 自身产生的临时文件，保持文件系统的整洁。
*   **健康检查**: OSAC 内部应包含周期性的健康检查机制，例如检查 `opencode` 进程是否正常运行，磁盘空间是否充足，网络连接是否正常等。异常情况应通过 `HEARTBEAT` 消息或独立的 `HEALTH_STATUS` 消息报告给父智能体。
*   **资源监控**: 监控 CPU、内存使用情况，防止资源耗尽导致服务不稳定。当资源使用率超过阈值时，可以向父智能体发出警告。

## 6. 总结

OpenCode Sandbox Agent Client (OSAC) 的设计旨在为父智能体提供一个强大、灵活且安全的沙盒代理。通过 WebSocket 通信协议和结构化的 API 接口，父智能体可以远程调度 OpenCode CLI 执行任务，利用会话机制实现任务的连续性，并通过热加载机制动态配置技能和 MCP 服务器。同时，完善的更新与自维护机制确保了 OSAC 自身的稳定运行和及时更新。这一设计将使 OpenCode 能够作为父智能体生态系统中的一个重要组成部分，高效地完成各种开发任务。
