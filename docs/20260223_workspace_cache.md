# 2026-02-23 Workspace Cache

## 目标
- 为编排平台“内容预览-文件”增加缓存层，避免每次直通 sandbox。
- 执行与查看分离：执行仍通过 OSAC，查看优先读缓存。

## 覆盖范围
- `GET /api/task-creation/sessions/:sessionId/workspace/tree`
- `GET /api/task-creation/sessions/:sessionId/workspace/file`

## 数据来源
- 文件树/文件内容通过 OSAC 转发调用 OpenCode Server HTTP 接口获取（`/file`、`/file/content`）。
- OSAC 仅负责流量转发与保证 OpenCode Server 可用，不参与文件数据处理。

## 多租户说明
- 缓存按 `tenantKey + sessionId` 分区。
- `tenantKey` 解析顺序：`X-Tenant-Id` header → `X-User-Id` header → `tenantId` query → `default`。
- OpenCode 事件触发失效时，会清理该 session 在所有 tenant 下的缓存，避免残留。

## 行为说明
- 默认命中缓存：若缓存未过期直接返回。
- `refresh=1` 可强制绕过缓存。
- 当 OSAC 读取失败时，会回退到最近一次缓存（标记为 stale）。
- OpenCode 变更事件触发失效：
  - `file.edited`
  - `file.watcher.updated`
  - `session.diff`
  - `command.executed`
  - toolName: `apply_patch`

## 配置项
- `TASK_CREATION_CACHE_TTL_TREE_MS`（默认 10000）
- `TASK_CREATION_CACHE_TTL_FILE_MS`（默认 60000）
- `TASK_CREATION_CACHE_MAX_FILES`（默认 200）

## 持久化位置
- `oneceo/apps/api/.runtime-cache/task-creation/task-creation-cache.json`
