# 20260328 Word / Excel 多阶段协同技能实现与验证

## 1. 实现目标

基于 [20260328_WordExcel多阶段协同技能设计.md](/D:/oneceo-task-creation-agent-fresh/docs/agent研发文档/20260328_WordExcel多阶段协同技能设计.md)，将当前项目的：

- `Word 文档`
- `Excel 表格`

从“增强版 skill brief”升级成“一个主技能，内部多阶段子技能协同”的执行协议。

本轮继续坚持最短路径：

- 不改 UI
- 不改 Office mode 产品入口
- 不新增 connector
- 不更换生成引擎
- 只改 `shared 契约 + skill 模板 + Altus prompt + 测试`

## 2. 实际改动

## 2.1 新增共享 Word / Excel 契约

新增文件：

- [docx-generation.ts](/D:/oneceo-task-creation-agent-fresh/packages/shared/src/docx-generation.ts)
- [xlsx-generation.ts](/D:/oneceo-task-creation-agent-fresh/packages/shared/src/xlsx-generation.ts)

并在 [index.ts](/D:/oneceo-task-creation-agent-fresh/packages/shared/src/index.ts) 中统一导出。

### 2.1.1 Docx 契约内容

包括：

- `DOCX_TASK_PHASES`
- `DOCX_TASK_MODES`
- `DOCX_CONTENT_ARCHETYPES`
- `DOCX_STYLE_PACKS`
- `DOCX_SECTION_TYPES`
- `DOCX_QA_GATE_RULES`
- `DocxGenerationBrief`
- `DocxEvidenceBundle`
- `DocxOutlinePlan`
- `DocxStyleSystem`

### 2.1.2 Xlsx 契约内容

包括：

- `XLSX_TASK_PHASES`
- `XLSX_TASK_MODES`
- `XLSX_CONTENT_ARCHETYPES`
- `XLSX_SHEET_TYPES`
- `XLSX_QA_GATE_RULES`
- `XlsxGenerationBrief`
- `XlsxEvidenceBundle`
- `XlsxWorkbookPlan`
- `XlsxFormulaPlan`

## 2.2 重写 Word / Excel skill 模板

修改文件：

- [skill-attachment-templates.ts](/D:/oneceo-task-creation-agent-fresh/apps/web/client/src/lib/skill-attachment-templates.ts)

### 2.2.1 `Word 文档`

现在已从单体 brief 升级为 6 阶段协同协议：

1. `docx_task_router`
2. `docx_research_curator`
3. `docx_outline_architect`
4. `docx_style_system_designer`
5. `docx_builder`
6. `docx_qa_reviewer`

同时补齐：

- `task_mode`
- `content_archetype`
- `style_pack`
- `sectionType`
- `document_manifest.json`
- Word 专属 QA gate

### 2.2.2 `Excel 表格`

现在已从单体 brief 升级为 6 阶段协同协议：

1. `xlsx_task_router`
2. `xlsx_source_curator`
3. `xlsx_workbook_designer`
4. `xlsx_formula_planner`
5. `xlsx_builder`
6. `xlsx_qa_reviewer`

同时补齐：

- `task_mode`
- `content_archetype`
- `sheetType`
- `Formula-First`
- `workbook_manifest.json`
- Excel 专属 QA gate

## 2.3 升级 Altus managed 的 Word / Excel prompt 协议

修改文件：

- [altus-managed-prompt-service.ts](/D:/oneceo-task-creation-agent-fresh/apps/api/src/services/altus-managed-prompt-service.ts)

新增的核心规则：

- DOCX 必须先选 `taskMode + contentArchetype + stylePack`
- DOCX 必须先形成 `DocxGenerationBrief`
- DOCX 必须先做 `outline`，再写正文
- DOCX 必须写 `document_manifest.json`
- DOCX 必须过 DOCX QA gate 才能 `complete_task`

- XLSX 必须先选 `taskMode + contentArchetype`
- XLSX 必须先形成 `XlsxGenerationBrief`
- XLSX 必须先做 workbook 规划，再写单元格
- XLSX 必须先做 `Formula-First` 公式规划
- XLSX 必须写 `workbook_manifest.json`
- XLSX 必须过 XLSX QA gate 才能 `complete_task`

