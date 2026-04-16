# 20260409 Altus记忆终态重构：DB真相源 + Redis读模型方案 [尚未采用]

- 对应 Issue：#44
- 适用范围：`apps/api`（task-creation / altus managed / sandbox archive 关联链路）
- 目标类型：终态一次性重构（非兼容补丁）

## 1. 目标与约束

### 1.1 目标

- 记忆与会话状态只使用 `DB + Redis`：
  - DB 作为唯一真相源（持久化、审计、恢复依据）。
  - Redis 作为读模型与流式加速层（可失效、可重建）。
- 完全移除本地文件对线上记忆与恢复的参与。
- R2 仅用于 workspace/state 归档恢复与交付物对象存储。

### 1.2 强约束

- 不采用兼容/补丁式双路径长期共存。
- 不引入新业务语义，只做架构收敛。
- Redis 仅在 `ONECEO_REDIS_ENABLED=true` 且 `REDIS_URL` 有效时启用；否则全量回 DB。
- 必须提供显式 Redis 兼容层：未显式启用 Redis 时，线上逻辑不得发起任何 Redis 读写。
- 线上环境必须支持系统环境变量注入：`ONECEO_REDIS_ENABLED` 与 `REDIS_URL` 可仅通过 process env 生效。

## 2. 当前问题（需一次性解决）

- 会话状态有历史本地侧车：`data/task-creation-memory.json`。
- 读路径存在 file/DB/Redis 混合选择，边界不清晰。
- 本地日志与本地记忆在无状态部署下不可持久，不可跨实例一致。

## 3. 终态架构

### 3.1 存储分层

- **PostgreSQL（真相源）**
  - 会话主状态。
  - 全量消息。
  - recent 持久窗口。
  - run 事件。
  - projection outbox。
- **Redis（读模型）**
  - recent messages page。
  - run state / run events stream。
  - workspace 树/文件热点缓存（可选）。
- **R2（对象存储）**
  - sandbox workspace/state 归档与恢复。
  - 交付物对象。

### 3.2 读写原则

- 写路径：`DB事务成功` 是唯一成功标准。
- 缓存更新：由 outbox 异步投影到 Redis。
- 读路径：`Redis -> DB -> 回填Redis`。

### 3.3 Redis 兼容层（无 Redis 模式）

- 模式判定：
  - `redis_enabled`：`ONECEO_REDIS_ENABLED=true` 且 `REDIS_URL` 非空。
  - `no_redis`：除 `redis_enabled` 之外的所有情况（包括只配置 `REDIS_URL` 但未显式开启）。
- `no_redis` 行为：
  - 最近消息、运行状态、工作区缓存全部直读 DB 或直接走既有非 Redis 路径。
  - 所有 Redis 写入变为 no-op。
  - 接口可返回 `cache.source=db_no_redis`（或同等语义字段）便于观测。
- 代码约束：
  - 禁止业务层直接 new Redis 客户端。
  - 统一经 `redis-client-service` 与兼容层 facade 调用，确保模式判定唯一。

### 3.4 环境变量来源与优先级（含线上）

- Redis 开关最终读取来源统一为 `process.env`。
- 线上（容器/平台）要求：
  - 支持仅依赖系统环境变量，不要求 `.env` 文件存在。
  - 若系统环境变量与 `.env` 冲突，系统环境变量优先。
- 本地开发要求：
  - 可使用 `.env` 作为默认值来源。
  - 未显式开启 `ONECEO_REDIS_ENABLED=true` 时仍按 `no_redis` 模式处理。
- 风险控制要求：
  - 禁止在加载 `.env` 时清空或覆盖已经注入的 Redis 相关系统环境变量。
  - 必须修正 `load-env` 实现为“系统变量优先”：
    - 若进程中已存在 Redis 相关系统变量，`.env` 仅补缺、不覆盖。
    - 禁止在 env 加载前清空 Redis 相关系统变量。

### 3.5 Redis 写入单路径约束

- 仅“读模型投影数据”遵循单写路径：`task-session-projection-worker`。
- 现有直接写 Redis 的读模型路径（例如 run/event writer 直接 append stream）必须切换为写 outbox。
- 禁止“outbox 投影 + 直接写 Redis（同一读模型 key）”并存，避免重复事件与顺序竞争。
- 控制面 Redis（如心跳、停止请求、租约）不纳入 outbox，但必须经统一 facade 且在 `no_redis` 下有明确降级语义。

## 4. 数据模型修改（DB）

> 目标：将 file-memory-store 承载的会话关键状态迁入 DB。

### 4.1 扩展 `task_creation_sessions`

新增字段：

- `title text not null default '新建任务会话'`
- `title_locked boolean not null default false`
- `title_source text not null default 'placeholder'`
- `title_resolved_at timestamp null`
- `is_favorite boolean not null default false`
- `project_id text null`
- `project_name text null`
- `share_enabled boolean not null default false`
- `share_token text null`
- `mode text not null default 'altus'`
- `driver text not null default 'altus'`
- `executor text null`
- `codex_execution_mode text null`
- `stage text not null default 'collecting'`
- `phase text not null default 'ideation'`
- `phase_cycle integer not null default 0`
- `runtime_json jsonb not null default '{}'::jsonb`
- `pending_clarification_json jsonb null`
- `pending_resume_json jsonb null`

