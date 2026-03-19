# Codex 纯 App Server 模式实现设计

日期：2026-03-18  
状态：开发中

## 1. 背景

当前 oneceo 的 Codex 直通模式已经具备：

1. E2B sandbox 内运行 Codex
2. 通过 OSAC 驱动 Codex 执行
3. 支持基础多轮续聊
4. 支持平台侧 recent/history 缓冲
5. 支持 Codex session 级归档恢复

但当前链路仍以：

- `CLI / SDK 事件`
- `command_execution`
- `file_change`

为主，展示层虽然已经能做“文件修改 / 文件查看 / 搜索 / 目录检查”等卡片，但在用户核心诉求上仍有明显缺口：

1. 缺少稳定的原生 `diff` 语义
2. 文件修改更多表现为 shell heredoc 或命令级事件，而不是变更级事件
3. 当前 richer item surface 不完整，前端只能对命令做语义推断

结合 Codex 官方资料可确认：

1. Codex harness 的完整 item 语义包括：
   - `user message`
   - `agent message`
   - `tool execution`
   - `approval request`
   - `diff`
2. App Server 是 Codex 对外暴露 richer session semantics 的主要协议面
3. 当前 CLI/SDK 链路更适合“执行器控制”和“轻量事件消费”，不适合承载完整 UI 语义

因此，本设计明确将 Codex 后续演进方向调整为：

**从当前 CLI/SDK 驱动链路，迁移到“纯 App Server 模式”。**

## 2. 目标

本次目标不是“再补一点 Codex 兼容逻辑”，而是：

1. 为 oneceo 规划一套纯 App Server 的 Codex 直通架构
2. 明确当前所有功能在 App Server 模式下如何实现
3. 重点解决：
   - 文件显示
   - 原生变更 diff
   - 会话恢复
   - 历史回放
   - 前端过程流展示
4. 为后续代码迁移提供明确的功能拆分与替换顺序

## 3. 非目标

本轮文档不做：

1. 直接修改现有生产链路
2. 同时保留“SDK 主链路 + App Server 补充 diff”的长期混合模式
3. 修改 OpenCode 已验证可用的任何流程
4. 扩展到 `claudecode` 或其他 executor

## 4. 总体结论

### 4.1 为什么选择纯 App Server

对 oneceo 来说，如果目标是：

1. 正确展示文件变化
2. 获取原生 diff
3. 保持会话级上下文
4. 统一前端过程消息语义

那么更合理的方向是：

**完全使用 App Server 作为 Codex 的唯一协议面。**

原因：

1. App Server 暴露 richer item semantics，原生支持 `diff`
2. 事件流更适合 UI 直接消费
3. 不需要继续从 `command_execution(write)` 反推“这是不是文件修改”
4. 后续 `approval`、`diff`、`tool execution`、`agent message` 可以统一走 typed item 映射

### 4.2 为什么不采用“SDK + App Server 混合”

混合模式短期看似稳，长期会形成两套事实来源：

1. 控制面来自 SDK / CLI
2. richer UI 事件来自 App Server
3. session 恢复可能走 SDK
4. diff 又走 App Server

这样会导致：

1. session 身份与 item 来源分裂
2. 历史回放逻辑复杂化
3. oneceo 需要做双协议兼容
4. 后续维护成本显著升高

结论：

- 混合模式只适合实验
- 不适合作为正式产品架构

## 5. 架构方案

## 5.1 总体架构

纯 App Server 模式下，链路调整为：

```text
oneceo web
  -> oneceo api
    -> OSAC
      -> sandbox 内 codex app-server
        -> Codex harness
```

关键变化：

1. sandbox 内不再以 CLI/SDK 作为主事件源
2. sandbox 内启动 `codex app-server`
3. OSAC 不再只转发 `EXECUTOR_* + CLI JSON 事件`
4. OSAC 改为消费 App Server 的 websocket/stdio 协议
5. oneceo api 基于 App Server item 流做统一持久化与 websocket 推送

## 5.2 角色分工

