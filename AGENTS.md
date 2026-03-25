# AGENTS.md

> 本文件是 `oneceo/` 内的协作入口。新成员请先阅读本文，再按引用文档进行深入理解。

## 必读

- `docs/AGENTS_GUIDE/CODEX_PROMPT.md`
- 仓库根目录 `AGENTS.md`
- 如果你认为我的要求不清晰，你需要问清晰后再开始工作。你不能假设我非常清楚自己的需求，你需要从原始需求和问题出发，如果动机和目标不清晰，请停下来和我讨论。
- 如果我明确要求你参照某个项目去实现某个功能，你必须把“参照项目代码”当作直接实现依据，在开发前、开发中、开发完成后多次对照比较，覆盖主流程、关键交互、边界条件、数据结构、接口行为、UI细节和容易被忽略的实现细节，确保高效且高精度复刻，避免在新项目里重复踩参照项目已经解决过的坑。
- 开发新功能时，你需要先到docs目录创建功能的系统文档并按照功能层级设计文档，用户会对你的设计文档审核，只有用户认同开发文档后，才可以在开发文档的基础进行开发。
- 修改功能和修复功能时，需要先检查docs目录是否存在相关的设计文档，并对设计文档进行及时更新。
- 你在通过脚本启动e2b进行测试时，必须对每一次sandbox启动增加对应的关闭行为，避免忘记关闭导致的额外计费。
- 如果用户明确要求写一个todo，你需要在编写开发文档的同时，将todo提取到todos.md ,并在todos.md中注明todo的添加日期和管理的文档，以便对所有todo实现索引。

## 修复和重构方案规范

当需要你给出修复或重构方案时，必须遵循以下规范：

- 不允许给出兼容性或补丁方案
- 不允许过度设计，请保持最短路径实现且不违反第一条原则
- 不允许自行给出需求以外的方案，例如兜底或降级方案，这可能会导致业务逻辑出现偏移的问题
- 必须确保方案的逻辑正确，必须经过全链路的逻辑验证。



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
