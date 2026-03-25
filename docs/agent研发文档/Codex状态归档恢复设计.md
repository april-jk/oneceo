# Codex 状态归档恢复设计

日期：2026-03-18  
状态：已实现并完成 A/B 实测

## 0.1 2026-03-22 补充修正：失效 Sandbox 自动重建

历史会话恢复链路在真实使用中暴露出一个额外问题：

1. session 记录里仍保留旧 `orchestratorSessionId`
2. 环境表或 E2B 连接缓存仍把它视为可复用
3. 用户发送下一条消息时，provision 流程先尝试复用旧 sandbox
4. 到 `commands_ready` 才收到 `Sandbox is probably not running anymore`
5. 请求直接失败，用户看到显式错误，而不是无感恢复

这个问题不属于 session 恢复语义本身，而属于恢复入口的 runtime 自愈缺失。

因此补充一个强制要求：

1. `provision` 发现旧 sandbox 在 `sandbox_info` 或 `commands_ready` 阶段不可用时，必须把它判定为失效世代
2. 同一请求内必须自动放弃旧 sandbox，关闭本地复用状态，并直接新建新 sandbox
3. 新 sandbox 启动后继续执行既有的归档恢复与 `resumeExecutorSession` 链路
4. 只有第二次冷启动仍失败时，才允许把错误暴露给用户

这样“自动归档 + 自动恢复”对用户才是无感的，用户不需要理解旧 sandbox 是否已死亡，也不应该手动刷新或重试来触发恢复。

## 1. 背景

当前 `oneceo` 已经完成了 `Codex` 直通主链路：

- session 固定 `driver=codex`
- runtime 保存 `orchestratorSessionId + executorSessionId`
- sandbox 内通过 OSAC 驱动 Codex CLI
- 同一 sandbox 内已支持 `resume` 续聊

但用户对恢复能力的要求已经明确提升为：

1. 不只是恢复工作区文件
2. 不只是恢复执行环境
3. 而是必须恢复同一个 Codex session
4. 恢复后下一轮输入要继续沿用前面对话上下文

也就是说，本方案的目标不是 `workspace recovery`，而是 **session recovery**。

## 2. 核心约束

本设计有两条硬约束，后续实现不得违反。

### 2.1 不修改 OpenCode 已验证逻辑

当前 OpenCode 的工作区归档恢复已经验证可用，因此：

1. 不修改 OpenCode 已有恢复时序
2. 不改 OpenCode 已有 session 恢复语义
3. 不在 OpenCode 代码路径上继续混入 Codex 特判

结论：

- `Codex` 必须新建一套专属恢复流程
- 代码命名、service、状态字段都要明确标注为 `codex`
- 不能复用 OpenCode 的“逻辑语义”，只能在必要时复用底层归档介质能力

### 2.2 恢复成功只认 session 恢复

对 Codex 而言，“恢复成功”必须满足：

1. 新 sandbox 中成功恢复原 `executorSessionId`
2. 下一轮输入继续沿用原上下文
3. 用户看到的是同一段对话继续，而不是新 thread 重新开始

因此以下情况都 **不能** 叫“恢复成功”：

1. 只恢复了 workspace 文件
2. 只恢复了 sandbox，但新建了 Codex thread
3. 旧 `executorSessionId` 恢复失败，但系统静默改成新 thread

这些只能算降级或失败，不能冒充“已恢复对话”。

## 3. 目标

### 3.1 目标

让 `Codex` 在 sandbox 被销毁后，达到明确的 session-level recovery：

1. 恢复原工作区文件
2. 恢复原 Codex 本地状态
3. 恢复原 `executorSessionId`
4. 恢复原对话上下文连续性
5. 下一轮输入继续在原 session 上执行

### 3.2 非目标

本轮不做：

1. 修改 OpenCode 已有恢复方案
2. 扩展到其他 executor（例如 `claudecode`）
3. 把“文件恢复”包装成“session 恢复”
4. 保证所有 Codex CLI 版本状态目录完全一致

## 4. 当前现状

### 4.1 已有基础能力

当前 oneceo 已有这些底座能力：

1. Sandbox 关闭前可把 `workspace + state` 一起打包上传到 R2  
   位置：[sandbox-archive-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/sandbox-archive-service.ts)