### E2B

继续负责：

1. sandbox 创建与销毁
2. 模板选择
3. workspace/state 目录准备
4. 端口映射
5. `.codex` 状态目录归档恢复

### OSAC

继续负责：

1. 与 sandbox 内服务建立控制链路
2. 连接 codex app-server
3. 统一转发请求与事件
4. session 恢复时负责把原 `executorSessionId` 发给 app-server

但不再负责：

1. 直接拼装 `codex exec`
2. 直接消费 CLI stdout JSON 事件作为主链路

### oneceo API

负责：

1. session 与 runtime 状态维护
2. App Server item -> oneceo timeline message 映射
3. 持久化到 `conversation_messages`
4. recent cache 更新
5. 对前端 websocket/SSE 推送

### 前端

负责：

1. 按原生 item 类型渲染
2. `diff` 进入变更预览
3. `file_change` 进入文件变更卡片
4. `command_execution` 作为命令动作卡片，而不是 diff 代用品

## 6. 功能规划

下面按“当前所有关键功能”逐项说明 App Server 模式的实现方式。

## 6.1 设置切换

### 目标

在 `设置 -> 模型设置 -> Codex` 中，真正切到 App Server 模式。

### 实现方式

1. 设置层仍保留 `executor=codex`
2. 增加 Codex 内部 runtime mode：
   - `codexRuntimeMode = app_server`
3. `driver=codex` 时：
   - sandbox provision 只启动 `codex app-server`
   - 不再启动 CLI JSON bridge 作为主链路

### 验收标准

1. 新会话 `driver=codex`
2. 新 runtime metadata 中明确标记：
   - `executor=codex`
   - `codexTransport=app_server`

## 6.2 建会话

### 目标

建立 Codex 会话时，直接创建 App Server session。

### 实现方式

1. 前端发送首条消息
2. API 先确保 sandbox/runtime ready
3. OSAC 请求 sandbox 内 codex app-server：
   - create session / start thread
4. 返回：
   - `executorSessionId`
   - 初始 session metadata
5. API 写回：
   - `runtime.executorSessionId`
   - `runtime.orchestratorSessionId`
   - `runtime.transport=app_server`

### 验收标准

1. 首轮消息只创建一个 session
2. `executorSessionId` 来自 app-server，不再来自 CLI resume 侧逻辑

## 6.3 多轮对话

### 目标

同一会话多轮对话保持同一 App Server session。

### 实现方式

1. 后续每轮消息带原 `executorSessionId`
2. OSAC 将输入发给同一 app-server session
3. app-server 连续返回 item 流

### 验收标准

1. 第二轮不会新建 session
2. 上下文连续
3. 历史不会重复拼接旧轮次内容

## 6.4 消息流

### 目标

将 App Server 的 typed item 作为平台主事实来源。

### 实现方式

oneceo 统一消费这些 item：

1. `user_message`
2. `agent_message`
3. `reasoning`
4. `tool_execution`
5. `command_execution`
6. `file_change`
7. `diff`
8. `approval_request`
9. `turn.started`
10. `turn.completed`
11. `turn.failed`

API 层统一做：

1. 标准化 message key
2. 标准化 timeline cursor
3. 写入 `conversation_messages`
4. 更新 `task_session_recent_messages`
5. websocket 实时推送

### 验收标准

1. recent/history 不依赖回源 Codex 才能显示完整对话
2. 刷新页面后消息完整恢复
3. 同一 messageKey 不重复

## 6.5 文件显示

### 目标

让“文件相关动作”不再靠命令推断。

### 实现方式

1. `file_change` item 作为主文件动作来源
2. 前端直接显示：
   - `新建文件`
   - `更新文件`
   - `删除文件`
3. 点击后联动内容预览面板

### 验收标准

1. 不再依赖 `cat <<EOF > file` 去判断是文件修改
2. 文件卡片直接绑定原生 `path + kind`

## 6.6 变更 diff

### 目标

使用 Codex 原生 diff，而不是平台派生 diff。

