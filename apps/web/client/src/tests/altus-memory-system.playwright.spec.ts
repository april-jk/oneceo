import { execFileSync } from 'node:child_process';

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { bootstrapSharedAuthenticatedUser } from './playwright-auth';
import { composerTextarea } from './playwright-locators';

const WEB_URL = 'http://oneceo.ai:3000';
const API_URL = 'http://oneceo.ai:3000';
const API_APP_CWD = '/Users/watson/codingProj/oneceo/apps/api';
const OPEN_SETTINGS_DIALOG_EVENT = 'oneceo:open-settings-dialog';
const RUN_COMPLETE_TIMEOUT_MS = 180_000;
const SESSION_URL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;

type AuthMePayload = {
  data?: {
    user?: {
      id: string;
      displayName?: string;
      personalization?: Record<string, string>;
    };
  };
};

type ProjectPayload = {
  data?: {
    id: string;
    name: string;
    altusProjectMemory?: {
      context?: string;
      guidelines?: string;
      operatingRules?: string;
      executionManual?: string;
    } | null;
  };
};

type SessionMessagesPayload = {
  data?: Array<{
    role?: string;
    messageType?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }>;
};

type ManagedRunSummary = {
  id: string;
  status?: string;
};

type InternalMemorySnapshot = {
  userMemory: {
    preferredName: string;
    occupation: string;
    location: string;
    responsePreferences: string;
  };
  projectMemory: {
    context?: string;
    guidelines?: string;
    operatingRules?: string;
    executionManual?: string;
  } | null;
  sessionMemory: {
    version: number;
    summary: {
      goal: string;
      latestOutcome: string;
      openQuestions: string[];
    };
    constraints: string[];
    decisions: string[];
    workingNotes: string[];
  };
  promptSection: string;
};

test.describe.configure({ timeout: 360_000 });

function uniqueToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  options: { headers?: Record<string, string> } = {},
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

async function waitForLatestManagedRun(api: APIRequestContext, sessionId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_COMPLETE_TIMEOUT_MS) {
    const response = await apiGetWithRetry(
      api,
      `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs/latest`,
    );
    if (response.ok()) {
      const payload = (await response.json()) as { data?: ManagedRunSummary | null };
      if (payload?.data?.id) {
        return payload.data;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`latest managed run not found for session ${sessionId}`);
}

async function waitForRunCompleted(api: APIRequestContext, sessionId: string, previousRunId?: string | null) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_COMPLETE_TIMEOUT_MS) {
    const latest = await waitForLatestManagedRun(api, sessionId);
    if (previousRunId && latest.id === previousRunId) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    if (latest.status === 'completed') {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`managed run did not complete for ${sessionId}`);
}

