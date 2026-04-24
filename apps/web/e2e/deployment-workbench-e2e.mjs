import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ACCOUNT_FILE = path.resolve(__dirname, 'playwright-test-account.json');
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://127.0.0.1:3000';
const SESSION_ID =
  process.env.ONECEO_E2E_SESSION_ID || '';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || 'http://127.0.0.1:4000';
const E2E_APP_SESSION_ID = process.env.ONECEO_E2E_APP_SESSION_ID || '';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadTestAccount() {
  const raw = await readFile(TEST_ACCOUNT_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    email: process.env.ONECEO_E2E_USER_EMAIL || asText(parsed.email) || `oneceo-e2e-${Date.now()}@example.com`,
    password: process.env.ONECEO_E2E_USER_PASSWORD || asText(parsed.password) || 'OneceoE2E!234',
    displayName:
      process.env.ONECEO_E2E_USER_DISPLAY_NAME ||
      asText(parsed.displayName) ||
      'Playwright Test User',
  };
}

async function apiRequest(pathname, sessionToken) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    headers: {
      cookie: `app_session_v2_id=${sessionToken}`,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `request failed ${pathname}: ${payload?.error || payload?.message || text || response.status}`,
    );
  }
  return payload?.data ?? payload;
}

function extractAppSessionToken(response) {
  const raw = response.headers.get('set-cookie') || '';
  const matched = raw.match(/(?:^|,\s*)app_session_v2_id=([^;,\s]+)/);
  if (!matched?.[1]) {
    throw new Error('failed to extract app_session_v2_id from set-cookie');
  }
  return matched[1];
}

async function resolveSessionToken(account) {
  if (E2E_APP_SESSION_ID) {
    return E2E_APP_SESSION_ID;
  }

  const loginPayload = JSON.stringify({
    email: account.email,
    password: account.password,
  });
  let loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: loginPayload,
  });

  if (!loginResponse.ok) {
    await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        displayName: account.displayName,
      }),
    });
    loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: loginPayload,
    });
  }

  if (!loginResponse.ok) {
    const text = await loginResponse.text();
    throw new Error(`auth login failed: ${loginResponse.status} ${text}`);
  }
  return extractAppSessionToken(loginResponse);
}

async function resolveSessionId(sessionToken) {
  if (SESSION_ID) {
    return SESSION_ID;
  }

  const sessions = await apiRequest('/api/task-creation/sessions?scope=all&limit=20', sessionToken);
  const candidates = Array.isArray(sessions) ? sessions : [];
  for (const session of candidates) {
    const sessionId = asText(session?.id);
    if (!sessionId) continue;
    try {
      const panel = await apiRequest(
        `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deployment`,
        sessionToken,
      );
      const latestStatus = asText(panel?.latestStatus).toLowerCase();
      const bindingState = asText(panel?.bindingState).toLowerCase();
      if (
        panel?.latestUrl ||
        panel?.latestStaticUrl ||
        bindingState === 'ready' ||
        ['success', 'active', 'deployed'].includes(latestStatus)
      ) {
        return sessionId;
      }
    } catch {
      continue;
    }
  }

  throw new Error('no deployable session found; set ONECEO_E2E_SESSION_ID or run website deploy e2e first');
}

async function main() {
  const account = await loadTestAccount();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1480, height: 960 },
  });
  const sessionToken = await resolveSessionToken(account);
  const targetSessionId = await resolveSessionId(sessionToken);
  await context.addCookies([
    { name: 'app_session_v2_id', value: sessionToken, url: WEB_BASE_URL },
    { name: 'app_session_v2_id', value: sessionToken, url: API_BASE_URL },
  ]);
  const page = await context.newPage();

  try {
    await page.goto(`${WEB_BASE_URL}/session/${targetSessionId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.waitForLoadState('networkidle', { timeout: 120000 });

    const showPreviewButton = page.getByRole('button', { name: '显示预览' });
    if (await showPreviewButton.count()) {
      await showPreviewButton.click();
    }

    const preview = page.locator('aside').filter({ hasText: '内容预览' }).first();
    await preview.waitFor({ state: 'visible', timeout: 30000 });

    await preview.getByRole('button', { name: '部署' }).first().click();
    await preview.getByRole('button', { name: '发布与访问' }).click();
    await preview.getByText('网站地址', { exact: true }).waitFor({
      state: 'visible',
      timeout: 120000,
    });

    await preview.getByRole('button', { name: '仪表盘' }).click();
    await preview.getByRole('button', { name: '站点数据' }).click({ force: true });
    await preview.getByText('当前平台已感知的数据', { exact: true }).waitFor({
      state: 'visible',
      timeout: 30000,
    });
    await preview.getByText('分析能力接入状态', { exact: true }).waitFor({
      state: 'visible',
      timeout: 30000,
    });
    await preview.getByText('页面访问统计', { exact: true }).waitFor({
      state: 'visible',
      timeout: 30000,
    });
    await page.screenshot({
      path: '/Users/watson/codingProj/oneceo/apps/web/test-results/deployment-workbench-site-dashboard.png',
      fullPage: true,
    });

    await preview.getByRole('button', { name: '部署数据' }).click({ force: true });
    await preview.getByText('当前线上版本', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await preview.getByText('模板与平台接入基线', { exact: true }).waitFor({
      state: 'visible',
      timeout: 30000,
    });
    await preview.getByText('最近版本轨迹', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });

    console.log(
      JSON.stringify({
        sessionId: targetSessionId,
        deploymentOverviewVisible: true,
        dashboardDeploymentsVisible: true,
        dashboardSiteVisible: true,
        result: 'success',
      })
    );
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[deployment-workbench-e2e] failure', error);
  process.exit(1);
});
