# Todo 清单

> 本文件汇总所有待办事项，按添加日期和管理文档索引。

---

## 2026-05-18

### 对话管理与智能体管理整合

- [ ] 编写前端代码：视图切换器 + 阶段 Tab 条 + 运营概览视图
  - 管理文档：`docs/UIUX文档/admin_management控制台重构/20260518_对话管理与智能体管理整合方案_[尚未采用].md`
  - 修改文件：`apps/admin_management/web/src/App.tsx`
- [ ] 编写前端代码：删除侧边栏 agent 导航项和 `AgentManagementOverview` 相关代码
  - 管理文档：`docs/UIUX文档/admin_management控制台重构/20260518_对话管理与智能体管理整合方案_[尚未采用].md`
  - 修改文件：`apps/admin_management/web/src/App.tsx`, `src/types.ts`, `src/api.ts`
- [ ] 编写后端代码：删除 `AgentManagementService` 和 `agent-management-routes.ts`
  - 管理文档：`docs/UIUX文档/admin_management控制台重构/20260518_对话管理与智能体管理整合方案_[尚未采用].md`
  - 修改文件：`apps/admin_management/server/services/agent-management-service.ts`, `server/routes/agent-management-routes.ts`, `server/index.ts`
- [ ] 验证所有从其他模块跳转到对话的链接正常工作
  - 管理文档：`docs/UIUX文档/admin_management控制台重构/20260518_对话管理与智能体管理整合方案_[尚未采用].md`
- [ ] 验证阶段 Tab 过滤逻辑正确
  - 管理文档：`docs/UIUX文档/admin_management控制台重构/20260518_对话管理与智能体管理整合方案_[尚未采用].md`
- [ ] 验证运营概览数据正确
  - 管理文档：`docs/UIUX文档/admin_management控制台重构/20260518_对话管理与智能体管理整合方案_[尚未采用].md`
