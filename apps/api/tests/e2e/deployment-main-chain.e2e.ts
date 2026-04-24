import '../../src/config/env';

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { e2bConnector } from '../../src/connectors/e2b-connector';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
} from '../../src/db/dao';

type JsonRecord = Record<string, any>;

type ApiResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

type CookieSession = {
  cookie: string;
};

type TestReport = {
  startedAt: string;
  finishedAt?: string;
  apiBase: string;
  marker: string;
  userEmail?: string;
  sessionId?: string;
  runId?: string;
  orchestratorSessionId?: string;
  publicUrl?: string;
  deploymentStatus?: string;
  bindingState?: string;
  providerErrorCode?: string;
  analyticsStatus?: string;
  sandboxCleanup?: string;
  sessionCleanup?: string;
  passed: boolean;
  checkpoints: Array<{
    name: string;
    status: 'passed' | 'failed';
    details?: Record<string, unknown>;
  }>;
  error?: string;
};

const API_BASE = String(process.env.ONECEO_E2E_API_BASE || `http://127.0.0.1:${process.env.PORT || '4000'}`).replace(/\/+$/, '');
const HEALTH_URL = `${API_BASE}/health`;
const RUN_TIMEOUT_MS = Math.max(5 * 60_000, Number(process.env.ONECEO_E2E_RUN_TIMEOUT_MS || 12 * 60_000));
const DEPLOY_TIMEOUT_MS = Math.max(5 * 60_000, Number(process.env.ONECEO_E2E_DEPLOY_TIMEOUT_MS || 15 * 60_000));
const URL_TIMEOUT_MS = Math.max(60_000, Number(process.env.ONECEO_E2E_URL_TIMEOUT_MS || 5 * 60_000));
const POLL_INTERVAL_MS = Math.max(2_000, Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5_000));
const KEEP_RESOURCES = ['1', 'true', 'yes', 'on'].includes(String(process.env.ONECEO_E2E_KEEP_RESOURCES || '').trim().toLowerCase());

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeReport(report: TestReport) {
  const reportsDir = path.resolve(process.cwd(), 'tests/e2e/reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = nowStamp();
  const jsonPath = path.join(reportsDir, `deployment-main-chain-${stamp}.json`);
  const mdPath = path.join(reportsDir, `deployment-main-chain-${stamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Deployment Main Chain E2E',
    '',
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt || '-'}`,
    `- apiBase: ${report.apiBase}`,
    `- marker: ${report.marker}`,
    `- userEmail: ${report.userEmail || '-'}`,
    `- sessionId: ${report.sessionId || '-'}`,
    `- runId: ${report.runId || '-'}`,
    `- orchestratorSessionId: ${report.orchestratorSessionId || '-'}`,
    `- publicUrl: ${report.publicUrl || '-'}`,
    `- deploymentStatus: ${report.deploymentStatus || '-'}`,
    `- bindingState: ${report.bindingState || '-'}`,
    `- providerErrorCode: ${report.providerErrorCode || '-'}`,
    `- analyticsStatus: ${report.analyticsStatus || '-'}`,
    `- sandboxCleanup: ${report.sandboxCleanup || '-'}`,
    `- sessionCleanup: ${report.sessionCleanup || '-'}`,
    `- passed: ${report.passed}`,
    '',
    '## Checkpoints',
    ...report.checkpoints.map((item) => `- ${item.name}: ${item.status}`),
  ];

  if (report.error) {
    lines.push('', '## Error', '', '```text', report.error, '```');
  }

  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[e2e] json report: ${jsonPath}`);
  console.log(`[e2e] markdown report: ${mdPath}`);
}

function requireCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/app_session_v2_id=([^;]+)/);
  assert.ok(match?.[1], 'register response should set app_session_v2_id cookie');
  return `app_session_v2_id=${match[1]}`;
}

async function requestJson<T>(
  input: string,
  init?: RequestInit & { cookie?: string; expectedStatus?: number }
): Promise<{ response: Response; body: ApiResult<T> | T }> {
  const headers = new Headers(init?.headers || {});
  if (init?.cookie) {
    headers.set('cookie', init.cookie);
  }
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });
  if (typeof init?.expectedStatus === 'number') {
    assert.equal(response.status, init.expectedStatus, `unexpected status for ${input}`);
  }
  let body: ApiResult<T> | T;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : ({} as ApiResult<T>);
  } catch (error) {
    throw new Error(`failed to parse JSON from ${input}: ${text.slice(0, 400)}`);
  }
  return { response, body };
}

async function getApiData<T>(url: string, cookie: string): Promise<T> {
  const { response, body } = await requestJson<T>(url, {
    method: 'GET',
    cookie,
  });
  assert.equal(response.ok, true, `GET ${url} failed: ${JSON.stringify(body)}`);
  assert.ok((body as ApiResult<T>).success !== false, `GET ${url} returned success=false`);
  return ((body as ApiResult<T>).data ?? body) as T;
}

async function postApiData<T>(url: string, cookie: string, payload?: unknown): Promise<T> {
  const { response, body } = await requestJson<T>(url, {
    method: 'POST',
    cookie,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  assert.equal(response.ok, true, `POST ${url} failed: ${JSON.stringify(body)}`);
  assert.ok((body as ApiResult<T>).success !== false, `POST ${url} returned success=false`);
  return ((body as ApiResult<T>).data ?? body) as T;
}

async function deleteApi(url: string, cookie: string) {
  const { response, body } = await requestJson<JsonRecord>(url, {
    method: 'DELETE',
    cookie,
  });
  assert.equal(response.ok, true, `DELETE ${url} failed: ${JSON.stringify(body)}`);
  assert.ok((body as ApiResult<JsonRecord>).success !== false, `DELETE ${url} returned success=false`);
}

async function waitForHealth() {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1500);
  }
  throw lastError instanceof Error ? lastError : new Error('API health check failed');
}

async function poll<T>(
  label: string,
  timeoutMs: number,
  predicate: () => Promise<T>,
  accept: (value: T) => boolean,
): Promise<T> {
  const started = Date.now();
  let lastValue: T | null = null;
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await predicate();
      lastValue = value;
      if (accept(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error(`[timeout] ${label} not ready: ${JSON.stringify(lastValue, null, 2)}`);
}

function buildGenerationPrompt(marker: string) {
  return [
    '在当前工作区直接创建一个最小可部署静态网页应用，不要提问，不要解释，不要部署。',
    '要求：',
    '1. 只使用原生 HTML/CSS/JavaScript，不要引入任何框架或外部依赖。',
    '2. 在工作区根目录创建 index.html、styles.css、app.js。',
    '3. 页面 title 必须是 "OneCEO Deployment E2E".',
    `4. 页面主体必须显著显示唯一标识 "${marker}"。`,
    '5. 页面还要包含一个按钮和一个计数器，点击按钮后计数递增，确保页面不是空白模板。',
    '6. index.html 必须引用 styles.css 和 app.js。',
    '7. 完成后只用一句话汇报结果。',
  ].join('\n');
}

async function fetchPublicHtml(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
  };
}

async function main() {
  const report: TestReport = {
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    marker: `ONECEO_E2E_MARKER_${Date.now().toString(36)}`,
    checkpoints: [],
    passed: false,
  };

  let cookieSession: CookieSession | null = null;
  let sessionId = '';
  let orchestratorSessionId = '';

  const checkpoint = (name: string, status: 'passed' | 'failed', details?: Record<string, unknown>) => {
    report.checkpoints.push({ name, status, details });
  };

  try {
    console.log(`[e2e] API_BASE=${API_BASE}`);
    console.log(`[e2e] marker=${report.marker}`);
    await waitForHealth();
    checkpoint('health', 'passed', { url: HEALTH_URL });

    const email = `oneceo-e2e-${Date.now()}@example.com`;
    const password = `Oneceo!${Date.now().toString(36)}`;
    report.userEmail = email;

    const register = await requestJson<{ user: JsonRecord }>(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        displayName: 'OneCEO E2E Runner',
      }),
      expectedStatus: 200,
    });
    cookieSession = { cookie: requireCookie(register.response) };
    assert.ok((register.body as ApiResult<{ user: JsonRecord }>).success, 'register should succeed');
    checkpoint('register', 'passed', {
      email,
    });

    const session = await postApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions`, cookieSession.cookie, {
      title: 'Railway Umami Deployment E2E',
      mode: 'altus',
    });
    sessionId = asText(session.id || session.sessionId);
    report.sessionId = sessionId;
    assert.ok(sessionId, 'session id should exist');
    checkpoint('create_session', 'passed', { sessionId });

    const runtime = await postApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/runtime/start`,
      cookieSession.cookie
    );
    orchestratorSessionId = asText(runtime.orchestratorSessionId || runtime.sessionId);
    report.orchestratorSessionId = orchestratorSessionId || undefined;
    checkpoint('runtime_start', 'passed', {
      orchestratorSessionId: orchestratorSessionId || null,
    });

    const sessionMeta = await poll<JsonRecord>(
      'session runtime ready',
      2 * 60_000,
      async () => getApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions/${sessionId}`, cookieSession!.cookie),
      (value) => {
        const runtimeId = asText(value?.runtime?.orchestratorSessionId);
        const runtimeStatus = asText(value?.runtimeStatus?.status).toLowerCase();
        return Boolean(runtimeId) && runtimeStatus !== 'failed';
      }
    );
    orchestratorSessionId = asText(sessionMeta?.runtime?.orchestratorSessionId) || orchestratorSessionId;
    report.orchestratorSessionId = orchestratorSessionId || undefined;
    assert.ok(orchestratorSessionId, 'orchestratorSessionId should exist after runtime start');
    checkpoint('runtime_session_meta', 'passed', {
      orchestratorSessionId,
      runtimeStatus: sessionMeta?.runtimeStatus?.status || null,
    });

    const runStart = await postApiData<JsonRecord>(`${API_BASE}/api/altus-managed/inputs`, cookieSession.cookie, {
      sessionId,
      content: buildGenerationPrompt(report.marker),
      metadata: {
        source: 'deployment_main_chain_e2e',
      },
    });
    const runId = asText(runStart?.run?.id || runStart?.run?.runId);
    report.runId = runId || undefined;
    assert.ok(runId, 'run id should exist');
    checkpoint('managed_input_submit', 'passed', { runId });

    const latestRun = await poll<JsonRecord>(
      'managed run terminal',
      RUN_TIMEOUT_MS,
      async () => getApiData<JsonRecord>(`${API_BASE}/api/altus-managed/sessions/${sessionId}/runs/latest`, cookieSession!.cookie),
      (value) => {
        const status = asText(value?.status).toLowerCase();
        return ['completed', 'failed', 'stopped', 'waiting_user'].includes(status);
      }
    );
    const latestRunStatus = asText(latestRun.status).toLowerCase();
    const persistedRun = await taskSessionRunDAO.getRun(runId);
    assert.ok(persistedRun, 'run should persist in DB');
    assert.notEqual(latestRunStatus, 'failed', 'managed run should not fail');
    assert.notEqual(latestRunStatus, 'stopped', 'managed run should not stop');
    assert.notEqual(latestRunStatus, 'waiting_user', 'managed run should not ask for clarification');
    checkpoint('managed_run_completed', 'passed', {
      runStatus: latestRunStatus,
      dbRunStatus: persistedRun?.status || null,
    });

    const workspaceTree = await getApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/workspace/tree?refresh=1&depth=4&maxEntries=200`,
      cookieSession.cookie
    );
    const treeText = JSON.stringify(workspaceTree);
    assert.match(treeText, /index\.html/i);
    assert.match(treeText, /styles\.css/i);
    assert.match(treeText, /app\.js/i);
    checkpoint('workspace_tree', 'passed', {
      containsIndex: /index\.html/i.test(treeText),
      containsStyles: /styles\.css/i.test(treeText),
      containsAppJs: /app\.js/i.test(treeText),
    });

    const indexFile = await getApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/workspace/file?path=${encodeURIComponent('index.html')}&refresh=1`,
      cookieSession.cookie
    );
    assert.equal(indexFile.isBinary, false, 'index.html should be text');
    assert.match(String(indexFile.content || ''), new RegExp(report.marker));
    checkpoint('workspace_index_html', 'passed', {
      path: indexFile.path || 'index.html',
      markerFound: true,
    });

    const baseline = await getApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/deployment/template`,
      cookieSession.cookie
    );
    assert.ok(Boolean(baseline.workspaceDetected), 'deployment template should detect workspace');
    checkpoint('deployment_template_baseline', 'passed', {
      status: baseline.status || null,
      analyticsMode: baseline.analyticsMode || null,
      errors: Array.isArray(baseline.errors) ? baseline.errors : [],
      warnings: Array.isArray(baseline.warnings) ? baseline.warnings : [],
    });

    const deployPanel = await postApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/deployment/deploy`,
      cookieSession.cookie
    );
    assert.ok(asText(deployPanel.bindingState), 'deploy panel should return bindingState');
    checkpoint('deployment_trigger', 'passed', {
      bindingState: deployPanel.bindingState || null,
      provisioningPhase: deployPanel.provisioningPhase || null,
    });

    const finalDeployment = await poll<JsonRecord>(
      'deployment panel settled',
      DEPLOY_TIMEOUT_MS,
      async () => getApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions/${sessionId}/deployment`, cookieSession!.cookie),
      (value) => {
        const state = asText(value?.bindingState).toLowerCase();
        const latestStatus = asText(value?.latestStatus).toLowerCase();
        if (state === 'repair_required' || state === 'provider_error') {
          return true;
        }
        if (state === 'ready' && (value?.latestUrl || value?.latestStaticUrl || (Array.isArray(value?.domains) && value.domains.length > 0))) {
          return true;
        }
        return ['success', 'deployed', 'active'].includes(latestStatus);
      }
    );

    report.deploymentStatus = asText(finalDeployment.latestStatus) || undefined;
    report.bindingState = asText(finalDeployment.bindingState) || undefined;
    report.providerErrorCode = asText(finalDeployment.providerErrorCode) || undefined;
    report.analyticsStatus = asText(finalDeployment.analytics?.status) || undefined;

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    assert.ok(environment, 'sandbox environment row should exist');
    const environmentMetadata = (environment?.metadata || {}) as JsonRecord;
    assert.ok(environmentMetadata.deploymentState, 'deploymentState should be written to sandbox metadata');
    checkpoint('deployment_state_persisted', 'passed', {
      bindingState: environmentMetadata.deploymentState?.bindingState || null,
      provisioningPhase: environmentMetadata.deploymentState?.provisioningPhase || null,
      providerErrorCode: environmentMetadata.deploymentState?.providerErrorCode || null,
    });

    const publicUrl =
      asText(finalDeployment.latestUrl) ||
      asText(finalDeployment.latestStaticUrl) ||
      (Array.isArray(finalDeployment.domains) && finalDeployment.domains.length > 0
        ? asText(finalDeployment.domains[0])
        : '');
    if (publicUrl) {
      report.publicUrl = publicUrl;
      const publicPage = await poll<{ status: number; text: string }>(
        'public deployment reachable',
        URL_TIMEOUT_MS,
        async () => fetchPublicHtml(publicUrl),
        (value) => value.status === 200 && value.text.includes(report.marker)
      );
      assert.match(publicPage.text, /window\.__ONECEO_ANALYTICS__/);
      assert.doesNotMatch(publicPage.text, /%VITE_[A-Z0-9_]+%/);
      checkpoint('public_url_reachable', 'passed', {
        publicUrl,
        status: publicPage.status,
        markerFound: publicPage.text.includes(report.marker),
        analyticsBootstrapFound: /window\.__ONECEO_ANALYTICS__/.test(publicPage.text),
      });

      const analyticsAfterVisit = await poll<JsonRecord>(
        'analytics status after visit',
        2 * 60_000,
        async () => getApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions/${sessionId}/deployment`, cookieSession!.cookie),
        (value) => {
          const status = asText(value?.analytics?.status).toLowerCase();
          return status === 'bound' || status === 'tracking';
        }
      );
      report.analyticsStatus = asText(analyticsAfterVisit.analytics?.status) || report.analyticsStatus;
      checkpoint('analytics_status', 'passed', {
        analyticsStatus: analyticsAfterVisit.analytics?.status || null,
        pageviews: analyticsAfterVisit.analytics?.pageviews ?? null,
        visits: analyticsAfterVisit.analytics?.visits ?? null,
      });
    } else {
      assert.ok(
        report.bindingState === 'repair_required' || report.bindingState === 'provider_error',
        'missing public URL is only acceptable with explicit repair/provider state'
      );
      checkpoint('deployment_provider_state', 'passed', {
        bindingState: report.bindingState || null,
        providerErrorCode: report.providerErrorCode || null,
      });
    }

    const dbSession = await taskCreationSessionDAO.getSession(sessionId);
    assert.ok(dbSession, 'session should exist in DB during run');
    checkpoint('db_session_exists', 'passed', {
      dbStatus: dbSession?.status || null,
    });

    report.passed = true;
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    report.error = message;
    checkpoint('failure', 'failed', { message });
    throw error;
  } finally {
    if (!KEEP_RESOURCES) {
      if (orchestratorSessionId) {
        try {
          await e2bConnector.killSandbox(orchestratorSessionId);
          await sandboxExecutionEnvironmentDAO.updateStatus(orchestratorSessionId, 'closed');
          report.sandboxCleanup = 'killed';
        } catch (error) {
          report.sandboxCleanup = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (cookieSession?.cookie && sessionId) {
        try {
          await deleteApi(`${API_BASE}/api/task-creation/sessions/${sessionId}`, cookieSession.cookie);
          report.sessionCleanup = 'deleted';
        } catch (error) {
          report.sessionCleanup = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } else {
      report.sandboxCleanup = 'skipped_by_env';
      report.sessionCleanup = 'skipped_by_env';
    }

    report.finishedAt = new Date().toISOString();
    try {
      await writeReport(report);
    } catch (reportError) {
      console.error('[e2e] write report failed:', reportError);
    }
  }
}

void main()
  .then(() => {
    console.log('[e2e] deployment main chain passed');
  })
  .catch((error) => {
    console.error('[e2e] deployment main chain failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
