import { chromium } from '@playwright/test';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://oneceo.ai:3000';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || WEB_BASE_URL;
const SESSION_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_SESSION_WAIT_TIMEOUT_MS || 30 * 60 * 1000);
const DEPLOY_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_DEPLOY_WAIT_TIMEOUT_MS || 30 * 60 * 1000);
const PUBLIC_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_PUBLIC_WAIT_TIMEOUT_MS || 10 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5000);
const CASE_FILTER = String(process.env.ONECEO_E2E_CASE_ID || '').trim();
const TEST_ACCOUNT_FILE = path.resolve(ROOT_DIR, 'web/e2e/playwright-test-account.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseLastJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJson(lines[index]);
    if (parsed) {
      return parsed;
    }
  }
  for (let cursor = trimmed.lastIndexOf('{'); cursor >= 0; cursor = trimmed.lastIndexOf('{', cursor - 1)) {
    const parsed = parseJson(trimmed.slice(cursor));
    if (parsed) {
      return parsed;
    }
  }
  return parseJson(trimmed);
}

function compact(text, limit = 240) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadTestAccount() {
  const raw = await fs.readFile(TEST_ACCOUNT_FILE, 'utf8');
  const parsed = parseJson(raw);
  if (!parsed?.email || !parsed?.password) {
    throw new Error(`invalid test account file: ${TEST_ACCOUNT_FILE}`);
  }
  return {
    email: process.env.ONECEO_E2E_USER_EMAIL || parsed.email,
    password: process.env.ONECEO_E2E_USER_PASSWORD || parsed.password,
    displayName: process.env.ONECEO_E2E_USER_DISPLAY_NAME || parsed.displayName || 'Playwright Test User',
  };
}

async function ensurePlaywrightTestUser(account) {
  const { stdout } = await execFile(
    'pnpm',
    ['--filter', 'api', 'exec', 'tsx', 'scripts/ensure-playwright-test-user.ts'],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ONECEO_E2E_USER_EMAIL: account.email,
        ONECEO_E2E_USER_PASSWORD: account.password,
        ONECEO_E2E_USER_DISPLAY_NAME: account.displayName,
      },
      maxBuffer: 1024 * 1024,
    },
  );
  const parsed = parseLastJsonObject(stdout);
  if (!parsed?.ok) {
    throw new Error(`failed to ensure playwright test user: ${stdout}`);
  }
  return parsed;
}

function extractAppSessionCookie(setCookieHeader) {
  const match = String(setCookieHeader || '').match(/(?:^|,\s*)app_session_v2_id=([^;,\s]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function loginViaApiAndSeedBrowser(context, account) {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `api login failed: ${payload?.error || payload?.message || text || response.status}`,
    );
  }
  const cookieValue = extractAppSessionCookie(response.headers.get('set-cookie'));
  if (!cookieValue) {
    throw new Error('api login succeeded but set-cookie missing app_session_v2_id');
  }
  const cookie = {
    name: 'app_session_v2_id',
    value: cookieValue,
    domain: new URL(WEB_BASE_URL).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  };
  await context.addCookies([cookie]);
  return cookieValue;
}

async function buildAuthCookieHeader(context, account) {
  const apiCookies = await context.cookies(API_BASE_URL);
  const webCookies = await context.cookies(WEB_BASE_URL);
  const merged = [...apiCookies, ...webCookies];
  const appSession = merged.find((item) => item.name === 'app_session_v2_id' && item.value);
  if (appSession?.value) {
    return `app_session_v2_id=${appSession.value}`;
  }
  const seededValue = await loginViaApiAndSeedBrowser(context, account);
  return `app_session_v2_id=${seededValue}`;
}

async function loginThroughUi(page, account) {
  await page.goto(`${WEB_BASE_URL}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: /登录|sign in/i }).click();
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
}

async function apiRequest(pathname, authCookieHeader, init = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      Cookie: authCookieHeader,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `request failed ${pathname}: ${payload?.error || payload?.message || text || response.status}`,
    );
  }
  return payload?.data ?? payload;
}

async function submitManagedInput(authCookieHeader, content, source) {
  return apiRequest('/api/altus-managed/inputs', authCookieHeader, {
    method: 'POST',
    body: JSON.stringify({
      content,
      metadata: { source },
    }),
  });
}

async function waitForRunStatus(page, sessionId, authCookieHeader, runId, timeoutMs, phaseLabel) {
  const startedAt = Date.now();
  let lastPrinted = '';
  while (Date.now() - startedAt < timeoutMs) {
    const latestRun = await apiRequest(
      `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs/latest`,
      authCookieHeader,
    );
    if (runId && latestRun?.id !== runId) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const descriptor = JSON.stringify({
      phaseLabel,
      runId: latestRun?.id,
      status: latestRun?.status,
      mode: latestRun?.mode,
      updatedAt: latestRun?.updatedAt,
    });
    if (descriptor !== lastPrinted) {
      console.log('[run]', descriptor);
      lastPrinted = descriptor;
    }
    const status = String(latestRun?.status || '').toLowerCase();
    if (status === 'waiting_user') {
      const answerBox = page.locator('textarea[placeholder="请输入问题回答..."]');
      if ((await answerBox.count()) > 0) {
        await answerBox.fill('请按最佳方案直接继续，不需要再提问。');
        await answerBox.press('Enter');
      } else {
        throw new Error(`${phaseLabel} waiting_user without visible clarification input`);
      }
      await sleep(2000);
      continue;
    }
    if (['completed', 'failed', 'stopped'].includes(status)) {
      return latestRun;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${phaseLabel} timed out after ${timeoutMs}ms`);
}

async function waitForNewRun(sessionId, authCookieHeader, previousRunId, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const latestRun = await apiRequest(
      `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs/latest`,
      authCookieHeader,
    );
    if (latestRun?.id && latestRun.id !== previousRunId) {
      return latestRun;
    }
    await sleep(1500);
  }
  throw new Error('new run was not created');
}

