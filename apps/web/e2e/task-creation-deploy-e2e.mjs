import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ACCOUNT_FILE = path.resolve(__dirname, 'playwright-test-account.json');
const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://127.0.0.1:3000';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || 'http://127.0.0.1:4000';
const PROMPT =
  process.env.ONECEO_E2E_PROMPT ||
  '请使用 Node.js 开发一个 2048 小游戏，生成完整可运行项目，自己在 sandbox 内启动并使用 Playwright 做核心交互测试，确认通过后再结束。不要先问问题，直接开始。';

const SESSION_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_SESSION_WAIT_TIMEOUT_MS || 25 * 60 * 1000);
const DEPLOY_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_DEPLOY_WAIT_TIMEOUT_MS || 20 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5000);
const PREVIEW_BUTTON_NAME = /显示预览|show preview/i;
const DEPLOY_TAB_NAME = /^(部署|Deployment)$/i;
const DEPLOY_NOW_BUTTON_NAME = /^(立即部署|立即发布|发布|publish now|deploy now|publish)$/i;
const ARTIFACT_DEPLOY_BUTTON_NAME = /^(发布网站|Deploy website)$/i;

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

async function apiRequest(path, authCookieHeader, init = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookieHeader,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    const errorMessage =
      payload?.error ||
      payload?.message ||
      text ||
      `request failed: ${response.status}`;
    throw new Error(errorMessage);
  }
  return payload;
}

function extractAppSessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const matched = raw.match(/(?:^|,\s*)app_session_v2_id=([^;,\s]+)/);
  if (!matched?.[1]) {
    throw new Error('failed to extract app_session_v2_id from set-cookie');
  }
  return `app_session_v2_id=${matched[1]}`;
}

async function ensureSessionCookieHeader(account) {
  const loginPayload = JSON.stringify({
    email: account.email,
    password: account.password,
  });

  let loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginPayload,
  });

  if (!loginResponse.ok) {
    await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        displayName: account.displayName,
      }),
    });
    loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: loginPayload,
    });
  }

  if (!loginResponse.ok) {
    const text = await loginResponse.text();
    throw new Error(`auth login failed: ${loginResponse.status} ${text}`);
  }

  return extractAppSessionCookie(loginResponse);
}

