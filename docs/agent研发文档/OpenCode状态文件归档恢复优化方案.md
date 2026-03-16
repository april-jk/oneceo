# OpenCode 状态文件归档恢复优化方案

## 1. 背景

当前直通模式下，页面刷新后的历史消息主要依赖平台侧已落盘的会话消息恢复。

本次目标不是继续增强平台侧消息存储，而是让 OpenCode 在 Sandbox 销毁前，把自己的会话状态文件一并保存；下次 Sandbox 启动并恢复文件后，OpenCode 自己就能直接读回此前的完整会话历史。这样 oneceo 页面重新进入时，拿到的是 OpenCode 原生历史，而不是平台侧二次拼装的历史副本。

## 2. 目标

- 在直通模式下，OpenCode 会话历史以 OpenCode 自身状态文件为主存。
- Sandbox 销毁前保存 OpenCode 状态文件；Sandbox 恢复后通过文件恢复历史。
- 页面重新进入时，可直接从 OpenCode 读取完整历史消息。
- 平台仅保留最小运行态映射，不再承担“历史消息主存”的职责。

## 3. 现状分析

### 3.1 当前 oneceo 已有能力

- Sandbox 关闭/归档前，oneceo 已有工作区归档能力：
  - [sandbox-archive-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/sandbox-archive-service.ts)
- 当前归档对象是工作区目录：
  - 默认工作区根：`/opt/.altus/opencode/workspaces/{taskSessionId}`
- Sandbox 恢复时，会把归档 tar 包恢复回工作区目录：
  - `restoreWorkspaceIfArchived()`

这说明我们已经具备“销毁前保存文件、下次启动恢复文件”的基础设施，但目前保存的是工作区代码，不是明确为 OpenCode 会话状态设计的数据目录。

### 3.2 当前 OpenCode 启动方式

- oneceo 在 Sandbox 内通过 `opencode serve --hostname --port` 启动 OpenCode Server：
  - [sandbox-agent-provision-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/sandbox-agent-provision-service.ts)
- oneceo 通过 OpenCode HTTP API 与其通信：
  - `GET /session`
  - `GET /session/:id`
  - `GET /session/:id/message`
  - `POST /session/:id/message`
  - 对接代码：
    - [opencode-http-client.ts](/Users/eunice/codingProject/oneceo/apps/api/src/connectors/opencode-http-client.ts)

### 3.3 当前缺口

- 工作区恢复后，代码文件能回来，但 OpenCode 的会话数据不保证跟着回来。
- 现在的 `runtime.opencodeSessionId` 只是平台记录的运行态映射，不是 OpenCode 历史的真实持久化来源。
- 如果 Sandbox 被销毁，OpenCode 自己的 session/message 数据目录没有一并恢复，那么重新进入页面时仍然拿不到 OpenCode 原生完整历史。

## 4. OpenCode 官方调研结论

以下结论来自 OpenCode 官方文档与官方仓库：

### 4.1 OpenCode 自身会把 session 数据存盘

OpenCode 官方 Troubleshooting 文档明确写到，OpenCode 会把 session data 存储在本地磁盘：