索引补充：

- `(user_id, updated_at desc)`
- `(user_id, is_favorite, updated_at desc)`
- `(share_enabled, share_token)`

### 4.2 新增 `task_session_projection_outbox`

字段建议：

- `id uuid pk`
- `session_id uuid not null`
- `event_type text not null`
- `payload_json jsonb not null`
- `created_at timestamp not null default now()`
- `processed_at timestamp null`
- `retry_count integer not null default 0`
- `next_retry_at timestamp not null default now()`
- `last_error text null`

索引：

- `processed_at is null`（可用 partial index）
- `(next_retry_at asc)`
- `(session_id, created_at desc)`

## 5. 服务层改造

## 5.1 新建统一服务

新增：`apps/api/src/services/task-session-state-service.ts`

职责：

- 会话状态写入（title/favorite/stage/phase/runtime/pending 等）。
- 消息写入（调用现有 `taskCreationSessionDAO.addMessage(s)`）。
- 在同一事务中写 outbox（仅 `redis_enabled` 模式，用于 Redis 投影）。
- 提供统一读取 DTO（替代 file-memory-store 组装逻辑）。

### 5.2 Redis 投影 Worker

新增：`apps/api/src/services/task-session-projection-worker.ts`

职责：

- 轮询 outbox 未处理事件。
- 更新 Redis recent page / run state / run events。
- 成功标记 `processed_at`；失败指数退避重试。
- 幂等处理：基于 `event_id/message_key/timeline_cursor` 去重。
- 并发消费语义：
  - 多 worker 消费必须使用行级抢占（`FOR UPDATE SKIP LOCKED` 或同等机制）。
  - 同一 session 事件按 `created_at + id` 顺序处理，避免乱序覆盖。
- `no_redis` 模式策略：
  - 不生成 Redis 投影 outbox 事件（固定规则）。
  - 禁止 `no_redis` 下持续累积未处理 outbox。

### 5.3 现有调用点切换

以下模块全部从 `taskCreationFileMemoryStore` 切到 `task-session-state-service`：

- `apps/api/src/routes/task-creation-routes.ts`
- `apps/api/src/services/altus-managed-setup-service.ts`
- `apps/api/src/agents/task-creation/websocket-service.ts`
- `apps/api/src/agents/task-creation/task-creation-service.ts`
- `apps/api/src/services/opencode-remote-service.ts`
- `apps/api/src/services/codex-remote-service.ts`
- `apps/api/src/services/opencode-event-stream-service.ts`
- `apps/api/src/services/direct-mode-deployment-capability-service.ts`
- `apps/api/src/routes/internal-task-creation-routes.ts`
- `apps/api/src/services/altus-managed-run-entry-service.ts`
- `apps/api/src/services/altus-run-coordinator.ts`
- `apps/api/src/services/sandbox-agent-provision-service.ts`
- `apps/api/src/services/sandbox-archive-service.ts`
- `apps/api/src/services/sandbox-skill-sync-service.ts`
- `apps/api/src/services/session-connector-service.ts`
- `apps/api/src/services/session-mcp-recovery-service.ts`
- 其他仍调用 `taskCreationFileMemoryStore` 的路径（以全局检索清零为准）

### 5.4 删除本地文件依赖

- 下线 `apps/api/src/agents/task-creation/file-memory-store.ts` 在线上路径中的所有调用。
- 删除/停止 `data/task-creation-memory.json` 的创建与读取逻辑。
- 侧边接口与聚合函数全部改为 DB 读取。

### 5.5 新增缓存兼容层 Facade

新增：`apps/api/src/services/task-session-cache-facade.ts`

职责：

- 统一提供 `get/set/invalidate` 接口给 routes/services 使用。
- 内部执行 Redis 模式判定；`no_redis` 下保证读返回空、写为 no-op。
- 对外屏蔽 Redis 细节，避免业务代码散落开关判断。

### 5.6 本地文件缓存去依赖

- `task-creation-memory.json`：完全下线线上依赖。
- `task-creation-cache.json`（workspace 本地文件缓存）：线上路径不再作为恢复或正确性来源。
- 本地日志文件（如 connector-debug.log）仅保留调试用途，不参与恢复与状态判断。

## 6. API 行为定义（终态）

### 6.1 会话详情

- 单一来源：DB。
- 返回结构保持与当前前端契约一致（字段不减）。

### 6.2 最近消息

- 先读 Redis recent page。
- miss 或 stale 回 DB `task_session_recent_messages`。
- 回填 Redis。
- stale 判定必须显式化：
  - Redis envelope 至少包含 `latestTimelineCursor`、`latestMessageKey`、`runtimeGeneration`、`cachedAt`。
  - 与 DB 侧轻量游标查询结果对比（同 session 最新 cursor/key/generation）；不一致即判 stale 并回源。

### 6.3 历史消息

- 仅 DB cursor 查询。
- 不依赖 Redis 历史全量存储。

