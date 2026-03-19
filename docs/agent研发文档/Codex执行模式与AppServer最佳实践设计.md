# Codex 执行模式与 AppServer 最佳实践设计

日期：2026-03-19  
状态：开发中

## 1. 背景

当前 oneceo 已经支持：

1. `executor = codex`
2. 旧链路下通过现有 Codex 直通模式执行任务
3. 基础多轮续聊
4. 平台 recent/history 缓冲
5. Codex session 级归档恢复

但在你当前的目标里，`codex` 已经不只是一个单一执行器，而是需要拆成两种运行模式：

1. `sdk模式`
   - 保持现有可用链路
   - 继续作为稳定默认方案
2. `ws模式`
   - 实际上是纯 `Codex App Server` 模式
   - 用于承载 richer item surface
   - 重点解决：
     - `fileChange`
     - `turn/diff/updated`
     - 原生文件显示
     - 原生 diff 展示

本设计的目标是：

1. 总结当前已验证通过的 App Server 最佳实践
2. 把它转成 oneceo 内部可实现的正式产品方案
3. 在设置中为 `codex` 增加 `sdk模式 / ws模式`
4. 明确每一个功能在两种模式下的实现边界

## 2. 设计原则

### 2.1 不修改 OpenCode 既有链路

本方案只影响 `executor = codex`。

不允许：

1. 修改 OpenCode 已验证可用的恢复逻辑
2. 修改 OpenCode 现有消息链路
3. 把 Codex 的 transport 特判扩散到其他 executor

### 2.2 `sdk模式` 保持旧链路

`sdk模式` 的意义不是重做，而是：

1. 复用当前已有 Codex 直通实现
2. 保持现有用户可用性
3. 作为 `ws模式` 未准备好时的稳定兜底

### 2.3 `ws模式` 专指纯 App Server 模式

这里的 `ws模式` 是产品命名。

其技术实质为：

1. Codex 以 `app-server` 作为唯一 richer item 协议面
2. oneceo 消费原生 typed item
3. 原生获取 `fileChange` 和 `turn/diff/updated`

注意：

1. 当前 sandbox 内实测最稳定的 transport 是 `stdio`
2. 之所以在设置中命名为 `ws模式`，是因为其对外语义是 “App Server / richer stream 模式”
3. 如果后续真正稳定切到 websocket transport，设置层命名无需再变

因此，设置文案里的 `ws模式` 应理解为：

**Codex App Server 模式**

而不是字面上强绑定 `sandbox 内一定走 websocket`。

### 2.4 不采用派生 diff

`ws模式` 的核心收益是原生 diff。

明确禁止：

1. 从 `command_execution` 派生 diff
2. 用“命令摘要 + 文件路径”伪装成真正 diff

规则：

1. 有原生 `turn/diff/updated` 时，展示 diff
2. 有原生 `fileChange` 时，展示文件变更
3. 没有原生 diff 时，只能降级成文件变更/命令卡片，不能冒充 diff

## 3. 已验证通过的最佳实践

这是当前在 E2B non-prod sandbox 里已经实测通过的配置。

### 3.1 结论

纯 App Server 模式要在 sandbox 内稳定返回：

1. `reasoning`
2. `fileChange`
3. `turn/diff/updated`
4. `agentMessage`

必须满足以下条件：

1. sandbox 内 Codex CLI 升级到 `0.115.0-alpha.27`
2. 启动前写入 `~/.codex/config.toml`
3. 启动前写入 `~/.codex/auth.json`
4. `base_url` 使用 provider 根地址，如 `https://ai.hvmz.cn`
5. 不再依赖 `OPENAI_BASE_URL` 这类 deprecated env 作为 App Server 主配置来源

### 3.2 推荐配置

`~/.codex/config.toml`

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

`~/.codex/auth.json`

```json
{
  "OPENAI_API_KEY": "***"
}
```

### 3.3 当前已验证结果

在 sandbox `iyg2r9150vczz3kxvpfog` 上已验证：

1. `thread/started`
2. `turn/started`
3. `item/reasoning/*`
4. `item/started(type=fileChange)`
5. `item/fileChange/outputDelta`
6. `item/completed(type=fileChange)`
7. `turn/diff/updated`
8. `item/agentMessage/delta`
9. `turn/completed(status=completed)`

说明：

