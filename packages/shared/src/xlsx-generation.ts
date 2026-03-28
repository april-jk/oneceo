export const XLSX_TASK_PHASES = [
  'xlsx_task_router',
  'xlsx_source_curator',
  'xlsx_workbook_designer',
  'xlsx_formula_planner',
  'xlsx_builder',
  'xlsx_qa_reviewer',
] as const;

export type XlsxTaskPhase = (typeof XLSX_TASK_PHASES)[number];

export const XLSX_TASK_MODES = ['read', 'create', 'edit', 'fix', 'validate'] as const;

export type XlsxTaskMode = (typeof XLSX_TASK_MODES)[number];

export const XLSX_CONTENT_ARCHETYPES = [
  'budget_tracker',
  'learning_plan',
  'business_analysis',
  'project_tracker',
  'data_summary',
  'input_form',
] as const;

export type XlsxContentArchetype = (typeof XLSX_CONTENT_ARCHETYPES)[number];

export const XLSX_SHEET_TYPES = [
  'inputs',
  'calculations',
  'summary',
  'dashboard',
  'sources',
  'raw_data',
  'notes',
] as const;

export type XlsxSheetType = (typeof XLSX_SHEET_TYPES)[number];

export const XLSX_QA_GATE_RULES = [
  'final_xlsx_exists',
  'workbook_structure_is_complete',
  'derived_values_prefer_live_excel_formulas',
  'preserve_source_urls_when_external_sources_are_used',
  'include_sources_or_raw_data_when_required',
  'avoid_delivering_a_single_flat_sheet_as_finished_output',
] as const;

export type XlsxQaGateRule = (typeof XLSX_QA_GATE_RULES)[number];

export interface XlsxGenerationBrief {
  artifactType: 'xlsx';
  taskMode: XlsxTaskMode;
  contentArchetype: XlsxContentArchetype;
  goal: string;
  sheetStrategy: string;
  requiresWebResearch: boolean;
  requiresSourceSheet: boolean;
  requiresRawDataSheet: boolean;
  requiresCharts: boolean;
  requiresFormulas: boolean;
}

export interface XlsxEvidenceBundle {
  sourceUrls: string[];
  dataPoints: string[];
  referenceLabels: string[];
  unitsAndDateNotes: string[];
}

export interface XlsxWorkbookSheet {
  name: string;
  sheetType: XlsxSheetType;
  purpose: string;
  columns: string[];
  formulaZones: string[];
  chartNeed: string;
}

export interface XlsxWorkbookPlan {
  sheets: XlsxWorkbookSheet[];
}

export interface XlsxFormulaPlan {
  formulaRules: string[];
  calculatedColumns: string[];
  totalRows: string[];
  numberFormats: string[];
}
