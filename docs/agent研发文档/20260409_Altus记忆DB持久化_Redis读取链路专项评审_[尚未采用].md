# 20260409 Altus记忆DB持久化+Redis读取链路专项评审 [尚未采用]

## 1. 目标与范围

本方案只讨论一种路线：

- 记忆与消息以数据库为唯一持久化真相源（Source of Truth）。
- Redis 仅作为读取加速层与短期状态层。
- 不改变业务语义，不引入文件作为恢复依赖。

适用范围：

- 会话详情读取。
- 最近消息首屏加载。
- 运行中增量消息流（SSE/WS 对应的最近窗口读取）。

不在本次范围：

- 工作区文件归档（仍走 R2）。
- 连接器原始调试日志的最终治理形态（另行文档化）。

## 2. 设计原则

- 单一真相源：DB 是唯一 authoritative state。
- 缓存可丢失：Redis 失效不影响正确性，只影响性能。
- 写后可读一致优先：写入成功后，Redis 以异步快速更新；读取允许短时间回源 DB。
- 开关可控：仅在 `ONECEO_REDIS_ENABLED=true` 且 `REDIS_URL` 有效时启用 Redis 路径。

## 3. 目标数据面

### 3.1 DB 持久化层（保持主存）

- `conversation_messages`：全量会话消息。
- `task_session_recent_messages`：最近窗口的持久化快照。
- `task_session_run_events`：run 事件序列。

### 3.2 Redis 加速层（读取导向）

- recent-messages page cache：首屏最近消息分页。
- run state / run events stream：运行态快速读。
- workspace/read cache（已有路径按开关可选）。

说明：Redis key 命名、TTL、stream 长度应严格沿用现有统一规范，避免再次分叉。

## 4. 读写时序（建议）

### 4.1 写消息时序

1. API/服务先写入 DB（事务内完成 message + recent window 维护）。
2. DB 提交成功后，异步刷新 Redis 对应 session 的 recent page。
3. 刷新 Redis 失败只记告警，不回滚 DB。

语义：以“写 DB 成功”为唯一成功标准。

### 4.2 读最近消息时序

1. 先尝试 Redis recent page。
2. miss 或 stale 时回源 DB（`task_session_recent_messages`，必要时回退全量 message 表）。
3. 将回源结果回填 Redis。

语义：Redis 是性能层，不是正确性层。

### 4.3 读完整历史时序

1. 直接从 DB 历史表按 `timelineCursor` 读取。
2. Redis 不做全量历史真相存储，仅做最近窗口和热点页。

## 5. 一致性与失效策略

### 5.1 一致性锚点

- `timelineCursor`：消息顺序锚点。
- `messageKey`：幂等去重锚点。
- `runtimeGeneration`：运行代际锚点。

### 5.2 Redis TTL 与失效

- recent page TTL：短 TTL（例如分钟级），结合写后主动刷新。
- run state TTL：按运行状态动态续期，终态后缩短生命周期。
- 发生会话归档/恢复、runtime 绑定变更时，按 session 维度执行精准失效。

### 5.3 故障语义

- Redis 故障：自动回退 DB 读路径，系统可用但延迟上升。
- DB 故障：请求失败（不可将 Redis 作为“最终一致主存”替代）。

## 6. 与当前实现的差异点

- 当前存在 `task-creation-memory.json` 侧车会话态；本方案要求逐步去侧车化。
- 当前本地 `connector-debug.log` 仅本机可见；本方案不把它纳入恢复链路。
- 当前已有部分 Redis 缓存能力；本方案将其明确为“统一读加速层”，并以 DB 语义兜底。

## 7. 与“全文件主存”方案对比

| 维度 | DB主存+Redis读加速 | 全文件主存 |
|---|---|---|
| 无状态部署适配 | 高 | 低 |
| 多实例一致性 | 高（依赖DB事务） | 低（依赖共享盘与锁） |
| 故障恢复 | 标准化（DB+R2） | 易受节点影响 |
| 查询与审计 | 强 | 弱 |
| 运维复杂度 | 中 | 中到高（规模化后） |
| 长期可维护性 | 高 | 低 |

结论：对 oneceo 当前架构，优先选择 DB 主存 + Redis 读加速。

## 8. 分阶段落地建议（仅评审，不改代码）

### Phase 1：读路径收敛

- 明确所有 recent/history 读取优先级：Redis -> DB。
- 清点并统一 Redis key 与 TTL 策略。

### Phase 2：侧车去依赖

- 将 `task-creation-memory.json` 承载的关键会话元数据映射到 DB。
- 文件保留为调试镜像，不参与线上恢复判断。

### Phase 3：可观测性补齐

- 指标：Redis 命中率、DB 回源耗时、消息顺序一致性异常数。
- 告警：Redis 连续失败降级、recent 快照与历史游标不一致。

## 9. 验收标准

- 任意实例重启后，历史会话读取一致。
- Redis 关闭后功能正确，仅性能下降。
- 压测下 recent 接口 P95/P99 显著优于 DB 直读基线。

## 10. 评审结论

该方案可行，且与当前系统演进方向一致。建议作为“记忆读取链路”默认路线推进。