1. `ws模式` 的关键能力已被实机验证
2. 当前剩余工作不是“证明它能不能行”，而是接入 oneceo 主链路

## 4. 设置改造方案

## 4.1 页面目标

在：

`设置 -> 模型设置 -> 执行器选择 = codex`

时，新增一层 Codex 执行模式选择。

### 4.2 新交互结构

保留现有：

1. `执行器选择`
   - `opencode`
   - `claudecode`
   - `codex`

新增：

2. `Codex 模式`
   - `sdk模式`
   - `ws模式`

仅当 `executor = codex` 时显示。

### 4.3 模式说明文案

建议文案：

1. `sdk模式`
   - 使用当前稳定 Codex 链路
   - 优先保证兼容性和恢复能力
2. `ws模式`
   - 使用 Codex App Server 链路
   - 支持原生文件变更与 diff 展示

### 4.4 默认值

建议默认：

1. 新用户默认 `sdk模式`
2. `ws模式` 先作为显式切换功能

原因：

1. `sdk模式` 已经在现有产品里具备稳定性
2. `ws模式` 虽已实测通过，但接入面更大
3. 先做显式切换更安全

## 5. 数据结构调整

## 5.1 用户偏好

新增 Codex 专属偏好：

```ts
type CodexExecutionMode = 'sdk' | 'ws';
```

建议保存：

1. localStorage
2. 后端用户设置

字段建议：

```ts
type TaskCreationUserSettings = {
  executor: 'opencode' | 'claudecode' | 'codex';
  altusMode: 'sandbox' | 'managed';
  codexExecutionMode?: 'sdk' | 'ws';
};
```

## 5.2 session 级标识

session 除了已有：

1. `driver`
2. `executor`

还需要新增：

```ts
type CodexTransportMode = 'sdk' | 'app_server';
```

写入规则：

1. `executor=codex + sdk模式`
   - `runtime.transport = sdk`

## 11. 当前实现进度

### 11.1 第一阶段已完成

已落地：

1. 设置中 `executor=codex` 时显示 `Codex 模式`
2. 支持 `sdk模式 / ws模式`
3. 新会话保存 `codexExecutionMode`
4. session/runtime 固定保存 `transport=sdk|app_server`
5. `codex-remote-service` 已按 transport 分发旧链路与 App Server 链路

### 11.2 第二阶段已完成

已落地：

1. `ws模式` 的 App Server 原生消息已接入前端消息流
2. 已补齐 camelCase item 类型兼容：
   - `commandExecution`
   - `fileChange`
   - `approvalRequest`
   - `agentMessage`
3. `turn/diff/updated` 已进入平台预览链路
4. `fileChange.changes[].diff` 已进入平台预览链路
5. 前端点击 `文件变更 / 变更 Diff` 卡片时，可联动到右侧 diff 预览，而不是继续停留在命令级降级展示

### 11.3 当前边界

当前仍保持：

1. `sdk模式` 继续走原链路，不受 `ws模式` 改动影响
2. `ws模式` 使用原生 diff，不采用平台派生 diff
3. 当前阶段以消息流和预览链路接通为主，后续仍需补一轮完整页面级回归

### 11.4 本轮修正

已确认并修正：

1. `ws模式` 同一会话续聊失败的直接根因不是 `thread/resume` 失效
2. 实际根因是当前 App Server 主链路采用“单轮阻塞等待完成”，长任务超过原先 `60s` 等待窗口后被误判为失败
3. 当前已把 `ws模式` 默认等待窗口提升到 `10 分钟`
4. 同时过滤了 `account/rateLimits/updated`、`thread/tokenUsage/updated`、`item/reasoning/*`、`codex/event/*` 等内部 transport 噪音
2. `executor=codex + ws模式`
   - `runtime.transport = app_server`

注意：

1. 设置只影响新会话默认值
2. 历史 session 必须继续使用创建时的 transport
3. 不允许运行中的 session 静默热切换 transport

## 6. 功能规划

## 6.1 建会话

### `sdk模式`

沿用现有链路：

1. 继续通过当前 Codex 直通 service 建 session
2. `executorSessionId` 沿用旧逻辑

### `ws模式`

改为：

1. provision sandbox
2. 准备 `~/.codex/config.toml + auth.json`
3. 启动 App Server
4. 创建 App Server thread
5. 将 `threadId` 写入 `runtime.executorSessionId`

## 6.2 多轮对话

