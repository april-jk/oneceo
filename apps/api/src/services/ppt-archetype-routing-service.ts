import { asText } from './altus-managed-shared';
import { isPresentationRequest } from './altus-structured-clarification-service';

export type PptDeckArchetype =
  | 'investor_pitch'
  | 'internal_strategy_review'
  | 'brand_business_intro'
  | 'industry_research_report'
  | 'technical_seminar'
  | 'product_solution_deck'
  | 'consulting_recommendation'
  | 'periodic_review';

export type PptGenerationContext = {
  archetype: PptDeckArchetype;
  label: string;
  reason: string;
  slideArchetypes: string[];
  evidenceQuestions: string[];
  sourceCoverageRules: string[];
  styleKitDirectives: string[];
};

const ARCHETYPE_LABELS: Record<PptDeckArchetype, string> = {
  investor_pitch: '投资人/融资路演',
  internal_strategy_review: '内部战略汇报',
  brand_business_intro: '企业品牌与业务推介',
  industry_research_report: '行业研究报告',
  technical_seminar: '技术研讨/培训',
  product_solution_deck: '产品方案介绍',
  consulting_recommendation: '咨询建议书',
  periodic_review: '周期复盘/进展汇报',
};

const SLIDE_ARCHETYPES: Record<PptDeckArchetype, string[]> = {
  investor_pitch: [
    'cover',
    'investment_thesis',
    'problem_definition',
    'product_matrix',
    'traction_chart',
    'market_map',
    'moat_stack',
    'risk_matrix',
    'team_density',
    'roadmap',
    'ask_or_use_of_funds',
    'appendix_sources',
  ],
  internal_strategy_review: [
    'cover',
    'executive_summary',
    'context_background',
    'key_findings',
    'business_diagnostics',
    'decision_options',
    'risk_matrix',
    'recommendation',
    'roadmap',
    'appendix_sources',
  ],
  brand_business_intro: [
    'cover',
    'brand_positioning',
    'capability_map',
    'product_matrix',
    'customer_value',
    'proof_cases',
    'cooperation_model',
    'roadmap',
    'appendix_sources',
  ],
  industry_research_report: [
    'cover',
    'executive_summary',
    'market_map',
    'trend_drivers',
    'competitive_landscape',
    'evidence_table',
    'opportunity_matrix',
    'risk_matrix',
    'appendix_sources',
  ],
  technical_seminar: [
    'cover',
    'technical_context',
    'architecture_principle',
    'benchmark_table',
    'implementation_cases',
    'limitations',
    'future_trends',
    'appendix_sources',
  ],
  product_solution_deck: [
    'cover',
    'pain_points',
    'solution_overview',
    'architecture_diagram',
    'feature_matrix',
    'business_value',
    'implementation_roadmap',
    'proof_cases',
    'appendix_sources',
  ],
  consulting_recommendation: [
    'cover',
    'executive_summary',
    'problem_definition',
    'diagnostic_findings',
    'decision_options',
    'recommendation',
    'implementation_roadmap',
    'risk_matrix',
    'appendix_sources',
  ],
  periodic_review: [
    'cover',
    'goal_recap',
    'progress_snapshot',
    'metric_dashboard',
    'issue_risk_log',
    'next_actions',
    'appendix_sources',
  ],
};

const EVIDENCE_QUESTIONS: Record<PptDeckArchetype, string[]> = {
  investor_pitch: [
    'What evidence proves the opportunity, growth, product maturity, moat, risk, team quality, and ask/use-of-funds?',
    'Which high-impact numbers require primary-source or cross-source validation?',
  ],
  internal_strategy_review: [
    'What facts support the current-state diagnosis, key strategic judgments, decision options, and recommended actions?',
    'Which risks or constraints must leadership see before choosing a path?',
  ],
  brand_business_intro: [
    'What evidence supports positioning, capability claims, customer value, cases, and cooperation model?',
    'Which claims need customer-facing wording instead of investor-style valuation language?',
  ],
  industry_research_report: [
    'What sources prove market structure, demand drivers, competitive positions, opportunities, and risks?',
    'Which figures need dates, units, and scope clearly preserved?',
  ],
  technical_seminar: [
    'What primary or technical sources explain principles, architecture, benchmarks, implementation cases, and limits?',
    'Which terms, metrics, or comparisons require precise definitions?',
  ],
  product_solution_deck: [
    'What evidence proves user pain, solution fit, architecture feasibility, feature value, and implementation path?',
    'Which integration, delivery, or operational constraints must be visible?',
  ],
  consulting_recommendation: [
    'What evidence supports the diagnosis, option comparison, recommendation, and implementation roadmap?',
    'Which tradeoffs should be shown instead of hidden?',
  ],
  periodic_review: [
    'What evidence proves progress, metric changes, issues, risks, and next actions?',
    'Which numbers should be shown as status tracking rather than persuasive claims?',
  ],
};

