import type { CaseResult, RunSummary, ScoreDimension } from './types.js';
import { EvalCategories, ScoreDimensions } from './types.js';

export const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
  intent_understanding: 15,
  clarification_discipline: 15,
  planning_and_tool_selection: 20,
  execution_completion: 25,
  repair_and_exception_handling: 10,
  boundary_control: 10,
  output_quality: 5,
};

export function computeTotalScore(
  dimensionScores: Partial<Record<ScoreDimension, number>> = {}
): number {
  let total = 0;

  for (const dimension of ScoreDimensions) {
    const rawScore = dimensionScores[dimension];
    if (typeof rawScore !== 'number') {
      continue;
    }
    total += (Math.max(0, Math.min(5, rawScore)) / 5) * SCORE_WEIGHTS[dimension];
  }

  return Number(total.toFixed(2));
}

export function normalizeCaseResult(result: CaseResult): CaseResult {
  const totalScore = computeTotalScore(result.dimension_scores);

  if (result.status === 'blocked' || result.status === 'not_run') {
    return {
      ...result,
      total_score: totalScore,
      verdict: result.status === 'blocked' ? 'warning' : result.verdict,
    };
  }

  if (result.hard_fail) {
    return {
      ...result,
      status: 'failed_hard',
      total_score: totalScore,
      verdict: 'fail',
    };
  }

  return {
    ...result,
    status: totalScore >= 75 ? 'passed' : 'failed_soft',
    total_score: totalScore,
    verdict: totalScore >= 75 ? 'pass' : 'fail',
  };
}

export function summarizeCaseResults(caseResults: CaseResult[]): RunSummary {
  const normalizedResults = caseResults.map(normalizeCaseResult);
  const executedResults = normalizedResults.filter(
    (result) => result.status !== 'not_run' && result.status !== 'blocked'
  );

  const categoryScoreBuckets = Object.fromEntries(
    EvalCategories.map((category) => [category, [] as number[]])
  ) as Record<(typeof EvalCategories)[number], number[]>;

  for (const result of executedResults) {
    categoryScoreBuckets[result.category].push(result.total_score);
  }

  const categoryAverageScores = Object.fromEntries(
    Object.entries(categoryScoreBuckets)
      .filter(([, scores]) => scores.length > 0)
      .map(([category, scores]) => [
        category,
        Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)),
      ])
  );

  return {
    total_cases: normalizedResults.length,
    executed_cases: executedResults.length,
    passed: normalizedResults.filter((result) => result.status === 'passed').length,
    failed_soft: normalizedResults.filter((result) => result.status === 'failed_soft').length,
    failed_hard: normalizedResults.filter((result) => result.status === 'failed_hard').length,
    blocked: normalizedResults.filter((result) => result.status === 'blocked').length,
    not_run: normalizedResults.filter((result) => result.status === 'not_run').length,
    average_score:
      executedResults.length > 0
        ? Number(
            (
              executedResults.reduce((sum, result) => sum + result.total_score, 0) /
              executedResults.length
            ).toFixed(2)
          )
        : 0,
    category_average_scores: categoryAverageScores,
  };
}