### `sdk模式`

继续沿用现有 resume 逻辑。

### `ws模式`

基于 App Server：

1. 后续消息继续发给同一 `threadId`
2. `threadId` 视为 `executorSessionId`
3. 保持上下文连续

## 6.3 消息展示

### `sdk模式`

继续使用当前已有的：

1. `command_execution`
2. `file_change`
3. `reasoning`
4. `agent_message`

### `ws模式`

主事实来源调整为：

1. `reasoning`
2. `fileChange`
3. `turn/diff/updated`
4. `agentMessage`
5. 其他 typed item

## 6.4 文件显示

### `sdk模式`

仍以：

1. `file_change`
2. `command_execution(write)`

做降级展示。

### `ws模式`

原生使用：

1. `fileChange.changes[]`
2. `item/fileChange/outputDelta`

展示：

1. 新建文件
2. 更新文件
3. 删除文件

## 6.5 diff 展示

### `sdk模式`

不提供原生 diff。

### `ws模式`

直接使用：

1. `turn/diff/updated.diff`

用于：

1. 主对话区的变更摘要
2. 右侧预览面板 diff 视图
3. 文件变更卡片点击后的详细 diff

## 6.6 recent/history 平台缓冲

两种模式都必须保留平台缓冲层，不允许页面刷新后完全依赖回源。

统一要求：

1. 事件先落平台持久化
2. 再 websocket 推送
3. recent cache 继续保留

区别：

1. `sdk模式` 缓冲原有 executor_event
2. `ws模式` 缓冲 App Server typed item 映射后的平台消息

## 6.7 session 恢复

### `sdk模式`

保持现有恢复方案。

### `ws模式`

恢复策略：

1. 继续复用 Codex 专属 `~/.codex` 归档恢复链路
2. 恢复 `workspace + ~/.codex`
3. 使用原 `threadId/executorSessionId` 恢复会话

成功标准：

1. 恢复同一 `threadId`
2. 下一轮输入保持上下文连续

## 6.8 设置切换规则

硬规则：

1. 全局设置只影响新会话
2. 历史 session 保留原 transport
3. `sdk -> ws` 或 `ws -> sdk` 不允许静默覆盖运行中会话
4. 若当前 session 与全局默认不一致，只提示“仅新会话生效”

## 7. 模块改造规划

## 7.1 前端

涉及：

1. [SettingsDialog.tsx](/Users/watson/codingProj/oneceo/apps/web/client/src/components/SettingsDialog.tsx)
2. [zh.json](/Users/watson/codingProj/oneceo/apps/web/client/src/locales/zh.json)
3. `useTaskCreationAgent`
4. `Home.tsx`

新增能力：

1. Codex 模式选择 UI
2. session transport 展示与恢复
3. `ws模式` 下的原生 diff 渲染

## 7.2 API

涉及：

1. `codex-remote-service.ts`
2. `codex-app-server-turn-service.ts`
3. `task-creation-routes.ts`
4. `file-memory-store.ts`

新增能力：

1. `sdk/app_server` 分发
2. `threadId` 作为 `executorSessionId`
3. App Server item 持久化与 recent 缓冲

## 7.3 Sandbox provision

涉及：

1. `sandbox-agent-provision-service.ts`

新增能力：

1. Codex App Server 前置配置写入
2. `~/.codex/config.toml`
3. `~/.codex/auth.json`
4. `codexBinaryPath` 注入

## 8. 实施顺序

建议按以下顺序推进：

1. 设置层增加 `sdk模式 / ws模式`
2. session/runtime 增加 `transport` 标识
3. API 按 mode 分发：
   - `sdk -> 旧链路`
   - `ws -> App Server`
4. `ws模式` 接入原生 `fileChange + turn/diff/updated`
5. 前端 diff 视图接线
6. 再做 session 级恢复回归

## 8.1 `ws模式` 实时回传重构

### 背景

当前 `ws模式` 虽然已经接入了 App Server 原生：

1. `fileChange`
2. `turn/diff/updated`
3. `agentMessage`
4. `reasoning`

但主链路实现仍然是：

1. `sendUserInput()`
2. 启动一次 App Server turn
3. 阻塞等待 `turn/completed`
4. 再一次性把本轮 notifications 回写到平台

这会带来两个直接问题：