## 2.4 补充 API prompt 测试

修改文件：

- [altus-managed-prompt-service.test.ts](/D:/oneceo-task-creation-agent-fresh/apps/api/tests/altus-managed-prompt-service.test.ts)

新增测试覆盖：

- DOCX 多阶段协同是否进入 prompt
- DOCX 是否要求 `document_manifest.json`
- DOCX 是否要求 bounded section architecture
- DOCX 是否要求 DOCX QA gate

- XLSX 多阶段协同是否进入 prompt
- XLSX 是否要求 `workbook_manifest.json`
- XLSX 是否要求 `Formula-First`
- XLSX 是否要求 XLSX QA gate

## 3. 实现中的取舍

和 `PPT` 切片一样，本轮也先把 `shared` 契约抽出来，但 `Altus` prompt 服务仍保留了一份本地镜像常量用于稳定运行。

原因不是做兼容补丁，而是当前仓库结构下，先保证：

- 契约被正式抽出
- prompt 规则可立即落地
- 真链路可直接验证

这是当前分支里最短、最稳的实现路径。

## 4. 验证结果

本轮已完成的验证：

- `pnpm --filter @oneceo/shared build`
- `pnpm --filter web check`
- `pnpm --filter api exec node --import tsx --test tests/altus-managed-prompt-service.test.ts`

以及 2 条真实 Office smoke。

### 4.1 Word 多阶段协同 smoke

- session: `f8c2a0bc-59ae-4078-80b7-6d851c90cd4a`
- run: `f90be823-0c02-44cd-ab7e-84f11f1bc864`
- status: `completed`
- deliverable: `ai-resume-coach-business-plan-multiphase.docx`
- size: `45148 bytes`
- tools: `web_search / web_extract / shell_execute / write_file / complete_task`

验证特征：

- 生成的是业务计划书，不是通用报告体
- 包含执行摘要、市场环境、产品方案、商业模式、Go-to-Market、风险与缓释、参考资料
- 文档中保留了 `12` 条来源 URL
- 交付物已正常落库并可下载

清理结果：

- sandbox `ib98ope1naefr83z691vj` 已关闭
- session 已删除

### 4.2 Excel 多阶段协同 smoke

- session: `be68d337-da61-4215-a60a-f9be1b7ded7a`
- run: `a37c68cc-2d6b-4f1d-af55-a235c00362a4`
- status: `completed`
- deliverable: `ai-pm-growth-learning-plan-multiphase.xlsx`
- size: `12126 bytes`
- tools: `web_search / web_extract / shell_execute / write_file / complete_task`

验证特征：

- workbook 包含 `Summary / Phase_Planning / Resource_Tracking / Sources` 4 个 sheet
- `Summary` 页已有公式型统计与进度区
- 已验证多个单元格为 live Excel formulas，而不是硬编码结果
- 已保留来源说明与资源 URL
- 交付物已正常落库并可下载

清理结果：

- sandbox `isunuvtjjnquhpxtwgsc7` 已关闭
- session 已删除

## 5. 验证结论

结论已经比较清楚：

- `Word 文档` 不再只是“写一篇泛化报告”，而是先路由、先大纲、先风格，再交付
- `Excel 表格` 不再只是“拼一张表”，而是先路由、先 workbook、先公式规划，再交付
- `shared` 契约、前端 skill 文本、Altus prompt 和真实 run 已经对齐
- 真链路中 `Word / Excel` 都已成功完成并可下载

## 6. 当前效果

当前 `Word / Excel` 已经完成和 `PPT` 同级别的首版“多阶段协同技能”落地：

- `PPT 办公`
- `Word 文档`
- `Excel 表格`

这三类 Office skill 现在都不再只是单体 prompt brief，而是：

**一个主技能 + 内部阶段化执行协议**

## 7. 下一步建议

如果继续推进，最值得做的是：

1. 让 `Word / Excel` 真实 run 也输出 `document_manifest.json / workbook_manifest.json`
2. 增加更多 archetype 差异化 smoke
3. 再决定是否把这三类 Office skill 继续上升成正式 `office mode`
