# connector / guide / session runtime 多用户隔离校验 [20260403-2028已采用]

## 目标

对 `connector profile`、`connector guide`、`session runtime` 三条链路做同一口径的多用户隔离联调，确保：

1. 授权结果符合当前用户或内部管理边界
2. DB 落点只写入归属正确的 `userId / taskSessionId / profileId`
3. Redis 只在真实存在落点时校验；当前 worktree 无直接 Redis 状态时，必须明确记录“无直接 Redis 状态”

## 当前 worktree 事实

本 worktree 停在较早提交，尚未包含后续 `#10/#11/#12` 中的 Redis 基础层与 run/session cache 代码。因此本次 `#13` 在当前分支中的 Redis 结论必须收紧为：

- `connector profile`：无直接 Redis 状态
- `connector guide`：无直接 Redis 状态
- `session runtime binding / recovery`：无直接 Redis 状态

也就是说，本次不会设计或验证不存在的 Redis key 命名，而是验证这些链路执行前后不会产生额外 Redis 隔离副作用。

## 校验范围

### 1. connector profile

- 个人 profile 的创建、读取、更新、删除必须严格按 `user_connector_profiles.user_id`
- 使用 `profileId` 触发的 session refresh / detach，不允许越权刷新或拆除其他用户 session binding

### 2. connector guide

- `connector_guide_policies / revisions` 是平台级数据，不按 `userId` 分表
- 但 `task_session_connector_guides` 的投影必须严格跟随 `taskSessionId`
- 调试和内部管理入口必须收敛到内部管理边界，不能在未配置内部 token 时裸露

### 3. session runtime

- `task_session_connector_bindings.task_session_id` 必须回到 `task_creation_sessions.user_id`
- attach / detach / recovery 都只能由 session owner 驱动
- recovery 即便通过 `orchestratorSessionId` 进入，也必须回读 `task_creation_sessions.user_id` 再决定后续 profile 权限

## 最短路径实现

### connector profile / runtime

- 保持现有 `sessionConnectorService.assertSessionOwnership(...)`
- 用真实 DB 联调证明：
  - `userA` 不能把 `userB.profileId` 挂到 `userA.sessionId`
  - 失败后 binding 不会被写成跨用户 profile

### connector guide

- 收紧 `internal-connector-guide-routes`
- 当 `ONECEO_INTERNAL_TOKEN` 未配置时直接 `403`
- 配置了 token 后，必须携带正确 `x-oneceo-internal-token` 才能访问

### runtime recovery

- 用真实 DB 预置“session 属于 A，但 binding.profileId 属于 B”的脏数据
- 再走 `reconcileByOrchestratorSessionId`
- 证明恢复链会按 session owner `A` 校验，并把 binding 标记为失败，而不是错误地接受 `B` 的 profile

## 接口与证据矩阵

### connector / runtime

1. `sessionConnectorService.attachConnector(taskSessionId, userId, connectorKey, profileId, ...)`
   - 授权结果：跨用户 `profileId` 必须拒绝
   - DB 证据：`task_session_connector_bindings.profile_id` 保持 owner 自己的 profile
   - Redis：无直接 Redis 状态；执行前后 Redis key 数不增加

2. `sessionConnectorService.reconcileByOrchestratorSessionId(orchestratorSessionId)`
   - 授权结果：按 `task_creation_sessions.user_id` 重新校验
   - DB 证据：跨用户脏 binding 被标成 `failed`
   - Redis：无直接 Redis 状态；执行前后 Redis key 数不增加

### guide

1. `GET /api/internal/connector-guides`
2. `GET /api/internal/connector-guides-debug/sessions/:taskSessionId`
   - 授权结果：未启用内部 token 时 `403`；缺 token 或错误 token 时 `401`
   - DB 证据：不新增或篡改 guide/session binding
   - Redis：无直接 Redis 状态

3. `connectorGuideService.recomputeSessionGuides(taskSessionId)`
   - 授权结果：只由该 `taskSessionId` 已 attached 的 binding 决定
   - DB 证据：`task_session_connector_guides.task_session_id` 只投影当前 session
   - Redis：无直接 Redis 状态；执行前后 Redis key 数不增加

## 过度设计约束

- 不为当前 worktree 不存在的 Redis 基础层补新规范
- 不引入新的 guide 权限模型，只收紧现有 internal token 边界
- 不改 connector guide 的平台级数据模型
- 不引入兼容分支或兜底逻辑

## 验收

### 路由级

- `internal-connector-guide-routes.test.ts`
  - 内部 token 未配置时 `403`
  - token 错误时 `401`
  - token 正确时允许读取 policy / session guides

### 真实 DB 联调

- `connector-guide-runtime-isolation-live.test.ts`
  - `attachConnector` 拒绝跨用户 profile
  - `recomputeSessionGuides` 只投影本 session
  - `reconcileByOrchestratorSessionId` 按 session owner 拒绝 foreign profile
  - Redis `db15` 在整个链路前后保持 `0`