1. 用户发送第二条消息后，即使已经落到同一个 `taskSessionId / threadId`，前端也长时间看不到中间进度
2. 长任务期间，平台无法持续展示 `reasoning / fileChange / diff / agentMessage`

因此，`ws模式` 的正式实现不能继续采用“阻塞式单轮回写”。

### 目标

`ws模式` 必须改为：

1. 后台执行
2. 增量事件回传
3. 最终完成收口

也就是：

1. 用户发消息后，平台立即返回 accepted
2. App Server turn 在后台继续跑
3. 平台持续消费 notification 并推送到前端
4. turn 完成后再做最终状态写回和归档

### 设计要求

#### 1. 同一会话继续沿用同一个 thread

每轮 `ws模式` 发送都必须：

1. 继续使用当前 `runtime.executorSessionId`
2. 通过 `thread/resume`
3. 不允许静默新建 thread 冒充“续聊成功”

#### 2. 用户消息必须先落平台

在后台 turn 启动之前，平台必须先完成：

1. `codex_user_input` 持久化
2. `Codex 已接收输入，正在执行...` 状态消息写入
3. session 状态切为 `in_progress/executing`

#### 3. 中间事件必须增量入库

后台执行期间，平台必须持续接收并持久化：

1. `item/reasoning/*`
2. `item/agentMessage/delta`
3. `item/completed(type=fileChange)`
4. `turn/diff/updated`
5. `turn/completed`

这里的关键不是“最后能补齐”，而是：

1. 页面打开时一直有消息
2. 长任务期间能看到持续进度

#### 4. 最终态统一收口

后台执行完成后：

1. `turn/completed -> session.completed`
2. `error/超时 -> session.failed`
3. 归档仍然只在最终完成态触发

### 推荐实现

#### 后台任务模型

在平台侧为每个 `taskSessionId + threadId + turnId` 建立一个后台 turn job：

1. `sendUserInput()` 只负责创建 job 和立即返回
2. 后台 job 负责执行 App Server turn
3. job 负责轮询/消费 notifications 并增量落库

#### 传输方式

当前不改 E2B template，不改外部环境。

因此实现约束是：

1. 继续使用本地代码
2. 继续通过 `e2bConnector.runCommand()`
3. 可以在 sandbox 内启动后台命令并写结果文件
4. 平台侧通过轮询文件或任务状态做增量消费

不采用：

1. 修改 E2B template
2. 修改外部 codex 镜像
3. 依赖新公网 websocket 入口

#### 状态文件建议

建议每个 turn job 在 sandbox 内写一组状态文件，例如：

1. `notifications.jsonl`
2. `result.json`
3. `status.json`

平台侧：

1. 周期性读取增量 notifications
2. 用 notification identity 去重
3. 最后读取 result/status 完成收口

### 验收标准

`ws模式` 改造完成后，必须满足：

1. 第二条消息继续落在同一个 `taskSessionId`
2. 第二条消息继续落在同一个 `executorSessionId(threadId)`
3. 用户发送后立即看到自己的消息
4. 用户发送后立即看到 accepted / executing 状态
5. 长任务期间持续收到中间事件
6. turn 完成后状态最终正确收口

## 9. 风险

### 9.1 命名风险

设置里叫 `ws模式`，但当前 sandbox 内最稳 transport 是 stdio。

解决：

1. 产品文案明确这是 `Codex App Server 模式`
2. 内部实现允许 transport 先走 stdio
3. 不把设置文案和底层 transport 强绑定

### 9.2 恢复复杂度提升

`ws模式` 引入 App Server thread/session 语义后，恢复链路更依赖 `~/.codex`。

解决：

1. 保持 Codex 专属恢复链路
2. 不借 OpenCode 流程

### 9.3 双模式长期维护成本

同时支持 `sdk模式 + ws模式` 会增加维护成本。

解决：

1. 先让两种模式并存
2. 如果 `ws模式` 成熟稳定，再考虑未来是否把它提升为默认

## 10. 最终建议

建议正式采用以下产品方案：

1. `executor=codex` 保持不变
2. 新增 `codex执行模式 = sdk | ws`
3. 默认 `sdk`
4. `ws模式` 采用当前已验证通过的 App Server 最佳实践：
   - `~/.codex/config.toml`
   - `~/.codex/auth.json`
   - `Codex 0.115.0-alpha.27`
5. `ws模式` 专门负责文件显示与原生 diff
6. `sdk模式` 继续作为稳定兜底

