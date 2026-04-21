import { z } from 'zod';

export const EvalCategories = [
  'intent_recognition',
  'clarification',
  'planning',
  'tool_selection',
  'execution',
  'repair_retry',
  'boundary_control',
  'multi_turn_continuity',
] as const;

export const ScoreDimensions = [
  'intent_understanding',
  'clarification_discipline',
  'planning_and_tool_selection',
  'execution_completion',
  'repair_and_exception_handling',
  'boundary_control',
  'output_quality',
] as const;

export type EvalCategory = (typeof EvalCategories)[number];
export type ScoreDimension = (typeof ScoreDimensions)[number];

export const EvalCaseSchema = z.object({
  case_id: z.string().min(1),
  case_version: z.string().min(1),
  category: z.enum(EvalCategories),
  title: z.string().min(1),
  prompt: z.string().min(1).optional(),
  prompt_sequence: z.array(z.string().min(1)).optional().default([]),
  preconditions: z.array(z.string().min(1)).optional().default([]),
  expected: z.array(z.string().min(1)).min(1),
  forbidden: z.array(z.string().min(1)).min(1),
  required_evidence: z.array(z.string().min(1)).optional().default([]),
  hard_fail_rules: z.array(z.string().min(1)).optional().default([]),
});

export const EvalSuiteSchema = z.object({
  suite_id: z.string().min(1),
  suite_version: z.string().min(1),
  generated_at: z.string().min(1),
  smoke_case_ids: z.array(z.string().min(1)).default([]),
  categories: z.array(z.enum(EvalCategories)).min(1),
  cases: z.array(EvalCaseSchema).min(1),
});

export const CaseResultStatusSchema = z.enum([
  'passed',
  'failed_soft',
  'failed_hard',
  'blocked',
  'not_run',
]);

export const CaseVerdictSchema = z.enum(['pass', 'fail', 'warning']);

export const DimensionScoresSchema = z
  .object(
    Object.fromEntries(
      ScoreDimensions.map((dimension) => [dimension, z.number().min(0).max(5).optional()])
    ) as Record<ScoreDimension, z.ZodOptional<z.ZodNumber>>
  )
  .partial();

export const CaseResultSchema = z.object({
  case_id: z.string().min(1),
  case_version: z.string().min(1),
  category: z.enum(EvalCategories),
  status: CaseResultStatusSchema,
  hard_fail: z.boolean(),
  hard_fail_reasons: z.array(z.string()),
  dimension_scores: DimensionScoresSchema.default({}),
  total_score: z.number().min(0).max(100),
  verdict: CaseVerdictSchema,
  evidence_refs: z.array(z.string()),
  notes: z.string(),
});

export const RunSummarySchema = z.object({
  total_cases: z.number().int().nonnegative(),
  executed_cases: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed_soft: z.number().int().nonnegative(),
  failed_hard: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  not_run: z.number().int().nonnegative(),
  average_score: z.number().min(0).max(100),
  category_average_scores: z.record(z.string(), z.number().min(0).max(100)),
});

export const RunManifestSchema = z.object({
  run_id: z.string().min(1),
  suite_id: z.string().min(1),
  suite_version: z.string().min(1),
  executed_at: z.string().min(1),
  executor: z.string().min(1),
  git: z.object({
    branch: z.string(),
    commit: z.string(),
  }),
  model_config: z.object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number().nullable(),
    notes: z.string().optional().default(''),
  }),
  environment: z.object({
    mode: z.string(),
    base_url: z.string(),
    auth_profile: z.string(),
  }),
  case_count: z.number().int().nonnegative(),
  summary: RunSummarySchema,
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;
export type CaseResult = z.infer<typeof CaseResultSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