2. 新 sandbox 启动时会自动尝试 `restoreWorkspaceIfArchived()`  
   位置：[sandbox-agent-provision-service.ts](/Users/watson/codingProj/oneceo/apps/api/src/services/sandbox-agent-provision-service.ts:981)
3. Session 已保存：
   - `driver`
   - `runtime.orchestratorSessionId`
   - `runtime.executorSessionId`
4. OSAC 已支持：
   - `EXECUTOR_RUNTIME_ENSURE`
   - `EXECUTOR_SESSION_RESUME`
   - `EXECUTOR_INPUT_SEND`

### 4.2 当前不足

当前不足不在“有没有 tar 包”，而在“Codex session 恢复链路没有被单独设计”：

1. 还没有明确定义 Codex state 的专属落盘目录
2. 还没有明确定义 `executorSessionId` 的恢复校验时机
3. 还没有把“旧 session 恢复失败”定义为显式失败态
4. 还没有定义新 sandbox 中恢复旧 session 的专属时序

### 4.3 当前风险

如果现在直接把“归档恢复”理解为“Codex 一定能无缝继续”，会有三个风险：

1. 旧 sandbox 已销毁，但新的 sandbox 中 Codex 本地 state 不足以 resume 旧 thread
2. 旧 `executorSessionId` 恢复失败后仍被保留在 runtime 中，导致后续输入反复撞无效 session
3. 系统静默新建 thread，表面可用，实际已经丢失上下文连续性

第 3 点是本设计最不能接受的行为。

### 4.4 2026-03-18 A/B 实测结论

已按“sandbox A 产生真实对话 -> 归档关闭 -> sandbox B 恢复旧 session”做了 10 个实测样本，结论如下：

1. 当前 oneceo 的默认 `workspace + stateRoot` 归档，**不能** 达到 Codex 的 session-level recovery
2. 单纯调整 `HOME`、`XDG_*`、`CODEX_HOME` 后再归档，仍然**不能**稳定恢复旧 session
3. 真实探测确认：Codex 的关键 session 状态实际落在：

```text
/home/user/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<executorSessionId>.jsonl
```

4. 真实探测还确认：当前成功运行的 Codex sandbox 中，`rollout-*.jsonl` 文件存在于 `~/.codex/sessions`，而不是当前归档验收重点里的 `workspaceRoot` 或 `stateRoot/taskSessionId`
5. 因此，现有归档链路即使能恢复项目文件，也天然抓不到 Codex 用于 `resume` 的核心 session 元数据

补充证据：

1. 实测 sandbox 中可见：
   - `/home/user/.codex/sessions/2026/03/18/rollout-2026-03-18T05-32-49-019cff6e-ad2b-72e0-976a-7f7e9244b1e4.jsonl`
2. 该 rollout 文件头部已包含：
   - `payload.id = executorSessionId`
   - `payload.cwd = workspaceRoot`
   - `originator = codex_exec`

这说明后续恢复的关键，不是“猜 Codex 会不会自动恢复”，而是明确把 `~/.codex` 下的 session 状态纳入 Codex 专属归档恢复链路。

## 5. 成功标准

`Codex` 恢复成功必须同时满足：

1. `restoreWorkspaceIfArchived()` 恢复出原 `workspace + state`
2. 新 sandbox 中 `ensureExecutorRuntime(codex)` 成功
3. `resumeExecutorSession(executorSessionId)` 成功
4. 返回的 `executorSessionId` 与旧 session 一致，或由 Codex/OSAC 明确确认是同一逻辑 session
5. 下一轮用户输入继续在该 session 上执行

如果缺少其中任意一点，就不能标记为“恢复成功”。

## 6. 设计原则

### 6.1 恢复分层，但验收只认第二层

Codex 恢复仍然分两层：

1. 文件环境恢复
2. 执行器 session 恢复

但产品语义上只认第 2 层：

- 第 1 层只是前置条件
- 第 2 层才是成功标准

### 6.2 先恢复文件，再恢复 session

顺序必须固定为：

1. 新 sandbox 启动
2. 恢复 `workspaceRoot + stateRoot`
3. 启动 Codex 专属 OSAC bridge
4. `ensureExecutorRuntime(codex)`
5. 尝试 `resumeExecutorSession(executorSessionId)`
6. 成功则进入 `session_restored`
7. 失败则进入 `session_restore_failed`

注意：

- 这里没有“失败后直接新建 thread 并算成功”的分支
- 新建 thread 只能作为人工接受的降级补救，不能算 session 恢复成功

