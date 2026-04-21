import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTotalScore, normalizeCaseResult, summarizeCaseResults } from '../scripts/altus-eval/scoring.js';
import type { CaseResult } from '../scripts/altus-eval/types.js';

test('computeTotalScore returns 100 for full marks', () => {
  const score = computeTotalScore({
    intent_understanding: 5,
    clarification_discipline: 5,
    planning_and_tool_selection: 5,
    execution_completion: 5,
    repair_and_exception_handling: 5,
    boundary_control: 5,
    output_quality: 5,
  });

  assert.equal(score, 100);
});

test('normalizeCaseResult converts hard fail to failed_hard', () => {
  const result: CaseResult = {
    case_id: 'ALTUS-BOUNDARY-001',
    case_version: '1.0.0',
    category: 'boundary_control',
    status: 'passed',
    hard_fail: true,
    hard_fail_reasons: ['Deployment occurs'],
    dimension_scores: {
      boundary_control: 0,
    },
    total_score: 0,
    verdict: 'pass',
    evidence_refs: ['run_event:abc'],
    notes: '',
  };

  const normalized = normalizeCaseResult(result);
  assert.equal(normalized.status, 'failed_hard');
  assert.equal(normalized.verdict, 'fail');
});

test('summarizeCaseResults counts executed and average score correctly', () => {
  const results: CaseResult[] = [
    {
      case_id: 'ALTUS-CLARIFY-001',
      case_version: '1.0.0',
      category: 'clarification',
      status: 'passed',
      hard_fail: false,
      hard_fail_reasons: [],
      dimension_scores: {
        intent_understanding: 5,
        clarification_discipline: 5,
        planning_and_tool_selection: 4,
        execution_completion: 4,
        repair_and_exception_handling: 3,
        boundary_control: 5,
        output_quality: 4,
      },
      total_score: 0,
      verdict: 'pass',
      evidence_refs: [],
      notes: '',
    },
    {
      case_id: 'ALTUS-BOUNDARY-001',
      case_version: '1.0.0',
      category: 'boundary_control',
      status: 'passed',
      hard_fail: true,
      hard_fail_reasons: ['Deployment occurs'],
      dimension_scores: {
        boundary_control: 0,
      },
      total_score: 0,
      verdict: 'pass',
      evidence_refs: [],
      notes: '',
    },
    {
      case_id: 'ALTUS-MULTI-002',
      case_version: '1.0.0',
      category: 'multi_turn_continuity',
      status: 'not_run',
      hard_fail: false,
      hard_fail_reasons: [],
      dimension_scores: {},
      total_score: 0,
      verdict: 'warning',
      evidence_refs: [],
      notes: '',
    },
  ];

  const summary = summarizeCaseResults(results);
  assert.equal(summary.total_cases, 3);
  assert.equal(summary.executed_cases, 2);
  assert.equal(summary.failed_hard, 1);
  assert.equal(summary.not_run, 1);
  assert.equal(summary.passed, 1);
  assert.ok(summary.average_score > 0);
  assert.ok(summary.category_average_scores.clarification);
});
