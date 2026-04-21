# 01 Altus多级记忆系统升级方案 [尚未采用]

- 适用范围：`apps/api` 中 Altus managed run、task session、sandbox archive / restore 主链
- 当前目标：在不引入 API 侧本地持久化的前提下，为 Altus 建立可恢复、可加速、可在 sandbox 中运行的多级记忆系统
- 当前状态：设计评审稿，未开始代码实施

---

## 1. 目标与边界

### 1.1 目标

为 Altus 建立一套明确的多级记忆体系，满足以下要求：

1. 用户刷新页面、API 重启、sandbox 意外丢失后，Altus 仍能恢复到相对新的会话记忆
2. 模型每轮不只依赖最近消息，还能读取结构化的“会话事实 / 用户约束 / 当前计划 / 交付上下文 / 运行经验”
3. 记忆在运行期可以先落到 sandbox 文件里高频更新，再按触发条件回写到 DB
4. Redis 只承担热缓存与读加速，不承担唯一持久职责
5. 方案必须能复用我们已经为 skills 做出的 `DB + Redis + sandbox 文件 + archive` 这条链路，而不是另起一套

### 1.2 明确边界

本方案只覆盖：

1. **Altus managed run 会话级记忆**
2. **Altus 在 sandbox 中运行时的工作记忆**
3. **sandbox 归档恢复后的记忆回灌**

本方案不覆盖：

1. 跨用户的长期画像系统
2. 独立的向量检索/知识库
3. OpenCode / Codex / ClaudeCode 直通模式的全面记忆重构
4. 以 API 侧本地文件替代 DB 的任何方案

---

## 2. 现状检查结论

基于当前代码，Altus 已经具备“多层状态”的雏形，但还没有形成统一的 Altus 记忆系统。

### 2.1 已存在的层

#### A. DB 持久层

当前已有：

1. `task_creation_sessions`
2. `task_creation_messages`
3. `task_session_runs`
4. `task_creation_sessions.metadata_json.sessionSkillState`

这说明：

- 会话主状态、消息、run 事件已经能持久化
- skills 会话记忆已经开始写入 DB
- 但 **Altus 通用记忆** 还没有统一结构

#### B. Redis 热层

当前已有：

1. recent messages page
2. history cursor
3. workspace dir/tree/file cache
4. session events
5. Altus run state
6. Altus run recovery snapshot
7. skill session state cache

这说明：

- Redis 已经承担读加速和短窗口恢复
- 但 **Altus 通用记忆** 尚未进入 Redis 热层

#### C. Sandbox 文件层

当前已有：

1. skills 的 sandbox 文件记忆：
   - `.oneceo/session-memory/skills-memory.json`
2. sandbox archive / restore 已接入 skills 文件回写 DB

这说明：

- 我们已经证明“sandbox 文件副本 + 回写 DB”在技能记忆上可行
- 但 Altus 的任务记忆、计划记忆、交付上下文记忆还没有落到同类文件

#### D. Archive / Restore 层

当前已有：

1. workspace/state 归档到 R2
2. restore 后会恢复 sandbox 内文件
3. restore / archive 时已开始触发 skills memory flush

这说明：

- sandbox 内文件记忆可以随工作区一并归档
- 但 Altus 通用记忆还没有定义自己的文件格式与恢复优先级

### 2.2 当前主要缺口

1. Altus 没有一个统一的 `altusMemory` 结构
2. 记忆事实散落在 recent messages、session metadata、run 状态、sandbox 工作区、skills 状态里
3. 模型每轮提示词没有稳定读取“结构化会话记忆”的入口
4. sandbox 中虽然可以有文件记忆，但目前只有 skills 在使用
5. API 侧仍大量依赖 `file-memory-store.ts` 做会话运行态投影，但这不是无状态部署下可接受的 durable memory

结论：

**当前系统不是“没有记忆”，而是“有多层状态，但没有统一的 Altus 多级记忆模型”。**

---

## 3. 目标架构

## 3.1 Altus 多级记忆分层

### Level 0：当轮瞬时记忆

定义：

- 当前用户输入
- 最近一批消息
- 当前 run 的工具调用上下文
- 当前轮临时推理需要的 scratch data

特征：

- 只在本轮执行中使用
- 不直接持久化
- 随 run 结束自然消失

定位：

- `AltusRunCoordinator`
- prompt assembling
- tool runtime 当前上下文

### Level 1：会话结构化记忆（DB 真相源）

定义：

- 当前会话已经确认的结构化事实

建议结构：

