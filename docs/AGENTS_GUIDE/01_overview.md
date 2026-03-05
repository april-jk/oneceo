# 01 概览

- 本仓库是 `oneceo.ai` 多项目工作区，核心能力包括：
  - 主平台 Web（用户端）
  - 主平台 API（编排、任务、SSE 转发、E2B Sandbox 管理）
  - 管理后台（会话与审计）
  - Sandbox 模板构建（E2B + n.eko + Playwright MCP）

- 关键目录：
  - `apps/web`：用户端前端
  - `apps/api`：主平台 API
  - `apps/admin_management`：管理后台 Web + API
  - `e2b_templates`：E2B 模板构建与补丁
  - `agentClient_on_KVM`：OSAC 客户端源码（仅用于构建与发布，KVM 已停用）

- 运行方式与端口见 `02_services.md`。
