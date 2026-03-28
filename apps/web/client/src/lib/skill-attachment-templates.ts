export type SkillAttachmentTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
};

const PPT_PHASE_SKILLS = [
  'ppt_task_router',
  'ppt_research_curator',
  'ppt_storyboard_designer',
  'ppt_visual_system_designer',
  'ppt_builder',
  'ppt_qa_reviewer',
] as const;

const PPT_CONTENT_ARCHETYPES = [
  'pitch_deck',
  'consulting_report',
  'roadmap_plan',
  'training_material',
  'proposal_solution',
  'research_summary',
  'product_story',
] as const;

const PPT_STYLE_PACKS = [
  'consulting_clean',
  'executive_formal',
  'vision_bold',
  'training_friendly',
] as const;

const PPT_PAGE_TYPES = ['cover', 'toc', 'section_divider', 'content', 'summary'] as const;

const PPT_CONTENT_SUBTYPES = [
  'text_enhanced',
  'mixed_media',
  'data_viz',
  'comparison',
  'timeline_process',
  'image_showcase',
] as const;

const PPT_PALETTE_KEYS = [
  'business_authority',
  'vibrant_tech',
  'education_charts',
  'forest_eco',
  'luxury_mysterious',
  'platinum_white_gold',
] as const;

const PPT_STYLE_RECIPES = ['sharp', 'soft', 'rounded', 'pill'] as const;

const PPT_FONT_PAIRINGS = ['yahei_arial', 'yahei_calibri', 'yahei_cambria'] as const;

const PPT_QA_GATES = [
  'final_pptx_exists',
  'has_cover_page',
  'has_summary_page',
  'has_at_least_two_non_text_content_pages',
  'has_at_least_two_content_subtypes',
  'no_three_repeated_layouts_in_a_row',
  'preserve_source_urls_when_external_sources_are_used',
  'no_placeholders_or_empty_template_pages',
] as const;

const DOCX_PHASE_SKILLS = [
  'docx_task_router',
  'docx_research_curator',
  'docx_outline_architect',
  'docx_style_system_designer',
  'docx_builder',
  'docx_qa_reviewer',
] as const;

const DOCX_TASK_MODES = ['create', 'fill_edit', 'format_apply'] as const;

const DOCX_CONTENT_ARCHETYPES = [
  'business_plan',
  'formal_report',
  'proposal',
  'policy_process',
  'meeting_memo',
  'research_brief',
  'external_statement',
] as const;

const DOCX_STYLE_PACKS = [
  'formal_executive',
  'proposal_professional',
  'policy_precise',
  'research_structured',
] as const;

const DOCX_SECTION_TYPES = [
  'title_block',
  'executive_summary',
  'context_problem',
  'analysis_argument',
  'plan_recommendation',
  'process_policy',
  'action_items',
  'appendix_references',
] as const;

const DOCX_QA_GATES = [
  'final_docx_exists',
  'has_clear_heading_hierarchy',
  'section_order_matches_archetype',
  'preserve_source_urls_when_external_sources_are_used',
  'avoid_generic_report_structure_for_every_document',
  'no_placeholders_or_empty_sections',
] as const;

const XLSX_PHASE_SKILLS = [
  'xlsx_task_router',
  'xlsx_source_curator',
  'xlsx_workbook_designer',
  'xlsx_formula_planner',
  'xlsx_builder',
  'xlsx_qa_reviewer',
] as const;

const XLSX_TASK_MODES = ['read', 'create', 'edit', 'fix', 'validate'] as const;

const XLSX_CONTENT_ARCHETYPES = [
  'budget_tracker',
  'learning_plan',
  'business_analysis',
  'project_tracker',
  'data_summary',
  'input_form',
] as const;

const XLSX_SHEET_TYPES = [
  'inputs',
  'calculations',
  'summary',
  'dashboard',
  'sources',
  'raw_data',
  'notes',
] as const;

const XLSX_QA_GATES = [
  'final_xlsx_exists',
  'workbook_structure_is_complete',
  'derived_values_prefer_live_excel_formulas',
  'preserve_source_urls_when_external_sources_are_used',
  'include_sources_or_raw_data_when_required',
  'avoid_delivering_a_single_flat_sheet_as_finished_output',
] as const;