```json
{
  "version": 1,
  "summary": {
    "taskGoal": "",
    "currentPlan": [],
    "latestOutcome": "",
    "openQuestions": []
  },
  "constraints": {
    "product": [],
    "technical": [],
    "delivery": []
  },
  "preferences": {
    "style": [],
    "interaction": [],
    "tooling": []
  },
  "artifacts": {
    "primaryOutputs": [],
    "workspaceHighlights": [],
    "deliverableHints": []
  },
  "runtimeNotes": {
    "toolLearnings": [],
    "deploymentFacts": [],
    "testFindings": []
  },
  "updatedAt": "",
  "lastWriter": ""
}
```

存储位置建议：

- `task_creation_sessions.metadata_json.altusMemory`

原因：

1. 当前 `sessionSkillState` 已经走同一模式
2. 这一版目标是最短路径接入，不额外引入新的 memory table
3. 结构化记忆应保持小而稳定，适合放在 session metadata 中

约束：

1. 保持 compact，不能把完整消息历史塞进去
2. 只存“结构化事实”，不存全量聊天原文
3. 目标大小控制在 16KB 到 64KB 内

### Level 2：Redis 热记忆

定义：

- DB 中 `altusMemory` 的热缓存副本

作用：

1. Altus 每轮启动时低延迟读取
2. 刷新页面时为 recent + memory 联合查询提速
3. 作为 sandbox 回灌前的快速读取来源

建议 key：

- `task-session:cache:altus-memory`

缓存内容：

```json
{
  "memory": { "...": "..." },
  "version": 12,
  "updatedAt": "2026-04-21T12:00:00.000Z"
}
```

原则：

1. Redis miss 时直接回 DB
2. Redis 永远不能先于 DB 成为写入成功标准
3. `ONECEO_REDIS_ENABLED=false` 时完全 no-op

### Level 3：Sandbox 运行记忆文件

定义：

- Altus 在 sandbox 内运行时可直接读写的工作记忆副本

建议路径：

- `.oneceo/session-memory/altus-memory.json`

建议内容：

```json
{
  "version": 1,
  "sessionId": "",
  "snapshotVersion": 12,
  "updatedAt": "",
  "summary": {},
  "constraints": {},
  "preferences": {},
  "artifacts": {},
  "runtimeNotes": {},
  "dirty": true
}
```

作用：

1. 模型 / 工具在 sandbox 内可以高频更新
2. 避免每次微小变化都直接打 DB
3. 随 workspace/state 一并归档

原则：

1. sandbox 文件不是唯一真相源
2. 仅在 sandbox 存活期间可视为“最新工作副本”
3. 离开 sandbox 之后，必须通过回写进入 DB 才算 durable

### Level 4：Archive 恢复副本

定义：

- sandbox 工作区归档中的 `altus-memory.json`

作用：

1. sandbox 异常丢失后恢复最近一次未回写前的工作记忆
2. 在 DB 版本较旧时，作为恢复候选

原则：

1. archive 仍不是唯一真相源
2. archive 只承担“恢复候选副本”
3. restore 后必须重新执行“DB / archive / sandbox”版本对齐

---

## 4. 统一职责划分

### 4.1 DB

负责：

1. 会话 durable memory
2. 结构化事实最终版本
3. 版本号与时间戳
4. 审计与恢复基线

### 4.2 Redis

负责：

1. 读取加速
2. 热缓存
3. API 和 run 启动时的低延迟读

### 4.3 Sandbox 文件

负责：

1. 运行时高频更新
2. 工具调用后的即时记录
3. 未回写前的 working copy

### 4.4 Archive

负责：

1. sandbox 意外丢失后的副本恢复
2. 把 sandbox working copy 带入下一代 sandbox

### 4.5 API 侧 file-memory-store

结论必须明确：

**`apps/api/src/agents/task-creation/file-memory-store.ts` 不属于新的 Altus 多级记忆层。**

原因：

1. 它位于 API 本地文件系统
2. 无状态部署下不可依赖
3. 目前仍承担历史运行态投影职责，但不应继续扩张为新记忆系统的正式层

---

## 5. 写入与回写策略

## 5.1 写入主原则

1. 结构化 durable memory 只以 DB 成功为准
2. sandbox 文件可先于 DB 更新，但必须在触发点回写
3. Redis 只在 DB 写入成功后更新或失效

## 5.2 sandbox 文件更新时机

以下场景允许更新 `.oneceo/session-memory/altus-memory.json`：

1. Altus 识别出新的明确任务目标
2. Altus 输出新的执行计划
3. 工具产生了新的关键事实
4. 测试/部署/交付结果发生变化
5. 用户在多轮澄清中补充新的稳定约束

## 5.3 回写 DB 触发点

为避免“变更即回写”过于频繁，本方案采用**触发式 + 节流式回写**：

### 强制回写

1. `waiting_user`
2. `completed`
3. `failed`
4. `stopped`
5. `archive`
6. `restore` 后对齐完成

### 节流回写

当 sandbox 仍在长时间运行时，允许增加：

1. dirty 且距离上次回写超过 `N` 分钟
2. dirty 且累计关键变更次数超过 `K`

