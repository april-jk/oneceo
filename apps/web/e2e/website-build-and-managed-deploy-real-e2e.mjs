import { chromium } from '@playwright/test';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywrightTestAccount } from './test-account.mjs';

const execFile = promisify(execFileCb);

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://oneceo.ai:3000';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || WEB_BASE_URL;
const PROMPT =
  process.env.ONECEO_E2E_PROMPT ||
  '帮我写个外贸的网站，做亚克力产品出口，需要有产品介绍、公司介绍等页面。请直接生成完整可运行项目，不要先提问。';
const DEPLOY_PROMPT = process.env.ONECEO_E2E_DEPLOY_PROMPT || '帮我部署当前项目';
const SESSION_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_SESSION_WAIT_TIMEOUT_MS || 30 * 60 * 1000);
const DEPLOY_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_DEPLOY_WAIT_TIMEOUT_MS || 30 * 60 * 1000);
const PUBLIC_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_PUBLIC_WAIT_TIMEOUT_MS || 10 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5000);
const REPORT_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_DIR = path.resolve(ROOT_DIR, 'web/test-results/website-build-deploy-real-e2e');
const UNIQUE_PROMPT = `${PROMPT}\n\n[playwright-e2e:${REPORT_STAMP}]`;

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
  return parseJson(trimmed);
}

function compact(text, limit = 200) {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadTestAccount() {
  return loadPlaywrightTestAccount();
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
  const redirectTarget = `/new-task?q=${encodeURIComponent(PROMPT)}`;
  await page.goto(
    `${WEB_BASE_URL}/login?redirect=${encodeURIComponent(redirectTarget)}`,
    {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    },
  );
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: /登录|sign in/i }).click();
}