async function waitForSessionProgress(sessionId, authCookieHeader, page) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  let lastQuestionAt = 0;

  while (Date.now() - startedAt < SESSION_WAIT_TIMEOUT_MS) {
    const detailPayload = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}`,
      authCookieHeader
    );
    const detail = detailPayload?.data || {};
    const status = String(detail.status || '');
    const stage = String(detail.stage || '');
    const phase = String(detail.phase || '');
    const runtimeStatus = detail.runtimeStatus?.status || null;

    let workspaceTree = null;
    try {
      workspaceTree = await apiRequest(
        `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/workspace/tree`,
        authCookieHeader
      );
    } catch {
      workspaceTree = null;
    }

    const messagePayload = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`,
      authCookieHeader
    );
    const messages = Array.isArray(messagePayload?.data) ? messagePayload.data : [];
    const lastMessages = messages.slice(-5).map((item) => ({
      role: item.role,
      type: item.messageType,
      content: String(item.content || '').slice(0, 160),
    }));

    const snapshot = {
      status,
      stage,
      phase,
      runtimeStatus,
      messageCount: messages.length,
      workspaceItems: Array.isArray(workspaceTree?.data?.items) ? workspaceTree.data.items.length : 0,
      lastMessages,
    };

    if (JSON.stringify(snapshot) !== JSON.stringify(lastSnapshot)) {
      console.log('[session]', JSON.stringify(snapshot));
      lastSnapshot = snapshot;
    }

    const needsAnswer = await page
      .locator('textarea[placeholder="请输入问题回答..."]')
      .count()
      .catch(() => 0);
    if (needsAnswer && Date.now() - lastQuestionAt > 15000) {
      lastQuestionAt = Date.now();
      await page.locator('textarea').fill('请按你的最佳方案直接继续，不需要再提问。');
      await page.getByRole('button').filter({ has: page.locator('svg') }).last().click().catch(() => undefined);
      console.log('[session] answered clarification');
    }

    const hasPlaywrightEvidence = messages.some((item) => {
      const content = String(item.content || '').toLowerCase();
      return content.includes('playwright');
    });
    const hasWorkspace = Array.isArray(workspaceTree?.data?.items) && workspaceTree.data.items.length > 0;

    if ((status === 'completed' || stage === 'completed') && hasWorkspace) {
      return {
        detail,
        messages,
        hasPlaywrightEvidence,
        workspaceTree: workspaceTree?.data || null,
      };
    }

    if (status === 'failed' || stage === 'failed') {
      throw new Error(`session failed: ${JSON.stringify(snapshot)}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`session did not complete within ${SESSION_WAIT_TIMEOUT_MS}ms`);
}

async function waitForDeploymentSuccess(sessionId, authCookieHeader) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < DEPLOY_WAIT_TIMEOUT_MS) {
    const payload = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deployment`,
      authCookieHeader
    );
    const info = payload?.data || {};
    const currentDeployment =
      (Array.isArray(info.deployments) ? info.deployments : []).find((item) => item.id === info.deploymentId) ||
      (Array.isArray(info.deployments) ? info.deployments[0] : null);
    const snapshot = {
      configured: info.configured,
      latestStatus: info.latestStatus,
      deploymentId: info.deploymentId,
      latestUrl: info.latestUrl,
      latestStaticUrl: info.latestStaticUrl,
      message: info.message,
      deploymentCount: Array.isArray(info.deployments) ? info.deployments.length : 0,
      currentStatus: currentDeployment?.status || null,
      domainCount: Array.isArray(info.domains) ? info.domains.length : 0,
      logs: Array.isArray(info.logs) ? info.logs.slice(-3).map((item) => String(item.message || '').slice(0, 120)) : [],
    };

    if (JSON.stringify(snapshot) !== JSON.stringify(lastSnapshot)) {
      console.log('[deploy]', JSON.stringify(snapshot));
      lastSnapshot = snapshot;
    }

    const status = String(snapshot.currentStatus || snapshot.latestStatus || '');
    if (status === 'SUCCESS' && (snapshot.latestUrl || snapshot.latestStaticUrl)) {
      return info;
    }
    if (status === 'FAILED' || status === 'CRASHED') {
      throw new Error(`deployment failed: ${JSON.stringify(snapshot)}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`deployment did not finish within ${DEPLOY_WAIT_TIMEOUT_MS}ms`);
}

async function main() {
  const account = await loadTestAccount();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const sessionCookieHeader = await ensureSessionCookieHeader(account);
  const sessionCookieValue = sessionCookieHeader.replace(/^app_session_v2_id=/, '');
  await context.addCookies([
    { name: 'app_session_v2_id', value: sessionCookieValue, url: WEB_BASE_URL },
    { name: 'app_session_v2_id', value: sessionCookieValue, url: API_BASE_URL },
  ]);

  try {
    await page.goto(WEB_BASE_URL, { waitUntil: 'networkidle' });
    await page.goto(`${WEB_BASE_URL}/new-task?q=${encodeURIComponent(PROMPT)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/session\//, { timeout: 120000 });
    await page.waitForTimeout(5000);

    const sessionUrl = page.url();
    const sessionId = sessionUrl.split('/session/')[1]?.split(/[?#]/)[0];

    if (!sessionId) {
      throw new Error(`failed to resolve session id: ${sessionId}`);
    }

    console.log('[identifiers]', JSON.stringify({ sessionId }));

    const sessionResult = await waitForSessionProgress(sessionId, sessionCookieHeader, page);
    console.log(
      '[session-complete]',
      JSON.stringify({
        hasPlaywrightEvidence: sessionResult.hasPlaywrightEvidence,
        workspaceItems: Array.isArray(sessionResult.workspaceTree?.items) ? sessionResult.workspaceTree.items.length : 0,
      })
    );

    await page.getByRole('button', { name: PREVIEW_BUTTON_NAME }).click();
    const previewPanel = page.locator('aside').first();
    const previewDeploymentTab = previewPanel.getByRole('button', { name: DEPLOY_TAB_NAME });
    if (await previewDeploymentTab.count()) {
      await previewDeploymentTab.click();
      await page.waitForTimeout(1500);
      const deployButton = previewPanel.getByRole('button', { name: DEPLOY_NOW_BUTTON_NAME });
      await deployButton.click();
    } else {
      await page.getByRole('button', { name: ARTIFACT_DEPLOY_BUTTON_NAME }).first().click();
    }
    console.log('[deploy] trigger clicked');

    const deploymentInfo = await waitForDeploymentSuccess(sessionId, sessionCookieHeader);
    const deployedUrl = deploymentInfo.latestUrl || deploymentInfo.latestStaticUrl;
    if (!deployedUrl) {
      throw new Error('deployment succeeded but no public url returned');
    }

    const deployedPage = await context.newPage();
    await deployedPage.goto(deployedUrl, { waitUntil: 'networkidle', timeout: 120000 });
    const deployedBody = await deployedPage.locator('body').innerText();
    const deployedTitle = await deployedPage.title();
    console.log(
      '[deployed-app]',
      JSON.stringify({
        url: deployedUrl,
        title: deployedTitle,
        contains2048: deployedBody.includes('2048') || deployedTitle.includes('2048'),
      })
    );

    if (!deployedBody.includes('2048') && !deployedTitle.includes('2048')) {
      throw new Error(`deployed app did not look like 2048: title=${deployedTitle}`);
    }

    await deployedPage.close();
    console.log('[result] success');
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[result] failure', error);
  process.exit(1);
});