### 实现方式

1. App Server item 流中优先接 `diff` item
2. `diff` item 进入 oneceo 统一 timeline
3. 前端将 `diff` item 渲染为：
   - diff 胶囊
   - 变更面板
   - 内容预览页中的 diff 视图

### 关键规则

1. 有 `diff` item 时，前端直接以 diff 语义展示
2. `command_execution(write)` 不再伪装成 diff
3. `file_change` 只表示文件动作，不表示 patch 正文

### 验收标准

1. 文件修改场景里，前端能看到真正 diff
2. 不再把 heredoc / shell 命令误当成 diff 内容

## 6.7 工具卡片

### 目标

保留过程感，但不让命令淹没对话。

### 实现方式

1. `command_execution`
   - 显示为轻量命令卡片
2. `tool_execution`
   - 显示为工具卡片
3. hover 只显示摘要
4. 点开详情看完整信息

### 验收标准

1. 命令卡片与 diff 卡片明确区分
2. 工具卡片不承担 diff 展示职责

## 6.8 审批/授权

### 目标

让 Codex 的 `approval_request` 进入 oneceo 统一确认流。

### 实现方式

1. app-server 返回 `approval_request`
2. API 持久化为专门消息类型
3. 前端显示待确认卡片
4. 用户确认后经 API -> OSAC -> app-server 回传结果

### 验收标准

1. 待授权步骤可见
2. 授权后同一会话继续推进

## 6.9 recent/history 缓冲

### 目标

保持 oneceo 平台层消息缓冲，不让页面刷新依赖“重新从 Codex 拉完整历史”。

### 实现方式

继续保留：

1. `conversation_messages`
2. `task_session_recent_messages`
3. 前端本地 history cache

但消息源改为：

1. App Server typed item

### 验收标准

1. 用户刷新页面仍能直接看到 recent messages
2. App Server 暂时不可达时，已落盘历史仍可读

## 6.10 session 级恢复

### 目标

保持现有 Codex session 恢复目标不变，但底层恢复对象改为 App Server session。

### 实现方式

1. 继续保留：
   - `/home/user/.codex` 映射与归档恢复
2. sandbox 恢复后：
   - 启动 `codex app-server`
   - 用旧 `executorSessionId` 执行 session resume
3. 成功后写回：
   - `codexRestoreStatus=session_restored`

### 验收标准

1. 原 `executorSessionId` 恢复成功
2. 下一轮继续保留原上下文
3. 恢复失败时显式失败，不允许静默新建新 session 冒充成功

## 6.11 标题/侧边栏/收藏等平台功能

### 目标

保持这些平台功能与 Codex transport 解耦。

### 实现方式

以下功能继续由 oneceo 平台层维护，不依赖 App Server：

1. 首次明确消息锁定标题
2. 侧边栏收藏
3. 侧边栏删除
4. 右键菜单
5. 本地 session summary

### 验收标准

1. transport 从 CLI 切到 App Server 后，这些平台功能行为不变

## 7. 需要替换的模块

## 7.1 API 层

需要新增或重构：

1. `codex-app-server-service.ts`
   - 专门负责与 app-server 协议交互
2. `codex-remote-service.ts`
   - 从 CLI/SDK 事件消费，迁移成 app-server item 消费
3. `sandbox-executor-registry.ts`
   - `codex` 分支切到 `app_server`

## 7.2 OSAC 层

需要新增：

1. app-server transport manager
2. session create / send / resume / interrupt
3. app-server item event 转发

需要废弃：

1. 以 `codex exec --json` 为主链路的 manager

## 7.3 sandbox provision

需要新增：

1. `ensureCodexAppServer()`
2. app-server 监听地址
3. OSAC 到 app-server 的连接准备

继续保留：

1. `.codex` 映射
2. workspace/state 恢复

## 7.4 前端

需要调整：

1. `Home.tsx`
   - 原生 `diff` item 渲染
   - `file_change` 与 `command_execution` 彻底分层
2. `opencode-preview.ts`
   - 增加 Codex 原生 diff item 支持
