# OSAC 侧 Altus 模式 MCP 开发任务文档 [20260330-1027已采用]

更新时间：2026-03-30

## 1. 目标

本文件只描述 `OSAC` 侧开发任务。

目标：

1. 把 OSAC 升级成 Altus mode 的 MCP Runtime Host
2. 支持 provider lifecycle，而不是只支持“写 MCP server 配置”
3. 支持本地 stdio MCP 和远端 SSE MCP
4. 支持按 `taskSessionId` 动态挂载 tools

## 2. 本期需要新增的 OSAC 模块

1. `mcp_control_server`
2. `mcp_provider_registry`
3. `mcp_process_supervisor`
4. `mcp_remote_client_manager`
5. `mcp_session_tool_bridge`
6. `mcp_event_bus`

## 3. 协议支持

OSAC 必须实现：

1. `REGISTER_MCP_PROVIDER`
2. `UPDATE_MCP_PROVIDER_ENV`
3. `ATTACH_MCP_PROVIDER_TO_SESSION`
4. `DETACH_MCP_PROVIDER_FROM_SESSION`
5. `REMOVE_MCP_PROVIDER`
6. `LIST_SESSION_MCP_TOOLS`

并回传：

1. `MCP_PROVIDER_STATUS`
2. `MCP_PROVIDER_EVENT`
3. `SESSION_MCP_TOOLS_RESPONSE`

## 4. provider registry

职责：

1. 保存 provider 基础信息
2. 保存 env version
3. 保存 attached tools
4. 保存 `providerId -> taskSessionId` 绑定关系

必须支持：

1. provider 覆盖注册
2. provider 状态查询
3. provider 删除

## 5. local stdio provider

这是第一阶段必须先完成的能力。

要求：

1. 支持 spawn MCP 子进程
2. 支持 stdio 协议握手
3. 支持 tools schema 拉取
4. 支持 provider 崩溃检测

错误处理：

1. 启动失败回 `provider_start_failed`
2. tools schema 读取失败回 `tool_schema_load_failed`

## 6. remote SSE provider

这是第二阶段能力。

要求：

1. OSAC 作为 client 建立远端 SSE/stream 连接
2. 持续维护连接状态
3. 支持 header/token 更新
4. 支持断线重连

## 7. session tool bridge

职责：

1. 把 provider tools attach 到某个 `taskSessionId`
2. detach 时移除
3. 提供 `LIST_SESSION_MCP_TOOLS`
4. 提供 tool invoke bridge

这里是 Altus mode 真正消费 tools 的入口。

要求：

1. 同一 session 可以挂多个 provider
2. 同一 provider 可以挂多个 tool
3. tool name 冲突要有稳定命名规则

## 8. env update 规则

必须严格按下面逻辑实现：

1. 更新 provider 内存态 env/header
2. 标记 `env_dirty`
3. 如果 transport 支持热更新，则直接切 client 配置
4. 如果 transport 依赖启动期 env，则下一次调用前 restart provider

禁止错误实现：

1. 假设改进程环境后旧进程自动生效

## 9. 事件流

OSAC 必须通过 event bus 上报：

1. `provider_started`
2. `provider_ready`
3. `provider_failed`
4. `provider_restarting`
5. `provider_reconnected`
6. `provider_stopped`
7. `tool_attached`
8. `tool_detached`

## 10. 开发顺序

### 阶段 1

1. provider registry
2. local stdio provider
3. session tool bridge
4. `LIST_SESSION_MCP_TOOLS`

### 阶段 2

1. env update
2. restart / reconnect
3. provider event bus

### 阶段 3

1. remote SSE provider
2. tool invoke bridge 稳定化
3. 恢复/重放机制

## 11. OSAC 侧验收

1. `REGISTER_MCP_PROVIDER` 能启动本地 provider
2. `ATTACH_MCP_PROVIDER_TO_SESSION` 后能查询到真实 tools
3. provider 崩溃后能自动恢复
4. env 更新后下一次调用前能生效
5. `LIST_SESSION_MCP_TOOLS` 返回的是 session 实际可调用工具，不是静态配置
