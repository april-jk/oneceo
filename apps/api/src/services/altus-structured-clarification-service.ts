export type StructuredClarificationSelectionMode = 'single' | 'multiple';

export type StructuredClarificationOption = {
  id: string;
  label: string;
  description: string;
  impact: string;
  recommended?: boolean;
};

export type StructuredClarificationCard = {
  id: string;
  title: string;
  question: string;
  why: string;
  selectionMode: StructuredClarificationSelectionMode;
  required: boolean;
  options: StructuredClarificationOption[];
  allowOther: boolean;
  allowNote: boolean;
  notePlaceholder?: string;
};

export type StructuredClarificationCardPlan = {
  kind: 'structured_clarification';
  taskType: 'ppt' | 'report' | 'website' | 'generic';
  title: string;
  summary: string;
  maxCards: 4;
  cards: StructuredClarificationCard[];
  briefFields: string[];
};

export type StructuredClarificationFallbackType =
  | 'artifact_type'
  | 'tech_stack'
  | 'scope_boundary'
  | 'integration_target'
  | 'acceptance_requirement'
  | 'presentation_brief'
  | 'none';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: unknown) {
  return asText(value).toLowerCase();
}

function includesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function toOption(id: string, label: string, description: string, impact: string, recommended = false) {
  return { id, label, description, impact, recommended };
}

function enforceCardOptionContract(card: StructuredClarificationCard): StructuredClarificationCard {
  const options = card.options.slice(0, 3).map((option, index) => ({
    ...option,
    recommended: index === 0,
  }));
  if (!options.some((option) => option.recommended) && options[0]) {
    options[0] = { ...options[0], recommended: true };
  }
  return {
    ...card,
    options,
    allowOther: true,
    allowNote: false,
  };
}

function enforcePlanOptionContract(plan: StructuredClarificationCardPlan): StructuredClarificationCardPlan {
  return {
    ...plan,
    maxCards: 4,
    cards: plan.cards.slice(0, 4).map(enforceCardOptionContract),
    briefFields: plan.briefFields.slice(0, 8),
  };
}

const PRESENTATION_REQUEST_KEYWORDS = [
  'ppt',
  'pptx',
  'powerpoint',
  'presentation',
  'slides',
  'slide deck',
  '演示文稿',
  '幻灯片',
] as const;

const DIRECT_WITH_DEFAULTS_KEYWORDS = [
  '不要问',
  '不用问',
  '无需确认',
  '直接做',
  '直接生成',
  '按默认',
  '你决定',
  'do not ask',
  "don't ask",
  'use defaults',
] as const;

const PURPOSE_AUDIENCE_KEYWORDS = [
  '投资人',
  '融资',
  '路演',
  '客户',
  '合作伙伴',
  '高管',
  '内部',
  '培训',
  '课堂',
  '学术',
  '研讨',
  '汇报',
  'investor',
  'pitch',
  'client',
  'internal',
  'training',
] as const;

const CONTENT_SOURCE_KEYWORDS = [
  '联网',
  '搜索',
  '检索',
  '官网',
  '招股书',
  '公告',
  '年报',
  '新闻',
  '用户提供',
  '上传',
  '资料',
  'source',
  'research',
  'web',
  'official',
] as const;

const DEPTH_PAGE_COUNT_KEYWORDS = [
  '页',
  '页数',
  '简版',
  '标准版',
  '深度',
  '大纲',
  'outline',
  'pages',
  'slides',
] as const;

const VISUAL_STYLE_KEYWORDS = [
  '风格',
  '视觉',
  '科技',
  '投研',
  '商务',
  '路演',
  '咨询',
  '学术',
  '深色',
  '浅色',
  'style',
  'visual',
  'consulting',
] as const;

const MUST_INCLUDE_KEYWORDS = [
  '必须包含',
  '包括',
  '重点',
  '不要',
  '禁止',
  '风险',
  '财务',
  '市场',
  '竞品',
  '技术',
  'must include',
  'avoid',
] as const;

export function isPresentationRequest(textRaw: unknown) {
  return includesAny(normalizeText(textRaw), PRESENTATION_REQUEST_KEYWORDS);
}