async function waitForSessionUrl(page: Page) {
  await expect(page).toHaveURL(/\/session\//, { timeout: SESSION_URL_TIMEOUT_MS });
  const sessionId = await page.evaluate(() => localStorage.getItem('task_creation_session_id') || '');
  expect(sessionId).toBeTruthy();
  return sessionId;
}

async function waitForMessages(api: APIRequestContext, sessionId: string) {
  const response = await apiGetWithRetry(
    api,
    `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as SessionMessagesPayload;
  return Array.isArray(payload?.data) ? payload.data : [];
}

function inspectAltusMemoryViaApi(sessionId: string, userId: string): InternalMemorySnapshot {
  const script = `
    import { altusMemoryContextService } from './src/services/altus-memory-context-service';
    (async () => {
      const result = await altusMemoryContextService.buildPromptSectionForRun({
        sessionId: process.env.SESSION_ID,
        userId: process.env.USER_ID,
      });
      console.log(JSON.stringify(result));
      process.exit(0);
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const output = execFileSync('pnpm', ['exec', 'tsx', '-e', script], {
    cwd: API_APP_CWD,
    env: {
      ...process.env,
      SESSION_ID: sessionId,
      USER_ID: userId,
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(output.trim()) as InternalMemorySnapshot;
}

async function waitForInternalMemorySnapshot(
  sessionId: string,
  userId: string,
  predicate: (snapshot: InternalMemorySnapshot) => boolean,
  timeoutMs = 20_000,
) {
  const startedAt = Date.now();
  let lastSnapshot: InternalMemorySnapshot | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = inspectAltusMemoryViaApi(sessionId, userId);
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (lastSnapshot) {
    return lastSnapshot;
  }
  throw new Error(`internal memory snapshot not available for ${sessionId}`);
}

test('altus 三级记忆在单次登录复用下保持正确', async ({ browser }) => {
  const token = uniqueToken();
  const preferredName = `MemoryUser-${token}`;
  const occupation = `QA-${token}`;
  const location = `Shanghai-${token}`;
  const responsePreferences = `回答必须先称呼 ${preferredName}，并保持冷静专业。`;
  const projectName = `Memory Project ${token}`;
  const projectDescription = `Playwright memory test ${token}`;
  const projectContext = `项目代号 MemoryProject-${token}，用于验证项目级记忆继承。`;
  const projectGuidelines = '所有回答先给结论，再给一句依据。';
  const projectOperatingRules = '回答中必须明确提到项目代号。';
  const projectExecutionManual = '不要提问；两句话内回答；优先复用已有记忆。';
  const prompt1 = '请只用两句话回答：你现在应该如何称呼我，并说明当前项目代号。不要提问。';
  const prompt2 = '继续当前会话：只用一句话复述上一轮确认的称呼和项目代号。不要提问。';
  const prompt3 = '我是谁';

  const consoleLogs: string[] = [];
  const requestFailures: string[] = [];
  const pageErrors: string[] = [];

  let context: BrowserContext | null = null;
  let api: APIRequestContext | null = null;
  let page: Page | null = null;
  let userId = '';
  let originalPersonalization: Record<string, string> | null = null;
  let createdProjectId: string | null = null;
  let createdSessionId: string | null = null;

  try {
    context = await bootstrapSharedAuthenticatedUser(browser, WEB_URL);
    api = await createApiContextFromBrowser(context);
    page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleLogs.push(`[${message.type()}] ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      const errorText = request.failure()?.errorText || 'unknown';
      if (errorText.includes('ERR_ABORTED')) {
        return;
      }
      if (
        url.includes('/api/auth/') ||
        url.includes('/api/task-creation/') ||
        url.includes('/api/altus-managed/')
      ) {
        requestFailures.push(`${request.method()} ${url} :: ${errorText}`);
      }
    });

    const meResponse = await apiGetWithRetry(api, '/api/auth/me');
    expect(meResponse.ok()).toBe(true);
    const mePayload = (await meResponse.json()) as AuthMePayload;
    userId = mePayload.data?.user?.id || '';
    expect(userId).toBeTruthy();
    originalPersonalization = { ...(mePayload.data?.user?.personalization || {}) };

    const profileUpdateResponse = await api.patch('/api/auth/profile', {
      data: {
        personalization: {
          ...originalPersonalization,
          preferredName,
          occupation,
          location,
          responsePreferences,
        },
      },
    });
    expect(profileUpdateResponse.ok()).toBe(true);

    await page.goto(`${WEB_URL}/home`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('altus_mode', 'managed');
      localStorage.removeItem('task_creation_session_id');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate((eventName) => {
      window.dispatchEvent(new CustomEvent(eventName, { detail: { tab: 'personalization' } }));
    }, OPEN_SETTINGS_DIALOG_EVENT);
    await expect(page.locator('#personalization-preferred-name')).toHaveValue(preferredName);
    await expect(page.locator('#personalization-occupation')).toHaveValue(occupation);
    await expect(page.locator('#personalization-location')).toHaveValue(location);
    await expect(page.locator('#personalization-response-preferences')).toHaveValue(responsePreferences);
    await page.keyboard.press('Escape');

    const projectCreateResponse = await api.post('/api/task-creation/projects', {
      data: {
        name: projectName,
        description: projectDescription,
        projectType: 'standard',
        altusProjectMemory: {
          context: projectContext,
          guidelines: projectGuidelines,
          operatingRules: projectOperatingRules,
          executionManual: projectExecutionManual,
        },
      },
    });
    expect(projectCreateResponse.ok()).toBe(true);
    const projectCreatePayload = (await projectCreateResponse.json()) as ProjectPayload;
    createdProjectId = projectCreatePayload.data?.id || null;
    expect(createdProjectId).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    const projectMainButton = page.getByRole('button', { name: projectName, exact: true }).first();
    await expect(projectMainButton).toBeVisible({ timeout: 30_000 });
    const projectRow = projectMainButton.locator('xpath=ancestor::div[1]');
    await projectRow.getByRole('button', { name: '在该项目下新建会话' }).click();

    await expect(composerTextarea(page)).toBeVisible();
    await composerTextarea(page).fill(prompt1);
    await composerTextarea(page).press('Enter');

    createdSessionId = await waitForSessionUrl(page);
    const firstCompletedRun = await waitForRunCompleted(api, createdSessionId);

    const sessionDetailResponse = await apiGetWithRetry(
      api,
      `/api/task-creation/sessions/${encodeURIComponent(createdSessionId)}`,
    );
    expect(sessionDetailResponse.ok()).toBe(true);
    const sessionDetailPayload = await sessionDetailResponse.json();
    expect(sessionDetailPayload?.data?.projectId).toBe(createdProjectId);
    expect(sessionDetailPayload?.data?.projectName).toBe(projectName);

    const meAfterUpdateResponse = await apiGetWithRetry(api, '/api/auth/me');
    expect(meAfterUpdateResponse.ok()).toBe(true);
    const meAfterUpdate = (await meAfterUpdateResponse.json()) as AuthMePayload;
    expect(meAfterUpdate.data?.user?.personalization?.preferredName).toBe(preferredName);
    expect(meAfterUpdate.data?.user?.personalization?.responsePreferences).toBe(responsePreferences);

    const projectDetailResponse = await apiGetWithRetry(
      api,
      `/api/task-creation/projects/${encodeURIComponent(createdProjectId!)}`,
    );
    expect(projectDetailResponse.ok()).toBe(true);
    const projectDetail = (await projectDetailResponse.json()) as ProjectPayload;
    expect(projectDetail.data?.altusProjectMemory?.context).toBe(projectContext);
    expect(projectDetail.data?.altusProjectMemory?.guidelines).toBe(projectGuidelines);
    expect(projectDetail.data?.altusProjectMemory?.operatingRules).toBe(projectOperatingRules);
    expect(projectDetail.data?.altusProjectMemory?.executionManual).toBe(projectExecutionManual);

    const firstMemorySnapshot = await waitForInternalMemorySnapshot(
      createdSessionId,
      userId,
      (snapshot) => snapshot.sessionMemory.version > 0,
    );
    expect(firstMemorySnapshot.userMemory.preferredName).toBe(preferredName);
    expect(firstMemorySnapshot.userMemory.occupation).toBe(occupation);
    expect(firstMemorySnapshot.userMemory.location).toBe(location);
    expect(firstMemorySnapshot.userMemory.responsePreferences).toBe(responsePreferences);
    expect(firstMemorySnapshot.projectMemory?.context).toBe(projectContext);
    expect(firstMemorySnapshot.projectMemory?.guidelines).toBe(projectGuidelines);
    expect(firstMemorySnapshot.sessionMemory.version).toBeGreaterThan(0);
    expect(firstMemorySnapshot.sessionMemory.summary.goal).toContain('请只用两句话回答');
    expect(firstMemorySnapshot.promptSection).toContain(`# Altus memory context`);
    expect(firstMemorySnapshot.promptSection).toContain(`preferred_name: ${preferredName}`);
    expect(firstMemorySnapshot.promptSection).toContain(`context: ${projectContext}`);

    const firstMessages = await waitForMessages(api, createdSessionId);
    const firstAssistantMessage = [...firstMessages]
      .reverse()
      .find(
        (message) =>
          (message.role === 'assistant' || message.role === 'agent') &&
          typeof message.content === 'string' &&
          message.messageType !== 'tool_result' &&
          message.messageType !== 'status_update' &&
          !message.content.startsWith('工具 ')
      );
    expect(firstAssistantMessage?.content || '').toContain(preferredName);
    expect(firstAssistantMessage?.content || '').toContain(`MemoryProject-${token}`);

    const deleteProjectBlockedResponse = await api.delete(
      `/api/task-creation/projects/${encodeURIComponent(createdProjectId!)}`,
    );
    expect(deleteProjectBlockedResponse.status()).toBe(409);
    const deleteProjectBlockedPayload = await deleteProjectBlockedResponse.json();
    expect(deleteProjectBlockedPayload?.error || '').toContain('当前项目下仍有关联会话');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/session/${createdSessionId}`));
    await expect(composerTextarea(page)).toBeVisible();
    const secondInputResponse = await api.post('/api/altus-managed/inputs', {
      multipart: {
        sessionId: createdSessionId,
        content: prompt2,
        messageKey: `managed-turn-2-${token}`,
        metadata: JSON.stringify({
          altusMode: 'managed',
          source: 'playwright-memory-test',
        }),
      },
    });
    expect(secondInputResponse.ok()).toBe(true);
    const secondCompletedRun = await waitForRunCompleted(api, createdSessionId, firstCompletedRun.id);

    const secondMemorySnapshot = await waitForInternalMemorySnapshot(
      createdSessionId,
      userId,
      (snapshot) => snapshot.sessionMemory.version > firstMemorySnapshot.sessionMemory.version,
    );
    expect(secondMemorySnapshot.sessionMemory.version).toBeGreaterThan(firstMemorySnapshot.sessionMemory.version);
    expect(secondMemorySnapshot.sessionMemory.summary.goal).toContain('继续当前会话');
    expect(secondMemorySnapshot.sessionMemory.summary.latestOutcome.length).toBeGreaterThan(0);
    expect(secondMemorySnapshot.sessionMemory.workingNotes.length).toBeGreaterThan(0);
    expect(secondMemorySnapshot.promptSection).toContain(`preferred_name: ${preferredName}`);
    expect(secondMemorySnapshot.promptSection).toContain(`context: ${projectContext}`);

    const secondMessages = await waitForMessages(api, createdSessionId);
    const userTurns = secondMessages.filter(
      (message) => message.messageType === 'user_input' || message.messageType === 'user_response',
    );
    expect(userTurns.length).toBeGreaterThanOrEqual(2);

    await composerTextarea(page).fill(prompt3);
    await composerTextarea(page).press('Enter');
    const thirdCompletedRun = await waitForRunCompleted(api, createdSessionId, secondCompletedRun.id);
    expect(thirdCompletedRun.status).toBe('completed');

    const thirdMessages = await waitForMessages(api, createdSessionId);
    expect(
      thirdMessages.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.includes('managed_model_plain_text_without_tool_call'),
      ),
    ).toBe(false);
    expect(
      thirdMessages.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.includes('本次执行失败') &&
          message.content.includes('managed_model_plain_text_without_tool_call'),
      ),
    ).toBe(false);
    const identityAssistantMessage = [...thirdMessages]
      .reverse()
      .find(
        (message) =>
          (message.role === 'assistant' || message.role === 'agent') &&
          typeof message.content === 'string' &&
          message.messageType !== 'tool_result' &&
          message.messageType !== 'status_update' &&
          !message.content.startsWith('工具 '),
      );
    expect(identityAssistantMessage?.content || '').toContain(preferredName);

    expect(pageErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
  } finally {
    if (api && createdSessionId) {
      await api.delete(`/api/task-creation/sessions/${encodeURIComponent(createdSessionId)}`).catch(() => null);
    }
    if (api && createdProjectId) {
      await api.delete(`/api/task-creation/projects/${encodeURIComponent(createdProjectId)}`).catch(() => null);
    }
    if (api && originalPersonalization) {
      await api.patch('/api/auth/profile', {
        data: {
          personalization: originalPersonalization,
        },
      }).catch(() => null);
    }
    await api?.dispose();
    await page?.close().catch(() => null);
    await context?.close().catch(() => null);
  }

  expect(consoleLogs.filter((item) => item.toLowerCase().includes('/api/'))).toEqual([]);
});
