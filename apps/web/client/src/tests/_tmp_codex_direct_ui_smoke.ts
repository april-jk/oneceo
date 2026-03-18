import { chromium, request as playwrightRequest, expect, type APIRequestContext, type Page } from '@playwright/test';

const WEB_URL = 'http://127.0.0.1:3000';
const API_URL = 'http://127.0.0.1:4000';
const PROMPT = 'Reply with exactly OK and nothing else.';
const COMPLETE_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_500;

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

async function apiGetWithRetry(api: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await api.get(path, { headers });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'api get failed'));
}

async function prepareCodexDirectMode(page: Page) {
  await page.goto(WEB_URL);
  await page.evaluate(() => {
    localStorage.setItem('altus_mode', 'sandbox');
    localStorage.setItem('altus_executor', 'codex');
    localStorage.removeItem('task_creation_session_id');
  });
  await page.goto(WEB_URL, { waitUntil: 'networkidle' });
}

async function waitForSessionId(page: Page) {
  await expect(page).toHaveURL(/\/session\//, { timeout: 30_000 });
  const sessionId = await page.evaluate(() => localStorage.getItem('task_creation_session_id') || '');
  if (!sessionId) {
    throw new Error('task_creation_session_id missing');
  }
  return sessionId;
}

async function readClientUserId(page: Page) {
  return page.evaluate(() => localStorage.getItem('oneceo_client_user_id') || '');
}

async function waitForCompletedSession(api: APIRequestContext, page: Page, sessionId: string) {
  const startedAt = Date.now();
  let lastPayload: unknown = null;
  while (Date.now() - startedAt < COMPLETE_TIMEOUT_MS) {
    const clientUserId = await readClientUserId(page);
    const response = await apiGetWithRetry(
      api,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}`,
      clientUserId ? { 'X-User-Id': clientUserId } : {}
    );
    const payload = await response.json();
    lastPayload = payload;
    const session = payload?.data || {};
    const runtime = session?.runtime || {};
    if (
      session?.status === 'completed' &&
      session?.stage === 'completed' &&
      session?.driver === 'codex' &&
      session?.executor === 'codex' &&
      typeof runtime?.orchestratorSessionId === 'string' &&
      runtime.orchestratorSessionId &&
      typeof runtime?.executorSessionId === 'string' &&
      runtime.executorSessionId
    ) {
      return payload;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  throw new Error(`session did not complete: ${JSON.stringify(lastPayload, null, 2).slice(0, 4000)}`);
}

async function waitForHistorySignals(api: APIRequestContext, page: Page, sessionId: string) {
  const startedAt = Date.now();
  let lastPayload: unknown = null;
  while (Date.now() - startedAt < COMPLETE_TIMEOUT_MS) {
    const clientUserId = await readClientUserId(page);
    const response = await apiGetWithRetry(
      api,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages/history?limit=30`,
      clientUserId ? { 'X-User-Id': clientUserId } : {}
    );
    const payload = await response.json();
    lastPayload = payload;
    const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
    const hasUserInput = messages.some(
      (item: any) => item?.messageType === 'codex_user_input' && normalizeText(String(item?.content || '')) === PROMPT
    );
    const hasTurnCompleted = messages.some(
      (item: any) =>
        item?.messageType === 'executor_event' &&
        item?.metadata?.eventType === 'turn.completed'
    );
    if (hasUserInput && hasTurnCompleted) {
      return payload;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  throw new Error(`history did not contain codex completion: ${JSON.stringify(lastPayload, null, 2).slice(0, 4000)}`);
}

async function captureUiState(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const sidebar = document.querySelector('aside');
    const sessionId = localStorage.getItem('task_creation_session_id') || '';
    const sidebarEntries = Array.from(sidebar?.querySelectorAll('a[href*="/session/"]') || [])
      .map((node) => ({
        href: (node as HTMLAnchorElement).getAttribute('href') || '',
        text: ((node as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((item) => item.text)
      .slice(0, 5);
    return {
      sessionId,
      mainText: (main?.textContent || '').replace(/\s+/g, ' ').trim(),
      sidebarEntries,
      url: window.location.href,
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await prepareCodexDirectMode(page);

    const composer = page.getByRole('textbox', { name: 'Type your message here...' });
    await composer.fill(PROMPT);
    await composer.press('Enter');

    const sessionId = await waitForSessionId(page);
    const sessionPayload = await waitForCompletedSession(api, page, sessionId);
    const historyPayload = await waitForHistorySignals(api, page, sessionId);
    await page.waitForTimeout(5000);
    const beforeReload = await captureUiState(page);

    const disallowedFragments = [
      'EXECUTOR_EVENT',
      'thread.started',
      'Codex 事件: item.started',
      'Codex 事件: item.completed',
      'Codex 会话已建立，正在等待执行...',
      'Codex 已接收输入，正在执行...',
    ];
    for (const fragment of disallowedFragments) {
      expect(beforeReload.mainText).not.toContain(fragment);
    }
    expect(beforeReload.mainText).toContain('OK');
    expect(beforeReload.mainText).toContain('Codex 执行完成');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2_000);
    const afterReload = await captureUiState(page);
    for (const fragment of disallowedFragments) {
      expect(afterReload.mainText).not.toContain(fragment);
    }
    expect(afterReload.mainText).toContain('OK');
    expect(afterReload.mainText).toContain('Codex 执行完成');

    console.log(
      JSON.stringify(
        {
          phase: 'completed',
          prompt: PROMPT,
          sessionId,
          session: sessionPayload?.data || null,
          historyTail: Array.isArray(historyPayload?.data?.messages)
            ? historyPayload.data.messages.slice(-8).map((item: any) => ({
                role: item?.role,
                messageType: item?.messageType,
                content: item?.content,
                metadata: item?.metadata,
              }))
            : [],
          beforeReload,
          afterReload,
        },
        null,
        2
      )
    );
  } finally {
    await context.close();
    await api.dispose();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
