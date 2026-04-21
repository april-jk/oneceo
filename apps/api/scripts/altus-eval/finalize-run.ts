import path from 'node:path';

import {
  loadRunManifest,
  parseCliArgs,
  readJsonLines,
  renderSummaryMarkdown,
  writeJsonFile,
  writeTextFile,
} from './io.js';
import { normalizeCaseResult, summarizeCaseResults } from './scoring.js';

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (typeof options['run-dir'] !== 'string') {
    throw new Error('--run-dir is required');
  }

  const runDir = path.resolve(process.cwd(), options['run-dir']);
  const manifestPath = path.join(runDir, 'run_manifest.json');
  const caseResultsPath = path.join(runDir, 'case_results.jsonl');

  const manifest = await loadRunManifest(manifestPath);
  const caseResults = (await readJsonLines(caseResultsPath)).map(normalizeCaseResult);
  const summary = summarizeCaseResults(caseResults);

  manifest.case_count = caseResults.length;
  manifest.summary = summary;

  await writeJsonFile(manifestPath, manifest);
  await writeTextFile(
    caseResultsPath,
    `${caseResults.map((result) => JSON.stringify(result)).join('\n')}\n`
  );
  await writeTextFile(path.join(runDir, 'summary.md'), renderSummaryMarkdown(manifest, summary, caseResults));

  process.stdout.write(`${runDir}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
