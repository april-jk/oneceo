import path from 'node:path';

import { summarizeCaseResults } from './scoring.js';
import type { CaseResult, RunManifest } from './types.js';
import {
  DEFAULT_RESULTS_ROOT,
  DEFAULT_SUITE_PATH,
  buildDateStamp,
  buildRunId,
  ensureDir,
  getGitInfo,
  loadSuite,
  parseCliArgs,
  renderSummaryMarkdown,
  selectCases,
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from './io.js';

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const suitePath =
    typeof options.suite === 'string' ? path.resolve(process.cwd(), options.suite) : DEFAULT_SUITE_PATH;
  const suite = await loadSuite(suitePath);
  const selectedCases = selectCases(suite, options);

  if (selectedCases.length === 0) {
    throw new Error('No cases selected for this run.');
  }

  const now = new Date();
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : buildRunId(now);
  const resultsRoot =
    typeof options['output-root'] === 'string'
      ? path.resolve(process.cwd(), options['output-root'])
      : DEFAULT_RESULTS_ROOT;
  const runDir = path.join(resultsRoot, buildDateStamp(now), suite.suite_id, runId);
  const artifactsDir = path.join(runDir, 'artifacts');

  await ensureDir(artifactsDir);

  const seededCaseResults: CaseResult[] = selectedCases.map((testCase) => ({
    case_id: testCase.case_id,
    case_version: testCase.case_version,
    category: testCase.category,
    status: 'not_run',
    hard_fail: false,
    hard_fail_reasons: [],
    dimension_scores: {},
    total_score: 0,
    verdict: 'warning',
    evidence_refs: [],
    notes: '',
  }));

  const summary = summarizeCaseResults(seededCaseResults);
  const manifest: RunManifest = {
    run_id: runId,
    suite_id: suite.suite_id,
    suite_version: suite.suite_version,
    executed_at: now.toISOString(),
    executor: typeof options.executor === 'string' ? options.executor : 'manual',
    git: getGitInfo(),
    model_config: {
      provider: typeof options.provider === 'string' ? options.provider : '',
      model: typeof options.model === 'string' ? options.model : '',
      temperature:
        typeof options.temperature === 'string' ? Number.parseFloat(options.temperature) : null,
      notes: typeof options.notes === 'string' ? options.notes : '',
    },
    environment: {
      mode: typeof options.mode === 'string' ? options.mode : '',
      base_url: typeof options['base-url'] === 'string' ? options['base-url'] : '',
      auth_profile: typeof options['auth-profile'] === 'string' ? options['auth-profile'] : '',
    },
    case_count: seededCaseResults.length,
    summary,
  };

  await writeJsonFile(path.join(runDir, 'run_manifest.json'), manifest);
  await writeJsonLines(path.join(runDir, 'case_results.jsonl'), seededCaseResults);
  await writeJsonFile(path.join(runDir, 'selected_cases.json'), selectedCases);
  await writeJsonFile(path.join(runDir, 'suite_snapshot.json'), suite);
  await writeJsonFile(path.join(runDir, 'metadata.json'), {
    suite_path: suitePath,
    output_root: resultsRoot,
    smoke: options.smoke === true,
  });
  await writeJsonFile(path.join(artifactsDir, '.keep.json'), { keep: true });
  await writeTextFile(path.join(runDir, 'summary.md'), renderSummaryMarkdown(manifest, summary, seededCaseResults));

  process.stdout.write(`${runDir}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
