# 2026-04-25 自动工作汇报

## 网站交付卡片改为 Sandbox 截图快照

- 将网站类完成卡片的主展示从 `workspace/raw` iframe 调整为 sandbox 内真实运行后截图，并把 PNG 上传到 R2 持久化。
- 新增 `task-session-website-preview-snapshot-service`，负责网页类 run 判定、启动命令识别、端口探测、Chromium 截图、R2 上传和历史截图读取。
- 在 Altus managed `complete_task` 收口阶段接入截图快照，快照 metadata 写入 `deliverables_ready`、最终 assistant message 和 run event，前端完成卡片优先展示持久化截图。
- 新增鉴权图片接口 `/api/task-creation/sessions/:sessionId/preview-snapshots/:runId/website.png`，只读取当前 session/run 已登记的截图，不恢复 sandbox、不接受前端传入 storage key。
- 保留 raw HTML 预览作为简单 HTML fallback；复杂网站截图失败时展示占位和源码/打开入口，避免再次展示 CSS/JS 缺失的半坏页面。
- 补充 API 与前端回归测试，验证截图触发条件、metadata 解析、完成卡片快照透传和既有 raw 预览恢复逻辑。
- 继续加固截图快照体验：截图图片加载失败时自动切到占位，不显示破图；R2 历史图片缺失时读取接口返回 404；启动脚本优先选择 `start/dev`，Vite `dev` 默认使用 5173，`preview` 默认使用 4173。
- 修复网站二次修改后的完成态展示：修改类 run 即使没有新的附件或 web artifact 路径，只要后端产出新的 `previewSnapshot`，前端也会重新生成一张新的网站交付卡片，并展示本轮新截图。

## Vercel MCP 工具扩展可行性文档

- 做了什么：按仓库规约先读取入口要求与 Vercel MCP 现状，确认本次需求属于新增能力，先补可行性文档，不进入代码实现。
- 遇到什么：当前工作区已有较多未提交 Vercel 相关改动；`rg` 在当前环境被拒绝执行，已改用 PowerShell 原生命令检索。
- 计划如何解决：已新增 `docs/features/connectors/vercel_mcp_tools_and_git_deployment_extension_feasibility_doc_[尚未采用].md`，等待用户评审后再决定是否进入实现阶段。

## 2026-04-25 Vercel MCP 后端 WebSocket 通路可行性评估

- 做了什么：阅读仓库入口规范、Git 操作指南、Vercel MCP 已采用文档，以及 API 侧 OSAC、connector registry、Vercel bridge、internal Vercel MCP route/service 的现有实现。
- 遇到什么：`rg` 在当前环境被拒绝执行，已改用 PowerShell `Get-ChildItem` 与 `Select-String` 定位相关代码。
- 计划如何解决：已新增候选执行文档 `docs/features/connectors/vercel_mcp_backend_ws_transport_execution_doc_[尚未采用].md`，结论是新增 `backend_rpc` provider transport，经 OSAC WebSocket 反向 RPC 调用后端 Vercel MCP service；待用户审核后再进入代码实现。

## 2026-04-25 OSAC backend_rpc provider 改进方案

- 做了什么：将 OSAC 侧需要新增的 `backend_rpc` provider transport、反向 RPC 协议、pending map、超时错误、状态上报与二进制发布要求整理成独立候选文档。
- 遇到什么：该方案需要改 OSAC agent 二进制，不只是 API 侧代码；当前仓库主要包含 OSAC 发布/下发管理与 API 客户端，OSAC agent 源码需在对应项目中修改。
- 计划如何解决：新增 `docs/features/connectors/osac_backend_mcp_rpc_provider_improvement_doc_[尚未采用].md`，待用户审核后再同步 API 与 OSAC agent 实现。

## 2026-04-25 OSAC v1.1.3 基线文档复核

- 做了什么：根据用户提供的 `D:/Downloads/使用方式文档-交付v1.1.3.md` 与 `D:/Downloads/进度.md` 复核 OSAC 当前能力边界。
- 遇到什么：v1.1.3 当前明确只支持 `local_stdio` 与 `remote_sse`，`backend_rpc` 必须作为新 OSAC 二进制能力发布；OSAC 源码落点应明确到 `OSAC_client/internal/protocol/protocol.go`、`server.go`、`mcp.go`。
- 计划如何解决：已把 v1.1.3 基线事实、源码落点、编译发布约束补入两份 `[尚未采用]` 候选文档。
