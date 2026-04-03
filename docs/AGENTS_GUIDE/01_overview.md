# 01 概览

本仓库当前不是早期“CEO / Manager / Employee 三个独立 HTTP Agent Demo”，而是已经演进为以任务会话为中心的多入口编排系统。

## 当前主线能力

- 用户端 Web
  - 路径：`apps/web`
  - 负责登录注册、任务会话、工作区预览、附件、连接器中心、技能设置、交付物查看
- 主平台 API
  - 路径：`apps/api`
  - 负责认证、任务会话、Altus managed run、OSAC、Sandbox、连接器、平台 Skills、LLM 代理、部署与数据库能力
- 管理后台
  - 路径：`apps/admin_management`
  - 负责管理员登录、会话观察、技能管理、连接器 Guide、OSAC 版本发布、Sandbox 观测
- Sandbox 模板与补丁
  - 路径：`e2b_templates`
  - 负责 E2B 模板构建、n.eko / Playwright / OpenCode 相关运行环境

## 当前系统形态

- 用户身份
  - 用户端与管理端是两套身份体系
  - 用户态通过 `apps/api/src/routes/auth-routes.ts`
  - 管理态通过 `apps/api/src/routes/internal-admin-auth-routes.ts` 和 `apps/admin_management/server/routes/admin-auth-routes.ts`
- 任务会话
  - 主入口是 `apps/api/src/routes/task-creation-routes.ts`
  - 会话包含 title、status、stage、phase、runtime、deliverables、workspace、deployment 等数据面
- 执行模式
  - Sandbox / OpenCode / Codex / ClaudeCode 直通链路
  - Altus managed run 链路
  - OSAC + MCP + Skills + 连接器恢复链路
- 存储与恢复
  - 会话状态、消息、run、连接器绑定、MCP 恢复任务在 API 侧持久化
  - OSAC 工件发布走 Cloudflare R2
  - Sandbox 支持 archive / restore

## 关键目录

- `apps/web/client/src`
  - 用户端 React 页面、hooks、api client
- `apps/api/src/routes`
  - 所有对外与内部 API 入口
- `apps/api/src/agents/task-creation`
  - 任务创建三层 Agent、状态存储、WebSocket 服务
- `apps/api/src/services`
  - Altus managed、OSAC、OpenCode、Sandbox、连接器、Skills、认证、部署、恢复等主服务
- `apps/admin_management/server`
  - 管理后台 API
- `apps/admin_management/web/src`
  - 管理后台前端

## 当前推荐事实来源

- 结构与流程：`docs/agent研发文档/当前agent架构.md`
- 身份体系：`docs/agent研发文档/20260402_用户身份认证与后台管理设计/README.md`
- 用户隔离：`docs/agent研发文档/20260402_多用户隔离模型与标识边界设计_[20260402-1106已采用].md`
- OSAC 工件：`docs/agent研发文档/20260401_OSAC二进制改为Cloudflare_R2下发设计_[20260401-2220已采用].md`
- 连接器与隐式 Skills：`docs/agent研发文档/20260401_连接器隐式Skills挂载与后台管理设计_[20260401-1037已采用].md`
- Redis 规范：`docs/agent研发文档/20260402_Redis_key_stream_TTL统一规范_[20260402-2250已采用].md`
