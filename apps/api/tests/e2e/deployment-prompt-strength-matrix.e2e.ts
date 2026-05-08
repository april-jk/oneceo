import '../../src/config/env';

import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

type PromptCase = {
  id: string;
  category: 'strong_constraints' | 'weak_constraints';
  label: string;
  promptText: string;
};

type CaseResult = {
  id: string;
  category: PromptCase['category'];
  label: string;
  passed: boolean;
  sessionId?: string;
  publicUrl?: string;
  deploymentStatus?: string;
  bindingState?: string;
  analyticsStatus?: string;
  checkpoints?: Array<{ name: string; status: 'passed' | 'failed'; details?: Record<string, unknown> }>;
  reportPath?: string;
  error?: string;
};

const API_PORT = process.env.PORT || '4000';
const API_BASE = String(process.env.ONECEO_E2E_API_BASE || `http://127.0.0.1:${API_PORT}`).replace(/\/+$/, '');
const REPORTS_DIR = path.resolve(process.cwd(), 'tests/e2e/reports');
const FILTER = String(process.env.ONECEO_E2E_CASE_FILTER || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const CASES: PromptCase[] = [
  {
    id: 'strong-enterprise-official-shell',
    category: 'strong_constraints',
    label: '企业官网固定模板',
    promptText: [
      '请在当前工作区直接创建一个可部署的网站，不要提问，不要部署，只完成源码。',
      '必须满足以下技术约束：',
      '1. 使用 OneCEO 官方固定模板壳：根目录必须有 client/、server/、shared/。',
      '2. 前端使用 Vite + React，服务端使用 Node + Express。',
      '3. package.json 的生产构建必须输出 dist/public 和 dist/index.js，生产启动必须是 node dist/index.js。',
      '4. 必须存在 oneceo.manifest.json，healthcheck 使用 /api/system/health。',
      '5. 网站是 AI 咨询公司的企业官网，至少包含 hero、服务介绍、案例、联系区域。',
      '6. 页面主体必须显著显示唯一标识 "__ONECEO_E2E_MARKER__"。',
      '7. 完成后只用一句话汇报结果。',
    ].join('\n'),
  },
  {
    id: 'strong-saas-dashboard-shell',
    category: 'strong_constraints',
    label: 'SaaS 落地页固定模板',
    promptText: [
      '请在当前工作区直接创建一个可部署的网站，不要提问，不要部署，只完成源码。',
      '技术要求：',
      '1. 严格使用 OneCEO 官方固定模板壳 client/server/shared。',
      '2. 使用 Vite + React + Node/Express，不要自由切换到其他语言或运行时。',
      '3. build/start 契约必须分别收敛到 dist/public 和 node dist/index.js。',
      '4. 网站主题是面向零售门店的 SaaS 产品落地页，要有产品价值、功能模块、价格方案、CTA 按钮。',
      '5. 页面主体必须显著显示唯一标识 "__ONECEO_E2E_MARKER__"。',
      '6. 完成后只用一句话汇报结果。',
    ].join('\n'),
  },
  {
    id: 'weak-restaurant-site',
    category: 'weak_constraints',
    label: '餐厅官网弱约束',
    promptText: [
      '帮我生成一个餐厅官网，直接在当前工作区完成源码，不要提问。',
      '页面里必须显著显示 "__ONECEO_E2E_MARKER__"。',
      '完成后只用一句话汇报结果。',
    ].join('\n'),
  },
  {
    id: 'weak-studio-site',
    category: 'weak_constraints',
    label: '设计工作室官网弱约束',
    promptText: [
      '帮我做一个设计工作室网站，直接在当前工作区完成源码，不要提问。',
      '页面里必须显著显示 "__ONECEO_E2E_MARKER__"。',
      '完成后只用一句话汇报结果。',
    ].join('\n'),
  },
];

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function runCase(testCase: PromptCase): Promise<CaseResult> {
  const tag = `${testCase.category}-${testCase.id}-${Date.now().toString(36)}`;
  const env = {
    ...process.env,
    ONECEO_E2E_API_BASE: API_BASE,
    ONECEO_E2E_PROMPT_CATEGORY: testCase.category,
    ONECEO_E2E_PROMPT_LABEL: testCase.label,
    ONECEO_E2E_PROMPT_TEXT: testCase.promptText,
    ONECEO_E2E_REPORT_TAG: tag,
  };

  try {
    const { stdout, stderr } = await execFile(
      process.execPath,
      ['--import', 'tsx', 'tests/e2e/deployment-main-chain.e2e.ts'],
      {
        cwd: process.cwd(),
        env,
        maxBuffer: 8 * 1024 * 1024,
      }
    );
    const combined = `${stdout}\n${stderr}`.trim();
    const reportMatch = combined.match(/\[e2e\] json report: (.+\.json)/);
    assert.ok(reportMatch?.[1], `missing report path for ${testCase.id}`);
    const reportPath = reportMatch[1].trim();
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as Record<string, any>;
    return {
      id: testCase.id,
      category: testCase.category,
      label: testCase.label,
      passed: Boolean(report.passed),
      sessionId: asText(report.sessionId) || undefined,
      publicUrl: asText(report.publicUrl) || undefined,
      deploymentStatus: asText(report.deploymentStatus) || undefined,
      bindingState: asText(report.bindingState) || undefined,
      analyticsStatus: asText(report.analyticsStatus) || undefined,
      checkpoints: Array.isArray(report.checkpoints) ? report.checkpoints : [],
      reportPath,
      error: asText(report.error) || undefined,
    };
  } catch (error: any) {
    return {
      id: testCase.id,
      category: testCase.category,
      label: testCase.label,
      passed: false,
      error:
        asText(error?.stdout) ||
        asText(error?.stderr) ||
        asText(error?.message) ||
        'e2e process failed',
    };
  }
}

async function writeMatrixReport(results: CaseResult[]) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = nowStamp();
  const jsonPath = path.join(REPORTS_DIR, `deployment-prompt-strength-matrix-${stamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `deployment-prompt-strength-matrix-${stamp}.md`);

  const summary = {
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    total: results.length,
    strongCount: results.filter((item) => item.category === 'strong_constraints').length,
    weakCount: results.filter((item) => item.category === 'weak_constraints').length,
    strongPassed: results.filter((item) => item.category === 'strong_constraints' && item.passed).length,
    weakPassed: results.filter((item) => item.category === 'weak_constraints' && item.passed).length,
    results,
  };

  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const lines = [
    '# Deployment Prompt Strength Matrix',
    '',
    `- apiBase: ${API_BASE}`,
    `- total: ${summary.total}`,
    `- strongPassed: ${summary.strongPassed}/${summary.strongCount}`,
    `- weakPassed: ${summary.weakPassed}/${summary.weakCount}`,
    '',
    '| Case | Category | Passed | Binding | Deploy | Analytics | Public URL |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (item) =>
        `| ${item.label} | ${item.category} | ${item.passed ? 'yes' : 'no'} | ${item.bindingState || '-'} | ${item.deploymentStatus || '-'} | ${item.analyticsStatus || '-'} | ${item.publicUrl || '-'} |`
    ),
  ];

  for (const item of results) {
    lines.push('', `## ${item.label}`, '');
    lines.push(`- category: ${item.category}`);
    lines.push(`- passed: ${item.passed}`);
    lines.push(`- bindingState: ${item.bindingState || '-'}`);
    lines.push(`- deploymentStatus: ${item.deploymentStatus || '-'}`);
    lines.push(`- analyticsStatus: ${item.analyticsStatus || '-'}`);
    lines.push(`- publicUrl: ${item.publicUrl || '-'}`);
    lines.push(`- reportPath: ${item.reportPath || '-'}`);
    if (item.error) {
      lines.push(`- error: ${item.error}`);
    }
  }

  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[matrix] json report: ${jsonPath}`);
  console.log(`[matrix] markdown report: ${mdPath}`);
}

async function main() {
  const cases = FILTER.length > 0 ? CASES.filter((item) => FILTER.includes(item.id)) : CASES;
  assert.ok(cases.length > 0, 'no prompt strength cases selected');
  const results: CaseResult[] = [];
  for (const testCase of cases) {
    console.log(`[matrix] running ${testCase.id}`);
    const result = await runCase(testCase);
    results.push(result);
    console.log(
      `[matrix] ${testCase.id}: ${result.passed ? 'passed' : 'failed'} binding=${result.bindingState || '-'} deploy=${result.deploymentStatus || '-'}`
    );
  }
  await writeMatrixReport(results);
  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    throw new Error(`prompt strength matrix failed for: ${failed.map((item) => item.id).join(', ')}`);
  }
}

void main().catch((error) => {
  console.error('[matrix] failed:', error);
  process.exitCode = 1;
});
