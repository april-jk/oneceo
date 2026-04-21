import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapSharedAuthenticatedUser } from './playwright-auth';
import { composerTextarea } from './playwright-locators';

const WEB_URL = 'http://127.0.0.1:3000';
const API_URL = 'http://127.0.0.1:4000';

const STATUS_PROMPT = '帮我查看当前部署状态';
const INTERCEPT_TEXT = '已识别为部署状态查询请求，正在调用平台服务...';
const COMPLETE_TEXT = '部署状态查询已完成';

const SESSION_URL_TIMEOUT_MS = 20_000;
const CAPABILITY_COMPLETE_TIMEOUT_MS = 120_000;
const NATIVE_HISTORY_COMPLETE_TIMEOUT_MS = 60_000;
const SNAPSHOT_POLL_INTERVAL_MS = 1_000;

type HistorySnapshotMessage = {
  role: string;
  messageType: string;
  content: string;
  metadata: {
    directModeIntercepted: boolean;
    capabilityId: string;
    outcome: string;
    tone: string;
    agent: string;
    source: string;
    eventType: string;
  };
};

type SessionSnapshotSummary = {
  id: string;
  status: string;
  stage: string;
  mode: string;
  executor: string;
  runtime: {
    orchestratorSessionId: string;
    opencodeSessionId: string;
  };
};

type ConversationSnapshot = {
  ui: {
    sessionId: string;
    mainText: string;
    sidebarPreview: Array<{ href: string; text: string }>;
  };
  history: HistorySnapshotMessage[];
  session: SessionSnapshotSummary;
};

type NativeHistorySessionCandidate = {
  sessionId: string;
  title: string;
  latestNativeContent: string;
  historyCount: number;
  orchestratorSessionId: string;
  opencodeSessionId: string;
};

test.describe.configure({ timeout: 240_000 });

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeMainText(value: string) {
  return normalizeText(value)
    .replace(/^Dialogue对话/, '')
    .replace(/运行中\s*·\s*[a-z0-9-]+/gi, '')
    .replace(/显示预览执行日志/g, '')
    .replace(/执行环境已接入（[^）]+）\s*·\s*OPENCODE_[A-Z_]+/g, '')
    .replace(/智能体正在处理\.\.\./g, '')
    .replace(/Agent Pro/g, '')
    .trim();
}

async function prepareDirectMode(page: Page) {
  await page.goto(WEB_URL);
  await page.evaluate(() => {
    localStorage.setItem('altus_mode', 'sandbox');
    localStorage.setItem('altus_executor', 'opencode');
    localStorage.removeItem('task_creation_session_id');
  });
  await page.goto(WEB_URL);
}

async function blurComposer(page: Page) {
  await page.locator('body').click({ position: { x: 20, y: 20 } });
}

async function waitForSessionUrl(page: Page) {
  await expect(page).toHaveURL(/\/session\//, { timeout: SESSION_URL_TIMEOUT_MS });
  return page.evaluate(() => localStorage.getItem('task_creation_session_id') || '');
}

async function waitForSidebarSessionPreview(page: Page, sessionId: string) {
  await expect(page.locator(`aside a[href*="${sessionId}"]`).first()).toBeVisible({
    timeout: CAPABILITY_COMPLETE_TIMEOUT_MS,
  });
}

async function waitForCapabilityCompletion(page: Page) {
  await expect(page.getByText(INTERCEPT_TEXT)).toBeVisible({
    timeout: CAPABILITY_COMPLETE_TIMEOUT_MS,
  });
  await expect(page.getByText(COMPLETE_TEXT)).toBeVisible({
    timeout: CAPABILITY_COMPLETE_TIMEOUT_MS,
  });
}

async function findLatestCompletedNativeSession(api: APIRequestContext) {
  const response = await apiGetWithRetry(api, '/api/task-creation/sessions?limit=100');
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      title?: string;
      status?: string;
      runtime?: {
        orchestratorSessionId?: string;
        opencodeSessionId?: string;
      };
    }>;
  };
  const list = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of list) {
    if (
      !item?.id ||
      item.status !== 'completed' ||
      !item.runtime?.orchestratorSessionId ||
      !item.runtime?.opencodeSessionId
    ) {
      continue;
    }
    const historyResponse = await apiGetWithRetry(
      api,
      `/api/task-creation/sessions/${encodeURIComponent(item.id)}/messages`
    );
    if (!historyResponse.ok()) {
      continue;
    }
    const historyPayload = (await historyResponse.json()) as {
      data?: Array<{
        content?: string;
        metadata?: {
          source?: string;
        };
      }>;
    };
    const history = Array.isArray(historyPayload?.data) ? historyPayload.data : [];
    const nativeHistory = history.filter((message) => message?.metadata?.source === 'opencode_native_history');
    if (nativeHistory.length === 0) {
      continue;
    }
    const latestNative = [...nativeHistory]
      .reverse()
      .find((message) => typeof message?.content === 'string' && message.content.trim());
    return {
      sessionId: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : item.id,
      latestNativeContent:
        typeof latestNative?.content === 'string' && latestNative.content.trim()
          ? latestNative.content.trim()
          : '',
      historyCount: nativeHistory.length,
      orchestratorSessionId: item.runtime.orchestratorSessionId,
      opencodeSessionId: item.runtime.opencodeSessionId,
    } satisfies NativeHistorySessionCandidate;
  }
  return null;
}

