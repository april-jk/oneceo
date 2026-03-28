# 20260328 Word / Excel 多阶段协同技能设计

## 1. 背景

当前项目里的 `PPT 办公` 已经进入“一个主技能 + 多阶段子技能协同”的首版落地，真实 smoke 也证明这条路可以显著拉开不同主题的生成结构。

但 `Word 文档` 和 `Excel 表格` 还停留在“增强版 skill brief”阶段，虽然已经具备以下能力：

- 可以联动 `web_search / web_extract`
- 可以生成 `.docx / .xlsx`
- 可以进入 deliverable 下载闭环

仍然存在两个核心问题：

1. 还没有像 `PPT` 一样的显式阶段协同协议
2. 生成策略仍偏平铺直叙，缺少先判型、再定结构、再定风格、最后交付的正式链路

因此，本轮目标不是继续把 `Word / Excel` 的 skill 文案写得更长，而是把它们升级成和 `PPT` 同级别的“主技能统一编排，多个阶段子技能协同工作”。

## 2. 参照项目结论

本轮直接参照 MiniMax `skills` 仓库中的 Office 相关实现：

- [MiniMax minimax-docx/SKILL.md](https://github.com/MiniMax-AI/skills/blob/main/skills/minimax-docx/SKILL.md)
- [MiniMax minimax-docx/references/scenario_a_create.md](https://github.com/MiniMax-AI/skills/blob/main/skills/minimax-docx/references/scenario_a_create.md)
- [MiniMax minimax-docx/references/typography_guide.md](https://github.com/MiniMax-AI/skills/blob/main/skills/minimax-docx/references/typography_guide.md)
- [MiniMax minimax-docx/references/design_principles.md](https://github.com/MiniMax-AI/skills/blob/main/skills/minimax-docx/references/design_principles.md)
- [MiniMax minimax-xlsx/SKILL.md](https://github.com/MiniMax-AI/skills/blob/main/skills/minimax-xlsx/SKILL.md)
- [MiniMax minimax-xlsx/references/create.md](https://github.com/MiniMax-AI/skills/blob/main/skills/minimax-xlsx/references/create.md)

### 2.1 MiniMax 的 Word 不是“统一写报告”

它的核心不是让模型自由写文档，而是先做 pipeline routing：

- `CREATE`
- `FILL-EDIT`
- `FORMAT-APPLY`

然后再根据文档类型继续分流：

- `report`
- `letter`
- `memo`
- `academic`
- `custom`

这意味着它把“这是什么文档”和“应该如何组织它”放在真正写 docx 之前。

### 2.2 MiniMax 的 Word 还把设计规则资产化了

它显式提供：

- typography guide
- design principles
- aesthetic recipe
- validation pipeline

所以它的专业感主要来自：

**先选文档类型 + 先选排版体系 + 再生成正文 + 最后过验证**

### 2.3 MiniMax 的 Excel 不是“写个表格”

它先路由：

- `READ`
- `CREATE`
- `EDIT`
- `FIX`
- `VALIDATE`

同时它把几个关键原则写成硬约束：

- `Formula-First`
- `CREATE -> XML template`
- `EDIT -> unpack/edit/pack`
- `Always produce the output file`
- `Validate before delivery`

这说明它的稳定性来自：

**先判断是读、建、改、修、验哪一类，再选择对应结构和校验方式**

## 3. 问题结论

当前项目里 `Word / Excel` 之所以还没有像 `PPT` 那样“更聪明”，不是因为缺少联网，也不是因为文案不够长，而是因为：

1. 没有像 `PPT` 一样的多阶段子技能协同链路
2. 没有把任务判型、结构决策、风格决策、交付校验拆成正式阶段
3. 没有把 MiniMax 这种“路由 + 设计系统 + 校验 gate”的思想迁移过来

因此，本轮必须把：

- `Word 文档`
- `Excel 表格`

都升级成：

**一个主技能 + 多阶段子技能协同**

## 4. 目标

本轮目标：

- 保持用户侧仍然是一个入口 `Word 文档`
- 保持用户侧仍然是一个入口 `Excel 表格`
- 内部升级为阶段协同链路
- 显式引入文档/工作簿判型、结构策略、风格策略、校验 gate
- 让不同任务类型走明显不同的生成路径

完成后预期效果：

- `商业计划书`、`制度流程`、`会议纪要` 不再写成同一种 Word 报告体
- `预算表`、`学习规划表`、`经营分析表` 不再写成同一种 Excel 表格
- `Word / Excel` 都有“先判型 -> 再规划 -> 再生成 -> 再校验”的稳定链路

## 5. 非目标

本轮不做以下事项：

- 不更换当前 `python-docx / openpyxl or existing workbook path` 所在技术栈
- 不引入新的连接器
- 不改前端 UI 入口
- 不把 `Word / Excel` 从当前 skills 菜单移成 office mode
- 不新增数据库表
- 不做模板市场

本轮只做最短路径：

**先把 Word / Excel 的 skill 与 prompt 升级成多阶段协同协议**

## 6. Word 多阶段协同设计

## 6.1 总体原则

用户看到的仍然是：

- `Word 文档`

内部执行改为 6 个阶段子技能协同：

1. `docx_task_router`
2. `docx_research_curator`
3. `docx_outline_architect`
4. `docx_style_system_designer`
5. `docx_builder`
6. `docx_qa_reviewer`

## 6.2 阶段定义

### 6.2.1 `docx_task_router`

职责：

- 判断任务属于 `create / fill-edit / format-apply`
- 选择唯一 `contentArchetype`
- 判断 audience / goal / tone / evidenceMode
- 决定是否需要联网资料、引用、附录、表格、图片

第一版 `contentArchetype` 限定为：

- `business_plan`
- `formal_report`
- `proposal`
- `policy_process`
- `meeting_memo`
- `research_brief`
- `external_statement`

输出契约：

- `DocxGenerationBrief`

至少包含：

- `artifactType`
- `taskMode`
- `contentArchetype`
- `audience`
- `goal`
- `tone`
- `structureStrategy`
- `evidenceMode`
- `requiresWebResearch`
- `requiresAppendix`
- `requiresTables`

### 6.2.2 `docx_research_curator`

职责：

- 在确有需要时做一轮受控检索
- 提炼事实、数据、案例、政策口径、引用依据
- 只保留真正进入正文或附录的资料

约束：

- 默认一轮 focused `web_search`
- 默认一轮 targeted `web_extract`
- 不允许无限补资料
- 只保留可直接支撑文档结论的来源

输出契约：

- `DocxEvidenceBundle`

至少包含：

- `factHighlights`
- `policyOrMarketReferences`
- `caseHighlights`
- `sourceUrls`

### 6.2.3 `docx_outline_architect`

职责：

- 先规划章节树，再写正文
- 根据 `contentArchetype` 决定 section order
- 决定摘要、结论、附录、行动项是否出现

约束：

- 不同 archetype 不允许复用同一份章节顺序
- `business_plan` 必须偏商业逻辑和增长路径
- `policy_process` 必须偏职责、步骤、边界和例外
- `meeting_memo` 必须偏结论、行动项、责任人与时间点

输出契约：

- `DocxOutlinePlan`

至少包含：

- `sections[]`
- 每节包含：
  - `index`
  - `sectionType`
  - `title`
  - `corePurpose`
  - `evidenceNeed`

### 6.2.4 `docx_style_system_designer`

职责：

- 选择统一文风、标题层级、字号和留白
- 约束整份文档的语气与版式

直接借鉴 MiniMax 的 typography/design principles，但第一版收敛成有限集合：

- `formal_executive`
- `proposal_professional`
- `policy_precise`
- `research_structured`

并固定：

- `fontPairing`
- `headingScale`
- `bodyScale`
- `lineSpacing`
- `paragraphSpacing`
- `marginProfile`

输出契约：

- `DocxStyleSystem`

### 6.2.5 `docx_builder`

职责：

- 按 `DocxGenerationBrief + DocxEvidenceBundle + DocxOutlinePlan + DocxStyleSystem` 生成 `.docx`
- 如需引用或附录，写入文档尾部或说明区

实现约束：

- 保持当前项目现有可用的 docx 路线
- 不在 builder 阶段重新决定内容结构
- 先定结构和文风，再写正文

额外输出：

- `document_manifest.json`

记录：

- 文档章节数
- 章节类型
- archetype
- style pack
- 是否使用外部来源
- 是否包含附录 / 表格 / 行动项

### 6.2.6 `docx_qa_reviewer`

职责：

- 校验文档结构是否符合 archetype
- 校验标题层级和语气是否统一
- 校验外部来源是否保留
- 校验最终交付路径

第一版 QA gate 强制检查：

1. 最终 `.docx` 存在
2. 标题层级清晰
3. 章节顺序与 archetype 匹配
4. 如使用外部资料，必须保留 `sourceUrls`
5. 不允许整份文档退化成通用报告体
6. 不允许明显占位文本、空节、伪完成结尾

## 7. Excel 多阶段协同设计

## 7.1 总体原则

用户看到的仍然是：

- `Excel 表格`

内部执行改为 6 个阶段子技能协同：

1. `xlsx_task_router`
2. `xlsx_source_curator`
3. `xlsx_workbook_designer`
4. `xlsx_formula_planner`
5. `xlsx_builder`
6. `xlsx_qa_reviewer`

## 7.2 阶段定义

### 7.2.1 `xlsx_task_router`

职责：

- 判断任务属于 `read / create / edit / fix / validate`
- 识别这是预算、学习规划、经营分析、项目排期、数据汇总还是录入表
- 判断是否需要公式、图表、来源 sheet、原始数据 sheet

第一版 `contentArchetype` 限定为：

- `budget_tracker`
- `learning_plan`
- `business_analysis`
- `project_tracker`
- `data_summary`
- `input_form`

输出契约：

- `XlsxGenerationBrief`

至少包含：

- `artifactType`
- `taskMode`
- `contentArchetype`
- `goal`
- `sheetStrategy`
- `requiresWebResearch`
- `requiresSourceSheet`
- `requiresRawDataSheet`
- `requiresCharts`
- `requiresFormulas`

### 7.2.2 `xlsx_source_curator`

职责：

- 在需要时检索公开数据、学习资源、行业基准或来源说明
- 收敛成可进入 workbook 的最小来源集合

约束：

- 默认一轮 focused `web_search`
- 默认一轮 targeted `web_extract`
- 不允许无限补数
- 只保留真正进入 sheet 或来源说明区的数据

输出契约：

- `XlsxEvidenceBundle`

至少包含：

- `sourceUrls`
- `dataPoints`
- `referenceLabels`
- `unitsAndDateNotes`

### 7.2.3 `xlsx_workbook_designer`

职责：

- 先规划 workbook 再写单元格
- 决定 sheet 名称、顺序、用途
- 决定哪些是输入区、公式区、汇总区、来源区

约束：

- 不同 archetype 不允许复用同一份 sheet 结构
- `budget_tracker` 必须有输入、汇总、总计逻辑
- `learning_plan` 必须有阶段规划和资源/来源说明
- `business_analysis` 必须有指标区和汇总/解释区

输出契约：

- `XlsxWorkbookPlan`

至少包含：

- `sheets[]`
- 每个 sheet 包含：
  - `name`
  - `purpose`
  - `columns`
  - `formulaZones`
  - `chartNeed`

### 7.2.4 `xlsx_formula_planner`

职责：

- 在真正写 workbook 前确定公式策略
- 明确哪些值是输入，哪些值必须是 live Excel formulas
- 决定汇总、占比、增长率、总计等写法

直接借鉴 MiniMax `Formula-First` 思想：

- 每个派生值尽量用 Excel 公式，而不是硬编码结果
- 外部来源数据需要保留单位、日期、口径
- 新建工作簿优先按结构规划书写，而不是先填值再补公式

输出契约：

- `XlsxFormulaPlan`

至少包含：

- `formulaRules`
- `calculatedColumns`
- `totalRows`
- `numberFormats`

### 7.2.5 `xlsx_builder`

职责：

- 按 `XlsxGenerationBrief + XlsxEvidenceBundle + XlsxWorkbookPlan + XlsxFormulaPlan` 生成 `.xlsx`
- 如有需要写入 `sources` / `raw_data` / `notes`

实现约束：

- 保持当前项目现有 workbook 生成路线
- 不在 builder 阶段重新决定 sheet 结构
- 先定 workbook，再落单元格

额外输出：

- `workbook_manifest.json`

记录：

- sheet 列表
- archetype
- taskMode
- 是否使用公式
- 是否包含 source/raw_data/chart

### 7.2.6 `xlsx_qa_reviewer`

职责：

- 校验 workbook 结构完整性
- 校验关键数值优先公式化
- 校验来源信息是否保留
- 校验最终交付路径

第一版 QA gate 强制检查：

1. 最终 `.xlsx` 存在
2. workbook / sheet 结构完整
3. 关键派生值优先公式化
4. 如使用外部数据，必须保留 `sourceUrls`
5. 如任务要求来源说明，必须存在 `sources`、`raw_data` 或说明区
6. 不允许只交付一个无结构的平铺数据页冒充完成

## 8. 协同顺序

### 8.1 Word 固定顺序

1. `docx_task_router`
2. `docx_research_curator`
3. `docx_outline_architect`
4. `docx_style_system_designer`
5. `docx_builder`
6. `docx_qa_reviewer`

### 8.2 Excel 固定顺序

1. `xlsx_task_router`
2. `xlsx_source_curator`
3. `xlsx_workbook_designer`
4. `xlsx_formula_planner`
5. `xlsx_builder`
6. `xlsx_qa_reviewer`

不允许跳过前面阶段直接生成最终文件。

## 9. 代码修改范围

进入实现时，最短修改范围控制在：

- `apps/web/client/src/lib/skill-attachment-templates.ts`
- `apps/api/src/services/altus-managed-prompt-service.ts`
- `apps/api/tests/altus-managed-prompt-service.test.ts`

必要时新增：

- `packages/shared/src/docx-generation.ts`
- `packages/shared/src/xlsx-generation.ts`
- `packages/shared/src/index.ts`

其中：

- `skill-attachment-templates.ts` 负责高层主技能协议
- `altus-managed-prompt-service.ts` 负责把阶段协同真正灌进 managed run
- shared 文件负责收敛常量和阶段契约

## 10. 实现路径

最短正确路径如下：

1. 抽出 Word / Excel 阶段、archetype、style pack、QA gate 常量
2. 重写 `Word 文档` 和 `Excel 表格` skill brief，使其显式要求按阶段推进
3. 重写 Altus 的 Word / Excel prompt 协议，使其先完成判型和规划，再生成文件
4. 增加 Word / Excel 对应的 QA gate 规则
5. 用真实 smoke 验证不同 archetype 是否已经拉开

## 11. 验证方式

### 11.1 Word

至少验证 3 条：

1. `商业计划书 DOCX`
2. `会议纪要 DOCX`
3. `制度流程 DOCX`

验证项：

- 三条任务结构明显不同
- 文风和章节顺序明显不同
- 如使用外部资料，来源得到保留
- 最终 `.docx` 可下载

### 11.2 Excel

至少验证 3 条：

1. `预算跟踪 XLSX`
2. `学习规划 XLSX`
3. `经营分析 XLSX`

验证项：

- 三条任务 sheet 结构明显不同
- workbook 不再退化成单页平铺表
- 派生值优先公式化
- 如使用外部数据，来源得到保留
- 最终 `.xlsx` 可下载

## 12. 风险与取舍

### 12.1 为什么不直接做很多独立 skills

因为那会导致：

- 用户学习成本变高
- 风格容易打架
- 调度轮次变长
- 结果更不稳定

所以正确做法不是“用户手动选多个 Word / Excel skills”，而是：

**一个主技能，内部多个阶段子技能协同**

### 12.2 为什么不直接照搬 MiniMax 的底层实现

因为本项目当前已围绕现有 `docx / xlsx deliverable pipeline` 形成闭环。

本轮最短正确路径是借鉴：

- 路由
- 设计资产
- 验证 gate

而不是直接迁移它的底层 OpenXML / XML 模板实现栈。

## 13. 下一步

如果这份设计确认通过，下一步直接进入实现：

1. 抽出 Word / Excel 协同契约
2. 重写 `Word 文档` 和 `Excel 表格` skill
3. 重写 Altus managed 的 Word / Excel prompt 协议
4. 进行至少 6 条真实 smoke 回归

## 14. 当前状态

本设计已进入首版实现，实施记录见：

- [20260328_WordExcel多阶段协同技能实现与验证.md](/D:/oneceo-task-creation-agent-fresh/docs/agent研发文档/20260328_WordExcel多阶段协同技能实现与验证.md)
