import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_URL = 'http://127.0.0.1:3000';
const API_URL = 'http://127.0.0.1:4000';
const STATUS_PROMPT = '帮我查看当前部署状态';
const INTERCEPT_TEXT = '已识别为部署状态查询请求，正在调用平台服务...';
const COMPLETE_TEXT = '部署状态查询已完成';
const CAPABILITY_START_TIMEOUT_MS = 20_000;
const CAPABILITY_COMPLETE_TIMEOUT_MS = 45_000;

async function prepareDirectMode(page: Page) {
  await page.goto(WEB_URL);
  await page.evaluate(() => {
    localStorage.setItem('altus_mode', 'sandbox');
    localStorage.setItem('altus_executor', 'opencode');
    localStorage.removeItem('task_creation_session_id');
  });
  await page.goto(WEB_URL);
}

async function waitForCapabilityCompletion(page: Page) {
  await expect(page.getByText(INTERCEPT_TEXT)).toBeVisible({ timeout: CAPABILITY_START_TIMEOUT_MS });
  await expect(page.getByText(COMPLETE_TEXT)).toBeVisible({ timeout: CAPABILITY_COMPLETE_TIMEOUT_MS });
}

async function waitForSidebarSessionPreview(
  page: Page,
  sessionId: string
) {
  await expect(page.locator(`aside a[href*="${sessionId}"]`).first()).toBeVisible({
    timeout: CAPABILITY_COMPLETE_TIMEOUT_MS,
  });
}

async function blurComposer(page: Page) {
  await page.locator('body').click({ position: { x: 20, y: 20 } });
}

async function captureStableState(page: Page) {
  return page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    const sidebar = document.querySelector('aside');
    const sessionId = localStorage.getItem('task_creation_session_id') || '';
    const mainText = normalize(main?.textContent || '');
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
}

async function readClientUserId(page: Page) {
  return page.evaluate(() => localStorage.getItem('oneceo_client_user_id') || '');
}

async function captureHistoryMessages(
  request: APIRequestContext,
  page: Page,
  sessionId: string
) {
  const clientUserId = await readClientUserId(page);
  const response = await request.get(
    `${API_URL}/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`,
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
      content: typeof item.content === 'string' ? item.content : '',
      metadata: {
        directModeIntercepted: Boolean(metadata.directModeIntercepted),
        capabilityId: typeof metadata.capabilityId === 'string' ? metadata.capabilityId : '',
        outcome: typeof metadata.outcome === 'string' ? metadata.outcome : '',
        tone: typeof metadata.tone === 'string' ? metadata.tone : '',
        agent: typeof metadata.agent === 'string' ? metadata.agent : '',
      },
    };
  });
}

async function captureConversationSnapshot(
  request: APIRequestContext,
  page: Page,
  sessionId: string
) {
  const ui = await captureStableState(page);
  const history = await captureHistoryMessages(request, page, sessionId);
  return {
    ui,
    history,
  };
}

async function waitForConversationSnapshotStable(
  request: APIRequestContext,
  page: Page,
  sessionId: string
) {
  let lastSignature = '';
  let stableCount = 0;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = await captureConversationSnapshot(request, page, sessionId);
    const hasIntercept = snapshot.history.some((item) => item.content === INTERCEPT_TEXT);
    const hasComplete = snapshot.history.some((item) => item.content === COMPLETE_TEXT);
    const signature = JSON.stringify(snapshot.history);

    if (hasIntercept && hasComplete) {
      stableCount = signature === lastSignature ? stableCount + 1 : 1;
      lastSignature = signature;
      if (stableCount >= 2) {
        return snapshot;
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`conversation snapshot did not stabilize for session ${sessionId}`);
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
    | { equal: false; reason?: string; diffPixels?: number; bbox?: { left: number; top: number; right: number; bottom: number } };
}

test('direct mode capability flow keeps conversation data identical after refresh and re-entry', async ({ page, context, request }, testInfo) => {
  await prepareDirectMode(page);

  await page.getByRole('textbox', { name: 'Type your message here...' }).fill(STATUS_PROMPT);
  await page.getByRole('textbox', { name: 'Type your message here...' }).press('Enter');

  await expect(page).toHaveURL(/\/session\//, { timeout: 20_000 });
  await waitForCapabilityCompletion(page);
  await blurComposer(page);
  const beforeSessionId = await page.evaluate(() => localStorage.getItem('task_creation_session_id') || '');
  await waitForSidebarSessionPreview(page, beforeSessionId);
  const beforeState = await waitForConversationSnapshotStable(request, page, beforeSessionId);
  const beforeScreenshot = await page.screenshot({ animations: 'disabled' });

  expect(beforeState.ui.sessionId).not.toBe('');
  expect(beforeState.ui.mainText).toContain(STATUS_PROMPT);
  expect(beforeState.ui.mainText).toContain(INTERCEPT_TEXT);
  expect(beforeState.ui.mainText).toContain(COMPLETE_TEXT);
  expect(beforeState.ui.sidebarPreview[0]?.href).toContain(beforeState.ui.sessionId);
  expect(beforeState.ui.sidebarPreview[0]?.text).toContain(STATUS_PROMPT);

  await page.reload({ waitUntil: 'networkidle' });
  await waitForCapabilityCompletion(page);
  await blurComposer(page);
  await waitForSidebarSessionPreview(page, beforeState.ui.sessionId);
  const afterState = await waitForConversationSnapshotStable(request, page, beforeState.ui.sessionId);
  const afterScreenshot = await page.screenshot({ animations: 'disabled' });

  const reentryPage = await context.newPage();
  await reentryPage.goto(`${WEB_URL}/session/${beforeState.ui.sessionId}?view=history`, {
    waitUntil: 'networkidle',
  });
  await waitForCapabilityCompletion(reentryPage);
  await blurComposer(reentryPage);
  await waitForSidebarSessionPreview(reentryPage, beforeState.ui.sessionId);
  const reentryState = await waitForConversationSnapshotStable(request, reentryPage, beforeState.ui.sessionId);
  const reentryScreenshot = await reentryPage.screenshot({ animations: 'disabled' });
  await reentryPage.close();

  const debugDir = testInfo.outputPath('refresh-visual-diff');
  mkdirSync(debugDir, { recursive: true });
  const beforePath = join(debugDir, 'before.png');
  const afterPath = join(debugDir, 'after.png');
  const reentryPath = join(debugDir, 'reentry.png');
  writeFileSync(beforePath, beforeScreenshot);
  writeFileSync(afterPath, afterScreenshot);
  writeFileSync(reentryPath, reentryScreenshot);
  const refreshScreenshotComparison = compareScreenshotsWithPython(beforePath, afterPath);
  const reentryScreenshotComparison = compareScreenshotsWithPython(beforePath, reentryPath);

  expect(afterState.ui.sessionId).toBe(beforeState.ui.sessionId);
  expect(afterState).toEqual(beforeState);
  expect(reentryState.ui.sessionId).toBe(beforeState.ui.sessionId);
  expect(reentryState).toEqual(beforeState);
  expect(refreshScreenshotComparison).toEqual({ equal: true, diffPixels: 0 });
  expect(reentryScreenshotComparison).toEqual({ equal: true, diffPixels: 0 });
});