- 官方文档：
  - [Troubleshooting - Storage](https://opencode.ai/docs/troubleshooting/)
- 关键信息：
  - 默认存储根目录：`~/.local/share/opencode/`
  - 其中 `project/` 下保存项目级 session/message 数据
  - Git 仓库项目存到 `<project-slug>/storage/`
  - 非 Git 项目存到 `global/storage/`

### 4.2 OpenCode 支持继续已有 session

OpenCode CLI 官方文档明确支持：

- `--continue` 继续最近会话
- `--session <id>` 继续指定会话
- `opencode session list`
- `opencode export [sessionID]`
- `opencode import <file>`

官方文档：

- [CLI](https://opencode.ai/docs/cli/)

这说明 OpenCode 的会话模型本身就是“可持久化、可恢复、可继续”的。

### 4.3 OpenCode Server 可直接读取历史消息

OpenCode 官方 Server 文档明确提供：

- `GET /session`
- `GET /session/:id`
- `GET /session/:id/message`

官方文档：

- [Server](https://opencode.ai/docs/server/)

这意味着只要 OpenCode 的本地会话状态目录被成功恢复，oneceo 在页面重新进入时，理论上可以直接从 OpenCode Server 取回完整历史消息。

### 4.4 OpenCode 支持把项目数据目录落到项目内

OpenCode 官方仓库 README 示例配置里包含：

```json
{
  "data": {
    "directory": ".opencode"
  }
}
```

来源：

- [OpenCode 官方仓库 README](https://github.com/opencode-ai/opencode)

这点非常关键，因为它意味着我们不一定要归档 `~/.local/share/opencode/project/...` 这种全局目录；也可以直接把 OpenCode 的项目数据目录落到工作区内的 `.opencode/`，使其天然被 oneceo 现有工作区归档覆盖。

### 4.5 当前集成版本兼容性结论

2026-03-13 在 oneceo 当前 Sandbox 环境实测时，OpenCode `v1.2.6` 启动日志明确报错：

- `Configuration is invalid at /home/user/.config/opencode/opencode.json`
- `Unrecognized key: "data"`

这说明：

- 官方 README 中出现过的 `data.directory` 示例，并不兼容 oneceo 当前 Sandbox 内实际运行的 OpenCode 版本。
- 因此本次落地不能直接依赖 `opencode.json.data.directory`。
- 但 OpenCode 仍然遵循 XDG 数据目录规则，实测 `XDG_DATA_HOME=<workspace>/.opencode` 后，`opencode.db` 和 log 会被写入工作区内。

结论：

- 方案 C 的“项目内数据目录”目标仍然成立；
- 具体实现应从“配置字段重定向”调整为“启动时注入 `XDG_DATA_HOME`”。

## 5. 方案选型

### 方案 A：继续只依赖平台侧消息落盘

- 做法：
  - 继续把历史消息主存放在 oneceo 平台侧数据库/文件存储
- 优点：
  - 改动小
- 缺点：
  - 不符合本次目标
  - OpenCode 原生会话状态、summary、fork、内部 part/tool 状态无法完整保真

结论：不采用。

### 方案 B：销毁前执行 `opencode export`，恢复后执行 `opencode import`

- 做法：
  - 销毁前导出单个 session JSON
  - 恢复后重新导入
- 优点：
  - 理论上可行
- 缺点：
  - 更像“迁移会话”，不是“恢复 OpenCode 自身运行态”
  - 需要额外处理导入时机、重复导入、fork/children/session 关系
  - 更适合作为兜底方案，不适合作为主方案

结论：作为兜底 fallback，可保留，不建议作为主路径。

### 方案 C：把 OpenCode 项目数据目录落到工作区内，并随工作区一起归档恢复

- 做法：
  - 启动 `opencode serve` 时注入 `XDG_DATA_HOME=<workspace>/.opencode`
  - 让 OpenCode 会话状态文件写到：
    - `/opt/.altus/opencode/workspaces/{taskSessionId}/.opencode`
  - Sandbox 归档时直接随工作区 tar 包一起保存
  - 恢复后重新启动 `opencode serve`
  - oneceo 通过 OpenCode API 重新枚举/恢复 session 和 message
- 优点：
  - 最符合“依赖 OpenCode 自身状态文件恢复”的目标
  - 与现有 `archiveSandboxWorkspace()/restoreWorkspaceIfArchived()` 天然兼容
  - 不需要额外保存全局 `~/.local/share/opencode`，可避免把全局 auth/log 数据一起打包
  - 历史消息、会话树、summary、内部 session 数据恢复更完整
- 缺点：
  - 需要保证所有 OpenCode server 启动路径都统一注入相同的 `XDG_DATA_HOME`
  - 需要在恢复后增加一次“恢复会话绑定”的逻辑

结论：推荐采用，作为主方案。

## 6. 推荐方案

## 6.1 总体思路

采用“项目内 `.opencode` 数据目录 + 工作区归档恢复 + 启动后重建 session 绑定”的方案。

关键原则：

- 历史消息主存放在 OpenCode 自己的数据目录
- 平台只保存最小必要映射，不保存历史消息副本作为主来源
- 恢复后优先从 OpenCode API 重读历史，而不是平台侧拼装

## 6.2 目标目录结构

每个直通任务会话对应独立工作区：

```text
/opt/.altus/opencode/workspaces/{taskSessionId}/
  ├── .opencode/
  │   ├── ... OpenCode project storage ...
  │   └── ... session / message / snapshot / summary ...
  └── 项目文件...
```

这样现有工作区归档 tar 包会天然包含 `.opencode/`。

## 6.3 启动配置调整

当前 oneceo 会在 Sandbox 内重写 `~/.config/opencode/opencode.json`，但当前 OpenCode 版本不接受 `data.directory`。

因此实际落地调整为：

- 保持 `opencode.json` 只写当前版本支持的 provider / model / mcp 配置
- 在所有 `opencode serve` 启动路径统一注入：

```bash
XDG_DATA_HOME=/opt/.altus/opencode/workspaces/{taskSessionId}/.opencode
```

这样 OpenCode 的 SQLite、日志和 session storage 会落到工作区内，同时不需要依赖当前版本不支持的配置键。

## 6.4 销毁前保存策略

当前归档逻辑已会打包整个工作区根目录，因此只要 `.opencode/` 在工作区内，就无需新增单独的 OpenCode 归档动作。

但需要补两项约束：

1. 归档前不得清理 `.opencode/`
2. 归档元数据中记录：
   - 当前 `taskSessionId`
   - 当前工作区路径
   - 最近一次可用的 `opencodeSessionId`

说明：

- 这里记录 `opencodeSessionId` 只是“恢复定位索引”，不是消息主存
- 消息内容仍以 `.opencode/` 内 OpenCode 原生状态为准

## 6.5 恢复后启动策略

恢复流程建议调整为：

1. 恢复工作区 tar 包
2. 确认 `.opencode/` 已恢复
3. 重写 `opencode.json`
4. 重新启动 `opencode serve`，并注入 `XDG_DATA_HOME=<workspace>/.opencode`
5. 通过 OpenCode API 校验会话是否可见：
   - `GET /session`
   - `GET /session/:id`
   - `GET /session/:id/message`

## 6.6 恢复后的会话绑定策略

恢复后 oneceo 不应直接假设旧 `runtime.opencodeSessionId` 一定可用，应按以下顺序恢复：

1. 如果已有 `runtime.opencodeSessionId`
   - 调用 `GET /session/:id`
   - 若存在则直接绑定使用
2. 如果旧 ID 不存在或失效
   - 调用 `GET /session`
   - 过滤当前工作区对应的 session
   - 选取最近一次活跃/最新的一条 session
   - 回写到运行态映射
3. 页面重新进入时
   - 优先从 OpenCode `GET /session/:id/message` 读取完整历史
   - 平台历史只作为兜底，不作为优先来源

补充约束（2026-03-14）：

- 同一个 `taskSessionId` 在用户多次进入、长时间中断、Sandbox 生命周期结束后，可能经历多次 Sandbox 重建。
- 因此 runtime 不能被理解为“固定 sandbox”，而应理解为“当前生效的一次 sandbox 世代”。
- 一个任务会话会存在：
  - 稳定主键：`taskSessionId`
  - 多个短生命周期 sandbox 世代：`orchestratorSessionId#1 / #2 / #3 ...`
  - 每个世代都可能从归档恢复出 OpenCode 数据目录，并重新定位到一个可继续的 `opencodeSessionId`

实现约束：

1. 当 `orchestratorSessionId` 发生变化时，必须立即清空内存态中的旧 `opencodeSessionId`
   - 因为旧 `opencodeSessionId` 只是“待验证恢复线索”，不能在新 sandbox 中默认视为可用
2. 只有在新 sandbox 中通过 OpenCode API 验证成功后，才允许把 `opencodeSessionId` 写回当前 runtime
3. 前端不得再从旧历史消息反推当前 runtime
   - 当前 runtime 只能以后端当前返回的 authoritative runtime 为准
4. 历史消息允许跨多次 sandbox 世代保留，但不能反向污染当前世代的 runtime 绑定
5. 对旧 sandbox 环境记录缺失 `opencodeBaseUrl/opencodeHost/opencodePort/opencodeWorkspaceRoot` 的情况
   - 后端必须支持按当前 E2B host 回填 metadata
   - 不能要求用户先手动重建 sandbox 或清空旧会话后才能继续续写

推荐最小数据模型：

```json
{
  "taskSessionId": "...",
  "runtime": {
    "generation": 3,
    "orchestratorSessionId": "sandbox-current",
    "opencodeSessionId": "session-restored-and-validated",
    "updatedAt": "..."
  }
}
```

其中：

- `generation` 表示当前已进入第几次 sandbox 世代
- `orchestratorSessionId` 表示当前世代的 sandbox
- `opencodeSessionId` 仅在“恢复并验证成功”后才允许存在

## 6.7 页面读取策略

页面重新进入时，建议改成：

1. 先查当前 task session 的 sandbox/runtime
2. 若 Sandbox 已恢复且 OpenCode session 可用
   - 优先从 OpenCode 拉历史消息
3. 若 OpenCode 不可用
   - 再退回平台侧历史消息

补充保护（2026-03-14）：

- 若 OpenCode native history 只恢复出 `opencode_user_input`，但没有任何可显示的 assistant/tool 回复，则 `/api/task-creation/sessions/:id/messages` 必须回退到平台已落盘消息。
- 原因：当前部分 OpenCode session 在新建直通对话或恢复早期，只能从 native history 读到用户输入；若此时仍强制 native 优先，会把平台侧已收到的 `opencode_event` 回复遮掉，导致用户只看到自己的提问，看不到 OpenCode 回复。

## 7. 已落地实现

截至 2026-03-13，已完成以下实现：

- `sandbox-agent-provision-service.ts`
  - 移除不兼容的 `opencode.json.data.directory`
  - 在 OpenCode server 启动与重启时注入工作区级 `XDG_DATA_HOME`
- `osac-agent-service.ts`
  - 在按需补拉起 OpenCode server 时，同样注入工作区级 `XDG_DATA_HOME`
- `opencode-remote-service.ts`
  - 恢复后优先从 OpenCode `/session` / `/session/:id/message` 重建绑定与读取历史
- `task-creation-routes.ts`
  - `GET /sessions/:id/messages` 优先走 OpenCode 原生历史，平台侧消息退为兜底
- `opencode-history-recovery.ts`
  - 新增会话恢复选择与原生消息归一化工具

## 8. 已完成验证

- 单测通过：
  - `tests/opencode-history-recovery.test.ts`
  - `tests/direct-capability-intercept-agent.test.ts`
  - `tests/direct-mode-entry.service.test.ts`
- OpenCode 直通 API 场景套件通过：
  - `tests/opencode-sandbox-direct/run-direct-mode-tests.ts`
  - 包含 `01_session_bootstrap`
  - 包含 `02_session_continuation`
  - 包含 `03_sse_realtime_incremental`
  - 包含 `04_persistence_refresh_consistency`
  - 包含 `05_completion_signal`

额外说明：

- 现有 Web Playwright 用例 `direct-mode-refresh-consistency.playwright.spec.ts` 本轮未通过，但失败原因是测试自身超时后 `request context disposed`，不是本次 OpenCode 恢复链路的后端回归。

这样最终页面展示的是 OpenCode 原生历史。

## 7. 实践细节

## 7.1 代码层面需调整的模块

预计会涉及：

- OpenCode 配置写入：
  - [sandbox-agent-provision-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/sandbox-agent-provision-service.ts)
- Sandbox 归档/恢复：
  - [sandbox-archive-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/sandbox-archive-service.ts)
- OpenCode 远端会话恢复：
  - [opencode-remote-service.ts](/Users/eunice/codingProject/oneceo/apps/api/src/services/opencode-remote-service.ts)
- 直通模式页面历史加载：
  - [useTaskCreationAgent.ts](/Users/eunice/codingProject/oneceo/apps/web/client/src/hooks/useTaskCreationAgent.ts)
- 任务创建会话接口：
  - [task-creation-routes.ts](/Users/eunice/codingProject/oneceo/apps/api/src/routes/task-creation-routes.ts)

## 7.2 需要新增的能力

- OpenCode 恢复会话解析器
  - 根据工作区与 OpenCode session 列表恢复最合适的 `opencodeSessionId`
- OpenCode 原生历史优先读取器
  - 页面进入时优先读取 OpenCode `GET /session/:id/message`
- 平台侧兜底回退开关
  - 当 OpenCode 历史不可读时，回退到现有平台历史

## 7.3 需要验证的关键点

- `.opencode/` 是否确实包含完整历史所需数据
- OpenCode 版本升级后，旧 `.opencode/` 是否仍可读取
- 同一工作区下多 session 时，恢复选中的 session 是否正确
- 自动 compact/fork 后，历史是否仍能完整还原

## 8. 风险与应对

### 风险 1：`.opencode/` 实际不包含全部历史

- 应对：
  - 开发前先在真实 Sandbox 中验证 `.opencode/` 文件变化
  - 若发现仍有历史落在 `~/.local/share/opencode/project/...`
  - 则补充第二层方案：将该 project storage 目录一并镜像到工作区归档中

### 风险 2：恢复后 session ID 变化

- 应对：
  - 不把恢复建立在“固定 sessionId 必须存在”上
  - 改为“旧 ID 优先，session list 兜底”

### 风险 3：归档体积增长

- 应对：
  - 为 `.opencode/` 增加大小观测
  - 必要时只保留最近 N 个 session/snapshot

### 风险 4：不同 OpenCode 版本的数据兼容性

- 应对：
  - 固定 Sandbox 模板中的 OpenCode 版本
  - 在归档元数据中记录 `opencodeVersion`
  - 恢复失败时自动回退到平台侧历史

## 9. 分阶段实施建议

### Phase 1：目录内持久化

- 在 `opencode.json` 中启用 `data.directory=".opencode"`
- 验证 `.opencode/` 已随工作区归档恢复

### Phase 2：恢复绑定

- 恢复后自动解析 `opencodeSessionId`
- 让平台知道应该向哪个 OpenCode session 拉历史
- 平台 runtime 改为 generation-aware：
  - 新 sandbox 创建后先只写新的 `orchestratorSessionId`
  - 清空旧 `opencodeSessionId`
  - 只有在新 sandbox 内验证旧 session 已恢复成功后，才回填新的 `opencodeSessionId`
  - 历史消息与流式事件都要带 `runtimeGeneration`

### Phase 3：页面历史切换为 OpenCode 优先

- 页面进入时优先从 OpenCode 拉历史消息
- 平台历史降级为 fallback
- 同一 task session 的多次 sandbox 重建必须保留 generation 边界
- 前端历史合并和流式去重 key 必须纳入 `runtimeGeneration`，避免旧新世代文本串流错误拼接

### Phase 4：导出导入兜底

- 如果发现 `.opencode/` 模式在部分版本下不稳定
- 再补 `opencode export/import` 作为灾备方案

## 9.1 运行中补充约束

- 归档恢复后不只要恢复 `.opencode/opencode.db` 等状态文件，还必须覆盖恢复工作区里的本地配置文件：
  - `~/.config/opencode/opencode.json`
  - `{workspace}/.opencode/opencode.json`
- 因为 OpenCode 启动时会优先读取工作区内的 `.opencode/opencode.json`，如果这个文件仍是旧 provider/model，就会在新 sandbox 中继续沿用旧模型。
- `runtime/start` 在复用现有 sandbox 时，也必须重新执行一次配置同步与 `opencode serve` 重启，不能只做 health-check 复用旧进程。
- “恢复旧 session” 必须校验 provider/model 兼容性：
  - 如果恢复出的 `opencodeSessionId` 绑定的是旧 provider/model，而当前平台配置已经切换，则不能继续复用该 session。
  - 这种情况下应清空 `opencodeSessionId`，保留当前 sandbox/runtime，然后创建新的 OpenCode session。
- 当 task session 当前状态已经是 `failed` 时，新的用户输入默认不复用旧 `opencodeSessionId`。
- `completed` 只表示上一轮执行结束，不能作为强制新建 OpenCode session 的条件。
- 同一 `taskSessionId` 下的连续用户对话，只要以下条件未变化，就应继续复用同一个 `opencodeSessionId`：
  - `orchestratorSessionId` 未切换
  - provider/model 未切换
  - 旧 `opencodeSessionId` 在当前 sandbox 内仍能通过 OpenCode API 验证可用
- 如果 `orchestratorSessionId` 已切换，但当前发送链路是“在新 sandbox 中恢复旧会话后继续续聊”，则恢复逻辑必须显式携带“上一代已验证可用的 `opencodeSessionId`”作为 preferred 值。
  - 否则 `resolveRecoveredOpencodeSessionId()` 会退化为“从 workspace session 列表中选择一个最新候选”，从而把同一 task session 的第二轮对话错误切到新的 OpenCode session。
- `runtime/touch`、sandbox 活跃度标记、归档脏标记这类辅助链路必须把数据库瞬时异常视为可降级故障，不能因为心跳或 metadata 写入失败导致 API 进程退出。
- `opencode/events` 在 runtime 未就绪、sandbox 已关闭或恢复中的阶段，应优先返回短生命周期 SSE bridge 信号，而不是直接返回 `409` JSON；前端应按 SSE 重连节奏平滑恢复。

## 10. 验收标准

- Sandbox 销毁前归档后，恢复出的工作区中存在 `.opencode/`
- 恢复后 OpenCode `GET /session` 能看到旧 session
- 恢复后 OpenCode `GET /session/:id/message` 能返回完整历史
- 页面在“重新进入会话”时，优先使用 OpenCode 原生历史
- 不依赖平台侧历史消息，也能完成主要会话恢复
- 多次 sandbox 重建后：
  - 当前 runtime 不会被旧世代 `opencodeSessionId` 污染
  - 历史消息时间线中能看出 generation 切换
  - 文本流不会跨 generation 错误合并
- 对旧会话做“恢复后继续对话”时：
  - 即使 sandbox 环境记录缺失 `opencodeBaseUrl`，首次续写也能自动回填并成功继续

## 11. 本次建议结论

建议采用：

- 主方案：`data.directory=".opencode"` + 工作区归档恢复 + 启动后 session 重绑定
- 兜底方案：`opencode export/import`

这个方案最贴近你的要求：

- 历史不是靠平台侧主存
- 依赖 OpenCode 自己的状态文件恢复
- 重新打开页面后直接能看到 OpenCode 原生完整会话历史

## 12. 参考资料

- OpenCode 官方存储说明：
  - [Troubleshooting - Storage](https://opencode.ai/docs/troubleshooting/)
- OpenCode 官方 CLI：
  - [CLI](https://opencode.ai/docs/cli/)
- OpenCode 官方 Server API：
  - [Server](https://opencode.ai/docs/server/)
- OpenCode 官方仓库 README：
  - [opencode-ai/opencode](https://github.com/opencode-ai/opencode)