async function submitManagedInput(authCookieHeader, content) {
  return apiRequest('/api/altus-managed/inputs', authCookieHeader, {
    method: 'POST',
    body: JSON.stringify({
      content,
      metadata: {
        source: 'website_build_and_managed_deploy_real_e2e',
      },
    }),
  });
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

async function waitForRunTerminal(sessionId, authCookieHeader, runId, timeoutMs, phaseLabel) {
  const startedAt = Date.now();
  let lastPrinted = '';
  while (Date.now() - startedAt < timeoutMs) {
    let latestRun = null;
    try {
      latestRun = await apiRequest(
        `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs/latest`,
        authCookieHeader,
      );
    } catch (error) {
      const message = compact(error?.stack || error?.message || String(error), 800);
      console.warn('[run][poll-error]', JSON.stringify({ phaseLabel, sessionId, runId, message }));
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
    if (runId && latestRun?.id !== runId) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const status = String(latestRun?.status || '').toLowerCase();
    if (['completed', 'failed', 'stopped', 'waiting_user'].includes(status)) {
      return latestRun;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${phaseLabel} timed out after ${timeoutMs}ms`);
}

async function waitForNewRun(sessionId, authCookieHeader, previousRunId, timeoutMs) {
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
  throw new Error('new deploy run was not created');
}

async function waitForWorkspaceEvidence(sessionId, authCookieHeader) {
  const tree = await apiRequest(
    `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/workspace/tree?refresh=1&depth=5&maxEntries=300`,
    authCookieHeader,
  );
  const text = JSON.stringify(tree);
  return {
    tree,
    containsIndex: /index\.html/i.test(text),
    containsPublicIndex: /public[\\/].*index\.html/i.test(text),
    containsServerEntry: /(?:^|[\\/])(server|app)\.(?:js|ts)\b/i.test(text),
    containsViewsDir: /"path":"(?:[^"]+\/)?views"/i.test(text),
    containsPublicDir: /"path":"(?:[^"]+\/)?public"/i.test(text),
    containsPackageJson: /package\.json/i.test(text),
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

async function waitForPublicPage(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PUBLIC_WAIT_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      const text = await response.text();
      if (response.status === 200 && /acrylic|亚克力|company|产品|products/i.test(text)) {
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

async function tryAnswerClarification(page) {
  const answerBox = page.locator('textarea[placeholder="请输入问题回答..."]');
  if ((await answerBox.count()) > 0) {
    await answerBox.fill('请按最佳方案直接继续，不需要再提问。');
    await answerBox.press('Enter');
    return true;
  }
  return false;
}

async function main() {
  await ensureDir(REPORT_DIR);
  const result = {
    startedAt: new Date().toISOString(),
    webBaseUrl: WEB_BASE_URL,
    apiBaseUrl: API_BASE_URL,
    prompt: PROMPT,
    promptUsed: UNIQUE_PROMPT,
    deployPrompt: DEPLOY_PROMPT,
    userEmail: null,
    sessionId: null,
    generationRunId: null,
    deployRunId: null,
    deployedUrl: null,
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    deployedPageConsoleErrors: [],
    deployedPageErrors: [],
    workspaceEvidence: null,
    deploymentPanel: null,
    publicPage: null,
    evidence: null,
    uiStartFallbackUsed: false,
    uiDeployFallbackUsed: false,
    passed: false,
    error: null,
  };

  const account = await loadTestAccount();
  result.userEmail = account.email;
  result.testAccountFile = account.filePath;
  const ensuredUser = await ensurePlaywrightTestUser(account);
  result.testUserId = ensuredUser.userId || null;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      result.consoleErrors.push(compact(msg.text(), 500));
    }
  });
  page.on('pageerror', (error) => {
    result.pageErrors.push(compact(error?.stack || error?.message || String(error), 800));
  });
  page.on('requestfailed', (request) => {
    result.requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`);
  });

  try {
    console.log('[auth]', 'ui_login_with_fixed_account');
    await loginThroughUi(page, account);
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
    const authCookieHeader = await buildAuthCookieHeader(context, account);

    result.uiStartFallbackUsed = true;
    await page.screenshot({
      path: path.join(REPORT_DIR, `ui-start-fallback-${REPORT_STAMP}.png`),
      fullPage: true,
    }).catch(() => undefined);
    console.log('[page] creating managed session through API to avoid stale-session restore', { url: page.url() });
    const submitResult = await submitManagedInput(authCookieHeader, UNIQUE_PROMPT);
    const sessionId = submitResult?.sessionId || submitResult?.run?.sessionId || null;
    if (!sessionId) {
      throw new Error(`failed to create session from API submit: ${JSON.stringify(submitResult)}`);
    }
    await page.goto(`${WEB_BASE_URL}/session/${sessionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);

    if (!sessionId) {
      throw new Error(`failed to resolve sessionId from ${page.url()}`);
    }
    result.sessionId = sessionId;

    let generationRun = await waitForRunTerminal(
      sessionId,
      authCookieHeader,
      null,
      SESSION_WAIT_TIMEOUT_MS,
      'generation',
    );
    if (String(generationRun?.status || '').toLowerCase() === 'waiting_user') {
      const answered = await tryAnswerClarification(page);
      if (!answered) {
        throw new Error('generation waiting_user without visible clarification input');
      }
      generationRun = await waitForRunTerminal(
        sessionId,
        authCookieHeader,
        generationRun.id,
        SESSION_WAIT_TIMEOUT_MS,
        'generation-after-answer',
      );
    }
    result.generationRunId = generationRun?.id || null;
    if (String(generationRun?.status || '').toLowerCase() !== 'completed') {
      throw new Error(`generation run did not complete: ${generationRun?.status}`);
    }

    result.workspaceEvidence = await waitForWorkspaceEvidence(sessionId, authCookieHeader);
    const hasStaticEntry =
      result.workspaceEvidence.containsIndex || result.workspaceEvidence.containsPublicIndex;
    const hasServerRenderedEntry =
      result.workspaceEvidence.containsPackageJson &&
      result.workspaceEvidence.containsServerEntry &&
      (result.workspaceEvidence.containsViewsDir || result.workspaceEvidence.containsPublicDir);
    if (!hasStaticEntry && !hasServerRenderedEntry) {
      throw new Error('workspace does not contain website entry file');
    }

    await page.screenshot({
      path: path.join(REPORT_DIR, `generation-session-${REPORT_STAMP}.png`),
      fullPage: true,
    });

    let deploymentAlreadyReady = false;
    try {
      result.deploymentPanel = await waitForDeploymentSuccess(sessionId, authCookieHeader, 15000);
      deploymentAlreadyReady = true;
      console.log('[page] deployment was already ready after generation, skipping extra deploy prompt');
    } catch {
      deploymentAlreadyReady = false;
    }

    if (!deploymentAlreadyReady) {
      let deployRunStart = null;
      const composer = page.locator('textarea').last();
      let composerReady = false;
      try {
        await composer.waitFor({ state: 'visible', timeout: 10000 });
        composerReady = true;
      } catch {
        composerReady = false;
      }

      if (composerReady) {
        await composer.fill(DEPLOY_PROMPT);
        await composer.press('Enter');
        try {
          deployRunStart = await waitForNewRun(
            sessionId,
            authCookieHeader,
            generationRun.id,
            45000,
          );
        } catch {
          result.uiDeployFallbackUsed = true;
          console.log('[page] UI deploy prompt did not create new run, falling back to API run start');
        }
      } else {
        result.uiDeployFallbackUsed = true;
        console.log('[page] deploy composer not visible after generation, falling back to API run start');
      }

      if (!deployRunStart) {
        deployRunStart = await apiRequest(
          `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs`,
          authCookieHeader,
          {
            method: 'POST',
            body: JSON.stringify({
              content: DEPLOY_PROMPT,
              metadata: {
                source: 'website_build_and_managed_deploy_real_e2e_deploy_fallback',
              },
            }),
          },
        );
      }
      let deployRun = await waitForRunTerminal(
        sessionId,
        authCookieHeader,
        deployRunStart.id,
        DEPLOY_WAIT_TIMEOUT_MS,
        'deploy',
      );
      if (String(deployRun?.status || '').toLowerCase() === 'waiting_user') {
        const answered = await tryAnswerClarification(page);
        if (!answered) {
          throw new Error('deploy waiting_user without visible clarification input');
        }
        deployRun = await waitForRunTerminal(
          sessionId,
          authCookieHeader,
          deployRun.id,
          DEPLOY_WAIT_TIMEOUT_MS,
          'deploy-after-answer',
        );
      }
      result.deployRunId = deployRun?.id || null;
      if (String(deployRun?.status || '').toLowerCase() !== 'completed') {
        throw new Error(`deploy run did not complete: ${deployRun?.status}`);
      }

      result.deploymentPanel = await waitForDeploymentSuccess(sessionId, authCookieHeader);
    }

    result.deployedUrl = result.deploymentPanel.latestUrl || result.deploymentPanel.latestStaticUrl || null;
    if (!result.deployedUrl) {
      throw new Error('deployment finished without public url');
    }

    const deployedPage = await context.newPage();
    deployedPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        result.deployedPageConsoleErrors.push(compact(msg.text(), 800));
      }
    });
    deployedPage.on('pageerror', (error) => {
      result.deployedPageErrors.push(compact(error?.stack || error?.message || String(error), 1200));
    });
    await deployedPage.goto(result.deployedUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await deployedPage.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
    await deployedPage.screenshot({
      path: path.join(REPORT_DIR, `deployed-page-${REPORT_STAMP}.png`),
      fullPage: true,
    });
    const renderedText = await deployedPage.locator('body').innerText().catch(() => '');
    const publicPage = await waitForPublicPage(result.deployedUrl);
    result.publicPage = {
      status: publicPage.status,
      containsAcrylic: /acrylic|亚克力/i.test(publicPage.text),
      containsCompany: /company|公司介绍/i.test(publicPage.text),
      containsProducts: /products|产品介绍|product/i.test(publicPage.text),
      browserContainsAcrylic: /acrylic|亚克力/i.test(renderedText),
      browserContainsCompany: /company|公司介绍/i.test(renderedText),
      browserContainsProducts: /products|产品介绍|product/i.test(renderedText),
      browserExcerpt: compact(renderedText, 600),
      excerpt: compact(publicPage.text, 600),
    };
    if (
      result.deployedPageConsoleErrors.length > 0 ||
      !result.publicPage.browserContainsAcrylic ||
      !result.publicPage.browserContainsProducts
    ) {
      throw new Error(
        `deployed page failed browser validation: consoleErrors=${result.deployedPageConsoleErrors.length} excerpt=${compact(renderedText, 240)}`,
      );
    }
    await deployedPage.close();

    result.evidence = await collectEvidence(sessionId);
    result.passed = true;
  } catch (error) {
    result.error = compact(error?.stack || error?.message || String(error), 4000);
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeJson(path.join(REPORT_DIR, `result-${REPORT_STAMP}.json`), result);
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[website-build-and-managed-deploy-real-e2e] failure', error);
  process.exit(1);
});
