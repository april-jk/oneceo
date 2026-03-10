# 2026-03-06 文件预览树实时性与渐进式加载修复

## 背景

- 内容预览「文件」标签此前依赖 `/workspace/tree` 一次性返回整棵树。
- 大目录（如 `node_modules`）在上游可能被标记 `ignored`，且全量扫描受 `maxEntries` 截断，导致目录不可见或数据不实时。
- 大量文件一次性下发会造成前端短时渲染脉冲，出现卡顿风险。

## 本次修复

- 新增后端目录分页接口：`GET /api/task-creation/sessions/:sessionId/workspace/dir`
  - 支持 `path`、`cursor`、`limit`。
  - 默认 `includeIgnored=1`，可返回被标记 ignored 的目录项（例如 `node_modules`）。
  - 返回 `hasMore` / `nextCursor`，支持增量加载。
- 前端文件树改为目录级懒加载：
  - 首次仅加载根目录。
  - 展开目录时按需加载其直接子项。
  - 大目录通过“加载更多”分批拉取，避免一次性大数据脉冲。
- 自动刷新策略保持：收到文件相关事件后刷新根目录，并刷新已展开目录，提升实时性。

## 变更文件

- `apps/api/src/routes/task-creation-routes.ts`
- `apps/web/client/src/lib/task-creation-client.ts`
- `apps/web/client/src/components/OpencodePreviewPanel.tsx`

## 验证

- `apps/web` TypeScript 检查通过。
- `opencode-sandbox-direct-ui` 前端回归测试 4 文件 10 用例通过。
- `apps/api` 全量 TypeScript 仍有历史错误（与本次改动无关），未新增本改动对应错误。

## 结果

- `node_modules` 等目录可在文件树中展示。
- 文件树改为渐进式加载，降低大目录加载造成的卡顿与内存压力。
- 文件标签页刷新实时性提升，展开目录后可持续增量加载最新内容。