const SOURCE_COVERAGE_RULES: Record<PptDeckArchetype, string[]> = {
  investor_pitch: [
    'During research and drafting, try to cover these evidence buckets: company filing or official disclosure, financials/IPO, product and technical validation, market size, competition, risk factors, team/funding.',
    'Do not use high-impact numbers from web_search snippets alone; call web_extract on the source page or downgrade the claim to a qualitative statement.',
    'Prefer at least 6 distinct cited sources for a 12-15 slide investor pitch; if fewer are available, explicitly record openQuestions instead of filling gaps with unsupported figures.',
    'Use the user-selected visual/story style from the confirmed brief in the deck name, final summary, and style kit; archetype defaults must not overwrite that choice.',
  ],
  internal_strategy_review: [
    'During research and drafting, try to cover these evidence buckets: current-state facts, operating or financial metrics, strategic options, constraints/risks, and recommended action evidence.',
    'Do not use high-impact numbers from web_search snippets alone; call web_extract on the source page or downgrade the claim to a qualitative statement.',
  ],
  brand_business_intro: [
    'During research and drafting, try to cover these evidence buckets: official positioning, product/service capabilities, customer value proof, cases or partnerships, and cooperation model.',
    'Prefer official and customer-facing sources; avoid investor-only valuation claims unless the user asks for them.',
  ],
  industry_research_report: [
    'During research and drafting, try to cover these evidence buckets: market size, demand drivers, competitive landscape, trend evidence, opportunity/risk evidence, and source methodology.',
    'Do not use high-impact market numbers from web_search snippets alone; call web_extract on the report/article or downgrade the claim.',
  ],
  technical_seminar: [
    'During research and drafting, try to cover these evidence buckets: technical principle, architecture, benchmark or metric definition, implementation case, limitation, and future trend.',
    'Prefer primary technical documents, papers, official docs, or benchmark pages over generic media summaries.',
  ],
  product_solution_deck: [
    'During research and drafting, try to cover these evidence buckets: pain evidence, solution capability, architecture feasibility, feature value, implementation path, and operational constraints.',
    'Claims about integration or implementation feasibility need extracted source detail or must be framed as assumptions.',
  ],
  consulting_recommendation: [
    'During research and drafting, try to cover these evidence buckets: diagnosis facts, option evidence, tradeoffs, recommendation rationale, implementation roadmap, and risk evidence.',
    'Do not hide weak evidence; put unresolved assumptions into openQuestions or a caveat slide.',
  ],
  periodic_review: [
    'During research and drafting, try to cover these evidence buckets: goals, progress metrics, issue/risk facts, changes since last period, and next action evidence.',
    'Treat numbers as status tracking and preserve date, unit, and owner when available.',
  ],
};

const STYLE_KIT_DIRECTIVES = [
  'Convert the chosen visual style into a concrete style kit: color tokens, typography scale, chart/table treatment, page density, and forbidden visual patterns.',
  'Use slide archetypes as reusable page functions; do not repeat one generic title-plus-bullets layout across the deck.',
  'Each slide needs one clear slideGoal and one evidenceNeed before writing render instructions.',
  'Keep all external facts source-traceable in an appendix, source notes, or references slide.',
];

function normalize(value: unknown) {
  return asText(value).toLowerCase();
}

function includesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isPresentationBriefConfirmation(text: string) {
  return (
    text.includes('结构化澄清选择') ||
    text.includes('confirmed brief') ||
    text.includes('confirmed task brief') ||
    text.includes('已确认ppt需求') ||
    text.includes('已确认 ppt 需求')
  );
}