建议默认：

- `N = 3~5 分钟`
- `K = 5`

这样可以避免：

1. 每次工具回包都打 DB
2. sandbox 突然死亡时丢掉整轮会话中后段记忆

## 5.4 版本对齐规则

需要引入统一版本号：

1. `dbVersion`
2. `redisVersion`
3. `sandboxSnapshotVersion`

合并原则：

1. 正常读：
   - 优先 DB
   - Redis 仅作为 DB 的加速副本
2. live sandbox flush：
   - 若 sandbox snapshotVersion > dbVersion，则允许写回 DB
3. restore 后：
   - 若 archive/sandbox 文件版本 > DB，则按 merge 规则写回 DB
   - 若 DB >= sandbox 文件，则用 DB 重写 sandbox 文件

---

## 6. 模型使用方式

Altus 每轮启动时，不应只把 recent messages 拼给模型，而应统一组装：

1. recent messages
2. `altusMemory.summary`
3. `altusMemory.constraints`
4. `altusMemory.preferences`
5. `altusMemory.runtimeNotes`
6. `sessionSkillState`

推荐顺序：

1. recent messages 继续保留原始上下文
2. structured memory 作为 system/context block 注入
3. sandbox 文件作为工具/运行态的本地读写副本

这样做的效果：

1. 长对话不会完全依赖 recent message window
2. 用户已确认的事实不会因为消息窗口裁剪丢失
3. 技能记忆与 Altus 任务记忆可以并行工作，而不是互相覆盖

---

## 7. 量身定做的最短路径实施方案

为了贴合当前仓库现状，建议不要一次性重写所有 session state，而是只新增一条 **Altus memory 主链**：

### 第一步：定义 Altus memory schema

新增：

- `metadata_json.altusMemory`

不新增独立表。

### 第二步：新增统一服务

建议新增：

- `apps/api/src/services/task-session-altus-memory-service.ts`

职责：

1. 读取 DB memory
2. 读取 Redis memory
3. 将 DB memory 写入 sandbox 文件
4. 从 sandbox 文件 flush 回 DB
5. 控制版本号、dirty 状态、回写节流

### 第三步：接入 Altus run 启动

接入点：

1. `altus-managed-run-entry-service.ts`
2. `altus-run-coordinator.ts`

启动时：

1. 先取 DB memory
2. 若 Redis 可用则读热缓存
3. 将最终 memory 注入 prompt
4. 将 durable memory 写入 sandbox `altus-memory.json`

### 第四步：接入运行期回写

接入点：

1. run waiting_user
2. run completed
3. run failed
4. run stopped
5. sandbox archive / restore

### 第五步：接入部分关键工具

优先接入：

1. 部署工具
2. 测试工具
3. 交付物工具
4. 计划/澄清结果写入

原因：

- 这四类是最容易形成稳定“会话事实”的来源

---

## 8. 不合理方案排除

### 8.1 直接把 API 本地 file-memory-store 当多级记忆一层

不允许。

原因：

1. 与“API 服务无状态”约束冲突
2. 跨实例不一致
3. 不能作为 durable memory 依赖

### 8.2 每次变更都立即回写 DB

不建议。

原因：

1. DB IO 过高
2. 工具高频回包时会造成无意义写放大
3. 容易引入更多竞态

### 8.3 完全只靠 sandbox 文件，不做 DB 结构化记忆

不允许。

原因：

1. sandbox 非持久
2. 丢 sandbox 即丢记忆
3. 页面刷新/API 重启无法恢复

### 8.4 一上来做跨用户长期画像记忆

当前不做。

原因：

1. 范围过大
2. 当前核心问题是 **会话级 Altus 记忆连续性**
3. 先把 session-scoped memory 做稳定，再考虑 user-scoped memory

---

## 9. 验收标准

实施后至少应满足：

1. Altus 连续多轮对话后，即使 recent messages 窗口裁剪，仍能保留关键任务目标与约束
2. API 重启后，新 run 能恢复上次 durable memory
3. sandbox 意外丢失后，新 sandbox 能恢复最近一次 archive/flush 前后的记忆
4. `ONECEO_REDIS_ENABLED=false` 时，系统仍能依赖 DB + sandbox 文件工作
5. 记忆更新不会因高频工具回包导致 DB 被持续打爆

---

## 10. 当前建议结论

针对当前 oneceo 项目，Altus 多级记忆系统的最合适定义是：

1. **DB durable memory**：唯一真相源
2. **Redis hot memory**：加速层
3. **sandbox altus-memory.json**：运行态工作副本
4. **archive snapshot**：恢复候选副本

并且要明确：

**API 本地 file-memory-store 不进入这个正式分层。**

这是当前最贴合你们部署约束、现有代码路径和最近 skills 改造方式的方案。
