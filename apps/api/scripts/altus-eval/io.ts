import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ZodSchema } from 'zod';

import type { CaseResult, EvalCase, EvalSuite, RunManifest, RunSummary } from './types.js';
import { CaseResultSchema, EvalSuiteSchema, RunManifestSchema } from './types.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const API_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const REPO_ROOT = path.resolve(API_ROOT, '..', '..');
export const DEFAULT_SUITE_PATH = path.join(
  REPO_ROOT,
  'docs',
  '智能体能力测试题库',
  '题库种子',
  'altus_eval_seed_v1.json'
);
export const DEFAULT_RESULTS_ROOT = path.join(REPO_ROOT, 'docs', '智能体能力测试题库', '结果归档');

export type CliOptions = Record<string, string | boolean>;

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

export async function ensureDir(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

export async function readJsonFile<T>(filePath: string, schema: ZodSchema<T>): Promise<T> {
  const content = await readFile(filePath, 'utf8');
  return schema.parse(JSON.parse(content));
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  const content = values.map((value) => JSON.stringify(value)).join('\n');
  await writeFile(filePath, `${content}\n`, 'utf8');
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, 'utf8');
}

export async function readJsonLines(filePath: string): Promise<CaseResult[]> {
  const content = await readFile(filePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => CaseResultSchema.parse(JSON.parse(line)));
}

export async function loadSuite(filePath: string): Promise<EvalSuite> {
  return readJsonFile(filePath, EvalSuiteSchema);
}

export async function loadRunManifest(filePath: string): Promise<RunManifest> {
  return readJsonFile(filePath, RunManifestSchema);
}

export function selectCases(suite: EvalSuite, options: CliOptions): EvalCase[] {
  const casesOption = typeof options.cases === 'string' ? options.cases : '';
  if (casesOption) {
    const selectedIds = new Set(
      casesOption
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
    return suite.cases.filter((testCase) => selectedIds.has(testCase.case_id));
  }

  if (options.smoke === true) {
    const selectedIds = new Set(suite.smoke_case_ids);
    return suite.cases.filter((testCase) => selectedIds.has(testCase.case_id));
  }

  return suite.cases;
}

export function getGitInfo(): { branch: string; commit: string } {
  return {
    branch: safeGit(['branch', '--show-current']),
    commit: safeGit(['rev-parse', 'HEAD']),
  };
}

function safeGit(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function buildRunId(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    'run',
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

export function buildDateStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export function renderSummaryMarkdown(
  manifest: RunManifest,
  summary: RunSummary,
  caseResults: CaseResult[]
): string {
  const hardFailCases = caseResults
    .filter((result) => result.status === 'failed_hard')
    .map((result) => `- ${result.case_id}`);

  const categoryLines = Object.entries(summary.category_average_scores)
    .map(([category, score]) => `- ${category}: ${score}`)
    .join('\n');

  return [
    '# Run Summary',
    '',
    '## Run Info',
    '',
    `- run_id: ${manifest.run_id}`,
    `- suite_id: ${manifest.suite_id}`,
    `- suite_version: ${manifest.suite_version}`,
    `- executed_at: ${manifest.executed_at}`,
    `- branch: ${manifest.git.branch || '(unknown)'}`,
    `- commit: ${manifest.git.commit || '(unknown)'}`,
    `- model: ${manifest.model_config.provider}/${manifest.model_config.model}`,
    `- environment: ${manifest.environment.mode} ${manifest.environment.base_url}`,
    '',
    '## Summary',
    '',
    `- total cases: ${summary.total_cases}`,
    `- executed cases: ${summary.executed_cases}`,
    `- passed: ${summary.passed}`,
    `- failed_soft: ${summary.failed_soft}`,
    `- failed_hard: ${summary.failed_hard}`,
    `- blocked: ${summary.blocked}`,
    `- not_run: ${summary.not_run}`,
    `- average_score: ${summary.average_score}`,
    '',
    '## Category Scores',
    '',
    categoryLines || '- (no executed category scores)',
    '',
    '## Hard Fail Cases',
    '',
    hardFailCases.length > 0 ? hardFailCases.join('\n') : '- none',
    '',
    '## Notes',
    '',
    '- Generated by apps/api/scripts/altus-eval',
    '',
  ].join('\n');
}