async function captureStableState(page: Page) {
  const state = await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    const sidebar = document.querySelector('aside');
    const sessionId = localStorage.getItem('task_creation_session_id') || '';
    const mainText = main?.textContent || '';
    const sidebarPreview = Array.from(sidebar?.querySelectorAll('a[href*="/session/"]') || [])
      .map((node) => ({
        href: (node as HTMLAnchorElement).getAttribute('href') || '',
        text: normalize((node as HTMLElement).innerText || ''),
      }))
      .filter((item) => item.text)
      .slice(0, 3);
    return {
      sessionId,
      mainText,
      sidebarPreview,
    };
  });

  return {
    ...state,
    mainText: sanitizeMainText(state.mainText),
  };
}

async function readClientUserId(page: Page) {
  return page.evaluate(() => localStorage.getItem('oneceo_client_user_id') || '');
}

async function createApiContextFromBrowser(context: BrowserContext) {
  const storageState = await context.storageState();
  return playwrightRequest.newContext({
    baseURL: API_URL,
    storageState,
  });
}

async function apiGetWithRetry(
  api: APIRequestContext,
  path: string,
  options: { headers?: Record<string, string> } = {}
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await api.get(path, options);
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

async function captureHistoryMessages(
  api: APIRequestContext,
  page: Page,
  sessionId: string
): Promise<HistorySnapshotMessage[]> {
  const clientUserId = await readClientUserId(page);
  const response = await apiGetWithRetry(
    api,
    `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      headers: clientUserId ? { 'X-User-Id': clientUserId } : {},
    }
  );

  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const list = Array.isArray(payload?.data) ? payload.data : [];

  return list.map((item) => {
    const metadata =
      item?.metadata && typeof item.metadata === 'object'
        ? (item.metadata as Record<string, unknown>)
        : {};

    return {
      role: typeof item.role === 'string' ? item.role : '',
      messageType: typeof item.messageType === 'string' ? item.messageType : '',
      content: normalizeText(typeof item.content === 'string' ? item.content : ''),
      metadata: {
        directModeIntercepted: Boolean(metadata.directModeIntercepted),
        capabilityId: typeof metadata.capabilityId === 'string' ? metadata.capabilityId : '',
        outcome: typeof metadata.outcome === 'string' ? metadata.outcome : '',
        tone: typeof metadata.tone === 'string' ? metadata.tone : '',
        agent: typeof metadata.agent === 'string' ? metadata.agent : '',
        source: typeof metadata.source === 'string' ? metadata.source : '',
        eventType: typeof metadata.eventType === 'string' ? metadata.eventType : '',
      },
    };
  });
}

async function captureSessionSummary(
  api: APIRequestContext,
  page: Page,
  sessionId: string
): Promise<SessionSnapshotSummary> {
  const clientUserId = await readClientUserId(page);
  const response = await apiGetWithRetry(api, `/api/task-creation/sessions/${encodeURIComponent(sessionId)}`, {
    headers: clientUserId ? { 'X-User-Id': clientUserId } : {},
  });

  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data?: Record<string, unknown> };
  const session = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const runtime =
    session.runtime && typeof session.runtime === 'object'
      ? (session.runtime as Record<string, unknown>)
      : {};

  return {
    id: typeof session.id === 'string' ? session.id : sessionId,
    status: typeof session.status === 'string' ? session.status : '',
    stage: typeof session.stage === 'string' ? session.stage : '',
    mode: typeof session.mode === 'string' ? session.mode : '',
    executor: typeof session.executor === 'string' ? session.executor : '',
    runtime: {
      orchestratorSessionId:
        typeof runtime.orchestratorSessionId === 'string' ? runtime.orchestratorSessionId : '',
      opencodeSessionId:
        typeof runtime.opencodeSessionId === 'string' ? runtime.opencodeSessionId : '',
    },
  };
}

async function captureConversationSnapshot(
  api: APIRequestContext,
  page: Page,
  sessionId: string
): Promise<ConversationSnapshot> {
  const [ui, history, session] = await Promise.all([
    captureStableState(page),
    captureHistoryMessages(api, page, sessionId),
    captureSessionSummary(api, page, sessionId),
  ]);
  const currentPreview = ui.sidebarPreview.find((item) => item.href.includes(sessionId));

  return {
    ui: {
      ...ui,
      sidebarPreview: currentPreview ? [currentPreview] : [],
    },
    history,
    session,
  };
}

async function waitForConversationSnapshotStable(
  api: APIRequestContext,
  page: Page,
  sessionId: string,
  input: {
    timeoutMs: number;
    predicate: (snapshot: ConversationSnapshot) => boolean;
    hint: string;
  }
) {
  const startedAt = Date.now();
  let lastSignature = '';
  let stableCount = 0;
  let lastSnapshot: ConversationSnapshot | null = null;

  while (Date.now() - startedAt < input.timeoutMs) {
    const snapshot = await captureConversationSnapshot(api, page, sessionId);
    lastSnapshot = snapshot;
    const signature = JSON.stringify(snapshot);

    if (input.predicate(snapshot)) {
      stableCount = signature === lastSignature ? stableCount + 1 : 1;
      lastSignature = signature;
      if (stableCount >= 2) {
        return snapshot;
      }
    } else {
      stableCount = 0;
      lastSignature = signature;
    }

    await page.waitForTimeout(SNAPSHOT_POLL_INTERVAL_MS);
  }

  throw new Error(
    `${input.hint}: ${JSON.stringify(lastSnapshot, null, 2).slice(0, 3000)}`
  );
}

function compareScreenshotsWithPython(beforePath: string, afterPath: string) {
  const script = `
import json
import sys
from PIL import Image, ImageChops

before = Image.open(sys.argv[1]).convert("RGBA")
after = Image.open(sys.argv[2]).convert("RGBA")

if before.size != after.size:
    print(json.dumps({
        "equal": False,
        "reason": f"dimension mismatch: {before.size} vs {after.size}"
    }))
    sys.exit(0)

diff = ImageChops.difference(before, after)
bbox = diff.getbbox()
if bbox is None:
    print(json.dumps({"equal": True, "diffPixels": 0}))
    sys.exit(0)

left, top, right, bottom = bbox
diff_pixels = 0
for pixel in diff.crop(bbox).getdata():
    if pixel[:4] != (0, 0, 0, 0):
        diff_pixels += 1

print(json.dumps({
    "equal": False,
    "diffPixels": diff_pixels,
    "bbox": {
        "left": left,
        "top": top,
        "right": right - 1,
        "bottom": bottom - 1
    }
}))
`;

  const raw = execFileSync('python3', ['-c', script, beforePath, afterPath], {
    encoding: 'utf8',
  }).trim();
  return JSON.parse(raw) as
    | { equal: true; diffPixels: 0 }
    | {
        equal: false;
        reason?: string;
        diffPixels?: number;
        bbox?: { left: number; top: number; right: number; bottom: number };
      };
}

function expectPreviewMatchesPrompt(snapshot: ConversationSnapshot, sessionId: string, prompt: string) {
  expect(snapshot.ui.sessionId).toBe(sessionId);
  expect(snapshot.ui.sidebarPreview[0]?.href).toContain(sessionId);
  expect(snapshot.ui.sidebarPreview[0]?.text).toContain(prompt);
}

function previewHasCompletedStatus(snapshot: ConversationSnapshot) {
  return snapshot.ui.sidebarPreview[0]?.text.includes('完成') ?? false;
}

function expectEqualScreenshots(
  testInfo: Parameters<typeof test>[1] extends never ? never : any,
  label: string,
  beforeScreenshot: Buffer,
  afterScreenshot: Buffer,
  reentryScreenshot: Buffer
) {
  const debugDir = testInfo.outputPath(`${label}-visual-diff`);
  mkdirSync(debugDir, { recursive: true });
  const beforePath = join(debugDir, 'before.png');
  const afterPath = join(debugDir, 'after.png');
  const reentryPath = join(debugDir, 'reentry.png');
  writeFileSync(beforePath, beforeScreenshot);
  writeFileSync(afterPath, afterScreenshot);
  writeFileSync(reentryPath, reentryScreenshot);

  const refreshScreenshotComparison = compareScreenshotsWithPython(beforePath, afterPath);
  const reentryScreenshotComparison = compareScreenshotsWithPython(beforePath, reentryPath);
  expect(refreshScreenshotComparison).toEqual({ equal: true, diffPixels: 0 });
  expect(reentryScreenshotComparison).toEqual({ equal: true, diffPixels: 0 });
}

async function openFreshSessionPage(
  browser: Browser,
  context: BrowserContext,
  sessionId: string
) {
  const storageState = await context.storageState();
  const nextContext = await browser.newContext({ storageState });
  const nextPage = await nextContext.newPage();
  await nextPage.goto(`${WEB_URL}/session/${sessionId}?view=history`, {
    waitUntil: 'networkidle',
  });
  return { nextContext, nextPage };
}

test('direct mode capability flow keeps conversation data identical after refresh and re-entry', async ({
  browser,
}, testInfo) => {
  const context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
  const page = await context.newPage();
  const api = await createApiContextFromBrowser(context);
  try {
    await prepareDirectMode(page);

    const composer = composerTextarea(page);
    await composer.fill(STATUS_PROMPT);
    await composer.press('Enter');

    const sessionId = await waitForSessionUrl(page);
    await waitForCapabilityCompletion(page);
    await blurComposer(page);
    await waitForSidebarSessionPreview(page, sessionId);

    const beforeState = await waitForConversationSnapshotStable(api, page, sessionId, {
      timeoutMs: CAPABILITY_COMPLETE_TIMEOUT_MS,
      hint: `capability conversation did not stabilize for ${sessionId}`,
      predicate: (snapshot) =>
        snapshot.history.some((item) => item.content === INTERCEPT_TEXT) &&
        snapshot.history.some((item) => item.content === COMPLETE_TEXT) &&
        snapshot.session.status === 'completed' &&
        snapshot.session.stage === 'completed' &&
        previewHasCompletedStatus(snapshot),
    });
    const beforeScreenshot = await page.screenshot({ animations: 'disabled' });

    expect(beforeState.ui.mainText).toContain(STATUS_PROMPT);
    expect(beforeState.ui.mainText).toContain(INTERCEPT_TEXT);
    expect(beforeState.ui.mainText).toContain(COMPLETE_TEXT);
    expectPreviewMatchesPrompt(beforeState, sessionId, STATUS_PROMPT);

    await page.reload({ waitUntil: 'networkidle' });
    await waitForCapabilityCompletion(page);
    await blurComposer(page);
    await waitForSidebarSessionPreview(page, sessionId);

    const afterState = await waitForConversationSnapshotStable(api, page, sessionId, {
      timeoutMs: CAPABILITY_COMPLETE_TIMEOUT_MS,
      hint: `capability refresh snapshot did not stabilize for ${sessionId}`,
      predicate: (snapshot) =>
        snapshot.history.some((item) => item.content === INTERCEPT_TEXT) &&
        snapshot.history.some((item) => item.content === COMPLETE_TEXT) &&
        snapshot.session.status === 'completed' &&
        snapshot.session.stage === 'completed' &&
        previewHasCompletedStatus(snapshot),
    });
    const afterScreenshot = await page.screenshot({ animations: 'disabled' });

    const { nextContext, nextPage } = await openFreshSessionPage(browser, context, sessionId);
    try {
      await waitForCapabilityCompletion(nextPage);
      await blurComposer(nextPage);
      await waitForSidebarSessionPreview(nextPage, sessionId);
      const reentryState = await waitForConversationSnapshotStable(api, nextPage, sessionId, {
        timeoutMs: CAPABILITY_COMPLETE_TIMEOUT_MS,
        hint: `capability reentry snapshot did not stabilize for ${sessionId}`,
        predicate: (snapshot) =>
          snapshot.history.some((item) => item.content === INTERCEPT_TEXT) &&
          snapshot.history.some((item) => item.content === COMPLETE_TEXT) &&
          snapshot.session.status === 'completed' &&
          snapshot.session.stage === 'completed' &&
          previewHasCompletedStatus(snapshot),
      });
      const reentryScreenshot = await nextPage.screenshot({ animations: 'disabled' });

      expect(afterState).toEqual(beforeState);
      expect(reentryState).toEqual(beforeState);
      expectEqualScreenshots(
        testInfo,
        'capability-refresh',
        beforeScreenshot,
        afterScreenshot,
        reentryScreenshot
      );
    } finally {
      await nextContext.close();
    }
  } finally {
    await context.close();
    await api.dispose();
  }
});

test('direct mode opencode session restores native history identically after refresh and re-entry', async ({
  browser,
}, testInfo) => {
  const context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
  const page = await context.newPage();
  const api = await createApiContextFromBrowser(context);
  try {
    await prepareDirectMode(page);
    const seeded = await findLatestCompletedNativeSession(api);
    expect(seeded).not.toBeNull();
    const sessionId = seeded!.sessionId;
    await page.goto(`${WEB_URL}/session/${sessionId}?view=history`, {
      waitUntil: 'networkidle',
    });
    await blurComposer(page);
    await waitForSidebarSessionPreview(page, sessionId);

    const beforeState = await waitForConversationSnapshotStable(api, page, sessionId, {
      timeoutMs: NATIVE_HISTORY_COMPLETE_TIMEOUT_MS,
      hint: `opencode native history conversation did not stabilize for ${sessionId}`,
      predicate: (snapshot) =>
        snapshot.session.executor === 'opencode' &&
        snapshot.session.mode === 'sandbox' &&
        snapshot.session.status === 'completed' &&
        snapshot.session.stage === 'completed' &&
        snapshot.session.runtime.orchestratorSessionId === seeded!.orchestratorSessionId &&
        snapshot.session.runtime.opencodeSessionId === seeded!.opencodeSessionId &&
        snapshot.history.filter((item) => item.metadata.source === 'opencode_native_history').length >=
          seeded!.historyCount &&
        snapshot.history.some(
          (item) =>
            item.metadata.source === 'opencode_native_history' &&
            item.content.includes(seeded!.latestNativeContent || seeded!.title)
        ),
    });
    const beforeScreenshot = await page.screenshot({ animations: 'disabled' });

    expect(beforeState.ui.mainText).toContain(seeded!.latestNativeContent || seeded!.title);
    expectPreviewMatchesPrompt(beforeState, sessionId, seeded!.title);

    await page.reload({ waitUntil: 'networkidle' });
    await blurComposer(page);
    await waitForSidebarSessionPreview(page, sessionId);

    const afterState = await waitForConversationSnapshotStable(api, page, sessionId, {
      timeoutMs: CAPABILITY_COMPLETE_TIMEOUT_MS,
      hint: `opencode native history refresh did not stabilize for ${sessionId}`,
      predicate: (snapshot) =>
        snapshot.session.status === 'completed' &&
        snapshot.session.stage === 'completed' &&
        snapshot.session.runtime.orchestratorSessionId === seeded!.orchestratorSessionId &&
        snapshot.session.runtime.opencodeSessionId === seeded!.opencodeSessionId &&
        snapshot.history.filter((item) => item.metadata.source === 'opencode_native_history').length >=
          seeded!.historyCount,
    });
    const afterScreenshot = await page.screenshot({ animations: 'disabled' });

    const { nextContext, nextPage } = await openFreshSessionPage(browser, context, sessionId);
    try {
      await blurComposer(nextPage);
      await waitForSidebarSessionPreview(nextPage, sessionId);
      const reentryState = await waitForConversationSnapshotStable(api, nextPage, sessionId, {
        timeoutMs: CAPABILITY_COMPLETE_TIMEOUT_MS,
        hint: `opencode native history reentry did not stabilize for ${sessionId}`,
        predicate: (snapshot) =>
          snapshot.session.status === 'completed' &&
          snapshot.session.stage === 'completed' &&
          snapshot.session.runtime.orchestratorSessionId === seeded!.orchestratorSessionId &&
          snapshot.session.runtime.opencodeSessionId === seeded!.opencodeSessionId &&
          snapshot.history.filter((item) => item.metadata.source === 'opencode_native_history').length >=
            seeded!.historyCount,
      });
      const reentryScreenshot = await nextPage.screenshot({ animations: 'disabled' });

      expect(afterState).toEqual(beforeState);
      expect(reentryState).toEqual(beforeState);
      expectEqualScreenshots(
        testInfo,
        'opencode-native-history-refresh',
        beforeScreenshot,
        afterScreenshot,
        reentryScreenshot
      );
    } finally {
      await nextContext.close();
    }
  } finally {
    await context.close();
    await api.dispose();
  }
});
