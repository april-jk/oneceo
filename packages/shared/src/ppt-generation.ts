export const PPT_TASK_PHASES = [
  'ppt_task_router',
  'ppt_research_curator',
  'ppt_storyboard_designer',
  'ppt_visual_system_designer',
  'ppt_builder',
  'ppt_qa_reviewer',
] as const;

export type PptTaskPhase = (typeof PPT_TASK_PHASES)[number];

export const PPT_CONTENT_ARCHETYPES = [
  'pitch_deck',
  'consulting_report',
  'roadmap_plan',
  'training_material',
  'proposal_solution',
  'research_summary',
  'product_story',
] as const;

export type PptContentArchetype = (typeof PPT_CONTENT_ARCHETYPES)[number];

export const PPT_PAGE_TYPES = [
  'cover',
  'agenda',
  'section-divider',
  'content',
  'comparison',
  'timeline',
  'quote',
  'closing',
] as const;

export type PptPageType = (typeof PPT_PAGE_TYPES)[number];

export const PPT_CONTENT_SUBTYPES = [
  'text_enhanced',
  'mixed_media',
  'data_viz',
  'comparison',
  'timeline_process',
  'image_showcase',
] as const;

export type PptContentSubtype = (typeof PPT_CONTENT_SUBTYPES)[number];

export const PPT_PALETTE_KEYS = [
  'business_authority',
  'vibrant_tech',
  'education_charts',
  'forest_eco',
  'luxury_mysterious',
  'platinum_white_gold',
] as const;

export type PptPaletteKey = (typeof PPT_PALETTE_KEYS)[number];

export const PPT_STYLE_RECIPES = ['sharp', 'soft', 'rounded', 'pill'] as const;

export type PptStyleRecipe = (typeof PPT_STYLE_RECIPES)[number];

export const PPT_STYLE_PACKS = [
  'consulting_clean',
  'executive_formal',
  'vision_bold',
  'training_friendly',
] as const;

export type PptStylePack = (typeof PPT_STYLE_PACKS)[number];

export const PPT_FONT_PAIRINGS = [
  'yahei_arial',
  'yahei_calibri',
  'yahei_cambria',
] as const;

export type PptFontPairing = (typeof PPT_FONT_PAIRINGS)[number];

export const PPT_QA_GATE_RULES = [
  'final_pptx_exists',
  'has_cover_page',
  'has_closing_page',
  'has_at_least_two_non_text_content_pages',
  'has_at_least_two_content_subtypes',
  'no_three_repeated_layouts_in_a_row',
  'preserve_source_urls_when_external_sources_are_used',
  'no_placeholders_or_empty_template_pages',
] as const;

export type PptQaGateRule = (typeof PPT_QA_GATE_RULES)[number];

export interface PptGenerationBrief {
  artifactType: 'pptx';
  contentArchetype: PptContentArchetype;
  audience: string;
  goal: string;
  tone: string;
  structureStrategy: string;
  visualGoal: string;
  evidenceMode: string;
  requiresWebResearch: boolean;
  requiresImages: boolean;
  requiresCharts: boolean;
}

export interface PptEvidenceBundle {
  factHighlights: string[];
  caseHighlights: string[];
  candidateImages: string[];
  chartCandidates: string[];
  sourceUrls: string[];
}

export interface PptStoryboardSlide {
  index: number;
  pageType: PptPageType;
  contentSubtype: PptContentSubtype | null;
  title: string;
  coreMessage: string;
  visualNeed: string;
  sourceRefs: string[];
}

export interface PptStoryboard {
  slides: PptStoryboardSlide[];
}

export interface PptVisualSystem {
  paletteKey: PptPaletteKey;
  styleRecipe: PptStyleRecipe;
  fontPairing: PptFontPairing;
  titleScale: string;
  bodyScale: string;
  spacingScale: string;
  pageBadgeStyle: string;
}
