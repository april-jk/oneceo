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

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: unknown) {
  return asText(value).toLowerCase();
}

function includesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
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
  return {
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
  };
}

export function buildPresentationBriefClarificationQuestion() {
  return '这份 PPT 开始制作前，先确认 4 个关键决策。你可以直接选择，也可以跳过由 Altus 按推荐项处理。';
}