### 6.4 无 Redis 模式接口语义

- `messages/recent`：直接读取 DB recent window，响应标记 `source=recent_db_no_redis`。
- `messages/history`：保持 DB cursor 读取，不受 Redis 开关影响。
- run status/events：优先 DB（或 DB+内存短态），不依赖 Redis stream。
- Redis 模式判定必须同时适配“系统环境变量模式”和“.env 模式”。
- 控制面能力语义需明确：
  - 心跳/停止请求若依赖 Redis，`no_redis` 下必须提供 DB/轮询降级或显式禁用并提示。

## 7. 一次性切换步骤（预上线环境）

1. 提交 DB migration（会话扩展字段 + outbox 表）。
2. 提交历史数据回填脚本：将 `task-creation-memory.json` 的关键会话状态幂等导入 DB 新字段。
3. 落地 `task-session-state-service` 与 `projection-worker`，并收敛 Redis 单写路径到 outbox。
4. 全量替换 `taskCreationFileMemoryStore` 调用点（以全局检索清零为准）。
5. 删除本地记忆文件读写逻辑。
6. 修正 env 加载优先级：`process env > .env`。
7. 完整回归（接口/会话恢复/消息顺序/redis 开关/系统变量优先）。
8. 灰度联调通过后，以同一发布窗口一次性切换。

> 说明：本项目尚未上线，采用“一次性切换”可避免长期双写和语义漂移。

## 8. 测试与验收

### 8.1 功能验收

- 实例重启后，同一 session 在任意实例读到一致状态。
- 最近消息分页顺序稳定，`timelineCursor` 单调。
- 关闭 Redis 后功能正确（仅性能下降）。
- 本地 `data/` 目录为空或缺失时，记忆读取无异常。

### 8.2 自动化测试

- DAO 层：会话状态更新、消息写入、outbox 生成。
- Worker 层：成功投影、失败重试、幂等去重。
- Route 层：session detail/recent/history 一致性。
- E2E：新建任务 -> 执行 -> 续聊 -> 重启后恢复。
- 开关矩阵：
  - `ONECEO_REDIS_ENABLED=true` + `REDIS_URL`：Redis 模式验证。
  - `ONECEO_REDIS_ENABLED=false` 或缺失：无 Redis 模式验证。
  - 仅 `REDIS_URL` 但未显式开启：必须判定为无 Redis 模式。
  - 系统环境变量与 `.env` 同时存在且冲突：必须以系统环境变量为准。
- 投影一致性：
  - 确认 Redis 不存在双写源（禁用历史直接写路径后再验证）。
  - `no_redis` 模式下 outbox 不积压。

### 8.3 性能指标

- `messages/recent`：P95、P99 与命中率。
- DB 回源率。
- outbox 堆积长度与处理延迟。

## 9. 风险与控制

- 风险：调用点遗漏导致部分路径仍读 file-memory。
  - 控制：通过全局检索 `taskCreationFileMemoryStore` 清零。
- 风险：Redis 投影延迟导致 recent 页面短暂旧数据。
  - 控制：读路径允许 DB 回源并回填。
- 风险：迁移字段不完整导致前端字段缺失。
  - 控制：以当前 session DTO 为契约做快照对比测试。

## 10. 实施清单（开发任务拆解）

1. `db/schema.ts` 与 `db/migrate.ts`：新增会话字段与 outbox 表。
2. 新增回填脚本：`file-memory -> DB` 幂等迁移与校验。
3. 新增 `task-session-state-service.ts`。
4. 新增 `task-session-projection-worker.ts`。
5. 新增 `task-session-cache-facade.ts`，落地无 Redis 兼容层。
6. 修改 `task-creation-routes.ts`、`internal-task-creation-routes.ts` 会话读取与写入入口。
7. 修改 `altus-managed-setup-service.ts`、`websocket-service.ts`、`task-creation-service.ts`、`opencode-remote-service.ts`、`codex-remote-service.ts`、`opencode-event-stream-service.ts`、`direct-mode-deployment-capability-service.ts`、`altus-managed-run-entry-service.ts`、`altus-run-coordinator.ts`、`sandbox-agent-provision-service.ts`、`sandbox-archive-service.ts`、`sandbox-skill-sync-service.ts`、`session-connector-service.ts`、`session-mcp-recovery-service.ts`。
8. 收敛读模型 Redis 写入到 outbox 投影，移除历史直接写 Redis 读模型路径。
9. 明确控制面 Redis（心跳/停止请求）在 `no_redis` 下的降级行为并实现。
10. 修正 `load-env`：系统环境变量优先于 `.env`。
11. 清理 `file-memory-store.ts` 与 `task-creation-cache-store` 的线上文件依赖。
12. 新增/更新单元测试、集成测试、回归脚本与压测脚本。

## 11. 结论

在“尚未上线”的前提下，建议直接实施该终态重构：

- 记忆与状态：`DB + Redis`
- 本地文件：不参与线上记忆恢复
- R2：仅工作区/状态归档与对象存储

该路线能以最短路径消除多实例不一致与无状态部署下的持久化风险。