这样可以满足：

1. 当前用户可用性不倒退
2. App Server 的文件显示和 diff 能力可正式接入
3. 后续若 `ws模式` 成熟，可以平滑成为默认方案

## 11. 当前实现进度

### 已完成

1. 设置页新增 `executor=codex` 下的 `sdk模式 / ws模式`
2. `Codex 模式` 只在 `sandbox 直通 + codex` 路径下显示
2. 前端 localStorage 已保存 `codexExecutionMode`
3. 新会话创建时会把 `codexExecutionMode` 带到 `POST /sessions`
4. session 顶层已新增：
   - `codexExecutionMode`
5. runtime 已新增：
   - `transport = sdk | app_server`
6. `codex-remote-service` 已开始按 session/runtime transport 分发：
   - `app_server -> ws模式`
   - `sdk -> 旧链路`
7. `ws模式` 已接入 App Server 原生：
   - `fileChange`
   - `turn/diff/updated`
8. `ws模式` 同一会话续聊已验证可用：
   - 实际根因是原先 `60s` 等待窗口导致长任务被误判失败
   - 当前默认等待窗口已提升到 `10 分钟`
9. `ws模式` 已过滤内部 transport 噪音：
   - `account/rateLimits/updated`
   - `thread/tokenUsage/updated`
   - `item/reasoning/*`
   - `codex/event/*`
   - `thread/status/changed`
10. 已修正交互体验：
   - 用户消息先在前端乐观显示，不再等待预检
   - 后端在启动 App Server turn 前先落库 `codex_user_input`
   - 后端会立即写入 `Codex 已接收输入，正在执行...`
11. `ws模式` 已从阻塞式单轮 `runTurn()` 改为：
   - 后台 turn job
   - 增量轮询 notifications
   - 中间消息持续写入平台缓冲层
12. 真实 E2B 验证已确认：
   - 第二条消息继续使用同一个 `taskSessionId`
   - 第二条消息继续使用同一个 `threadId`
   - turn 未完成前，平台已经持续收到并写入中间事件
13. `ws模式` 的 reasoning 展示策略已调整为：
   - 不再整类过滤 `item/reasoning/*`
   - 将 `summaryTextDelta` 聚合为稳定更新的一条“思考摘要”消息
   - 避免原先长任务期间前端长时间空白
14. 已确认并修复 `ws模式` 第二条消息误走“环境启动较慢”的根因：
   - 之前每轮都会重新启动一个临时 `codex app-server`
   - 没有真正复用第一轮已经启动的 App Server
   - 因此第二条消息会再次走启动链路，慢时被归一成“执行环境启动较慢”
15. 当前 `ws模式` 已改为复用 sandbox 内的常驻 App Server：
   - `codex-app-server-service` 负责保证常驻 server 存在
   - 每轮 turn 只连接本地 `ws://127.0.0.1:4321`
   - 不再为每条消息重复启动 `codex app-server`
16. 常驻 App Server 复用链路的关键修复点：
   - 端口探测不再把 `NOT_READY` 误判成 `READY`
   - 启动命令改为真正的 background 模式
   - 启动前先 `mkdir -p workspaceRoot`
   - turn 客户端改为 Python 标准库 websocket 握手，不依赖 sandbox 内额外安装 websocket 包
17. 针对第二条消息的发送前延迟也已收窄：
   - `executor=codex + ws模式`
   - 且本地已有可发送 runtime 绑定时
   - 前端不再额外阻塞等待一次 authoritative runtime 预检
18. 已确认并修复 `ws模式` 在 App Server turn 失败时的错误语义：
   - 之前会把 `turn/completed(status=failed)` 误判成完成
   - 导致页面出现“没有任何回复，但会话状态变成完成”
   - 当前已改为按 turn 实际状态判定：`failed -> failed`，不再写成 completed
19. App Server 的 `error` 通知现已保留原始错误正文与错误码：
   - 不再只显示一个无意义的 `error`
   - 会把上游错误消息写入平台消息与 metadata
20. 当前当上游返回额度/权限类错误时：
   - 页面应明确显示真实错误
   - 会话状态保持为 `failed`
   - 不再出现“执行完成”误导

### 未完成

1. 设置偏好尚未写入后端用户设置，只保留了本地存储
2. 还未做一轮完整页面级 `sdk/ws` 切换回归