3. `useTaskCreationAgent.ts`
   - history/reconcile 继续基于 messageKey，但要兼容 app-server item 类型

## 8. 推荐实施顺序

建议按四阶段推进：

### 阶段 1：协议验证

1. 在测试分支启动 `codex app-server`
2. 抓真实 websocket/stdio item 流
3. 确认是否稳定包含：
   - `diff`
   - `file_change`
   - `approval_request`

### 阶段 2：OSAC 接入

1. OSAC 接 app-server
2. 打通 create/send/resume/interrupt
3. 保证 session 级恢复仍然成立

### 阶段 3：API 持久化接线

1. App Server item -> `conversation_messages`
2. recent cache 重建
3. websocket 推送

### 阶段 4：前端展示

1. `diff` 视图
2. `file_change` 卡片
3. `command_execution` 轻量卡片
4. `approval_request` 卡片

## 9. 风险

## 9.1 App Server 实验性

风险：

1. 当前 CLI 标记为 experimental
2. 事件协议可能变化

对策：

1. OSAC 内增加协议适配层
2. oneceo API 只面向内部标准 envelope，不把 app-server 原始对象直接暴露给前端

## 9.2 迁移成本

风险：

1. 当前已有 CLI/SDK 直通链路
2. 切换 transport 影响范围较大

对策：

1. 在测试分支先验证
2. 稳定后再切主链路

## 9.3 diff 事件现实差异

风险：

1. 官方语义存在 `diff`
2. 但实际不同模型版本/运行形态返回频率可能不一致

对策：

1. 先做真实验证再决定最终切换
2. 若部分任务无 `diff`，前端仍保留 `file_change + command_execution` 作为降级显示
3. 但不采用平台派生 diff

## 10. 最终建议

我的建议是：

1. 正式方向采用 **纯 App Server 模式**
2. 不长期保留 `SDK + App Server` 混合主链路
3. 先在测试分支完成 app-server 实测
4. 验证拿到原生 `diff` 后，再开始真正迁移实现

原因很明确：

1. 你的核心诉求是“文件显示 + 原生变更 diff”
2. 这更符合 App Server 的能力边界
3. 继续沿当前 CLI/SDK 主链路打补丁，只会越来越偏

## 11. 2026-03-18 本地实现进展

### 11.1 已完成

1. 新增本地启动层：
   - [codex-app-server-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/codex-app-server-service.ts)
2. 新增协议归一化层：
   - [codex-app-server-protocol.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/codex-app-server-protocol.ts)
3. 新增临时探针脚本：
   - [\_tmp_codex_app_server_probe.ts](/Users/watson/codingProj/oneceo/apps/api/scripts/_tmp/_tmp_codex_app_server_probe.ts)
4. 新增单轮执行服务：
   - [codex-app-server-turn-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/codex-app-server-turn-service.ts)
5. 新增本机续聊探针：
   - [\_tmp_local_codex_app_server_resume_probe.mjs](/Users/watson/codingProj/oneceo/apps/api/scripts/_tmp/_tmp_local_codex_app_server_resume_probe.mjs)

### 11.2 当前实测结论

1. sandbox 内 `codex app-server --listen ws://0.0.0.0:4321` 可以正常启动并监听
2. 当前通过 E2B 公网 host 直连 websocket 会收到 `502`
3. 当前在 sandbox 内使用常规 websocket client 连接 `ws://127.0.0.1:4321` 时，也没有完成标准 HTTP upgrade 握手
4. 本机 `stdio` 探针已确认真实协议面存在：
   - `fileChange.changes[].diff`
   - `turn/diff/updated`
   - `thread/read -> turn.items`
5. 本机 `thread/resume` 跨 App Server 进程恢复已验证成功：
   - 第二轮使用同一 `threadId`
   - `thread/read.turns.length` 从 `1` 变为 `2`
   - 第二轮能回答第一轮上下文中的 token `ABC123`
