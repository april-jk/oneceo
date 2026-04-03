export type PlatformSkillSeed = {
  slug: string;
  name: string;
  description: string;
  category: string;
  bodyMarkdown: string;
  resources?: Array<{
    resourcePath: string;
    resourceType?: 'reference' | 'template';
    contentMarkdown: string;
  }>;
};

const PPT_PHASE_SKILLS = [
  'ppt_task_router',
  'ppt_research_curator',
  'ppt_storyboard_designer',
  'ppt_visual_system_designer',
  'ppt_builder',
  'ppt_qa_reviewer',
] as const;

const DOCX_PHASE_SKILLS = [
  'docx_task_router',
  'docx_research_curator',
  'docx_outline_architect',
  'docx_style_system_designer',
  'docx_builder',
  'docx_qa_reviewer',
] as const;

const XLSX_PHASE_SKILLS = [
  'xlsx_task_router',
  'xlsx_source_curator',
  'xlsx_workbook_designer',
  'xlsx_formula_planner',
  'xlsx_builder',
  'xlsx_qa_reviewer',
] as const;

function formatCodeList(values: readonly string[]) {
  return values.map((value) => `\`${value}\``).join(', ');
}

export const PLATFORM_SKILL_SEEDS: PlatformSkillSeed[] = [
  {
    slug: 'requirements-breakdown',
    name: '需求拆解',
    description: '把目标整理成范围、约束和交付项',
    category: 'general',
    bodyMarkdown: [
      '# Skill Brief: 需求拆解',
      '',
      '请先完成以下分析：',
      '- 明确用户目标和核心场景。',
      '- 列出功能范围、非目标和关键约束。',
      '- 输出可执行的交付清单与优先级。',
    ].join('\n'),
  },
  {
    slug: 'implementation-plan',
    name: '实现方案',
    description: '整理技术栈、模块划分和实施顺序',
    category: 'general',
    bodyMarkdown: [
      '# Skill Brief: 实现方案',
      '',
      '请基于当前需求给出实现方案：',
      '- 推荐合适的技术栈和数据存储。',
      '- 拆分核心模块、接口和边界。',
      '- 给出从 MVP 到完善版本的实施步骤。',
    ].join('\n'),
  },
  {
    slug: 'test-checklist',
    name: '测试清单',
    description: '补齐关键测试点和验收标准',
    category: 'general',
    bodyMarkdown: [
      '# Skill Brief: 测试清单',
      '',
      '请围绕当前任务补充测试视角：',
      '- 核心功能用例。',
      '- 边界条件与异常处理。',
      '- 最小验收标准与回归范围。',
    ].join('\n'),
  },
  {
    slug: 'office-ppt',
    name: 'PPT 办公',
    description: '创建、改写或重组可直接交付的专业演示文稿',
    category: 'office',
    bodyMarkdown: [
      '# Skill Brief: PPT 办公演示文稿生成',
      '',
      '请以专业演示设计师、内容策略顾问和商务沟通专家的标准完成当前任务，并直接推进到可交付结果。',
      '',
      '## 总原则',
      '- 不要把 PPT 任务当成“一段长 prompt 直接生成成品”，而要按固定阶段协同推进。',
      `- 六个内部阶段必须按固定顺序执行：${formatCodeList(PPT_PHASE_SKILLS)}。`,
      '- 不允许跳过前面的结构和视觉决策，直接开始写最终页面。',
      '',
      '## 交付要求',
      '- 最终产物优先生成可直接交付的 `.pptx`。',
      '- 如使用外部资料，必须保留来源 URL，可放在 speaker notes、附录页或验证说明中。',
      '- 当 `.pptx` 已生成且完成一次验证后，立即将其作为最终交付物完成。',
    ].join('\n'),
    resources: [
      {
        resourcePath: 'references/slide-structure-guide.md',
        resourceType: 'reference',
        contentMarkdown: [
          '# PPT Slide Structure Guide',
          '',
          '- 封面页应明确主题、副标题和场景，不要堆砌说明性段落。',
          '- 正文页优先采用“标题 + 核心观点 + 结构化证据”布局，而不是整页项目符号。',
          '- 汇总页应回收关键结论、下一步行动和需要保留的来源信息。',
        ].join('\n'),
      },
      {
        resourcePath: 'templates/business-deck-outline.md',
        resourceType: 'template',
        contentMarkdown: [
          '# Business Deck Outline',
          '',
          '1. 封面：主题、对象、日期',
          '2. 背景与问题：现状、痛点、影响',
          '3. 核心分析：证据、对比、洞察',
          '4. 方案与路径：行动方案、里程碑、负责人',
          '5. 收尾：结论、建议、后续行动',
        ].join('\n'),
      },
    ],
  },
  {
    slug: 'office-docx',
    name: 'Word 文档',
    description: '创建、改写或重组可直接交付的正式办公文档',
    category: 'office',
    bodyMarkdown: [
      '# Skill Brief: Word 办公文档生成与编辑',
      '',
      '请以专业办公文档作者、编辑和内容策略顾问的标准完成当前任务，并直接推进到可交付结果。',
      '',
      '## 总原则',
      '- 不要把 Word 任务当成“统一写一份报告”，而要按固定阶段协同推进。',
      `- 六个内部阶段必须按固定顺序执行：${formatCodeList(DOCX_PHASE_SKILLS)}。`,
      '- 先判定任务模式、文档原型和结构策略，再写正文和生成 `.docx`。',
      '',
      '## 交付要求',
      '- 最终产物优先生成可直接交付的 `.docx`。',
      '- 如使用外部资料，必须保留来源 URL，可放在参考资料、附录、脚注式说明或验证说明中。',
      '- 当 `.docx` 已生成且完成一次结构或文件验证后，立即将其作为最终交付物完成。',
    ].join('\n'),
    resources: [
      {
        resourcePath: 'templates/formal-report-outline.md',
        resourceType: 'template',
        contentMarkdown: [
          '# Formal Report Outline',
          '',
          '1. 标题与摘要',
          '2. 背景与目标',
          '3. 现状分析',
          '4. 建议方案',
          '5. 实施步骤',
          '6. 风险与附录',
        ].join('\n'),
      },
    ],
  },
  {
    slug: 'office-xlsx',
    name: 'Excel 表格',
    description: '创建、分析、改写或校验可直接交付的工作簿与数据表',
    category: 'office',
    bodyMarkdown: [
      '# Skill Brief: Excel 表格生成、分析与编辑',
      '',
      '请以专业办公数据分析与工作簿设计者的标准完成当前任务，并直接推进到可交付结果。',
      '',
      '## 总原则',
      '- 不要把 Excel 任务当成“写一张表”，而要按固定阶段协同推进。',
      `- 六个内部阶段必须按固定顺序执行：${formatCodeList(XLSX_PHASE_SKILLS)}。`,
      '- 先判定任务模式、工作簿结构和公式策略，再生成 `.xlsx`。',
      '',
      '## 交付要求',
      '- 最终产物优先生成可直接交付的 `.xlsx`。',
      '- 如使用外部数据，必须保留来源 URL、日期、单位和口径说明。',
      '- 当 `.xlsx` 已生成且完成一次文件或 workbook 结构验证后，立即将其作为最终交付物完成。',
    ].join('\n'),
    resources: [
      {
        resourcePath: 'references/workbook-qa-checklist.md',
        resourceType: 'reference',
        contentMarkdown: [
          '# Workbook QA Checklist',
          '',
          '- 至少区分输入区、计算区、输出区，避免所有内容堆在一张表。',
          '- 关键汇总值优先保留公式，不要只粘贴结果。',
          '- 当使用外部数据时，增加来源说明和更新时间。',
        ].join('\n'),
      },
    ],
  },
];