function formatCodeList(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

export const SKILL_ATTACHMENT_TEMPLATES: SkillAttachmentTemplate[] = [
  {
    id: 'requirements-breakdown',
    name: '需求拆解',
    description: '把目标整理成范围、约束和交付项',
    content: [
      '# Skill Brief: 需求拆解',
      '',
      '请先完成以下分析：',
      '- 明确用户目标和核心场景。',
      '- 列出功能范围、非目标和关键约束。',
      '- 输出可执行的交付清单与优先级。',
    ].join('\n'),
  },
  {
    id: 'implementation-plan',
    name: '实现方案',
    description: '整理技术栈、模块划分和实施顺序',
    content: [
      '# Skill Brief: 实现方案',
      '',
      '请基于当前需求给出实现方案：',
      '- 推荐合适的技术栈和数据存储。',
      '- 拆分核心模块、接口和边界。',
      '- 给出从 MVP 到完善版本的实施步骤。',
    ].join('\n'),
  },
  {
    id: 'test-checklist',
    name: '测试清单',
    description: '补齐关键测试点和验收标准',
    content: [
      '# Skill Brief: 测试清单',
      '',
      '请围绕当前任务补充测试视角：',
      '- 核心功能用例。',
      '- 边界条件与异常处理。',
      '- 最小验收标准与回归范围。',
    ].join('\n'),
  },
  {
    id: 'office-ppt',
    name: 'PPT 办公',
    description: '创建、改写或重组可直接交付的专业演示文稿',
    content: [
      '# Skill Brief: PPT 办公演示文稿生成',
      '',
      '请以专业演示设计师、内容策略顾问和商务沟通专家的标准完成当前任务，并直接推进到可交付结果。',
      '',
      '## 总原则',
      '- 不要把 PPT 任务当成“一段长 prompt 直接生成成品”，而要按固定阶段协同推进。',
      `- 六个内部阶段必须按固定顺序执行：${formatCodeList(PPT_PHASE_SKILLS)}。`,
      '- 不允许跳过前面的结构和视觉决策，直接开始写最终页面。',
      '',
      '## 阶段 1：任务判型 `ppt_task_router`',
      `- 在真正生成 PPT 之前，先选择唯一 \`content_archetype\`：${formatCodeList(PPT_CONTENT_ARCHETYPES)}。`,
      '- 同时判断 audience、goal、tone、structureStrategy、visualGoal、evidenceMode。',
      '- 形成内部 `PptGenerationBrief`，至少包含：artifactType、contentArchetype、audience、goal、tone、structureStrategy、visualGoal、evidenceMode、requiresWebResearch、requiresImages、requiresCharts。',
      '- 不同 archetype 必须带来不同结构。职业规划、商业路演、培训课件、方案建议和研究总结不能继续套同一份默认目录。',
      '',
      '## 阶段 2：资料整理 `ppt_research_curator`',
      '- 如任务明显需要事实、案例、数据或图片，先做一轮受控检索，而不是无限搜索。',
      '- 默认一轮 focused `web_search` + 一轮 targeted `web_extract`。',
      '- 最多保留 3 张真正会进入 deck 的候选图片。',
      '- 形成内部 `PptEvidenceBundle`，至少包含：factHighlights、caseHighlights、candidateImages、chartCandidates、sourceUrls。',
      '',
      '## 阶段 3：故事板设计 `ppt_storyboard_designer`',
      `- 页面主类型只从以下集合中选择：${formatCodeList(PPT_PAGE_TYPES)}。`,
      `- 内容页子类型只从以下集合中选择：${formatCodeList(PPT_CONTENT_SUBTYPES)}。`,
      '- 每页都要明确：index、pageType、contentSubtype、title、coreMessage、visualNeed、sourceRefs。',
      '- 先规划 deck，再写逐页内容，不要反过来。',
      '',
      '## 阶段 4：视觉系统 `ppt_visual_system_designer`',
      `- 先选一个 \`style_pack\`：${formatCodeList(PPT_STYLE_PACKS)}。`,
      `- 再选一个 \`paletteKey\`：${formatCodeList(PPT_PALETTE_KEYS)}。`,
      `- 再选一个 \`styleRecipe\`：${formatCodeList(PPT_STYLE_RECIPES)}。`,
      `- 再选一个 \`fontPairing\`：${formatCodeList(PPT_FONT_PAIRINGS)}。`,
      '- 颜色、留白、装饰、图文比例和图表形式都要随 visual system 一起变化。',
      '',
      '## 阶段 5：文件生成 `ppt_builder`',
      '- 只有在 generation brief、evidence bundle、storyboard 和 visual system 都明确后，才开始生成 `.pptx`。',
      '- 如使用 `python-pptx`，优先使用稳定导入：`Presentation`、`Inches`、`Pt`；需要颜色时用 `RGBColor`。',
      '- 生成时同时写一个 `presentation_manifest.json`，记录 slide 数量、pageType、contentSubtype、是否使用图片/图表、是否保留来源、palette、style recipe。',
      '',
      '## 阶段 6：质量校验 `ppt_qa_reviewer`',
      `- 在 \`complete_task\` 之前，必须通过以下 QA gate：${formatCodeList(PPT_QA_GATES)}。`,
      '- 不允许整份 deck 退化成重复的标题加 bullet 页面。',
      '- 至少要有真实封面页、真实收尾页，以及两页以上非纯文字内容页。',
      '',
      '## 交付要求',
      '- 最终产物优先生成可直接交付的 `.pptx`。',
      '- 如使用外部资料，必须保留来源 URL，可放在 speaker notes、附录页或验证说明中。',
      '- 当 `.pptx` 已生成且完成一次验证后，立即将其作为最终交付物完成。',
    ].join('\n'),
  },
  {
    id: 'office-docx',
    name: 'Word 文档',
    description: '创建、改写或重组可直接交付的正式办公文档',
    content: [
      '# Skill Brief: Word 办公文档生成与编辑',
      '',
      '请以专业办公文档作者、编辑和内容策略顾问的标准完成当前任务，并直接推进到可交付结果。',
      '',
      '## 总原则',
      '- 不要把 Word 任务当成“统一写一份报告”，而要按固定阶段协同推进。',
      `- 六个内部阶段必须按固定顺序执行：${formatCodeList(DOCX_PHASE_SKILLS)}。`,
      '- 先判定任务模式、文档原型和结构策略，再写正文和生成 `.docx`。',
      '',
      '## 阶段 1：任务判型 `docx_task_router`',
      `- 先选择唯一 \`task_mode\`：${formatCodeList(DOCX_TASK_MODES)}。`,
      `- 再选择唯一 \`content_archetype\`：${formatCodeList(DOCX_CONTENT_ARCHETYPES)}。`,
      '- 同时判断 audience、goal、tone、structureStrategy、evidenceMode。',
      '- 形成内部 `DocxGenerationBrief`，至少包含：artifactType、taskMode、contentArchetype、audience、goal、tone、structureStrategy、evidenceMode、requiresWebResearch、requiresAppendix、requiresTables。',
      '- 商业计划书、正式报告、方案建议、制度流程、会议纪要、研究简报和对外声明必须走不同结构，不允许继续套同一份通用报告体。',
      '',
      '## 阶段 2：资料整理 `docx_research_curator`',
      '- 如任务依赖事实、政策、市场、案例或引用依据，先做一轮受控检索。',
      '- 默认一轮 focused `web_search` + 一轮 targeted `web_extract`。',
      '- 只保留真正进入正文、附录或引用说明的来源。',
      '- 形成内部 `DocxEvidenceBundle`，至少包含：factHighlights、policyOrMarketReferences、caseHighlights、sourceUrls。',
      '',
      '## 阶段 3：大纲设计 `docx_outline_architect`',
      `- 章节类型优先从以下集合中组合：${formatCodeList(DOCX_SECTION_TYPES)}。`,
      '- 先规划章节树，再写正文。',
      '- 每节都要明确：index、sectionType、title、corePurpose、evidenceNeed。',
      '- `business_plan` 应偏商业逻辑、市场机会、模式、风险与实施路径。',
      '- `policy_process` 应偏职责、步骤、边界、例外与执行要求。',
      '- `meeting_memo` 应偏结论、行动项、责任人与时间点。',
      '',
      '## 阶段 4：风格系统 `docx_style_system_designer`',
      `- 风格包只从以下集合中选择：${formatCodeList(DOCX_STYLE_PACKS)}。`,
      '- 明确文风、标题层级、字号、段落节奏、留白和页边距策略。',
      '- 不同 style pack 必须带来明显不同的标题层级、段落密度和论证方式。',
      '',
      '## 阶段 5：文件生成 `docx_builder`',
      '- 只有在 generation brief、evidence bundle、outline 和 style system 都明确后，才开始生成 `.docx`。',
      '- 生成时同时写一个 `document_manifest.json`，记录章节数量、章节类型、archetype、style pack、是否使用外部来源、是否包含附录 / 表格 / 行动项。',
      '- builder 阶段不再重新决定章节结构，只负责落正文和交付文件。',
      '',
      '## 阶段 6：质量校验 `docx_qa_reviewer`',
      `- 在 \`complete_task\` 之前，必须通过以下 QA gate：${formatCodeList(DOCX_QA_GATES)}。`,
      '- 标题层级必须清晰，章节顺序必须与 archetype 匹配。',
      '- 如使用外部资料，必须保留来源 URL，可放在参考资料、附录、脚注式说明或验证说明中。',
      '- 不允许把所有文档都写成同一种空泛正式报告。',
      '',
      '## 交付要求',
      '- 最终产物优先生成可直接交付的 `.docx`。',
      '- 当 `.docx` 已生成且完成一次结构或文件验证后，立即将其作为最终交付物完成。',
    ].join('\n'),
  },
  {
    id: 'office-xlsx',
    name: 'Excel 表格',
    description: '创建、分析、改写或校验可直接交付的工作簿与数据表',
    content: [
      '# Skill Brief: Excel 表格生成、分析与编辑',
      '',
      '请以专业办公数据分析与工作簿设计者的标准完成当前任务，并直接推进到可交付结果。',
      '',
      '## 总原则',
      '- 不要把 Excel 任务当成“写一张表”，而要按固定阶段协同推进。',
      `- 六个内部阶段必须按固定顺序执行：${formatCodeList(XLSX_PHASE_SKILLS)}。`,
      '- 先判定任务模式、工作簿结构和公式策略，再生成 `.xlsx`。',
      '',
      '## 阶段 1：任务判型 `xlsx_task_router`',
      `- 先选择唯一 \`task_mode\`：${formatCodeList(XLSX_TASK_MODES)}。`,
      `- 再选择唯一 \`content_archetype\`：${formatCodeList(XLSX_CONTENT_ARCHETYPES)}。`,
      '- 形成内部 `XlsxGenerationBrief`，至少包含：artifactType、taskMode、contentArchetype、goal、sheetStrategy、requiresWebResearch、requiresSourceSheet、requiresRawDataSheet、requiresCharts、requiresFormulas。',
      '- 预算跟踪、学习规划、经营分析、项目跟踪、数据汇总和录入表不能继续复用同一份 workbook 结构。',
      '',
      '## 阶段 2：来源整理 `xlsx_source_curator`',
      '- 如任务依赖公开数据、行业口径、学习资源、基准指标或来源说明，先做一轮受控检索。',
      '- 默认一轮 focused `web_search` + 一轮 targeted `web_extract`。',
      '- 只保留真正进入 workbook 的数据点、来源 URL、日期和单位说明。',
      '- 形成内部 `XlsxEvidenceBundle`，至少包含：sourceUrls、dataPoints、referenceLabels、unitsAndDateNotes。',
      '',
      '## 阶段 3：工作簿设计 `xlsx_workbook_designer`',
      `- sheet 类型优先从以下集合中组合：${formatCodeList(XLSX_SHEET_TYPES)}。`,
      '- 先规划 workbook，再写单元格。',
      '- 每个 sheet 都要明确 name、purpose、columns、formulaZones、chartNeed。',
      '- `budget_tracker` 应有输入区、汇总区和总计逻辑。',
      '- `learning_plan` 应有阶段规划、资源清单和来源说明。',
      '- `business_analysis` 应有指标区、汇总区和解释区。',
      '',
      '## 阶段 4：公式策略 `xlsx_formula_planner`',
      '- 采用 Formula-First 原则：派生值优先写成 Excel 公式，而不是硬编码结果。',
      '- 明确哪些列是输入、哪些列是公式、哪些行是总计、哪些格式是金额 / 百分比 / 日期。',
      '- 如任务要求图表、同比、占比、总计或增长率，先确定公式与图表策略，再生成文件。',
      '',
      '## 阶段 5：文件生成 `xlsx_builder`',
      '- 只有在 generation brief、evidence bundle、workbook plan 和 formula plan 都明确后，才开始生成 `.xlsx`。',
      '- 如使用外部资料，优先写入 `sources`、`raw_data` 或说明区域。',
      '- 生成时同时写一个 `workbook_manifest.json`，记录 sheet 列表、archetype、taskMode、是否使用公式、是否包含 source / raw_data / chart。',
      '',
      '## 阶段 6：质量校验 `xlsx_qa_reviewer`',
      `- 在 \`complete_task\` 之前，必须通过以下 QA gate：${formatCodeList(XLSX_QA_GATES)}。`,
      '- 不允许只交付一张无结构的平铺数据页冒充完成。',
      '- 如使用外部数据，必须保留来源 URL、日期、单位和口径说明。',
      '- 关键派生值应优先公式化，而不是硬编码结果。',
      '',
      '## 交付要求',
      '- 最终产物优先生成可直接交付的 `.xlsx`。',
      '- 当 `.xlsx` 已生成且完成一次文件或 workbook 结构验证后，立即将其作为最终交付物完成。',
    ].join('\n'),
  },
];
