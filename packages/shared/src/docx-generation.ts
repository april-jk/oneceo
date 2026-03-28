export const DOCX_TASK_PHASES = [
  'docx_task_router',
  'docx_research_curator',
  'docx_outline_architect',
  'docx_style_system_designer',
  'docx_builder',
  'docx_qa_reviewer',
] as const;

export type DocxTaskPhase = (typeof DOCX_TASK_PHASES)[number];

export const DOCX_TASK_MODES = ['create', 'fill_edit', 'format_apply'] as const;

export type DocxTaskMode = (typeof DOCX_TASK_MODES)[number];

export const DOCX_CONTENT_ARCHETYPES = [
  'business_plan',
  'formal_report',
  'proposal',
  'policy_process',
  'meeting_memo',
  'research_brief',
  'external_statement',
] as const;

export type DocxContentArchetype = (typeof DOCX_CONTENT_ARCHETYPES)[number];

export const DOCX_STYLE_PACKS = [
  'formal_executive',
  'proposal_professional',
  'policy_precise',
  'research_structured',
] as const;

export type DocxStylePack = (typeof DOCX_STYLE_PACKS)[number];

export const DOCX_SECTION_TYPES = [
  'title_block',
  'executive_summary',
  'context_problem',
  'analysis_argument',
  'plan_recommendation',
  'process_policy',
  'action_items',
  'appendix_references',
] as const;

export type DocxSectionType = (typeof DOCX_SECTION_TYPES)[number];

export const DOCX_QA_GATE_RULES = [
  'final_docx_exists',
  'has_clear_heading_hierarchy',
  'section_order_matches_archetype',
  'preserve_source_urls_when_external_sources_are_used',
  'avoid_generic_report_structure_for_every_document',
  'no_placeholders_or_empty_sections',
] as const;

export type DocxQaGateRule = (typeof DOCX_QA_GATE_RULES)[number];

export interface DocxGenerationBrief {
  artifactType: 'docx';
  taskMode: DocxTaskMode;
  contentArchetype: DocxContentArchetype;
  audience: string;
  goal: string;
  tone: string;
  structureStrategy: string;
  evidenceMode: string;
  requiresWebResearch: boolean;
  requiresAppendix: boolean;
  requiresTables: boolean;
}

export interface DocxEvidenceBundle {
  factHighlights: string[];
  policyOrMarketReferences: string[];
  caseHighlights: string[];
  sourceUrls: string[];
}

export interface DocxOutlineSection {
  index: number;
  sectionType: DocxSectionType;
  title: string;
  corePurpose: string;
  evidenceNeed: string;
}

export interface DocxOutlinePlan {
  sections: DocxOutlineSection[];
}

export interface DocxStyleSystem {
  stylePack: DocxStylePack;
  fontPairing: string;
  headingScale: string;
  bodyScale: string;
  lineSpacing: string;
  paragraphSpacing: string;
  marginProfile: string;
}