export function hasPresentationDirectExecutionOverride(textRaw: unknown) {
  return includesAny(normalizeText(textRaw), DIRECT_WITH_DEFAULTS_KEYWORDS);
}

export function countPresentationBriefSignals(textRaw: unknown) {
  const text = normalizeText(textRaw);
  const checks = [
    includesAny(text, PURPOSE_AUDIENCE_KEYWORDS),
    includesAny(text, CONTENT_SOURCE_KEYWORDS),
    includesAny(text, DEPTH_PAGE_COUNT_KEYWORDS),
    includesAny(text, VISUAL_STYLE_KEYWORDS),
    includesAny(text, MUST_INCLUDE_KEYWORDS),
  ];
  return checks.filter(Boolean).length;
}

export function shouldRequestPresentationBrief(textRaw: unknown) {
  const text = normalizeText(textRaw);
  if (!isPresentationRequest(text)) return false;
  if (hasPresentationDirectExecutionOverride(text)) return false;
  return countPresentationBriefSignals(text) < 3;
}

export function coversPresentationBrief(textRaw: unknown) {
  const text = normalizeText(textRaw);
  if (!text) return false;
  if (
    text.includes('confirmed task brief') ||
    text.includes('已确认ppt需求') ||
    text.includes('已确认 ppt 需求') ||
    text.includes('结构化澄清选择')
  ) {
    return true;
  }
  return countPresentationBriefSignals(text) >= 3;
}

export function buildPresentationStructuredClarificationPlan(): StructuredClarificationCardPlan {
  return enforcePlanOptionContract({
    kind: 'structured_clarification',
    taskType: 'ppt',
    title: '生成 PPT 前确认 4 个关键决策',
    summary: '先确认受众、资料、深度和风格，再开始检索与制作。',
    maxCards: 4,
    briefFields: ['purpose_audience', 'content_source', 'depth_page_count', 'visual_story_style'],
    cards: [
      {
        id: 'purpose_audience',
        title: '演示目的与受众',
        question: '这份 PPT 主要给谁看？',
        why: '决定叙事角度和信息密度',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: true,
        notePlaceholder: '补充具体受众或使用场景',
        options: [
          {
            id: 'investor_pitch',
            label: '投资人融资路演',
            description: '强调投资价值与融资用途',
            impact: '会突出市场空间、技术壁垒、融资用途和风险。',
            recommended: true,
          },
          {
            id: 'executive_strategy',
            label: '内部高管战略汇报',
            description: '强调战略判断和风险',
            impact: '会把结论、资源投入和经营风险放在前面。',
          },
          {
            id: 'brand_business_intro',
            label: '企业品牌与业务推介',
            description: '强调业务亮点与合作机会',
            impact: '会降低财务细节密度，增加品牌和业务叙事。',
          },
          {
            id: 'technical_seminar',
            label: '行业技术研讨',
            description: '强调技术路线和证据链',
            impact: '会增加技术路线、竞品对比和专业术语解释。',
          },
        ],
      },
      {
        id: 'content_source',
        title: '内容来源与可信度',
        question: '资料来源希望怎么处理？',
        why: '决定是否联网和引用标准',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: true,
        notePlaceholder: '补充指定资料、链接或禁用来源',
        options: [
          {
            id: 'public_research',
            label: 'AI 联网检索公开资料',
            description: '速度快，覆盖面广',
            impact: '会联网搜索并保留关键来源 URL。',
            recommended: true,
          },
          {
            id: 'official_sources',
            label: '官网 + 公告 + 权威媒体',
            description: '更重视可信来源',
            impact: '会优先引用官网、公告、招股书和权威报道。',
          },
          {
            id: 'user_material_only',
            label: '只使用我提供的资料',
            description: '避免外部信息混入',
            impact: '会等待或使用已上传资料，不主动扩展外部事实。',
          },
          {
            id: 'outline_first',
            label: '先做结构大纲',
            description: '资料后续再补',
            impact: '会先产出可审阅大纲，不直接渲染最终 PPTX。',
          },
        ],
      },
      {
        id: 'depth_page_count',
        title: '深度与页数',
        question: '希望做到什么深度？',
        why: '决定页数、结构和工作量',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: true,
        notePlaceholder: '补充页数范围或交付深度',
        options: [
          {
            id: 'standard_12_15',
            label: '12-15 页标准版',
            description: '完整但不拖沓',
            impact: '会覆盖背景、业务、市场、财务、风险和结论。',
            recommended: true,
          },
          {
            id: 'brief_8_10',
            label: '8-10 页简版',
            description: '适合快速汇报',
            impact: '会压缩细节，突出最关键的结论和图表。',
          },
          {
            id: 'deep_18_25',
            label: '18-25 页深度版',
            description: '偏投研尽调',
            impact: '会增加证据、竞品、数据和风险分析页。',
          },
          {
            id: 'outline_only',
            label: '先产出结构大纲',
            description: '暂不生成 PPTX',
            impact: '会先给可确认的章节和逐页要点。',
          },
        ],
      },
      {
        id: 'visual_story_style',
        title: '视觉与叙事风格',
        question: '希望整体风格更接近哪一种？',
        why: '决定版式、色彩和讲法',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: true,
        notePlaceholder: '补充品牌色、参考风格或禁用风格',
        options: [
          {
            id: 'tech_investment',
            label: '科技投研风',
            description: '专业、克制、数据密度高',
            impact: '会使用更硬朗的结构、深色科技感和图表证据。',
            recommended: true,
          },
          {
            id: 'business_pitch',
            label: '商业路演风',
            description: '亮点突出，节奏强',
            impact: '会强化故事线、亮点页和结论页。',
          },
          {
            id: 'consulting_clean',
            label: '管理咨询风',
            description: '结构化、结论先行',
            impact: '会使用咨询式标题、矩阵、流程和对比图。',
          },
          {
            id: 'academic_seminar',
            label: '学术研讨风',
            description: '证据链和技术解释优先',
            impact: '会增加技术路线、引用和方法说明。',
          },
        ],
      },
    ],
  });
}

