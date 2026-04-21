# AGENTS.md

> 本文件是 `oneceo/` 内的协作入口。进入仓库后先读这里，再按索引进入对应子文档与设计文档。

## 必读

- `docs/AGENTS_GUIDE/CODEX_PROMPT.md`
- 仓库根目录 `AGENTS.md`
- `codex规范文档架构导览（分段文档）`中的文档是更详细的要求。
- 做git操作前必须从AGENTS.md阅读git相关的指南。
- 如果你认为我的要求不清晰，你需要问清晰后再开始工作。你不能假设我非常清楚自己的需求，你需要从原始需求和问题出发，如果动机和目标不清晰，请停下来和我讨论。
- 如果我明确要求你参照某个项目去实现某个功能，你必须把“参照项目代码”当作直接实现依据，在开发前、开发中、开发完成后多次对照比较，覆盖主流程、关键交互、边界条件、数据结构、接口行为、UI细节和容易被忽略的实现细节，确保高效且高精度复刻，避免在新项目里重复踩参照项目已经解决过的坑。
- 开发新功能时，你需要先到 `docs/` 目录创建功能的系统文档并按照功能层级设计文档，用户会对你的设计文档审核，只有用户认同开发文档后，才可以在开发文档的基础进行开发。
- 修改功能和修复功能时，需要先检查 `docs/` 目录是否存在相关的设计文档，并对设计文档进行及时更新。
- 当需求来源于 issue（无论是修复还是完善）时，要求与“开发新功能/修改与修复功能”完全一致：必须先检查或补齐 `docs/` 设计文档、完成文档评审与状态标记管理，再进入代码实现。
- 任何新建设计文档，在编写初期必须在文档标题后或文件索引名后追加状态标记：`[尚未采用]`。只有当用户明确同意并开始进入代码实现阶段后，才可以更新为：`[yyyymmdd-hhmm已采用]`。
- 如果后续方案被替换、暂停、废弃或重新采用，必须同步更新对应文档标题、README 索引和相关引用中的状态标记；禁止保留无状态标记的方案文档继续留在主目录中。
- 同一主题下，主目录只允许保留当前采用方案和明确带状态标记的候选方案；未采用或废弃文档必须移动到归档目录，或在索引中明确标记为非当前方案。
- 你在通过脚本启动 e2b 进行测试时，必须对每一次 sandbox 启动增加对应的关闭行为，避免忘记关闭导致的额外计费。
- 如果用户明确要求写一个 todo，你需要在编写开发文档的同时，将 todo 提取到 `todos.md`，并在 `todos.md` 中注明 todo 的添加日期和管理的文档，以便对所有 todo 实现索引。

## 修复和重构方案规范

当需要你给出修复或重构方案时，必须遵循以下规范：

- 不允许给出兼容性或补丁方案
- 不允许过度设计，请保持最短路径实现且不违反第一条原则
- 不允许自行给出需求以外的方案，例如兜底或降级方案，这可能会导致业务逻辑出现偏移的问题
- 必须确保方案的逻辑正确，必须经过全链路的逻辑验证

## codex规范文档架构导览（分段文档）

- `docs/AGENTS_GUIDE/01_overview.md`
- `docs/AGENTS_GUIDE/02_services.md`
- `docs/AGENTS_GUIDE/03_sandbox_e2b.md`
- `docs/AGENTS_GUIDE/04_agent_flow.md`
- `docs/AGENTS_GUIDE/05_系统调试与测试指南.md`
- `docs/AGENTS_GUIDE/06_分支与部署环境简要规范.md`
- `docs/AGENTS_GUIDE/AGENTS_git操作与提交指南.md`
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

## Playwright 测试账号约定

- 用户态 Playwright 固定测试账号统一存放在 `apps/web/e2e/playwright-test-account.json`。
- 该文件用于真实业务链路测试（登录、会话创建、部署等），后续测试优先复用，不要随意改名或改路径。
- 如果需要变更测试账号密码，必须同步更新依赖该文件的脚本与测试文档，避免出现“脚本仍用旧密码”的假失败。

## 智能体能力测试题库约定

