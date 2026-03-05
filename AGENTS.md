# AGENTS.md

> 本文件是 `oneceo/` 内的协作入口。新成员请先阅读本文，再按引用文档进行深入理解。

## 必读

- `docs/AGENTS_GUIDE/CODEX_PROMPT.md`
- 仓库根目录 `AGENTS.md`

## 架构导览（分段文档）

- `docs/AGENTS_GUIDE/01_overview.md`
- `docs/AGENTS_GUIDE/02_services.md`
- `docs/AGENTS_GUIDE/03_sandbox_e2b.md`
- `docs/AGENTS_GUIDE/04_agent_flow.md`
- `docs/AGENTS_GUIDE/AGENTS_git协作开发指南.md`
- `docs/AGENTS_GUIDE/AGENT_CODE_MODIFICATION_GUIDE.md`
- `docs/AGENTS_GUIDE/AGENT_USAGE_EXAMPLES.md`
- `docs/AGENTS_GUIDE/agent-code-locations.md`

## 反馈机制（oneceo 内）

- 目录：`agent自动工作汇报`
- 文件命名：
  - `auto_report_yyyymmdd.md`
  - `递归过程记录_yyyymmdd.md`
- 内容要求：简短记录“做了什么、遇到什么、计划如何解决”。

## 代码与服务边界

- 主平台代码：`apps/`
  - Web：`apps/web`
  - API：`apps/api`
  - 管理后台：`apps/admin_management`
- Sandbox 模板：`e2b_templates/`
- 旧 KVM 编排已停用，仅保留文档作为历史参考（见 `docs/legacy/kvm/`）。

## E2B Sandbox 规则（强制）

- 所有 Sandbox 调用必须通过 `apps/api/src/connectors/e2b-connector.ts`。
- `kvm-orchestrator` 暂停使用，不在本分支修改或部署。

## OSAC / OpenCode 规则（强制）

- 与 Sandbox 内服务通信必须经由 OSAC 链路与编排服务，禁止在业务路由直连。
- 相关服务代码集中在 `apps/api/src/services/` 与 `apps/api/src/clients/`。

## LLM 代理规则（强制）

- 统一通过 `apps/api/src/connectors/llm-proxy-connector.ts` 访问上游模型。
- 路由：`apps/api/src/routes/llm-proxy-routes.ts`。

## 变更记录要求

- 任何影响主流程的变更需保留说明性文档（提交记录或 docs 说明）。
- 避免跨系统误改，优先在所属子目录内闭环验证。
