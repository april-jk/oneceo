import { expect, request as playwrightRequest, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:4000';

const SESSION_URL_TIMEOUT_MS = 20_000;
const RUN_COMPLETE_TIMEOUT_MS = 180_000;
const UI_RECOVERY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

type ManagedRunSummary = {
  id: string;
  status?: string;
  sequence?: number | null;
};

type TimelineMessage = {
  content?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
};

type DeliverableArtifact = {
  id: string;
  name: string;
  path: string;
  mimeType?: string;
  downloadPath?: string;
};

type ManagedStreamLogEntry = {
  eventType: string;
  url: string;
  data: string;
  timestamp: number;
};

test.describe.configure({ timeout: 300_000 });

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildPrompt(fileName: string, token: string) {
  return [
    '请严格执行以下任务，不要提问：',
    `1. 在工作区根目录创建一个 Markdown 文件 \`${fileName}\``,
    '2. 文件内容必须精确包含：',
    '# Deliverable Stability Smoke',
    '',
    `token: ${token}`,
    '3. 不要创建任何其他最终交付文件',
    '4. 完成后把这个 markdown 作为唯一最终交付文件返回',
  ].join('\n');
}

async function installManagedEventRecorder(page: Page) {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __managedRunEventLog?: Array<{ eventType: string; url: string; data: string; timestamp: number }>;
    };
    if (win.__managedRunEventLog) {
      return;
    }
    win.__managedRunEventLog = [];
    const NativeEventSource = window.EventSource;
    class WrappedEventSource extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        const sourceUrl = String(url || '');
        if (!sourceUrl.includes('/api/altus-managed/runs/')) {
          return;
        }
        const eventTypes = [
          'run_ack',
          'run_status',
          'deliverables_ready',
          'assistant_delta',
          'assistant_message',
          'run_completed',
          'run_failed',
          'run_stopped',
        ];
        for (const eventType of eventTypes) {
          this.addEventListener(eventType, (event: MessageEvent) => {
            win.__managedRunEventLog?.push({
              eventType,
              url: sourceUrl,
              data: typeof event.data === 'string' ? event.data : '',
              timestamp: Date.now(),
            });
          });
        }
      }
    }
    Object.defineProperty(WrappedEventSource, 'CONNECTING', { value: NativeEventSource.CONNECTING });
    Object.defineProperty(WrappedEventSource, 'OPEN', { value: NativeEventSource.OPEN });
    Object.defineProperty(WrappedEventSource, 'CLOSED', { value: NativeEventSource.CLOSED });
    (window as any).EventSource = WrappedEventSource;
  });
}

async function bootstrapAuthenticatedUser(browser: import('@playwright/test').Browser, token: string) {
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    const response = await api.post('/api/auth/register', {
      data: {
        displayName: `playwright-${token}`,
        email: `playwright-${token}@example.com`,
        password: 'deliverable-test-123',
      },
    });
    expect(response.ok()).toBe(true);
    const storageState = await api.storageState();
    return await browser.newContext({ storageState });
  } finally {
    await api.dispose();
  }
}

async function enableManagedMode(page: Page) {
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('altus_mode', 'managed');
    localStorage.removeItem('task_creation_session_id');
  });
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Type your message here...' })).toBeVisible();
}

async function openManagedSession(page: Page, sessionId: string, view: 'chat' | 'history' = 'chat') {
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((nextSessionId) => {
    localStorage.setItem('altus_mode', 'managed');
    localStorage.setItem('task_creation_session_id', nextSessionId);
  }, sessionId);
  const suffix = view === 'history' ? '?view=history' : '';
  await page.goto(`${WEB_URL}/session/${sessionId}${suffix}`, { waitUntil: 'domcontentloaded' });
}

