import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywrightTestAccount } from './test-account.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://oneceo.ai:3000';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || WEB_BASE_URL;
const SESSION_ID =
  process.env.ONECEO_E2E_SESSION_ID || 'a8a09e77-89cd-423c-83ae-3daf18987686';
const DEPLOY_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_DEPLOY_WAIT_TIMEOUT_MS || 20 * 60 * 1000);
const ANALYTICS_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_ANALYTICS_WAIT_TIMEOUT_MS || 3 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5000);
const REPORT_DIR = path.resolve(ROOT_DIR, 'web/test-results/umami-deployment-integration');
const REPORT_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ANALYTICS_TEST_USER_AGENT =
  process.env.ONECEO_ANALYTICS_TEST_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadTestAccount() {
  return loadPlaywrightTestAccount();
}

function extractAppSessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const matched = raw.match(/(?:^|,\s*)app_session_v2_id=([^;,\s]+)/);
  if (!matched?.[1]) {
    throw new Error('failed to extract app_session_v2_id from set-cookie');
  }
  return matched[1];
}

async function login(account) {
  const body = JSON.stringify({
    email: account.email,
    password: account.password,
  });
  let response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!response.ok) {
    await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account),
    });
    response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }
  if (!response.ok) {
    throw new Error(`login failed: ${response.status} ${await response.text()}`);
  }
  return extractAppSessionCookie(response);
}

async function apiRequest(pathname, sessionToken, init = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      cookie: `app_session_v2_id=${sessionToken}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok || payload?.success === false) {
    throw new Error(`request failed ${pathname}: ${payload?.error || payload?.message || text || response.status}`);
  }
  return payload?.data ?? payload;
}

function getPublicUrl(panel) {
  return asText(panel?.latestStaticUrl) || asText(panel?.latestUrl) || asText(panel?.domains?.[0]);
}

async function waitForDeployment(sessionToken, startedDeploymentId) {
  const startedAt = Date.now();
  let lastPrinted = '';
  while (Date.now() - startedAt < DEPLOY_WAIT_TIMEOUT_MS) {
    const panel = await apiRequest(`/api/task-creation/sessions/${encodeURIComponent(SESSION_ID)}/deployment`, sessionToken);
    const snapshot = {
      bindingState: panel?.bindingState,
      latestStatus: panel?.latestStatus,
      deploymentId: panel?.deploymentId,
      latestStaticUrl: panel?.latestStaticUrl,
      analyticsWebsiteId: panel?.analytics?.websiteId,
      analyticsStatus: panel?.analytics?.status,
    };
    const line = JSON.stringify(snapshot);
    if (line !== lastPrinted) {
      console.log('[deployment]', line);
      lastPrinted = line;
    }
    const status = asText(panel?.latestStatus).toUpperCase();
    const publicUrl = getPublicUrl(panel);
    const deploymentMatches = !startedDeploymentId || !panel?.deploymentId || panel.deploymentId === startedDeploymentId;
    if (status === 'SUCCESS' && publicUrl && deploymentMatches) {
      return panel;
    }
    if (status === 'FAILED' || status === 'CRASHED' || panel?.bindingState === 'provider_error') {
      throw new Error(`deployment failed: ${line}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('deployment did not reach SUCCESS in time');
}

