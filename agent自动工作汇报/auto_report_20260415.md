# 2026-04-15 自动工作汇报

## 本次完成

- 新增管理后台 `app_user` 用户管理工作台，与对话管理、Sandbox 管理同级，覆盖列表、筛选、详情抽屉和用户状态操作。
- 打通 `app_users -> app_user_sessions -> task_creation_sessions -> sandbox_execution_environments` 的归属查询链路，后台可直接看到用户、会话、对话和 Sandbox 的关联关系。
- 新增内部管理接口与 admin_management BFF，支持用户列表、用户详情、启用/禁用、强制下线。
- 完成设计文档落盘、截图归档和 HTML 工作报告输出。

## 核心实现

- API：新增 `admin-app-user-service` 与 `internal-admin-app-user-routes`，聚合用户活跃度、会话、对话、Sandbox 与归属异常数据。
- 后台 BFF：新增 `user-management-service` 与 `user-management-routes`，把 API 能力透传给管理前端。
- 前端：新增 `UserManagementSection`，提供概览卡片、筛选栏、用户列表、详情抽屉与会话治理操作。
- 设计文档：补充 `docs/UIUX文档/admin_management控制台重构/20260415_用户管理工作台方案_[20260415-0943已采用].md` 并更新方案索引。

## 验证

- `apps/api`: `npm exec -- tsx --test tests/internal-admin-app-user-routes.test.ts` 通过。
- `apps/admin_management`: `npm run type-check` 通过。
- `apps/admin_management`: `npm run build` 通过。
- Playwright 实测打开管理后台“用户管理”，确认真实数据可见，详情抽屉可正常打开。

## 已知说明

- `apps/api`: `npm run type-check` 仍受当前仓库已有工作区依赖解析问题影响，报 `@oneceo/shared` 无法解析；这不是本轮新增逻辑引入的问题。

## 输出

- HTML 报告：`agent自动工作汇报/admin_management_user_report_20260415.html`
- 截图目录：`agent自动工作汇报/assets/`

## 同日补充记录

- 完成 Admin Connector Guide 动态化改造设计文档采用，文档为 `docs/agent研发文档/20260415_Admin连接器Guide动态化改造方案_[20260415-2034已采用].md`
- 排查 `http://localhost:5174/api/connector-guides` 不返回 Slack 的根因，确认问题在于 API 侧 guide policy 初始化与支持范围仍是旧硬编码模型
- 已修改 API `connector-guide-service.ts`，按当前 catalog 中 `visibleInMenu=true && available=true` 的 connector 自动补齐缺失 guide policy，并保留既有 policy 的可见性
- 已修改 Admin `ConnectorGuideManagementSection.tsx`，把候选集合改为“当前可用 catalog 项 + 已存在 policy”动态派生
- 下一步：完成类型检查与接口行为验证，确认 Slack 能进入 `/api/connector-guides` 与管理页候选集合