### 6.3 不信任旧 sandbox id

`orchestratorSessionId` 只是 sandbox 世代标识，不是会话身份。

当 sandbox 被销毁并重建时：

1. 必须允许 `orchestratorSessionId` 变化
2. 旧 `executorSessionId` 必须在新 sandbox 中重新校验
3. 只有 resume 通过后，才允许继续把它视为当前 session 的有效 id

### 6.4 Codex 必须独立建链路

后续实现必须按以下边界拆分：

1. OpenCode 恢复链路保持原样
2. Codex 恢复链路单独命名
3. 不允许在 OpenCode 恢复逻辑中加入 `if executor === 'codex'`
4. 若要复用能力，只能复用“归档介质 / 基础工具函数”，不能复用“OpenCode 恢复语义”

## 7. 推荐方案

## 7.1 Codex 目录模型

建议 Codex 保持“工作区目录 + 专属状态目录”双目录模型，但不要再假设 CLI 只会写入 `stateRoot/codex/`。根据实测，Codex 真实依赖的是 `~/.codex`。

每个 `taskSessionId` 对应：

```text
/home/user/opencode/workspaces/{taskSessionId}/
  └── 用户项目文件

/home/user/opencode/state/{taskSessionId}/codex-home/.codex/
  ├── sessions/
  ├── tmp/
  ├── shell_snapshots/
  └── 其他 Codex CLI 恢复所需状态文件
```

说明：

1. `workspaceRoot` 只放用户可见项目文件
2. `stateRoot/codex-home/.codex` 只放 Codex session 恢复所需状态
3. `stateRoot/codex-home/.codex` 不能位于 `workspaceRoot` 内部
4. sandbox 内真实生效路径仍应统一映射为 `/home/user/.codex`

## 7.2 Codex 状态目录约定

后续实现建议新增明确约定，并以“显式映射 `/home/user/.codex`”为核心：

1. `CODEX_ARCHIVE_HOME={stateRoot}/codex-home`
2. `CODEX_ARCHIVE_HOME/.codex/sessions` 归档 Codex rollout / session 文件
3. `CODEX_ARCHIVE_HOME/.codex/tmp` 归档 Codex 临时状态
4. sandbox provision 时，在 Codex 专属流程里执行：
   - 确保 `${stateRoot}/codex-home/.codex` 存在
   - 将 `/home/user/.codex` 映射到该目录
   - 再启动 OSAC / Codex

推荐实现方式优先级：

1. 优先：在 Codex 专属 bootstrap 中将 `/home/user/.codex` 软链接到 `${stateRoot}/codex-home/.codex`
2. 次选：直接以 `${stateRoot}/codex-home` 作为 `HOME`，并确认 Codex 真实写入 `~/.codex`
3. 不建议：只依赖 `CODEX_HOME`，因为实测 Codex 仍会写 `~/.codex/sessions`

目标是把 Codex resume 依赖的 `~/.codex` 明确收敛到可归档目录，而不是继续散落在默认 home 下。

说明：

1. 这套约定只服务于 Codex，不影响 OpenCode
2. 不再把 `stateRoot/taskSessionId` 误认为 Codex 已经在使用的真实 session 路径
3. `~/.codex/sessions` 是否成功被映射到归档目录，应成为 Codex provision 的硬校验项

## 7.3 归档内容

Codex 会话归档包继续沿用现有 tar 结构：

```text
workspace/
state/
```

但在 Codex 语义下，`state/` 的验收标准更严格：

1. 不只是“打包了 state 目录”
2. 而是“打包了 `/home/user/.codex` 实际映射目录”
3. 且恢复后足以支持旧 `executorSessionId` resume

否则就只能视为归档不完整。

## 7.4 Codex 专属 provision 恢复时序

建议新增 Codex 专属恢复流程，例如：

```text
provisionCodexWithSessionRestore()
  -> openEnvironment()
  -> ensureCodexWorkspaceLayout()
  -> restoreCodexWorkspaceAndState()
  -> ensureCodexHomeMapping(/home/user/.codex -> stateRoot/codex-home/.codex)
  -> ensureCodexOsacBridge()
  -> waitForCodexOsacBridgeReady()
  -> ensureExecutorRuntime(codex)
  -> resumeCodexExecutorSession()
  -> verifyCodexSessionContinuity()
```

