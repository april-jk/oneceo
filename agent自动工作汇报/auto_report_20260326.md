# 2026-03-26 工作汇报

## 今天做了什么

- 排查了 `npm run dev` / `pnpm --filter api dev` 启动前长时间卡在数据库迁移的问题，确认阻塞点是 API 启动前的 `connectorStorageBootstrap.ensureReady()` 每次都会无条件执行整套 `runMigration()`。
- 复核了 `apps/api/src/db/migrate.ts`，确认迁移里包含 `conversation_messages` 回填、`task_session_recent_messages` 全量重建以及多组索引创建，这些 SQL 不应在每次开发重启时重复执行。
- 已在 `apps/api/src/db/migrate.ts` 新增 schema 探测逻辑，启动时会先检查关键表、列、索引是否齐备。
- 已在 `apps/api/src/services/connector-storage-bootstrap.ts` 改为“schema 已就绪则直接跳过迁移；缺项时才执行迁移”，保留失败后可重试的行为。
- 新增 `apps/api/tests/connector-storage-bootstrap.test.ts`，覆盖“已就绪跳过迁移 / 缺失才迁移 / 首次失败后再次重试”三个分支。
- 同步更新了 `docs/agent研发文档/Altus接管模式参照Suna重构设计/09_实施步骤_风险与验收.md` 与 `docs/agent研发文档/自动化测试流程.md`。

## 遇到什么问题

- 当前仓库 `apps/api` 的全量 `type-check` 仍有一批历史错误，和本次改动无关，不能作为本次修复的通过依据。
- 用户日志里的 `ENETUNREACH` 指向远程 PostgreSQL 网络不可达，这不是迁移策略本身能消除的问题；本次修复解决的是“每次启动都重复全量迁移”造成的额外等待和放大失败窗口。

## 计划如何解决

- 后续如需继续压缩启动耗时，可再基于真实库状态补充 schema 探测日志或启动耗时埋点，但本轮先保持最短路径，不扩大到数据库连接策略重构。
- 如果远程数据库网络不可达仍频繁出现，需要单独排查 `apps/.env` 指向的数据库网络可达性、代理与本地网络策略。

## 新增工作记录：Altus 完成卡片右上角按钮改为部署

- 排查了 `apps/web/client/src/components/AltusArtifactPreviewCard.tsx`，确认完成卡片右上角按钮原先仍绑定 `onOpenViewer`，实际行为是“打开查看器”。
- 已把首页对话流里 `managed_artifact_card` 的该按钮改为“部署”主动作，直接调用现有 `deployTaskCreationSession(sessionId)`。
- 部署成功后会自动切到右侧 `OpencodePreviewPanel` 的 `deployment` tab，复用已有平台部署服务与部署状态面板。
- `AltusRunReplayDrawer` 没有接入该部署动作，保持回放场景下的文件查看语义，避免完成卡片和回放文件动作串位。

## 新增工作记录：连接器设置页统一为目录式入口

- 已按 `docs/agent研发文档/设置-连接器-添加或管理连接器统一设计.md` 开始落代码，把设置页连接器主入口重构为 `应用 / 自定义 API / 自定义 MCP` 三个 tab，并将 `应用` 改为目录态 + 详情态的一体化结构。
- 后端 `apps/api/src/connectors/definitions/*.ts` 已补齐 catalog 元数据字段，当前内置连接器定义统一带上 `category / featured / isNew / sortOrder`，为后续新增连接器提供统一扩展位。
- 前端设置页 `apps/web/client/src/components/ConnectorCenterPanel.tsx` 已改为搜索、推荐区、应用区、profile 选择、OAuth/保存/默认项/删除的统一面板，不再使用旧的左列列表 + 嵌套弹层作为一级入口。
- 会话页 `apps/web/client/src/components/ConnectorDialog.tsx` 已收口为仅消费 `app` 类 catalog 和 profile 挂载，不再承担设置页配置职责。
- 已完成 `pnpm --filter web check` 和连接器相关定向测试；`pnpm --filter api type-check` 仍被仓库内既有历史错误阻塞，本次未继续扩散处理无关模块。

## 新增工作记录：PPT 办公 skill 附件模板

- 复核了当前 skill 链路，确认 `apps/web` 里的“使用技能”目前是生成 `skill brief markdown` 附件，不是直接调用 OSAC 热加载；而 `apps/api/src/services/osac-agent-service.ts` 在 E2B 模式下仍明确不支持 `LOAD_SKILL`。
- 已新增 `docs/agent研发文档/技能附件_PPT办公技能模板设计.md`，说明本轮为什么先沿用 skill 附件链路，并记录外部 presentation skills 的参照点。
- 已将 `AttachmentPickerButton` 中内联的 skill 模板抽到独立模块，新增 `PPT 办公` 模板，便于后续继续补办公类 skills。
- 新的 PPT skill 会要求后续代理按“结论先行、逐页大纲、视觉建议、speaker notes、最终 PPTX 或可导出 slide source”的方式交付。

## 新增工作记录：参照 MiniMax Office skills 扩展办公模板

- 按用户要求参照 `MiniMax-AI/skills` 的 `pptx-generator`、`minimax-docx`、`minimax-xlsx` 三个 Office 相关 skill，对现有模板体系做了二次收敛。
- 已把 Office 模板从单个 `PPT 办公` 扩展为三项：`PPT 办公`、`Word 文档`、`Excel 表格`。
- 改进点不是简单改文案，而是把 MiniMax 里的“任务分流”思路带进模板：PPT 区分 create/edit/read，Word 区分新建/编辑/套模板，Excel 区分分析/新建/编辑/校验。
- 已同步把设计文档升级为 Office 套件视角，并更新前端回归用例，使其按模板源自动校验所有 skill 项是否在菜单中可见。