async function waitForWorkspaceEvidence(sessionId, authCookieHeader) {
  const tree = await apiRequest(
    `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/workspace/tree?refresh=1&depth=6&maxEntries=400`,
    authCookieHeader,
  );
  const items = Array.isArray(tree?.items) ? tree.items : [];
  const text = JSON.stringify(items);
  return {
    tree,
    items,
    serialized: text,
  };
}

async function waitForDeploymentSuccess(sessionId, authCookieHeader, timeoutMs = DEPLOY_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastPrinted = '';
  while (Date.now() - startedAt < timeoutMs) {
    const panel = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deployment`,
      authCookieHeader,
    );
    const descriptor = JSON.stringify({
      bindingState: panel?.bindingState,
      latestStatus: panel?.latestStatus,
      latestUrl: panel?.latestUrl,
      latestStaticUrl: panel?.latestStaticUrl,
      providerErrorCode: panel?.providerErrorCode,
      provisioningPhase: panel?.provisioningPhase,
    });
    if (descriptor !== lastPrinted) {
      console.log('[deploy]', descriptor);
      lastPrinted = descriptor;
    }
    const latestStatus = String(panel?.latestStatus || '').toLowerCase();
    const bindingState = String(panel?.bindingState || '').toLowerCase();
    if (
      (bindingState === 'ready' || ['success', 'deployed', 'active'].includes(latestStatus)) &&
      (panel?.latestUrl || panel?.latestStaticUrl)
    ) {
      return panel;
    }
    if (bindingState === 'provider_error' || bindingState === 'repair_required' || latestStatus === 'failed') {
      throw new Error(`deployment ended in ${bindingState || latestStatus}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('deployment timed out');
}

async function waitForNoDeploymentPublicUrl(sessionId, authCookieHeader, quietWindowMs = 12_000) {
  const startedAt = Date.now();
  let lastPanel = null;
  while (Date.now() - startedAt < quietWindowMs) {
    const panel = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deployment`,
      authCookieHeader,
    );
    lastPanel = panel;
    if (panel?.latestUrl || panel?.latestStaticUrl) {
      throw new Error(`unexpected deployment public url: ${panel.latestUrl || panel.latestStaticUrl}`);
    }
    await sleep(3000);
  }
  return lastPanel;
}

async function waitForPublicPage(url, expectedRegex) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PUBLIC_WAIT_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      const text = await response.text();
      if (response.status === 200 && expectedRegex.test(text)) {
        return { status: response.status, text };
      }
    } catch {}
    await sleep(5000);
  }
  throw new Error(`public page not ready: ${url}`);
}

async function collectEvidence(sessionId) {
  const { stdout } = await execFile(
    'pnpm',
    ['--filter', 'api', 'exec', 'tsx', 'scripts/collect-website-deploy-e2e-evidence.ts', sessionId],
    {
      cwd: ROOT_DIR,
      env: process.env,
      maxBuffer: 1024 * 1024 * 4,
    },
  );
  const parsed = parseLastJsonObject(stdout);
  if (!parsed?.ok) {
    throw new Error(`failed to collect evidence: ${stdout}`);
  }
  return parsed;
}

function hasWorkspaceIndicator(workspaceEvidence, indicators) {
  const serializedTree = String(workspaceEvidence?.serialized || '');
  const paths = Array.isArray(workspaceEvidence?.items)
    ? workspaceEvidence.items
        .map((item) => String(item?.path || '').trim())
        .filter(Boolean)
    : [];
  return indicators.every((pattern) => {
    const pathMatched = paths.some((itemPath) => {
      pattern.lastIndex = 0;
      return pattern.test(itemPath);
    });
    if (pathMatched) {
      return true;
    }
    pattern.lastIndex = 0;
    return pattern.test(serializedTree);
  });
}

function buildTaggedPrompt(prompt, caseId, stamp) {
  return `${prompt}\n\n[playwright-language-matrix:${caseId}:${stamp}]`;
}

async function runDeployableCase(page, authCookieHeader, caseItem, reportDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const generationPrompt = buildTaggedPrompt(caseItem.prompt, caseItem.id, stamp);
  const submitResult = await submitManagedInput(
    authCookieHeader,
    generationPrompt,
    `deployable_language_matrix:${caseItem.id}`,
  );
  const sessionId = submitResult?.sessionId || submitResult?.run?.sessionId || null;
  if (!sessionId) {
    throw new Error(`failed to create session for ${caseItem.id}`);
  }

  await page.goto(`${WEB_BASE_URL}/session/${sessionId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);

  const generationRun = await waitForRunStatus(
    page,
    sessionId,
    authCookieHeader,
    null,
    SESSION_WAIT_TIMEOUT_MS,
    `${caseItem.id}:generation`,
  );
  if (String(generationRun?.status || '').toLowerCase() !== 'completed') {
    throw new Error(`${caseItem.id} generation did not complete`);
  }

  const workspaceEvidence = await waitForWorkspaceEvidence(sessionId, authCookieHeader);
  if (!hasWorkspaceIndicator(workspaceEvidence, caseItem.workspaceIndicators)) {
    throw new Error(`${caseItem.id} workspace indicators not satisfied`);
  }

  const deploySubmit = await apiRequest(
    `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs`,
    authCookieHeader,
    {
      method: 'POST',
      body: JSON.stringify({
        content: caseItem.deployPrompt || '帮我部署当前项目',
        metadata: {
          source: `deployable_language_matrix_deploy:${caseItem.id}`,
        },
      }),
    },
  );
  const deployRunId =
    deploySubmit?.id ||
    deploySubmit?.run?.id ||
    (await waitForNewRun(sessionId, authCookieHeader, generationRun.id)).id;
  const deployRun = await waitForRunStatus(
    page,
    sessionId,
    authCookieHeader,
    deployRunId,
    DEPLOY_WAIT_TIMEOUT_MS,
    `${caseItem.id}:deploy`,
  );
  if (String(deployRun?.status || '').toLowerCase() !== 'completed') {
    throw new Error(`${caseItem.id} deploy run did not complete`);
  }

  const deploymentPanel = await waitForDeploymentSuccess(sessionId, authCookieHeader);
  const deployedUrl = deploymentPanel.latestUrl || deploymentPanel.latestStaticUrl;
  if (!deployedUrl) {
    throw new Error(`${caseItem.id} deployment finished without public url`);
  }

  const publicPage = await waitForPublicPage(deployedUrl, caseItem.publicPageRegex);
  const evidence = await collectEvidence(sessionId);
  const deployToolCalled = (evidence.toolEvents || []).some(
    (event) => String(event.toolName || '') === 'deploy_application',
  );
  if (!deployToolCalled) {
    throw new Error(`${caseItem.id} did not call deploy_application`);
  }

  await page.screenshot({
    path: path.join(reportDir, `${caseItem.id}-session-${stamp}.png`),
    fullPage: true,
  }).catch(() => undefined);

  return {
    classification: 'deployable_website',
    sessionId,
    generationRunId: generationRun.id,
    deployRunId: deployRun.id,
    deployedUrl,
    workspaceEvidence: {
      itemCount: workspaceEvidence.items.length,
      matchedIndicators: caseItem.workspaceIndicators.map((pattern) => pattern.toString()),
    },
    deploymentPanel: {
      bindingState: deploymentPanel.bindingState,
      latestStatus: deploymentPanel.latestStatus,
      latestUrl: deploymentPanel.latestUrl || null,
      latestStaticUrl: deploymentPanel.latestStaticUrl || null,
    },
    publicPage: {
      status: publicPage.status,
      excerpt: compact(publicPage.text, 500),
    },
    evidence: {
      deployToolCalled,
      toolEvents: evidence.toolEvents || [],
      autoAttachedMessages: evidence.autoAttachedMessages || [],
    },
  };
}

async function runNonDeployableCase(page, authCookieHeader, caseItem, reportDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prompt = buildTaggedPrompt(caseItem.prompt, caseItem.id, stamp);
  const submitResult = await submitManagedInput(
    authCookieHeader,
    prompt,
    `non_deployable_language_matrix:${caseItem.id}`,
  );
  const sessionId = submitResult?.sessionId || submitResult?.run?.sessionId || null;
  if (!sessionId) {
    throw new Error(`failed to create session for ${caseItem.id}`);
  }

  await page.goto(`${WEB_BASE_URL}/session/${sessionId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);

  const generationRun = await waitForRunStatus(
    page,
    sessionId,
    authCookieHeader,
    null,
    SESSION_WAIT_TIMEOUT_MS,
    `${caseItem.id}:generation`,
  );
  if (String(generationRun?.status || '').toLowerCase() !== 'completed') {
    throw new Error(`${caseItem.id} generation did not complete`);
  }

  const workspaceEvidence = await waitForWorkspaceEvidence(sessionId, authCookieHeader);
  if (!hasWorkspaceIndicator(workspaceEvidence, caseItem.workspaceIndicators)) {
    throw new Error(`${caseItem.id} workspace indicators not satisfied`);
  }

  const panel = await waitForNoDeploymentPublicUrl(sessionId, authCookieHeader);
  const evidence = await collectEvidence(sessionId);
  const deployToolCalled = (evidence.toolEvents || []).some(
    (event) =>
      ['deploy_application', 'redeploy_application', 'rollback_application_deployment'].includes(
        String(event.toolName || ''),
      ),
  );
  if (deployToolCalled) {
    throw new Error(`${caseItem.id} unexpectedly called deployment tool`);
  }

  await page.screenshot({
    path: path.join(reportDir, `${caseItem.id}-session-${stamp}.png`),
    fullPage: true,
  }).catch(() => undefined);

  return {
    classification: 'non_deployable_script',
    sessionId,
    generationRunId: generationRun.id,
    workspaceEvidence: {
      itemCount: workspaceEvidence.items.length,
      matchedIndicators: caseItem.workspaceIndicators.map((pattern) => pattern.toString()),
    },
    deploymentPanel: {
      bindingState: panel?.bindingState || null,
      latestStatus: panel?.latestStatus || null,
      latestUrl: panel?.latestUrl || null,
      latestStaticUrl: panel?.latestStaticUrl || null,
    },
    evidence: {
      deployToolCalled,
      toolEvents: evidence.toolEvents || [],
      autoAttachedMessages: evidence.autoAttachedMessages || [],
    },
  };
}

export async function runLanguageMatrix(input) {
  const {
    matrixId,
    classification,
    cases,
  } = input;
  const reportStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.resolve(ROOT_DIR, 'web/test-results', matrixId);
  await ensureDir(reportDir);

  const filteredCases = CASE_FILTER
    ? cases.filter((item) => item.id === CASE_FILTER)
    : cases;
  if (filteredCases.length === 0) {
    throw new Error(`no cases selected for ${matrixId}`);
  }

  const account = await loadTestAccount();
  await ensurePlaywrightTestUser(account);

  const result = {
    matrixId,
    classification,
    startedAt: new Date().toISOString(),
    webBaseUrl: WEB_BASE_URL,
    apiBaseUrl: API_BASE_URL,
    caseFilter: CASE_FILTER || null,
    cases: [],
    passed: false,
    error: null,
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(compact(msg.text(), 600));
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(compact(error?.stack || error?.message || String(error), 1200));
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`);
  });

  try {
    const authCookieHeader = await buildAuthCookieHeader(context, account);
    console.log('[auth]', JSON.stringify({ mode: 'api_session_seeded' }));
    await page.goto(WEB_BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);

    for (const caseItem of filteredCases) {
      const startedAt = Date.now();
      console.log('[case:start]', JSON.stringify({ id: caseItem.id, classification }));
      const caseResult = {
        id: caseItem.id,
        description: caseItem.description,
        prompt: caseItem.prompt,
        startedAt: new Date().toISOString(),
        passed: false,
        error: null,
      };
      try {
        const execution =
          classification === 'deployable_website'
            ? await runDeployableCase(page, authCookieHeader, caseItem, reportDir)
            : await runNonDeployableCase(page, authCookieHeader, caseItem, reportDir);
        caseResult.execution = execution;
        caseResult.passed = true;
      } catch (error) {
        caseResult.error = compact(error?.stack || error?.message || String(error), 4000);
      } finally {
        caseResult.finishedAt = new Date().toISOString();
        caseResult.durationMs = Date.now() - startedAt;
        result.cases.push(caseResult);
        await writeJson(path.join(reportDir, `${caseItem.id}.json`), caseResult);
        console.log('[case:end]', JSON.stringify({ id: caseItem.id, passed: caseResult.passed }));
      }
    }

    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    result.requestFailures = requestFailures;
    result.passed = result.cases.every((item) => item.passed);
  } catch (error) {
    result.error = compact(error?.stack || error?.message || String(error), 4000);
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeJson(path.join(reportDir, `result-${reportStamp}.json`), result);
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
}
