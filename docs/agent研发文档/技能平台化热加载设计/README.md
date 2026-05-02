# 技能平台化热加载设计

更新时间：2026-05-02

## 当前保留文档

主目录现在只保留当前主线文档和明确带状态标记的候选文档：

1. [12_Suna思路_简单渐进式Skills方案.md](./12_Suna思路_简单渐进式Skills方案.md) `[20260329-1846已采用]`
2. [14_数据库分层渐进式Skills方案.md](./14_数据库分层渐进式Skills方案.md) `[尚未采用]`
3. [15_Altus复合存储渐进式Skills使用方案.md](./15_Altus复合存储渐进式Skills使用方案.md) `[20260329-2248已采用]`
4. [16_管理后台复合存储Skills添加方案.md](./16_管理后台复合存储Skills添加方案.md) `[20260329-2248已采用]`
5. [17_管理后台复合存储Skills文件夹导入方案.md](./17_管理后台复合存储Skills文件夹导入方案.md) `[20260329-2248已采用]`
6. [18_前台用户复合存储Skills处理方案.md](./18_前台用户复合存储Skills处理方案.md) `[20260329-2248已采用]`
7. [19_复合存储渐进式Skills方案.md](./19_复合存储渐进式Skills方案.md) `[20260329-2248已采用]`
8. [20_部署Skill治理与自动加载方案.md](./20_部署Skill治理与自动加载方案.md) `[20260418-2048已采用]`
9. [21_Altus_Skills会话级保持与多轮恢复修复方案_[20260421-0020已采用].md](./21_Altus_Skills会话级保持与多轮恢复修复方案_[20260421-0020已采用].md) `[20260421-0020已采用]` - 会话级 skill 状态与按上下文继续挂载（当前实现先收敛 Altus 直通链路）
10. [28_WordExcel生成Skill产品化质量门方案_[20260502-1500已采用].md](./28_WordExcel生成Skill产品化质量门方案_[20260502-1500已采用].md) `[20260502-1500已采用]` - 将 `office-docx` / `office-xlsx` 从 prompt 约束推进到平台可验证的 manifest 与文件质量门
11. [26_竞品式PPT子任务编排工作流方案_[20260501-1718已采用].md](./26_竞品式PPT子任务编排工作流方案_[20260501-1718已采用].md) `[20260501-1718已采用]` - 复刻竞品 PPT 生成前工作流，改用 managed run 子任务编排，不依赖旧 PPT skill
12. [27_PPT渲染器接入方案_[20260502-1237已采用].md](./27_PPT渲染器接入方案_[20260502-1237已采用].md) `[20260502-1237已采用]` - 在 `ppt-workflow` 产出 `PptRenderInstructionDraft` 后，引入受控 PPTX 渲染器

## 当前主线

当前已实现主线是：

1. [12_Suna思路_简单渐进式Skills方案.md](./12_Suna思路_简单渐进式Skills方案.md)
2. [19_复合存储渐进式Skills方案.md](./19_复合存储渐进式Skills方案.md)
3. [15_Altus复合存储渐进式Skills使用方案.md](./15_Altus复合存储渐进式Skills使用方案.md)
4. [16_管理后台复合存储Skills添加方案.md](./16_管理后台复合存储Skills添加方案.md)
5. [17_管理后台复合存储Skills文件夹导入方案.md](./17_管理后台复合存储Skills文件夹导入方案.md)
6. [18_前台用户复合存储Skills处理方案.md](./18_前台用户复合存储Skills处理方案.md)
7. [21_Altus_Skills会话级保持与多轮恢复修复方案_[20260421-0020已采用].md](./21_Altus_Skills会话级保持与多轮恢复修复方案_[20260421-0020已采用].md)
8. [28_WordExcel生成Skill产品化质量门方案_[20260502-1500已采用].md](./28_WordExcel生成Skill产品化质量门方案_[20260502-1500已采用].md)
9. 旧 PPT 平台 skill 方案已于 `20260501-1703` 归档，当前不再作为主线。
10. [26_竞品式PPT子任务编排工作流方案_[20260501-1718已采用].md](./26_竞品式PPT子任务编排工作流方案_[20260501-1718已采用].md)
11. [27_PPT渲染器接入方案_[20260502-1237已采用].md](./27_PPT渲染器接入方案_[20260502-1237已采用].md)

对应代码主落点：

1. API 数据与聚合：`apps/api/src/db/schema.ts`、`apps/api/src/db/migrate.ts`、`apps/api/src/db/dao/platform-skill.dao.ts`、`apps/api/src/services/platform-skill-service.ts`
2. 用户态 catalog/settings：`apps/api/src/services/user-skill-service.ts`、`apps/api/src/routes/task-creation-routes.ts`
3. managed runtime：`apps/api/src/services/altus-managed-input-service.ts`、`apps/api/src/services/altus-managed-shared.ts`、`apps/api/src/services/altus-managed-prompt-service.ts`、`apps/api/src/services/altus-managed-tool-runtime.ts`、`apps/api/src/services/altus-run-coordinator.ts`、`apps/api/src/services/sandbox-skill-sync-service.ts`
4. Web 前端：`apps/web/client/src/lib/task-creation-client.ts`、`apps/web/client/src/lib/task-attachments.ts`、`apps/web/client/src/components/AttachmentPickerButton.tsx`、`apps/web/client/src/components/UserSkillSettingsPanel.tsx`

## 当前候选方案

尚未采用的新候选方案是：

1. [14_数据库分层渐进式Skills方案.md](./14_数据库分层渐进式Skills方案.md)
2. 其余候选方案已转入实现，不再视为候选。

## 已归档方案

1. [25_平台级PPT生成Skill引入方案_[20260501-1703已归档].md](./archive/20260501_ppt_skill_backup/25_平台级PPT生成Skill引入方案_[20260501-1703已归档].md) `[20260501-1703已归档]` - 旧 `office-ppt` / `magazine-web-ppt` 平台 skill 引入方案，因本轮改为竞品式子任务编排而移出当前主线。
