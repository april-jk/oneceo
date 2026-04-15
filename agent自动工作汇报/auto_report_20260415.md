## 2026-04-15

- 完成 Admin Connector Guide 动态化改造设计文档采用，文档为 `docs/agent研发文档/20260415_Admin连接器Guide动态化改造方案_[20260415-2034已采用].md`
- 排查 `http://localhost:5174/api/connector-guides` 不返回 Slack 的根因，确认问题在于 API 侧 guide policy 初始化与支持范围仍是旧硬编码模型
- 已修改 API `connector-guide-service.ts`，按当前 catalog 中 `visibleInMenu=true && available=true` 的 connector 自动补齐缺失 guide policy，并保留既有 policy 的可见性
- 已修改 Admin `ConnectorGuideManagementSection.tsx`，把候选集合改为“当前可用 catalog 项 + 已存在 policy”动态派生
- 下一步：完成类型检查与接口行为验证，确认 Slack 能进入 `/api/connector-guides` 与管理页候选集合
