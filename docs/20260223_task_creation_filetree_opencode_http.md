# 2026-02-23 内容预览文件树改为 OpenCode HTTP

## 变更摘要
- “内容预览-文件”不再通过 OSAC 执行命令读取文件树/内容。
- oneceo API 通过 OSAC 隧道转发到 OpenCode Server 的 HTTP 接口（`/file`、`/file/content`）获取数据。
- OSAC 仅负责流量转发与 OpenCode Server 运行保障，不参与文件数据处理。

## 背景与问题
- 现有实现依赖 OSAC 运行 Python 扫描目录，容易在连接或执行阻塞时导致前端一直“正在加载文件树”。
- OpenCode Web 已具备稳定的文件树/文件读取接口，复用更可靠。

## 行为调整
- `GET /api/task-creation/sessions/:sessionId/workspace/tree`
  - 先尝试命中缓存；未命中时通过 OSAC 转发调用 OpenCode `/file` 递归构建树。
- `GET /api/task-creation/sessions/:sessionId/workspace/file`
  - 通过 OSAC 转发调用 OpenCode `/file/content` 读取文件内容并按 `maxBytes` 截断。
- 若读取失败，仍可回退到最近一次缓存（stale）。

## OpenCode Server 访问规则
- 编排平台仅与 OSAC 建立连接，由 OSAC 转发至 sandbox 内部的 OpenCode HTTP 端口。
- 编排平台不需要配置 OpenCode Server 的对外访问地址。

## 新增/使用配置
- `OPENCODE_SERVER_ENSURE_ON_READ`：是否在读取文件/树前调用 OSAC 确保 Server 启动（默认 true）。

## 影响范围
- oneceo API: `apps/api/src/routes/task-creation-routes.ts`
- 文档：本记录 + `docs/20260223_workspace_cache.md`

## 验收要点
1. 内容预览-文件 能在有运行中的 OpenCode session 时正常展示树与文件内容。
2. 未命中缓存时仍可快速返回（无 OSAC 命令执行阻塞）。
3. `refresh=1` 仍可绕过缓存读取 OpenCode 最新数据。