async function inspectPublishedPage(page, url) {
  const sendRequests = [];
  page.on('requestfinished', async (request) => {
    if (request.url().includes('/api/send')) {
      const response = await request.response().catch(() => null);
      const responseText = response ? await response.text().catch(() => '') : '';
      sendRequests.push({
        method: request.method(),
        url: request.url(),
        status: response?.status() || null,
        responseText,
      });
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
  for (let i = 0; i < 3; i += 1) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
  }
  const inspection = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map((script) => ({
      src: script.src,
      oneceo: script.getAttribute('data-oneceo-analytics'),
      websiteId: script.getAttribute('data-website-id'),
      host: script.getAttribute('data-host-url'),
      inline: script.src ? '' : script.textContent || '',
    }));
    const config = window.__ONECEO_ANALYTICS__ || null;
    return {
      title: document.title,
      config,
      scriptWebsiteIds: scripts.map((item) => item.websiteId).filter(Boolean),
      inlineWebsiteIds: scripts
        .flatMap((item) => Array.from(item.inline.matchAll(/"websiteId":"([^"]+)"/g)).map((match) => match[1]))
        .filter(Boolean),
      runtimeScriptCount: scripts.filter((item) => item.oneceo === 'runtime').length,
      bodyText: document.body.innerText.slice(0, 500),
    };
  });
  return {
    ...inspection,
    sendRequests,
  };
}

async function waitForAnalytics(sessionToken, expectedWebsiteId) {
  const startedAt = Date.now();
  let lastPrinted = '';
  while (Date.now() - startedAt < ANALYTICS_WAIT_TIMEOUT_MS) {
    const panel = await apiRequest(`/api/task-creation/sessions/${encodeURIComponent(SESSION_ID)}/deployment`, sessionToken);
    const overview = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(SESSION_ID)}/deployment/analytics?range=24h`,
      sessionToken,
    );
    const snapshot = {
      panelWebsiteId: panel?.analytics?.websiteId,
      panelAnalyticsStatus: panel?.analytics?.status,
      pageviews: overview?.stats?.pageviews,
      visits: overview?.stats?.visits,
      visitors: overview?.stats?.visitors,
      topPages: overview?.topPages?.slice?.(0, 3),
    };
    const line = JSON.stringify(snapshot);
    if (line !== lastPrinted) {
      console.log('[analytics]', line);
      lastPrinted = line;
    }
    if (snapshot.panelWebsiteId !== expectedWebsiteId) {
      throw new Error(`panel websiteId mismatch: expected ${expectedWebsiteId}, got ${snapshot.panelWebsiteId}`);
    }
    if (Number(snapshot.pageviews || 0) > 0) {
      return { panel, overview };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`analytics did not report pageviews for ${expectedWebsiteId}`);
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const result = {
    startedAt: new Date().toISOString(),
    sessionId: SESSION_ID,
    webBaseUrl: WEB_BASE_URL,
    apiBaseUrl: API_BASE_URL,
    deployPanel: null,
    publishedPage: null,
    analytics: null,
    passed: false,
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    userAgent: ANALYTICS_TEST_USER_AGENT,
  });
  const account = await loadTestAccount();
  const token = await login(account);
  await context.addCookies([
    { name: 'app_session_v2_id', value: token, url: WEB_BASE_URL },
    { name: 'app_session_v2_id', value: token, url: API_BASE_URL },
  ]);

  try {
    console.log('[deploy] triggering real deployment');
    const deployPanel = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(SESSION_ID)}/deployment/deploy`,
      token,
      { method: 'POST', body: '{}' },
    );
    result.deployPanel = deployPanel;
    const panel = await waitForDeployment(token, deployPanel?.deploymentId);
    const publicUrl = getPublicUrl(panel);
    if (!publicUrl) {
      throw new Error('deployment did not return public url');
    }
    const page = await context.newPage();
    const publishedPage = await inspectPublishedPage(page, publicUrl);
    result.publishedPage = publishedPage;
    await page.screenshot({
      path: path.join(REPORT_DIR, `published-page-${REPORT_STAMP}.png`),
      fullPage: true,
    }).catch(() => undefined);
    await page.close();

    const pageWebsiteId =
      asText(publishedPage.config?.websiteId) ||
      asText(publishedPage.scriptWebsiteIds[0]) ||
      asText(publishedPage.inlineWebsiteIds[0]);
    if (!pageWebsiteId) {
      throw new Error(`published page did not expose oneceo analytics websiteId: ${JSON.stringify(publishedPage)}`);
    }
    const panelWebsiteId = asText(panel?.analytics?.websiteId);
    if (panelWebsiteId !== pageWebsiteId) {
      throw new Error(`websiteId mismatch after deployment: panel=${panelWebsiteId} page=${pageWebsiteId}`);
    }
    if (!publishedPage.sendRequests.some((item) => item.status === 200 && !String(item.responseText || '').includes('beep'))) {
      throw new Error(`published page did not send successful Umami request: ${JSON.stringify(publishedPage.sendRequests)}`);
    }

    result.analytics = await waitForAnalytics(token, pageWebsiteId);

    const uiPage = await context.newPage();
    await uiPage.goto(`${WEB_BASE_URL}/session/${SESSION_ID}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await uiPage.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => undefined);
    await uiPage.screenshot({
      path: path.join(REPORT_DIR, `oneceo-session-${REPORT_STAMP}.png`),
      fullPage: true,
    }).catch(() => undefined);
    await uiPage.close();

    result.passed = true;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeFile(path.join(REPORT_DIR, `result-${REPORT_STAMP}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[umami-deployment-integration-e2e] failure', error);
  process.exit(1);
});