注意：

1. 这不是 OpenCode provision 流程上打补丁
2. 这是 Codex 自己的恢复时序
3. 函数命名应明确体现 `codex`
4. `ensureCodexHomeMapping()` 是新的关键步骤，没有它就不应宣称支持 session 恢复

## 7.5 本轮已实现

本轮已在主仓库落地最小可用实现：

1. `sandbox-agent-provision-service.ts`
   - 新增 `ensureCodexHomeMapping()`
   - 在 `executor=codex` 的 provision 中执行 `/home/user/.codex -> {stateRoot}/codex-home/.codex` 显式映射
   - 映射前会把 sandbox 默认 `~/.codex` 内容合并进归档目录，避免丢失 Codex 默认技能与运行态
   - 新 sandbox 世代仍保持 `/home/user/.codex` 为 Codex 真实运行路径
2. `sandbox-archive-service.ts`
   - 归档/恢复元数据新增 `codexArchiveHome`、`codexDotCodexPath`
   - 归档包主体仍然只打 `workspace + state`，不改 OpenCode 已有 tar 结构
   - 新增 Codex 专属“归档前状态就绪校验”：
     - 当 sandbox 上已存在活动 `executorSessionId` 时，归档前必须在 `stateRoot/codex-home/.codex/sessions` 中验到对应 `rollout-<executorSessionId>.jsonl`
     - 只有校验通过才允许上传归档
     - 若校验失败，直接拒绝生成归档并写回失败元数据，避免产出“可恢复性不成立”的坏归档
   - 归档元数据额外记录：
     - `codexArchivedExecutorSessionId`
     - `codexArchiveVerifiedAt`
     - `codexArchiveVerifiedRollout`
     - `codexArchiveReady`
3. `opencode-workspace.ts`
   - 新增 Codex 专属归档目录解析函数
4. `codex-remote-service.ts`
   - 新增 Codex session 恢复状态写回：
     - `codexRestoreStatus`
     - `codexRestoreAt`
     - `codexRestoreSourceKey`
     - `previousExecutorSessionId`
     - `codexRestoreFailureReason`
   - 新 sandbox 上如果检测到已恢复的 `.codex/sessions`，会主动对旧 `executorSessionId` 执行 `resume`
   - 如果缺少可恢复状态，会显式返回 `state_restore_failed`，而不是静默新建 thread
5. `task-creation-routes.ts / file-memory-store.ts`
   - 已把 Codex 恢复状态纳入 session/runtime 明细返回与本地持久化

这套实现的关键点不是改 tar 结构，而是确保 `Codex` 的真实状态文件已经落进 `stateRoot`，从而被现有归档链路自然带走。

## 7.6 本轮实测结果

实现完成后，已再次执行 2 轮真实 A/B sandbox 验证，结果均成功：

1. sandbox A 中生成只存在于对话上下文里的 `memory token`
2. 关闭 A，触发 R2 归档
3. sandbox B 使用同一 `taskSessionId` 恢复
4. B 中通过原 `executorSessionId` 调用 `EXECUTOR_SESSION_RESUME + EXECUTOR_INPUT_SEND`
5. B 成功回答原 `memory token` 与文件标记，证明恢复的是同一段会话上下文，不是新 thread

成功样本：

1. `taskSessionId = codex_restore_current_1773829260867_385`
   - `executorSessionId = 019d0076-f4e9-7301-8e30-9aa52d6dcff4`
2. `taskSessionId = codex_restore_current_1773829377084_489`
   - `executorSessionId = 019d0079-0f35-7752-8484-ab0fe09cc0ed`

补充说明：

1. 底层 A/B 恢复链路已经通过
2. 平台层现在也具备显式恢复状态机：
   - 找到归档状态时，自动走 `resume`
   - 找不到归档状态时，明确报错并阻止静默新建 thread
3. 因此平台当前的语义是“恢复成功可继续，恢复失败可感知”，而不是“失败后悄悄换一个新会话”

## 7.7 最佳实践

基于本轮已验证成功的实现与 A/B 实测，Codex session 级恢复的最佳实践如下。

### 7.7.1 目录与映射

1. 始终把 Codex 的真实运行目录视为 `/home/user/.codex`
2. 不要假设 `CODEX_HOME` 或普通 `stateRoot` 就足以承载恢复
3. 对于 `taskSessionId = X`，推荐统一约定：