6. 当前 E2B sandbox 中的 App Server 结果与本机 stdio 不一致：
   - 可正常建 `threadId/turnId`
   - 但返回的 `latestTurn.items` 只有 `userMessage`
   - notification 主要是 `codex/event/*` 与 `error`
   - 暂未稳定拿到 `fileChange/diff`
   - stderr 可见：`state db missing rollout path for thread ...`

因此当前阶段更稳妥的实现判断是：

1. oneceo 平台侧仍然采用 **App Server 协议**
2. 但 sandbox 内推荐优先走 **stdio 托管模式**
3. 不依赖 E2B 公网 websocket 暴露作为主链路

### 11.3 代码实施含义

后续本地实现将按这个收口：

1. `codex app-server` 作为唯一协议面
2. 传输优先级：
   - `stdio` 主链路
   - `ws` 仅保留实验/诊断
3. `diff/fileChange/approval/tool execution` 全部从 App Server item 流获取
4. 不再从 CLI `command_execution` 推导 diff
5. session 级恢复在协议层优先采用：
   - `threadId == executorSessionId`
   - 恢复使用 `thread/resume`
6. 现阶段代码接线保持：
   - App Server 适配层已存在
   - 默认 transport 仍为现有 OSAC 直通
   - 仅在 `CODEX_TRANSPORT_MODE=app_server` 时启用 App Server 实验链路
## 12. 评审问题

请你确认以下三点：

1. Codex 正式方向是否确定切到纯 App Server 模式
2. 当前 CLI/SDK 直通链路后续是否只保留为实验兜底，而不再作为主实现方向
3. 前端 `diff` 是否要求“只有原生 diff 才展示 diff 面板”，没有 diff 时只显示 `file_change + command_execution`
# 最新验证结论（2026-03-19）

- 当前 E2B sandbox 中，`codex app-server` 要稳定返回 `reasoning / fileChange / turn/diff/updated / agentMessage`，不能只依赖临时进程环境变量透传。
- 已验证可用的方式是：在 sandbox 内预先写入 `~/.codex/config.toml` 和 `~/.codex/auth.json`，然后再启动 `codex app-server`。
- 其中：
  - `config.toml` 需要放在 `~/.codex/` 根目录
  - `auth.json` 需要提供 `OPENAI_API_KEY`
  - `base_url` 需要使用 provider 根地址，例如 `https://ai.hvmz.cn`，而不是 `https://ai.hvmz.cn/v1`
- 如果继续保留 `OPENAI_BASE_URL` / `OPENAI_API_BASE` / `CODEX_BASE_URL` 给 App Server 子进程，会触发旧配置路径并出现不稳定行为；当前实现已经在子进程启动前移除了这组 deprecated env。

## 已验证通过的最小 App Server 配置

```toml
model_provider = "OpenAI"
model = "gpt-5.2"
review_model = "gpt-5.2"
model_reasoning_effort = "high"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://ai.hvmz.cn"
wire_api = "responses"
supports_websockets = true
requires_openai_auth = true

[features]
responses_websockets_v2 = true
```

```json
{
  "OPENAI_API_KEY": "***"
}
```

## 最新实测结果

- sandbox：`iyg2r9150vczz3kxvpfog`
- codex binary：`/home/user/.altus/codex-runtime/npm-global/bin/codex`
- codex version：`0.115.0-alpha.27`
- 成功拿到的 App Server 原生事件：
  - `item/reasoning/summaryTextDelta`
  - `item/completed(type=reasoning)`
  - `item/started(type=fileChange)`
  - `item/fileChange/outputDelta`
  - `item/completed(type=fileChange)`
  - `turn/diff/updated`
  - `item/agentMessage/delta`
  - `item/completed(type=agentMessage)`
- 最新验证样本中，`latestTurn.items` 已包含：
  - `userMessage`
  - `reasoning`
  - `fileChange`
  - `agentMessage`
- `fileChange.changes[].diff` 与 `turn/diff/updated.diff` 已可直接用于前端文件变更和 diff 展示，不需要平台派生 diff。