async function waitForSessionUrl(page: Page) {
  await expect(page).toHaveURL(/\/session\//, { timeout: SESSION_URL_TIMEOUT_MS });
  const sessionId = await page.evaluate(() => localStorage.getItem('task_creation_session_id') || '');
  expect(sessionId).toBeTruthy();
  return sessionId;
}

async function createApiContextFromBrowser(context: BrowserContext) {
  const storageState = await context.storageState();
  return playwrightRequest.newContext({
    baseURL: API_URL,
    storageState,
  });
}

async function apiGetWithRetry(api: APIRequestContext, path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await api.get(path);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const retryable =
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('socket hang up') ||
        message.includes('fetch failed');
      if (!retryable || attempt === 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'api get failed'));
}

async function waitForLatestManagedRun(api: APIRequestContext, sessionId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_COMPLETE_TIMEOUT_MS) {
    const response = await apiGetWithRetry(
      api,
      `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs/latest`
    );
    if (response.ok()) {
      const payload = (await response.json()) as { data?: ManagedRunSummary | null };
      if (payload?.data?.id) {
        return payload.data;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`latest managed run not found for ${sessionId}`);
}

async function waitForRunCompleted(api: APIRequestContext, sessionId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_COMPLETE_TIMEOUT_MS) {
    const latest = await waitForLatestManagedRun(api, sessionId);
    if (latest.status === 'completed') {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`managed run did not complete for ${sessionId}`);
}

async function waitForMessages(api: APIRequestContext, sessionId: string) {
  const response = await apiGetWithRetry(
    api,
    `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`
  );
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: TimelineMessage[] };
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function waitForDeliverables(api: APIRequestContext, sessionId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_COMPLETE_TIMEOUT_MS) {
    const response = await apiGetWithRetry(
      api,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deliverables`
    );
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as { data?: DeliverableArtifact[] };
    const deliverables = Array.isArray(payload?.data) ? payload.data : [];
    if (deliverables.length > 0) {
      return deliverables;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`deliverables not ready for ${sessionId}`);
}

async function waitForMessageHistoryStable(
  api: APIRequestContext,
  sessionId: string,
  predicate: (messages: TimelineMessage[]) => boolean
) {
  const startedAt = Date.now();
  let lastSignature = '';
  let stableCount = 0;
  let lastMessages: TimelineMessage[] = [];
  while (Date.now() - startedAt < RUN_COMPLETE_TIMEOUT_MS) {
    const messages = await waitForMessages(api, sessionId);
    lastMessages = messages;
    const signature = JSON.stringify(messages);
    if (predicate(messages)) {
      stableCount = signature === lastSignature ? stableCount + 1 : 1;
      lastSignature = signature;
      if (stableCount >= 2) {
        return messages;
      }
    } else {
      stableCount = 0;
      lastSignature = signature;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`message history did not stabilize: ${JSON.stringify(lastMessages).slice(0, 3000)}`);
}

async function readManagedEventLog(page: Page): Promise<ManagedStreamLogEntry[]> {
  return page.evaluate(() => {
    const entries = (window as any).__managedRunEventLog;
    return Array.isArray(entries) ? entries : [];
  });
}

function getDeliverableCard(page: Page, fileName: string) {
  return page
    .locator('div')
    .filter({ hasText: 'Task complete' })
    .filter({ hasText: '下载' })
    .filter({ hasText: fileName })
    .first();
}

function extractRunIdFromEvent(entry: ManagedStreamLogEntry): string {
  try {
    const parsed = JSON.parse(entry.data || '{}') as { payload?: Record<string, unknown>; runId?: string };
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed;
    return typeof payload?.runId === 'string' ? payload.runId : '';
  } catch {
    return '';
  }
}

function extractEventType(message: TimelineMessage) {
  const metadata = message?.metadata;
  if (!metadata || typeof metadata !== 'object') return '';
  return typeof (metadata as Record<string, unknown>).eventType === 'string'
    ? String((metadata as Record<string, unknown>).eventType)
    : '';
}

test('managed deliverable stays stable from realtime stream to reload and re-entry', async ({
  browser,
}, testInfo) => {
  const token = uniqueToken();
  const fileName = `deliverable-stability-${token}.md`;
  const prompt = buildPrompt(fileName, token);

  const context = await bootstrapAuthenticatedUser(browser, token);
  const page = await context.newPage();
  await installManagedEventRecorder(page);
  await enableManagedMode(page);

  try {
    const composer = page.getByRole('textbox', { name: 'Type your message here...' });
    await composer.fill(prompt);
    await composer.press('Enter');

    const sessionId = await waitForSessionUrl(page);
    console.log('[managed-deliverable-test] session created', sessionId);
    const api = await createApiContextFromBrowser(context);
    try {
      const latestRun = await waitForRunCompleted(api, sessionId);
      expect(latestRun.id).toBeTruthy();
      console.log('[managed-deliverable-test] run completed', latestRun.id);

      const deliverableCard = getDeliverableCard(page, fileName);
      await expect(deliverableCard).toBeVisible({ timeout: RUN_COMPLETE_TIMEOUT_MS });
      await expect(page.getByText('已生成 1 个最终交付物')).toBeVisible({ timeout: RUN_COMPLETE_TIMEOUT_MS });
      await expect(page.getByRole('button', { name: '下载' })).toBeVisible();
      console.log('[managed-deliverable-test] deliverable card visible');

      const eventLog = await readManagedEventLog(page);
      const runEvents = eventLog.filter((entry) => extractRunIdFromEvent(entry) === latestRun.id);
      const deliverablesReadyIndex = runEvents.findIndex((entry) => entry.eventType === 'deliverables_ready');
      expect(deliverablesReadyIndex).toBeGreaterThanOrEqual(0);

      const messages = await waitForMessageHistoryStable(
        api,
        sessionId,
        (items) => {
          const readyIndex = items.findIndex((item) => extractEventType(item) === 'deliverables_ready');
          const completedIndex = items.findIndex((item) => extractEventType(item) === 'run_completed');
          return readyIndex >= 0 && completedIndex > readyIndex;
        }
      );

      const readyIndex = messages.findIndex((item) => extractEventType(item) === 'deliverables_ready');
      const completedIndex = messages.findIndex((item) => extractEventType(item) === 'run_completed');
      expect(readyIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThan(readyIndex);

      const deliverables = await waitForDeliverables(api, sessionId);
      expect(deliverables).toHaveLength(1);
      expect(deliverables[0]?.name).toBe(fileName);
      expect(deliverables[0]?.downloadPath).toBeTruthy();
      console.log('[managed-deliverable-test] deliverables listed');

      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载' }).click();
      const artifactDownload = await download;
      expect(artifactDownload.suggestedFilename()).toBe(fileName);
      const outputDir = testInfo.outputPath('managed-deliverable-download');
      mkdirSync(outputDir, { recursive: true });
      const savedPath = join(outputDir, fileName);
      await artifactDownload.saveAs(savedPath);
      const raw = readFileSync(savedPath, 'utf8');
      expect(raw).toContain('# Deliverable Stability Smoke');
      expect(raw).toContain(`token: ${token}`);
      console.log('[managed-deliverable-test] download verified');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(getDeliverableCard(page, fileName)).toBeVisible({ timeout: UI_RECOVERY_TIMEOUT_MS });
      console.log('[managed-deliverable-test] reload verified');

      const revisitPage = await context.newPage();
      try {
        await openManagedSession(revisitPage, sessionId, 'history');
        await expect(getDeliverableCard(revisitPage, fileName)).toBeVisible({ timeout: UI_RECOVERY_TIMEOUT_MS });
        console.log('[managed-deliverable-test] reentry verified (same context)');
      } finally {
        await revisitPage.close();
      }

      const nextContext = await browser.newContext({ storageState: await context.storageState() });
      try {
        const nextPage = await nextContext.newPage();
        await openManagedSession(nextPage, sessionId, 'history');
        await expect(getDeliverableCard(nextPage, fileName)).toBeVisible({ timeout: UI_RECOVERY_TIMEOUT_MS });
        console.log('[managed-deliverable-test] reentry verified (fresh context)');
      } finally {
        await nextContext.close();
      }
    } finally {
      await api.dispose();
    }
  } finally {
    await context.close();
  }
});