```text
workspaceRoot = /home/user/opencode/workspaces/X
stateRoot = /home/user/opencode/state/X
codexArchiveHome = /home/user/opencode/state/X/codex-home
codexDotCodexPath = /home/user/opencode/state/X/codex-home/.codex
runtimePath = /home/user/.codex
```

4. sandbox 内真实生效路径必须保持为：

```text
/home/user/.codex -> /home/user/opencode/state/X/codex-home/.codex
```

### 7.7.2 正确时序

推荐按以下顺序执行，不能颠倒：

1. 打开新 sandbox
2. 准备 `workspaceRoot + stateRoot`
3. 先执行归档恢复，把历史 `workspace + state` 还原
4. 再执行 `ensureCodexHomeMapping()`，确保 `/home/user/.codex` 指向 `stateRoot/codex-home/.codex`
5. 最后启动 OSAC bridge / Codex runtime
6. 用旧 `executorSessionId` 执行 `resume`
7. 发送新一轮消息验证上下文连续性

原因：

1. 如果先启动 Codex 再做映射，Codex 可能已经把新状态写进默认 home，污染恢复结果
2. 如果不在 runtime 启动前完成映射，旧 session 的 rollout 文件不会被命中

### 7.7.3 验收标准

只有同时满足以下条件，才算恢复成功：

1. B sandbox 中目标工作区文件存在
2. `/home/user/.codex/sessions/.../rollout-*.jsonl` 已从归档恢复
3. `resume` 使用的是 A 中的原 `executorSessionId`
4. B 的回答中包含只存在于 A 对话上下文、未写入文件系统的信息
5. 终态事件为 `turn.completed`

建议使用“双证据”验收：

1. 文件证据：例如 `restore_note.txt`
2. 上下文证据：例如只存在于对话中的 `memory token`

### 7.7.4 源头归档成功标准

为避免后续恢复阶段再出现“未找到 Codex 会话状态归档”，Codex 的源头归档必须满足以下条件：

1. 当前 sandbox 已存在活动 `executorSessionId`
2. 归档前必须先执行一次状态就绪校验
3. 校验目标不是 `workspaceRoot`，而是：

```text
{stateRoot}/codex-home/.codex/sessions/**/rollout-<executorSessionId>.jsonl
```

4. 只有找到与当前 `executorSessionId` 对应的 rollout 文件，才允许继续打包上传
5. 找不到 rollout 文件时，必须直接拒绝归档，并把失败原因写入 sandbox metadata

推荐写回的元数据：

1. `codexArchiveReady=true|false`
2. `codexArchivedExecutorSessionId`
3. `codexArchiveVerifiedAt`
4. `codexArchiveVerifiedRollout`
5. `archiveError`

结论：

1. 对 Codex 来说，“tar 上传成功”不等于“状态归档成功”
2. 只有“rollout 文件已落盘并被校验通过”的归档，才可作为后续 session 恢复输入
3. 这套源头校验是 Codex 专属逻辑，不进入 OpenCode 路径

补充一条实现注意事项：

1. 在 E2B sandbox 中，`runCommand()` 可能出现“`stdout` 已返回有效结果，但 SDK 仍抛 `exit status 1`”的情况
2. 因此像 `codex_home_mapping`、`rollout ready probe` 这类探测型命令，不能只以异常与否判断成功
3. 必须同时检查 `stdout / error.result.stdout`
4. 对于明确的成功标记（如 `READY:`、`FOUND:`），应优先按输出语义判定
5. 否则会把“实际上已映射成功”的 sandbox 误判为 provision 失败

### 7.7.5 禁止事项

以下做法已经被实测证明不可靠，不应再作为主方案：

1. 只归档 `workspaceRoot + stateRoot`，但不处理 `/home/user/.codex`
2. 只调整 `HOME`
3. 只调整 `XDG_*`
4. 只设置 `CODEX_HOME`
5. `resume` 失败后静默新建 thread，并对外宣称“恢复成功”
6. 在未验证 rollout 文件落盘的情况下直接上传归档

### 7.7.6 面向后续扩展的约束

这套最佳实践只适用于 `Codex`，后续若扩展到其他 executor，必须遵守：

1. 不修改 OpenCode 已验证恢复逻辑
2. 每个 executor 都要先找出其真实状态目录
3. 只有把“真实状态目录”收敛到可归档路径后，才谈 session 级恢复
4. 不允许用“环境变量猜测”替代“真实状态路径验证”

