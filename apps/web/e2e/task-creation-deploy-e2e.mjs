import { chromium } from '@playwright/test';

const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://127.0.0.1:3000';
const API_BASE_URL = process.env.ONECEO_API_BASE_URL || 'http://127.0.0.1:4000';
const PROMPT =
  process.env.ONECEO_E2E_PROMPT ||
  '请使用 Node.js 开发一个 2048 小游戏，生成完整可运行项目，自己在 sandbox 内启动并使用 Playwright 做核心交互测试，确认通过后再结束。不要先问问题，直接开始。';

const SESSION_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_SESSION_WAIT_TIMEOUT_MS || 25 * 60 * 1000);
const DEPLOY_WAIT_TIMEOUT_MS = Number(process.env.ONECEO_DEPLOY_WAIT_TIMEOUT_MS || 20 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5000);

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

async function apiRequest(path, userId, init = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
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

async function waitForSessionProgress(sessionId, userId, page) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  let lastQuestionAt = 0;

  while (Date.now() - startedAt < SESSION_WAIT_TIMEOUT_MS) {
    const detailPayload = await apiRequest(`/api/task-creation/sessions/${encodeURIComponent(sessionId)}`, userId);
    const detail = detailPayload?.data || {};
    const status = String(detail.status || '');
    const stage = String(detail.stage || '');
    const phase = String(detail.phase || '');
    const runtimeStatus = detail.runtimeStatus?.status || null;

    let workspaceTree = null;
    try {
      workspaceTree = await apiRequest(
        `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/workspace/tree`,
        userId
      );
    } catch {
      workspaceTree = null;
    }

    const messagePayload = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`,
      userId
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

async function waitForDeploymentSuccess(sessionId, userId) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < DEPLOY_WAIT_TIMEOUT_MS) {
    const payload = await apiRequest(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deployment`,
      userId
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  try {
    await page.goto(WEB_BASE_URL, { waitUntil: 'networkidle' });
    await page.goto(`${WEB_BASE_URL}/new-task?q=${encodeURIComponent(PROMPT)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/session\//, { timeout: 120000 });
    await page.waitForTimeout(5000);

    const sessionUrl = page.url();
    const sessionId = sessionUrl.split('/session/')[1]?.split(/[?#]/)[0];
    const userId = await page.evaluate(() => window.localStorage.getItem('oneceo_client_user_id'));

    if (!sessionId || !userId) {
      throw new Error(`failed to resolve identifiers: sessionId=${sessionId} userId=${userId}`);
    }

    console.log('[identifiers]', JSON.stringify({ sessionId, userId }));

    const sessionResult = await waitForSessionProgress(sessionId, userId, page);
    console.log(
      '[session-complete]',
      JSON.stringify({
        hasPlaywrightEvidence: sessionResult.hasPlaywrightEvidence,
        workspaceItems: Array.isArray(sessionResult.workspaceTree?.items) ? sessionResult.workspaceTree.items.length : 0,
      })
    );

    await page.getByRole('button', { name: '显示预览' }).click();
    await page.getByRole('button', { name: '部署' }).click();
    await page.waitForTimeout(1500);

    const deployButton = page.getByRole('button', { name: '立即部署' });
    await deployButton.click();
    console.log('[deploy] trigger clicked');

    const deploymentInfo = await waitForDeploymentSuccess(sessionId, userId);
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