export function buildPresentationBriefClarificationQuestion() {
  return '这份 PPT 开始制作前，先确认 4 个关键决策。你可以直接选择，也可以跳过由 Altus 按推荐项处理。';
}

function inferTaskType(question: string): StructuredClarificationCardPlan['taskType'] {
  const text = normalizeText(question);
  if (includesAny(text, PRESENTATION_REQUEST_KEYWORDS)) return 'ppt';
  if (includesAny(text, ['报告', 'report', '分析文档', '研究文档'])) return 'report';
  if (includesAny(text, ['网站', '网页', 'web', 'landing page', 'dashboard', '后台'])) return 'website';
  return 'generic';
}

function fallbackCardForType(
  clarificationType: StructuredClarificationFallbackType,
  question: string,
  options?: string[]
): StructuredClarificationCard {
  const optionLabels = (Array.isArray(options) ? options : []).map(asText).filter(Boolean).slice(0, 3);
  const fromLabels = optionLabels.map((label, index) =>
    toOption(`option_${index + 1}`, label, index === 0 ? '按常见路径推进' : '按该方向收敛需求', 'Altus 会按这个选择调整执行范围。', index === 0)
  );
  switch (clarificationType) {
    case 'artifact_type':
      return {
        id: 'artifact_type',
        title: '交付物类型',
        question: question || '这次主要要交付什么？',
        why: '决定后续执行路径',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options:
          fromLabels.length >= 3
            ? fromLabels
            : [
                toOption('web_app', '网页应用', '包含可交互页面', '会按前端应用路径规划与验证。', true),
                toOption('backend_api', '后端 API', '接口和服务优先', '会聚焦数据模型、接口和服务验证。'),
                toOption('business_system', '完整业务系统', '前后端与权限齐备', '会按模块、数据和权限边界拆解。'),
              ],
      };
    case 'tech_stack':
      return {
        id: 'tech_stack',
        title: '技术栈选择',
        question: question || '这次希望使用哪种技术栈？',
        why: '决定代码结构和依赖',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options:
          fromLabels.length >= 3
            ? fromLabels
            : [
                toOption('repo_default', '沿用仓库现有技术栈', '最稳妥，改动最小', '会优先复用现有框架和工具链。', true),
                toOption('react_typescript', 'React + TypeScript', '适合前端体验', '会按组件化页面和类型约束推进。'),
                toOption('node_typescript', 'Node.js + TypeScript', '适合 API 和脚本', '会优先保证服务逻辑和可测试性。'),
              ],
      };
    case 'scope_boundary':
      return {
        id: 'scope_boundary',
        title: '实现范围',
        question: question || '这次需要覆盖到什么范围？',
        why: '决定是否动后端和数据',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options:
          fromLabels.length >= 3
            ? fromLabels
            : [
                toOption('frontend_only', '只做前端页面', '不改后端接口', '会用现有数据或 mock 保持范围可控。', true),
                toOption('full_stack', '前后端一起做', '页面、接口和数据闭环', '会同步设计 API、数据和前端交互。'),
                toOption('backend_database', '后端和数据库优先', '先打通核心能力', '会优先处理数据模型、接口和验证。'),
              ],
      };
    case 'integration_target':
      return {
        id: 'integration_target',
        title: '接入边界',
        question: question || '这次需要接入什么系统？',
        why: '决定外部依赖和风险',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options:
          fromLabels.length >= 3
            ? fromLabels
            : [
                toOption('no_external', '不接外部系统', '先完成本地闭环', '会减少授权和网络依赖，先保证核心流程。', true),
                toOption('existing_api', '接入现有 API', '复用已有服务', '会先确认接口契约和错误处理。'),
                toOption('third_party', '接第三方平台', '需要授权和配置', '会把凭证、权限和失败恢复列为重点。'),
              ],
      };
    case 'acceptance_requirement':
      return {
        id: 'acceptance_requirement',
        title: '验收标准',
        question: question || '这次做到什么程度算完成？',
        why: '决定验证和交付深度',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options:
          fromLabels.length >= 3
            ? fromLabels
            : [
                toOption('source_only', '只要源码', '交付代码即可', '会控制验证成本，重点保证代码完整。', true),
                toOption('local_run', '本地可运行', '需要启动验证', '会补齐运行步骤并验证主流程。'),
                toOption('tests_pass', '测试通过', '需要自动化验证', '会优先补测试或运行现有测试。'),
              ],
      };
    case 'presentation_brief':
      return buildPresentationStructuredClarificationPlan().cards[0]!;
    case 'none':
    default:
      return {
        id: 'key_decision',
        title: '关键选择',
        question: question || '这次你更希望 Altus 按哪个方向推进？',
        why: '避免自由文本不清楚',
        selectionMode: 'single',
        required: true,
        allowOther: true,
        allowNote: false,
        options:
          fromLabels.length >= 3
            ? fromLabels
            : [
                toOption('balanced_default', '按推荐方案推进', '质量和速度均衡', 'Altus 会按当前上下文选择稳妥路径。', true),
                toOption('fast_first', '先快速产出初版', '适合尽快看到结果', '会优先完成可检查的第一版。'),
                toOption('quality_first', '先打磨质量', '适合正式交付', '会增加规划、验证和细节检查。'),
              ],
      };
  }
}

export function buildStructuredClarificationPlanFromQuestion(input: {
  question: string;
  options?: string[];
  clarificationType?: StructuredClarificationFallbackType;
}): StructuredClarificationCardPlan {
  const question = asText(input.question) || '请先选择一个方向，Altus 会按你的选择继续。';
  const clarificationType = input.clarificationType || 'none';
  const card = fallbackCardForType(clarificationType, question, input.options);
  return enforcePlanOptionContract({
    kind: 'structured_clarification',
    taskType: clarificationType === 'presentation_brief' ? 'ppt' : inferTaskType(question),
    title: clarificationType === 'presentation_brief' ? '生成 PPT 前确认关键决策' : '请确认关键需求',
    summary: '选择最接近的方向；第四项可填写你的自定义答案。',
    maxCards: 4,
    cards: [card],
    briefFields: [card.id],
  });
}
