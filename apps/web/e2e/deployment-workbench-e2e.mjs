import { chromium } from '@playwright/test';

const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://127.0.0.1:3000';
const SESSION_ID =
  process.env.ONECEO_E2E_SESSION_ID || '35a80bc5-3292-48c0-a997-5296662fbb13';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || 'http://127.0.0.1:4000';
const E2E_APP_SESSION_ID = process.env.ONECEO_E2E_APP_SESSION_ID || '';
const E2E_USER_EMAIL = process.env.ONECEO_E2E_USER_EMAIL || `oneceo-e2e-${Date.now()}@example.com`;
const E2E_USER_PASSWORD = process.env.ONECEO_E2E_USER_PASSWORD || 'OneceoE2E!234';
const E2E_USER_DISPLAY_NAME = process.env.ONECEO_E2E_USER_DISPLAY_NAME || 'Oneceo E2E';

function extractAppSessionToken(response) {
  const raw = response.headers.get('set-cookie') || '';
  const matched = raw.match(/(?:^|,\s*)app_session_id=([^;,\s]+)/);
  if (!matched?.[1]) {
    throw new Error('failed to extract app_session_id from set-cookie');
  }
  return matched[1];
}

async function resolveSessionToken() {
  if (E2E_APP_SESSION_ID) {
    return E2E_APP_SESSION_ID;
  }

  const loginPayload = JSON.stringify({
    email: E2E_USER_EMAIL,
    password: E2E_USER_PASSWORD,
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
        email: E2E_USER_EMAIL,
        password: E2E_USER_PASSWORD,
        displayName: E2E_USER_DISPLAY_NAME,
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1480, height: 960 },
  });
  const sessionToken = await resolveSessionToken();
  await context.addCookies([
    { name: 'app_session_id', value: sessionToken, url: WEB_BASE_URL, path: '/' },
    { name: 'app_session_id', value: sessionToken, url: API_BASE_URL, path: '/' },
  ]);
  const page = await context.newPage();

  try {
    await page.goto(`${WEB_BASE_URL}/session/${SESSION_ID}`, {
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
    await preview.getByRole('button', { name: '数据库' }).click();

    await preview.getByRole('button', { name: /game_scores/ }).waitFor({ state: 'visible', timeout: 120000 });
    await preview.getByRole('button', { name: /game_scores/ }).click();
    await preview.locator('tbody').getByText('Ava').first().waitFor({ state: 'visible', timeout: 120000 });
    await preview.locator('button').filter({ hasText: '设置' }).last().click();
    await preview.getByText('switchback.proxy.rlwy.net', { exact: true }).waitFor({
      state: 'visible',
      timeout: 120000,
    });

    await preview.getByRole('button', { name: '仪表盘' }).click();
    await preview.getByRole('button', { name: '站点数据' }).click({ force: true });
    await preview.getByText('分析').waitFor({ state: 'visible', timeout: 30000 });
    await preview.getByText('没有数据').first().waitFor({ state: 'visible', timeout: 30000 });

    await preview.getByRole('button', { name: '部署数据' }).click({ force: true });
    await preview.getByText('当前线上版本', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await preview.getByText('最近版本轨迹', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });

    console.log(
      JSON.stringify({
        sessionId: SESSION_ID,
        databaseTablesVisible: true,
        databaseConnectionVisible: true,
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