## 8. 恢复状态机

建议 Codex 恢复状态机只保留这几类：

1. `not_needed`
   - 当前仍是原 sandbox，无需恢复
2. `session_restored`
   - 旧 session 恢复成功，允许继续对话
3. `session_restore_failed`
   - 文件可能恢复了，但旧 session 未恢复成功
4. `state_restore_failed`
   - 连文件/state 恢复都失败

注意：

- 不再把 `restored_files_only` 叫“成功”
- 它最多只能作为 `session_restore_failed` 的内部诊断原因之一

## 9. Session / Runtime 数据结构建议

建议在 Codex runtime metadata 中补这些字段：

```ts
runtime: {
  orchestratorSessionId?: string;
  executor?: "codex";
  executorSessionId?: string;
  codexRestoreStatus?: "not_needed" | "session_restored" | "session_restore_failed" | "state_restore_failed";
  codexRestoreAt?: string;
  codexRestoreSourceKey?: string;
  previousExecutorSessionId?: string;
  codexRestoreFailureReason?: string;
}
```

语义：

1. `executorSessionId`
   - 当前确认可继续使用的 Codex session id
2. `previousExecutorSessionId`
   - 本次恢复尝试所使用的旧 session id
3. `codexRestoreStatus`
   - 用于明确表达是否恢复了同一对话上下文

## 10. 恢复流程设计

### 10.1 主路径：恢复同一 session

主路径流程：

1. 当前 session 持有旧 `executorSessionId`
2. 新 sandbox provision 完成
3. `restoreCodexWorkspaceAndState()` 恢复 `workspace + state`
4. `ensureExecutorRuntime(codex)`
5. 调用 `resumeExecutorSession(orchestratorSessionId, executorSessionId, workspacePath)`
6. 若 OSAC 返回 `EXECUTOR_SESSION_READY`
   - 标记 `codexRestoreStatus=session_restored`
   - 保留旧 `executorSessionId`
   - 后续输入继续在原 session 上执行

### 10.2 失败路径：旧 session 恢复失败

如果 `resumeExecutorSession()` 失败：

1. 标记 `codexRestoreStatus=session_restore_failed`
2. 记录失败原因
3. 保留 `previousExecutorSessionId`
4. 当前 runtime 不应继续把旧 `executorSessionId` 当成有效值
5. 前端必须明确提示：
   - 工作区可能已恢复
   - 但旧对话上下文未恢复

重要约束：

1. 这里不能静默改成新 thread 然后继续发送
2. 如果产品需要“允许用户从已恢复文件环境重新开始”，那是后续显式交互，不是自动恢复成功

### 10.3 状态恢复失败

如果 `restoreCodexWorkspaceAndState()` 本身失败：

1. 标记 `codexRestoreStatus=state_restore_failed`
2. 不再尝试 resume 旧 session
3. 前端明确提示当前无法恢复原会话

## 11. 验证方案

后续开发时，必须至少验证这三组场景：

### 11.1 同 sandbox 续聊

1. 不销毁 sandbox
2. 连续两轮输入
3. 旧 `executorSessionId` 持续有效

### 11.2 销毁后恢复同一 session

1. 建立 Codex 会话并产生文件修改
2. 触发 sandbox 归档
3. 销毁 sandbox
4. 重开同一 session
5. 新 sandbox 恢复文件和 state
6. `resumeExecutorSession()` 成功
7. 下一轮输入继续沿用原上下文

### 11.3 销毁后恢复失败

1. 建立 Codex 会话并产生文件修改
2. 归档成功
3. 人为让旧 session resume 失败
4. 重开 session
5. 系统明确返回 `session_restore_failed`
6. 不允许静默新建 thread 冒充恢复成功

## 12. 结论

对 Codex 而言，后续要交付的不是“文件归档恢复能力”，而是：

1. 恢复同一 `executorSessionId`
2. 恢复同一对话上下文
3. 恢复失败时明确失败，而不是静默新建 thread

同时必须坚持：

1. 不修改 OpenCode 已验证恢复逻辑
2. Codex 新建专属恢复流程
3. 所有命名、状态和实现边界都明确标注 `codex`

只有这样，后续 `claudecode` 等执行器扩展时，才不会再次混入 `OpenCode-only` 的历史包袱。