- 目录：`docs/智能体能力测试题库/`
- 该目录专门用于存放 Altus 与其他智能体能力/效果评估相关的测试问题、题组设计、评分标准与回归记录。
- 执行测试集、专项复测、日常 smoke 回归时，默认先遵循：
  - `docs/智能体能力测试题库/20260420_Altus测试集执行SOP_[20260420-1457已采用].md`
- 新增题库时，优先按能力主题拆分，例如：意图识别、澄清追问、工具选择、执行闭环、修复重试、误调用拦截、多轮连续性。
- 每份题库文档至少写清楚：测试输入、预期行为、禁止行为、验证证据、评分方式。
- 如果该题库文档本身属于正式方案或测试设计文档，仍然需要遵守本文件前文的状态标记规则（`[尚未采用]` / `[yyyymmdd-hhmm已采用]`）。
- 涉及测试集执行的文档、脚本说明、结果回传格式、跑前检查、判分顺序与汇报结构，应与上述 SOP 保持一致；如果 SOP 更新，相关引用与说明也必须同步更新。

## 代码与服务边界

- 主平台代码：`apps/`
  - Web：`apps/web`
  - API：`apps/api`
  - 管理后台：`apps/admin_management`
- Sandbox 模板：`e2b_templates/`
- 旧 KVM 编排已停用为主链执行方案，仅保留文档和后台观测/历史管理能力（见 `docs/legacy/kvm/` 与 `apps/admin_management/server/routes/kvm-routes.ts`）。

## E2B Sandbox 规则（强制）

- 所有主链 Sandbox 调用必须通过 `apps/api/src/connectors/e2b-connector.ts`。
- Sandbox 生命周期、归档、恢复、活跃度、调试信息都应落在 `apps/api/src/services/` 对应服务内闭环。
- `kvm-orchestrator` 暂停作为主执行链路使用，不在本分支修改或部署主流程。

## OSAC / OpenCode / Codex 规则（强制）

- 与 Sandbox 内服务通信必须经由 OSAC 链路与编排服务，禁止在业务路由直连。
- 相关服务代码集中在 `apps/api/src/services/` 与 `apps/api/src/clients/`。
- OSAC 二进制发布与下发以 R2 工件链路为准，不能回退成旧的手工分发方式。
- MCP 恢复、连接器绑定恢复、Skills 同步都必须接入现有恢复链路，不能绕过已有状态表和恢复任务。

## LLM 代理规则（强制）

- 统一通过 `apps/api/src/connectors/llm-proxy-connector.ts` 访问上游模型。
- 路由入口：`apps/api/src/routes/llm-proxy-routes.ts`。
- 任务会话主编排位于 `apps/api/src/agents/task-creation/` 与 `apps/api/src/services/altus-*`、`apps/api/src/services/opencode-*`，不要再按旧文档把主链理解成单纯的三个 HTTP Agent。

## 身份与授权规则（强制）

- 用户态与管理态必须分离：
  - 用户态：`app_users` / `app-auth-*`
  - 管理态：`admin_users` / `admin-auth-*`
- 用户端能力必须绑定真实 `app_users.id`，不能继续依赖匿名 `X-User-Id` 作为长期身份源。
- 会话、Skills、连接器 profile、Altus run、Sandbox 运行时都必须按用户归属隔离。

## Redis 使用规则（强制）

- 只有在环境变量显式配置 `ONECEO_REDIS_ENABLED=true` 且同时提供有效 `REDIS_URL` 时，才允许启用 Redis。
- 只配置 `REDIS_URL` 但未显式开启 `ONECEO_REDIS_ENABLED`，等同于未启用 Redis；主流程必须继续走现有 DB / 内存路径，不能偷偷写入或读取 Redis。
- 生产代码中的 Redis 访问必须统一经过 `apps/api/src/services/redis-client-service.ts`，禁止在业务代码直接创建 `ioredis` 客户端或绕过开关判断。
- 新增任何 Redis 缓存、stream、协调状态时，必须同时验证“显式启用时可用”和“未显式启用时完全不生效”两种行为，避免 DB 与 Redis 混用。

## 变更记录要求

- 任何影响主流程的变更需保留说明性文档（提交记录或 docs 说明）。
- 避免跨系统误改，优先在所属子目录内闭环验证。
- 更新 AGENTS 系列文档时，必须同步清理过期入口、旧接口示例和无效文件路径，避免新成员继续被旧文档误导。