function selectArchetype(text: string): { archetype: PptDeckArchetype; reason: string } {
  if (includesAny(text, ['投资人', '融资', '路演', '募资', '上市', 'ipo', 'investor', 'pitch', 'fundraising'])) {
    return { archetype: 'investor_pitch', reason: 'matched investor / fundraising / pitch audience' };
  }
  if (includesAny(text, ['内部高管', '战略汇报', '内部团队', '经营复盘', '管理层', '高管', 'strategy review'])) {
    return { archetype: 'internal_strategy_review', reason: 'matched internal strategy / executive review audience' };
  }
  if (includesAny(text, ['品牌', '业务推介', '客户', '合作伙伴', '企业介绍', '公司介绍', 'business intro'])) {
    return { archetype: 'brand_business_intro', reason: 'matched brand / customer / partner introduction intent' };
  }
  if (includesAny(text, ['技术研讨', '学术', '培训', '专家', '架构', '原理', 'technical seminar'])) {
    return { archetype: 'technical_seminar', reason: 'matched technical seminar / training intent' };
  }
  if (includesAny(text, ['产品方案', '解决方案', '售前', '方案介绍', 'solution deck'])) {
    return { archetype: 'product_solution_deck', reason: 'matched product / solution deck intent' };
  }
  if (includesAny(text, ['咨询建议', '建议书', '诊断', '决策建议', 'consulting'])) {
    return { archetype: 'consulting_recommendation', reason: 'matched consulting recommendation intent' };
  }
  if (includesAny(text, ['周报', '月报', '复盘', '进展汇报', 'periodic review'])) {
    return { archetype: 'periodic_review', reason: 'matched periodic review intent' };
  }
  return { archetype: 'industry_research_report', reason: 'defaulted to research-report structure for unspecified PPT intent' };
}

export function derivePptGenerationContext(texts: string[]): PptGenerationContext | null {
  const normalizedTexts = texts.map(normalize).filter(Boolean);
  const combined = normalizedTexts.join('\n');
  if (!combined || (!isPresentationRequest(combined) && !isPresentationBriefConfirmation(combined))) {
    return null;
  }

  const { archetype, reason } = selectArchetype(combined);
  return {
    archetype,
    label: ARCHETYPE_LABELS[archetype],
    reason,
    slideArchetypes: SLIDE_ARCHETYPES[archetype],
    evidenceQuestions: EVIDENCE_QUESTIONS[archetype],
    sourceCoverageRules: SOURCE_COVERAGE_RULES[archetype],
    styleKitDirectives: STYLE_KIT_DIRECTIVES,
  };
}

export function renderPptGenerationContext(context: PptGenerationContext): string {
  return [
    '# PPT generation contract',
    '- This section is task-scoped and applies only because the current task is a PPT / slides / presentation deliverable.',
    `- Deck archetype: ${context.archetype} (${context.label}).`,
    `- Routing reason: ${context.reason}.`,
    '- Do not default every PPT to an investor pitch. The confirmed brief and user-selected purpose/audience override all defaults.',
    '- Before drafting slide content, build an evidence-first research plan from the deck archetype and slide goals.',
    `- Recommended slide archetypes: ${context.slideArchetypes.join(', ')}.`,
    '- Evidence questions:',
    ...context.evidenceQuestions.map((item) => `  - ${item}`),
    '- Source coverage guidance (quality preference, not a blocking gate):',
    ...context.sourceCoverageRules.map((item) => `  - ${item}`),
    '- Retrieval workflow: use web_search to find candidate sources, then try to use web_extract on the strongest primary or high-authority sources before writing render instructions. Search result snippets are discovery signals, not sufficient evidence for final slide facts.',
    '- Source coverage is not allowed to block final delivery. If extraction or coverage is incomplete after reasonable attempts, continue to render, record the remaining gaps in openQuestions/source notes, and downgrade unsupported claims.',
    '- Style kit requirements:',
    ...context.styleKitDirectives.map((item) => `  - ${item}`),
    '- Use PPT-specific preflight and render verification. Do not use website debug_open_page / browser_interact / web visual detection for PPTX deliverables.',
  ].join('\n');
}
