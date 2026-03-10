import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  API_BASE,
  ScenarioContext,
  ScenarioResult,
  WS_URL,
  WsHarness,
} from './_shared/harness';

import scenario01 from './01_session_bootstrap/scenario';
import scenario02 from './02_session_continuation/scenario';
import scenario03 from './03_sse_realtime_incremental/scenario';
import scenario04 from './04_persistence_refresh_consistency/scenario';
import scenario05 from './05_completion_signal/scenario';

const scenarios: Array<{ name: string; run: (ctx: ScenarioContext) => Promise<ScenarioResult> }> = [
  { name: '01_session_bootstrap', run: scenario01 },
  { name: '02_session_continuation', run: scenario02 },
  { name: '03_sse_realtime_incremental', run: scenario03 },
  { name: '04_persistence_refresh_consistency', run: scenario04 },
  { name: '05_completion_signal', run: scenario05 },
];

const ROUND_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.DIRECT_TEST_MAX_ROUND_MS || 10 * 60 * 1000)
);
const SCENARIO_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.DIRECT_TEST_MAX_SCENARIO_MS || 2 * 60 * 1000)
);

function withTimeout<T>(label: string, timeoutMs: number, task: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[timeout] ${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    task
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function writeReport(result: {
  suiteId: string;
  apiBase: string;
  wsUrl: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  sessionId?: string;
  opencodeSessionId?: string;
  orchestratorSessionId?: string;
  scenarioResults: ScenarioResult[];
  error?: string;
}) {
  const reportsDir = path.resolve(process.cwd(), 'tests/opencode-sandbox-direct/reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  const jsonPath = path.join(reportsDir, `direct-mode-suite-${ts}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf8');

  const lines = [
    '# OpenCode Sandbox直通模式测试报告',
    '',
    `- suiteId: ${result.suiteId}`,
    `- startedAt: ${result.startedAt}`,
    `- finishedAt: ${result.finishedAt}`,
    `- passed: ${result.passed}`,
    `- apiBase: ${result.apiBase}`,
    `- wsUrl: ${result.wsUrl}`,
    `- sessionId: ${result.sessionId || '-'}`,
    `- opencodeSessionId: ${result.opencodeSessionId || '-'}`,
    `- orchestratorSessionId: ${result.orchestratorSessionId || '-'}`,
    '',
    '## 场景结果',
  ];

  for (const item of result.scenarioResults) {
    lines.push(`- ${item.name}: ${item.passed ? 'PASS' : 'FAIL'}`);
  }

  if (result.error) {
    lines.push('', '## 失败原因', result.error);
  }

  const mdPath = path.join(reportsDir, `direct-mode-suite-${ts}.md`);
  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(`[suite] json report: ${jsonPath}`);
  console.log(`[suite] markdown report: ${mdPath}`);
}

function buildFailureResult(name: string, error: unknown): ScenarioResult {
  const now = new Date().toISOString();
  const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
  return {
    name,
    passed: false,
    startedAt: now,
    finishedAt: now,
    details: {
      error: message,
    },
  };
}

async function main() {
  const suiteId = Date.now().toString(36);
  const startedAt = new Date().toISOString();
  const scenarioResults: ScenarioResult[] = [];
  let ws: WsHarness | null = null;
  let roundTimeoutTriggered = false;

  // Hard stop watchdog: guarantees a stuck run cannot exceed round timeout indefinitely.
  const hardStop = setTimeout(() => {
    console.error(
      `[suite] hard-timeout reached (${ROUND_TIMEOUT_MS}ms). Force exiting to avoid endless hang.`
    );
    process.exit(124);
  }, ROUND_TIMEOUT_MS + 5_000);
  hardStop.unref();

  const ctx: ScenarioContext = {
    suiteId,
    ws: null as unknown as WsHarness,
    prompts: [],
  };

  try {
    console.log(`[suite] API_BASE=${API_BASE}`);
    console.log(`[suite] WS_URL=${WS_URL}`);
    console.log(`[suite] ROUND_TIMEOUT_MS=${ROUND_TIMEOUT_MS}`);
    console.log(`[suite] SCENARIO_TIMEOUT_MS=${SCENARIO_TIMEOUT_MS}`);

    ws = await withTimeout('ws.connect', Math.min(60_000, ROUND_TIMEOUT_MS), WsHarness.connect(WS_URL, 20000));
    ctx.ws = ws;
    await withTimeout('ws.waitForWelcome', Math.min(30_000, ROUND_TIMEOUT_MS), ws.waitForWelcome(15000));

    for (const scenario of scenarios) {
      const roundElapsed = Date.now() - Date.parse(startedAt);
      const roundRemaining = ROUND_TIMEOUT_MS - roundElapsed;
      if (roundRemaining <= 0) {
        roundTimeoutTriggered = true;
        scenarioResults.push(
          buildFailureResult(
            scenario.name,
            new Error(`[timeout] round budget exhausted before ${scenario.name}`)
          )
        );
        break;
      }

      try {
        const scenarioTimeout = Math.max(15_000, Math.min(SCENARIO_TIMEOUT_MS, roundRemaining));
        const result = await withTimeout(
          `scenario.${scenario.name}`,
          scenarioTimeout,
          scenario.run(ctx)
        );
        scenarioResults.push(result);
      } catch (error) {
        console.error(`[suite] ${scenario.name} failed:`, error);
        scenarioResults.push(buildFailureResult(scenario.name, error));
        if (String((error as Error)?.message || '').includes('[timeout]')) {
          roundTimeoutTriggered = true;
          break;
        }
      }
    }

    // 至少首场景成功后才有 sessionId；若没有说明链路基础失败。
    assert.ok(
      scenarioResults.length > 0,
      'scenario results should not be empty'
    );

    const allPassed = scenarioResults.every((item) => item.passed);
    const finishedAt = new Date().toISOString();
    const recentWsMessages = ctx.ws?.messages?.slice(-20) || [];

    await writeReport({
      suiteId,
      apiBase: API_BASE,
      wsUrl: WS_URL,
      startedAt,
      finishedAt,
      passed: allPassed,
      sessionId: ctx.sessionId,
      opencodeSessionId: ctx.opencodeSessionId,
      orchestratorSessionId: ctx.orchestratorSessionId,
      scenarioResults,
      error: allPassed
        ? undefined
        : `recentWsMessages=${JSON.stringify(recentWsMessages, null, 2)}`,
    });

    if (roundTimeoutTriggered) {
      console.error('\n[suite] round timeout triggered, stopped remaining scenarios');
      process.exitCode = 1;
      return;
    }

    if (allPassed) {
      console.log('\n[suite] 全部场景通过');
      return;
    }

    console.error('\n[suite] 存在失败场景，请查看 reports 报告');
    process.exitCode = 1;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message =
      error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    try {
      await writeReport({
        suiteId,
        apiBase: API_BASE,
        wsUrl: WS_URL,
        startedAt,
        finishedAt,
        passed: false,
        sessionId: ctx.sessionId,
        opencodeSessionId: ctx.opencodeSessionId,
        orchestratorSessionId: ctx.orchestratorSessionId,
        scenarioResults,
        error: message,
      });
    } catch (reportError) {
      console.error('[suite] 写入报告失败:', reportError);
    }
    console.error('\n[suite] 执行异常:', error);
    process.exitCode = 1;
  } finally {
    ws?.close();
    clearTimeout(hardStop);
  }
}

void main().finally(() => {
  // 保底退出，避免遗留连接句柄导致测试进程卡住。
  const code = process.exitCode ?? 0;
  setTimeout(() => process.exit(code), 50);
});
