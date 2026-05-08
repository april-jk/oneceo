import '../../src/config/env';

import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { e2bConnector } from '../../src/connectors/e2b-connector';
import {
  appUserDAO,
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionRunDAO,
} from '../../src/db/dao';
import { hashPassword } from '../../src/utils/auth-password';

type JsonRecord = Record<string, any>;

type ApiResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

type CookieSession = {
  cookie: string;
};

type TestAccount = {
  email: string;
  password: string;
  displayName: string;
};

type TestReport = {
  startedAt: string;
  finishedAt?: string;
  apiBase: string;
  marker: string;
  promptCategory?: string;
  promptLabel?: string;
  promptText?: string;
  userEmail?: string;
  sessionId?: string;
  runId?: string;
  orchestratorSessionId?: string;
  publicUrl?: string;
  deploymentStatus?: string;
  bindingState?: string;
  providerErrorCode?: string;
  analyticsStatus?: string;
  publicReachabilityStatus?: 'passed' | 'failed' | 'unverified';
  publicMarkerStatus?: 'passed' | 'failed' | 'unverified';
  analyticsBootstrapStatus?: 'passed' | 'failed' | 'unverified';
  browserVisitStatus?: 'passed' | 'failed' | 'skipped';
  analyticsTrackingStatus?: 'passed' | 'failed' | 'unverified';
  publicProbeError?: string;
  publicMarkerLocation?: string;
  browserVisitScreenshot?: string;
  browserVisitError?: string;
  browserAnalyticsSendStatus?: number;
  browserPageErrors?: string[];
  sandboxCleanup?: string;
  sessionCleanup?: string;
  passed: boolean;
  checkpoints: Array<{
    name: string;
    status: 'passed' | 'failed';
    details?: Record<string, unknown>;
  }>;
  error?: string;
};

const execFile = promisify(execFileCallback);
const API_BASE = String(process.env.ONECEO_E2E_API_BASE || `http://127.0.0.1:${process.env.PORT || '4000'}`).replace(/\/+$/, '');
const HEALTH_URL = `${API_BASE}/health`;
const REPO_ROOT = path.resolve(process.cwd(), '../..');
const RUN_TIMEOUT_MS = Math.max(5 * 60_000, Number(process.env.ONECEO_E2E_RUN_TIMEOUT_MS || 12 * 60_000));
const DEPLOY_TIMEOUT_MS = Math.max(5 * 60_000, Number(process.env.ONECEO_E2E_DEPLOY_TIMEOUT_MS || 15 * 60_000));
const URL_TIMEOUT_MS = Math.max(60_000, Number(process.env.ONECEO_E2E_URL_TIMEOUT_MS || 5 * 60_000));
const ANALYTICS_TRACKING_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.ONECEO_E2E_ANALYTICS_TRACKING_TIMEOUT_MS || 3 * 60_000)
);
const PUBLIC_FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.ONECEO_E2E_PUBLIC_FETCH_TIMEOUT_MS || 15_000));
const BROWSER_VISIT_WAIT_MS = Math.max(1_000, Number(process.env.ONECEO_E2E_BROWSER_VISIT_WAIT_MS || 8_000));
const POLL_INTERVAL_MS = Math.max(2_000, Number(process.env.ONECEO_E2E_POLL_INTERVAL_MS || 5_000));
const REQUIRE_PUBLIC_REACHABILITY = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ONECEO_E2E_REQUIRE_PUBLIC_REACHABILITY || '').trim().toLowerCase()
);
const BROWSER_VISIT_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ONECEO_E2E_BROWSER_VISIT || '').trim().toLowerCase()
);
const REQUIRE_ANALYTICS_TRACKING = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ONECEO_E2E_REQUIRE_ANALYTICS_TRACKING || '').trim().toLowerCase()
);
const REQUIRE_BROWSER_NO_ERRORS = !['0', 'false', 'no', 'off'].includes(
  String(process.env.ONECEO_E2E_REQUIRE_BROWSER_NO_ERRORS ?? 'true').trim().toLowerCase()
);
const KEEP_RESOURCES = ['1', 'true', 'yes', 'on'].includes(String(process.env.ONECEO_E2E_KEEP_RESOURCES || '').trim().toLowerCase());
const TEST_ACCOUNT_PATH = path.resolve(process.cwd(), '../web/e2e/playwright-test-account.json');
const PROMPT_CATEGORY = asText(process.env.ONECEO_E2E_PROMPT_CATEGORY) || 'default';
const PROMPT_LABEL = asText(process.env.ONECEO_E2E_PROMPT_LABEL) || PROMPT_CATEGORY;
const PROMPT_TEXT_OVERRIDE = asText(process.env.ONECEO_E2E_PROMPT_TEXT);
const REPORT_TAG = asText(process.env.ONECEO_E2E_REPORT_TAG);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeReport(report: TestReport) {
  const reportsDir = path.resolve(process.cwd(), 'tests/e2e/reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = nowStamp();
  const suffix = REPORT_TAG ? `-${REPORT_TAG}` : '';
  const jsonPath = path.join(reportsDir, `deployment-main-chain-${stamp}${suffix}.json`);
  const mdPath = path.join(reportsDir, `deployment-main-chain-${stamp}${suffix}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    '# Deployment Main Chain E2E',
    '',
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt || '-'}`,
    `- apiBase: ${report.apiBase}`,
    `- marker: ${report.marker}`,
    `- promptCategory: ${report.promptCategory || '-'}`,
    `- promptLabel: ${report.promptLabel || '-'}`,
    `- userEmail: ${report.userEmail || '-'}`,
    `- sessionId: ${report.sessionId || '-'}`,
    `- runId: ${report.runId || '-'}`,
    `- orchestratorSessionId: ${report.orchestratorSessionId || '-'}`,
    `- publicUrl: ${report.publicUrl || '-'}`,
    `- deploymentStatus: ${report.deploymentStatus || '-'}`,
    `- bindingState: ${report.bindingState || '-'}`,
    `- providerErrorCode: ${report.providerErrorCode || '-'}`,
    `- analyticsStatus: ${report.analyticsStatus || '-'}`,
    `- publicReachabilityStatus: ${report.publicReachabilityStatus || '-'}`,
    `- publicMarkerStatus: ${report.publicMarkerStatus || '-'}`,
    `- analyticsBootstrapStatus: ${report.analyticsBootstrapStatus || '-'}`,
    `- browserVisitStatus: ${report.browserVisitStatus || '-'}`,
    `- analyticsTrackingStatus: ${report.analyticsTrackingStatus || '-'}`,
    `- publicMarkerLocation: ${report.publicMarkerLocation || '-'}`,
    `- browserVisitScreenshot: ${report.browserVisitScreenshot || '-'}`,
    `- browserAnalyticsSendStatus: ${report.browserAnalyticsSendStatus ?? '-'}`,
    `- browserPageErrors: ${
      Array.isArray(report.browserPageErrors) && report.browserPageErrors.length > 0
        ? report.browserPageErrors.join(' | ')
        : '-'
    }`,
    `- sandboxCleanup: ${report.sandboxCleanup || '-'}`,
    `- sessionCleanup: ${report.sessionCleanup || '-'}`,
    `- passed: ${report.passed}`,
    '',
    '## Checkpoints',
    ...report.checkpoints.map((item) => `- ${item.name}: ${item.status}`),
  ];

  if (report.error) {
    lines.push('', '## Error', '', '```text', report.error, '```');
  }

  await fs.writeFile(mdPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[e2e] json report: ${jsonPath}`);
  console.log(`[e2e] markdown report: ${mdPath}`);
}

function requireCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/app_session_v2_id=([^;]+)/);
  assert.ok(match?.[1], 'auth response should set app_session_v2_id cookie');
  return `app_session_v2_id=${match[1]}`;
}

async function loadTestAccount(): Promise<TestAccount> {
  const raw = await fs.readFile(TEST_ACCOUNT_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const email = asText(process.env.ONECEO_E2E_USER_EMAIL) || asText(parsed.email);
  const password = asText(process.env.ONECEO_E2E_USER_PASSWORD) || asText(parsed.password);
  const displayName =
    asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) || asText(parsed.displayName) || 'Playwright Test User';
  assert.ok(email, 'test account email is required');
  assert.ok(password, 'test account password is required');
  return {
    email,
    password,
    displayName,
  };
}

async function ensureTestAccount(account: TestAccount) {
  const passwordHash = await hashPassword(account.password);
  const existing = await appUserDAO.getByEmail(account.email);
  if (!existing) {
    return appUserDAO.create({
      email: account.email,
      passwordHash,
      displayName: account.displayName,
    });
  }
  return (
    (await appUserDAO.updateById(String(existing.id), {
      passwordHash,
      displayName: account.displayName,
      status: 'active',
    })) || existing
  );
}

async function loginWithAccount(account: TestAccount) {
  const login = await requestJson<{ user: JsonRecord }>(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
    expectedStatus: 200,
  });
  assert.ok((login.body as ApiResult<{ user: JsonRecord }>).success, 'login should succeed');
  return {
    cookie: requireCookie(login.response),
  };
}

async function requestJson<T>(
  input: string,
  init?: RequestInit & { cookie?: string; expectedStatus?: number }
): Promise<{ response: Response; body: ApiResult<T> | T }> {
  const headers = new Headers(init?.headers || {});
  if (init?.cookie) {
    headers.set('cookie', init.cookie);
  }
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });
  if (typeof init?.expectedStatus === 'number') {
    assert.equal(response.status, init.expectedStatus, `unexpected status for ${input}`);
  }
  let body: ApiResult<T> | T;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : ({} as ApiResult<T>);
  } catch (error) {
    throw new Error(`failed to parse JSON from ${input}: ${text.slice(0, 400)}`);
  }
  return { response, body };
}

async function getApiData<T>(url: string, cookie: string): Promise<T> {
  const { response, body } = await requestJson<T>(url, {
    method: 'GET',
    cookie,
  });
  assert.equal(response.ok, true, `GET ${url} failed: ${JSON.stringify(body)}`);
  assert.ok((body as ApiResult<T>).success !== false, `GET ${url} returned success=false`);
  return ((body as ApiResult<T>).data ?? body) as T;
}

async function postApiData<T>(url: string, cookie: string, payload?: unknown): Promise<T> {
  const { response, body } = await requestJson<T>(url, {
    method: 'POST',
    cookie,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  assert.equal(response.ok, true, `POST ${url} failed: ${JSON.stringify(body)}`);
  assert.ok((body as ApiResult<T>).success !== false, `POST ${url} returned success=false`);
  return ((body as ApiResult<T>).data ?? body) as T;
}

async function readWorkspaceFileIfExists(sessionId: string, cookie: string, filePath: string) {
  const encodedPath = encodeURIComponent(filePath);
  const { response, body } = await requestJson<JsonRecord>(
    `${API_BASE}/api/task-creation/sessions/${sessionId}/workspace/file?path=${encodedPath}&refresh=1`,
    {
      method: 'GET',
      cookie,
    }
  );
  if (!response.ok) {
    return null;
  }
  const payload = ((body as ApiResult<JsonRecord>).data ?? body) as JsonRecord;
  if (payload?.isBinary) {
    return null;
  }
  return payload;
}

async function findMarkerInWorkspaceFiles(
  sessionId: string,
  cookie: string,
  marker: string,
  candidates: string[]
) {
  for (const candidate of candidates) {
    const result = await readWorkspaceFileIfExists(sessionId, cookie, candidate);
    if (typeof result?.content !== 'string') {
      continue;
    }
    if (result.content.includes(marker)) {
      return {
        path: candidate,
        matched: true,
      };
    }
  }
  return null;
}

async function deleteApi(url: string, cookie: string) {
  const { response, body } = await requestJson<JsonRecord>(url, {
    method: 'DELETE',
    cookie,
  });
  assert.equal(response.ok, true, `DELETE ${url} failed: ${JSON.stringify(body)}`);
  assert.ok((body as ApiResult<JsonRecord>).success !== false, `DELETE ${url} returned success=false`);
}

async function waitForHealth() {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1500);
  }
  throw lastError instanceof Error ? lastError : new Error('API health check failed');
}

async function poll<T>(
  label: string,
  timeoutMs: number,
  predicate: () => Promise<T>,
  accept: (value: T) => boolean,
): Promise<T> {
  const started = Date.now();
  let lastValue: T | null = null;
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await predicate();
      lastValue = value;
      if (accept(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error(`[timeout] ${label} not ready: ${JSON.stringify(lastValue, null, 2)}`);
}

function buildGenerationPrompt(marker: string) {
  if (PROMPT_TEXT_OVERRIDE) {
    return PROMPT_TEXT_OVERRIDE.replaceAll('__ONECEO_E2E_MARKER__', marker);
  }
  return [
    '在当前工作区直接创建一个最小可部署静态网页应用，不要提问，不要解释，不要部署。',
    '要求：',
    '1. 只使用原生 HTML/CSS/JavaScript，不要引入任何框架或外部依赖。',
    '2. 在工作区根目录创建 index.html、styles.css、app.js。',
    '3. 页面 title 必须是 "OneCEO Deployment E2E".',
    `4. 页面主体必须显著显示唯一标识 "${marker}"。`,
    '5. 页面还要包含一个按钮和一个计数器，点击按钮后计数递增，确保页面不是空白模板。',
    '6. index.html 必须引用 styles.css 和 app.js。',
    '7. 完成后只用一句话汇报结果。',
  ].join('\n');
}

type PublicTextFetchResult = {
  ok: boolean;
  url: string;
  status?: number;
  text?: string;
  error?: string;
};

type PublicDeploymentProbe = {
  reachable: boolean;
  status?: number;
  markerFound: boolean;
  markerLocation?: string;
  analyticsBootstrapFound: boolean;
  unresolvedEnvPlaceholderFound: boolean;
  assetUrls: string[];
  error?: string;
};

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'object' && cause && 'message' in cause
          ? String((cause as { message?: unknown }).message)
          : '';
    return [error.name, error.message, causeMessage].filter(Boolean).join(': ');
  }
  return String(error);
}

async function fetchPublicText(url: string): Promise<PublicTextFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLIC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/javascript,text/css;q=0.8,*/*;q=0.1',
        'user-agent': 'OneCEO-Deployment-E2E/1.0',
      },
    });
    return {
      ok: response.ok,
      url,
      status: response.status,
      text: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: normalizeErrorMessage(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function resolvePublicAssetUrl(publicUrl: string, assetPath: string) {
  try {
    return new URL(assetPath, publicUrl).toString();
  } catch {
    return '';
  }
}

function extractScriptAssetUrls(publicUrl: string, html: string) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) && urls.length < 12) {
    const resolved = resolvePublicAssetUrl(publicUrl, match[1] || '');
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
  }
  return urls;
}

function hasAnalyticsBootstrap(text: string) {
  return (
    /window\.__ONECEO_ANALYTICS__/.test(text) ||
    /data-oneceo-analytics=["']runtime["']/.test(text)
  );
}

async function probePublicDeployment(publicUrl: string, marker: string): Promise<PublicDeploymentProbe> {
  const htmlFetch = await fetchPublicText(publicUrl);
  if (!htmlFetch.ok || typeof htmlFetch.text !== 'string') {
    return {
      reachable: false,
      status: htmlFetch.status,
      markerFound: false,
      analyticsBootstrapFound: false,
      unresolvedEnvPlaceholderFound: false,
      assetUrls: [],
      error: htmlFetch.error || `HTTP ${htmlFetch.status || 'unknown'}`,
    };
  }

  const html = htmlFetch.text;
  const assetUrls = extractScriptAssetUrls(publicUrl, html);
  const analyticsBootstrapFound = hasAnalyticsBootstrap(html);
  const unresolvedEnvPlaceholderFound = /%VITE_[A-Z0-9_]+%/.test(html);
  if (html.includes(marker)) {
    return {
      reachable: true,
      status: htmlFetch.status,
      markerFound: true,
      markerLocation: 'html',
      analyticsBootstrapFound,
      unresolvedEnvPlaceholderFound,
      assetUrls,
    };
  }

  let lastAssetError = '';
  for (const assetUrl of assetUrls) {
    const assetFetch = await fetchPublicText(assetUrl);
    if (!assetFetch.ok || typeof assetFetch.text !== 'string') {
      lastAssetError = assetFetch.error || `HTTP ${assetFetch.status || 'unknown'} for ${assetUrl}`;
      continue;
    }
    if (assetFetch.text.includes(marker)) {
      return {
        reachable: true,
        status: htmlFetch.status,
        markerFound: true,
        markerLocation: assetUrl,
        analyticsBootstrapFound,
        unresolvedEnvPlaceholderFound,
        assetUrls,
      };
    }
  }

  return {
    reachable: true,
    status: htmlFetch.status,
    markerFound: false,
    analyticsBootstrapFound,
    unresolvedEnvPlaceholderFound,
    assetUrls,
    error: lastAssetError || 'marker not found in HTML or linked script assets',
  };
}

async function pollPublicDeployment(publicUrl: string, marker: string): Promise<PublicDeploymentProbe> {
  const started = Date.now();
  let lastProbe: PublicDeploymentProbe | null = null;
  while (Date.now() - started < URL_TIMEOUT_MS) {
    lastProbe = await probePublicDeployment(publicUrl, marker);
    if (lastProbe.reachable && lastProbe.markerFound) {
      return lastProbe;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return (
    lastProbe || {
      reachable: false,
      markerFound: false,
      analyticsBootstrapFound: false,
      unresolvedEnvPlaceholderFound: false,
      assetUrls: [],
      error: 'public deployment probe did not run',
    }
  );
}

type BrowserVisitResult = {
  ok: boolean;
  status: 'passed' | 'failed' | 'skipped';
  screenshotPath?: string;
  analyticsSendStatus?: number;
  pageErrors?: string[];
  error?: string;
};

async function visitPublicDeploymentWithBrowser(publicUrl: string): Promise<BrowserVisitResult> {
  if (!BROWSER_VISIT_ENABLED) {
    return { ok: false, status: 'skipped' };
  }

  const reportsDir = path.resolve(process.cwd(), 'tests/e2e/reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const screenshotPath = path.join(reportsDir, `deployment-browser-visit-${nowStamp()}.png`);
  const browserScript = `
import { chromium } from '@playwright/test';

const [url, screenshotPath, waitMsRaw] = process.argv.slice(1);
const waitMs = Math.max(1000, Number(waitMsRaw || 8000));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1365, height: 900 }
});
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message || String(error)));
const analyticsResponsePromise = page
  .waitForResponse(
    (response) => response.url().includes('/api/send') && response.url().includes('analytics.oneceo.ai'),
    { timeout: Math.max(15000, waitMs + 10000) }
  )
  .catch(() => null);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(30000, waitMs + 15000) });
await page.waitForTimeout(waitMs);
const analyticsResponse = await analyticsResponsePromise;
await page.screenshot({ path: screenshotPath, fullPage: true });
await browser.close();
console.log(JSON.stringify({
  analyticsSendStatus: analyticsResponse ? analyticsResponse.status() : null,
  pageErrors: pageErrors.slice(0, 5)
}));
`;
  try {
    const { stdout } = await execFile(
      'pnpm',
      [
        '--dir',
        REPO_ROOT,
        '--filter',
        'web',
        'exec',
        'node',
        '--input-type=module',
        '--eval',
        browserScript,
        publicUrl,
        screenshotPath,
        String(BROWSER_VISIT_WAIT_MS),
      ],
      {
        cwd: REPO_ROOT,
        env: process.env,
        maxBuffer: 4 * 1024 * 1024,
      }
    );
    const metadata = JSON.parse(stdout.trim().split('\n').pop() || '{}') as {
      analyticsSendStatus?: number | null;
      pageErrors?: string[];
    };
    const analyticsSendStatus = Number(metadata.analyticsSendStatus);
    const pageErrors = Array.isArray(metadata.pageErrors) ? metadata.pageErrors.filter(Boolean) : [];
    if (analyticsSendStatus !== 200) {
      return {
        ok: false,
        status: 'failed',
        screenshotPath,
        analyticsSendStatus: Number.isFinite(analyticsSendStatus) ? analyticsSendStatus : undefined,
        pageErrors,
        error: 'browser visit did not observe analytics.oneceo.ai/api/send returning HTTP 200',
      };
    }
    if (REQUIRE_BROWSER_NO_ERRORS && pageErrors.length > 0) {
      return {
        ok: false,
        status: 'failed',
        screenshotPath,
        analyticsSendStatus,
        pageErrors,
        error: `browser page emitted runtime errors: ${pageErrors.join(' | ')}`,
      };
    }
    return {
      ok: true,
      status: 'passed',
      screenshotPath,
      analyticsSendStatus,
      pageErrors,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'failed',
      screenshotPath,
      error:
        asText(error?.stderr) ||
        asText(error?.stdout) ||
        asText(error?.message) ||
        normalizeErrorMessage(error),
    };
  }
}

async function main() {
  const marker = `ONECEO_E2E_MARKER_${Date.now().toString(36)}`;
  const report: TestReport = {
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    marker,
    promptCategory: PROMPT_CATEGORY,
    promptLabel: PROMPT_LABEL,
    promptText: PROMPT_TEXT_OVERRIDE || buildGenerationPrompt(marker),
    checkpoints: [],
    passed: false,
  };

  let cookieSession: CookieSession | null = null;
  let sessionId = '';
  let orchestratorSessionId = '';

  const checkpoint = (name: string, status: 'passed' | 'failed', details?: Record<string, unknown>) => {
    report.checkpoints.push({ name, status, details });
    console.log(`[e2e] checkpoint ${name}: ${status}`);
  };

  try {
    console.log(`[e2e] API_BASE=${API_BASE}`);
    console.log(`[e2e] marker=${report.marker}`);
    await waitForHealth();
    checkpoint('health', 'passed', { url: HEALTH_URL });

    const account = await loadTestAccount();
    console.log(`[e2e] loaded test account: ${account.email}`);
    report.userEmail = account.email;
    await ensureTestAccount(account);
    checkpoint('ensure_test_account', 'passed', {
      email: account.email,
    });
    cookieSession = await loginWithAccount(account);
    checkpoint('login', 'passed', {
      email: account.email,
    });

    const session = await postApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions`, cookieSession.cookie, {
      title: 'Railway Umami Deployment E2E',
      mode: 'altus',
    });
    console.log('[e2e] task session created');
    sessionId = asText(session.id || session.sessionId);
    report.sessionId = sessionId;
    assert.ok(sessionId, 'session id should exist');
    checkpoint('create_session', 'passed', { sessionId });

    const runtime = await postApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/runtime/start`,
      cookieSession.cookie
    );
    console.log('[e2e] runtime start requested');
    orchestratorSessionId = asText(runtime.orchestratorSessionId || runtime.sessionId);
    report.orchestratorSessionId = orchestratorSessionId || undefined;
    checkpoint('runtime_start', 'passed', {
      orchestratorSessionId: orchestratorSessionId || null,
    });

    const sessionMeta = await poll<JsonRecord>(
      'session runtime ready',
      2 * 60_000,
      async () => getApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions/${sessionId}`, cookieSession!.cookie),
      (value) => {
        const runtimeId = asText(value?.runtime?.orchestratorSessionId);
        const runtimeStatus = asText(value?.runtimeStatus?.status).toLowerCase();
        return Boolean(runtimeId) && runtimeStatus !== 'failed';
      }
    );
    orchestratorSessionId = asText(sessionMeta?.runtime?.orchestratorSessionId) || orchestratorSessionId;
    report.orchestratorSessionId = orchestratorSessionId || undefined;
    assert.ok(orchestratorSessionId, 'orchestratorSessionId should exist after runtime start');
    checkpoint('runtime_session_meta', 'passed', {
      orchestratorSessionId,
      runtimeStatus: sessionMeta?.runtimeStatus?.status || null,
    });

    const runStart = await postApiData<JsonRecord>(`${API_BASE}/api/altus-managed/inputs`, cookieSession.cookie, {
      sessionId,
      content: buildGenerationPrompt(report.marker),
      metadata: {
        source: 'deployment_main_chain_e2e',
      },
    });
    console.log('[e2e] managed input submitted');
    const runId = asText(runStart?.run?.id || runStart?.run?.runId);
    report.runId = runId || undefined;
    assert.ok(runId, 'run id should exist');
    checkpoint('managed_input_submit', 'passed', { runId });

    const latestRun = await poll<JsonRecord>(
      'managed run terminal',
      RUN_TIMEOUT_MS,
      async () => getApiData<JsonRecord>(`${API_BASE}/api/altus-managed/sessions/${sessionId}/runs/latest`, cookieSession!.cookie),
      (value) => {
        const status = asText(value?.status).toLowerCase();
        return ['completed', 'failed', 'stopped', 'waiting_user'].includes(status);
      }
    );
    const latestRunStatus = asText(latestRun.status).toLowerCase();
    const persistedRun = await taskSessionRunDAO.getRun(runId);
    assert.ok(persistedRun, 'run should persist in DB');
    checkpoint('managed_run_terminal', 'passed', {
      runStatus: latestRunStatus,
      dbRunStatus: persistedRun?.status || null,
      error: latestRun.error || latestRun.errorMessage || latestRun.lastError || null,
      finalMessage: asText(latestRun.finalMessage || latestRun.summary || latestRun.message).slice(0, 500) || null,
    });
    if (latestRunStatus === 'failed') {
      checkpoint('managed_run_failed', 'failed', {
        runStatus: latestRunStatus,
        dbRunStatus: persistedRun?.status || null,
        error: latestRun.error || latestRun.errorMessage || latestRun.lastError || null,
      });
    }
    assert.notEqual(latestRunStatus, 'failed', 'managed run should not fail');
    assert.notEqual(latestRunStatus, 'stopped', 'managed run should not stop');
    assert.notEqual(latestRunStatus, 'waiting_user', 'managed run should not ask for clarification');
    checkpoint('managed_run_completed', 'passed', {
      runStatus: latestRunStatus,
      dbRunStatus: persistedRun?.status || null,
    });

    const workspaceTree = await getApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/workspace/tree?refresh=1&depth=4&maxEntries=200`,
      cookieSession.cookie
    );
    const treeText = JSON.stringify(workspaceTree);
    const hasRootStaticShape =
      /index\.html/i.test(treeText) && /styles\.css/i.test(treeText) && /app\.js/i.test(treeText);
    const hasOfficialShellShape =
      /client\/index\.html/i.test(treeText) && /server\/index\.(t|j)s/i.test(treeText);
    assert.ok(
      hasRootStaticShape || hasOfficialShellShape,
      `workspace tree did not match a supported website shape: ${treeText.slice(0, 1200)}`
    );
    checkpoint('workspace_tree', 'passed', {
      hasRootStaticShape,
      hasOfficialShellShape,
    });

    const workspaceMarkerCandidates = hasOfficialShellShape
      ? [
          'client/index.html',
          'client/src/main.jsx',
          'client/src/main.tsx',
          'client/src/App.jsx',
          'client/src/App.tsx',
          'src/main.jsx',
          'src/main.tsx',
          'src/App.jsx',
          'src/App.tsx',
          'public/index.html',
        ]
      : ['index.html', 'app.js', 'styles.css'];
    const markerSource = await findMarkerInWorkspaceFiles(
      sessionId,
      cookieSession.cookie,
      report.marker,
      workspaceMarkerCandidates
    );
    assert.ok(
      markerSource,
      `workspace should contain marker in a supported entry source: ${workspaceMarkerCandidates.join(', ')}`
    );
    checkpoint('workspace_marker_source', 'passed', {
      path: markerSource.path,
      markerFound: true,
      officialShell: hasOfficialShellShape,
    });

    const baseline = await getApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/deployment/template`,
      cookieSession.cookie
    );
    console.log('[e2e] deployment template fetched');
    assert.ok(Boolean(baseline.workspaceDetected), 'deployment template should detect workspace');
    checkpoint('deployment_template_baseline', 'passed', {
      status: baseline.status || null,
      analyticsMode: baseline.analyticsMode || null,
      errors: Array.isArray(baseline.errors) ? baseline.errors : [],
      warnings: Array.isArray(baseline.warnings) ? baseline.warnings : [],
    });

    const deployPanel = await postApiData<JsonRecord>(
      `${API_BASE}/api/task-creation/sessions/${sessionId}/deployment/deploy`,
      cookieSession.cookie
    );
    console.log('[e2e] deployment requested');
    assert.ok(asText(deployPanel.bindingState), 'deploy panel should return bindingState');
    checkpoint('deployment_trigger', 'passed', {
      bindingState: deployPanel.bindingState || null,
      provisioningPhase: deployPanel.provisioningPhase || null,
    });

    const finalDeployment = await poll<JsonRecord>(
      'deployment panel settled',
      DEPLOY_TIMEOUT_MS,
      async () => getApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions/${sessionId}/deployment`, cookieSession!.cookie),
      (value) => {
        const state = asText(value?.bindingState).toLowerCase();
        const latestStatus = asText(value?.latestStatus).toLowerCase();
        if (state === 'repair_required' || state === 'provider_error') {
          return true;
        }
        if (state === 'ready' && (value?.latestUrl || value?.latestStaticUrl || (Array.isArray(value?.domains) && value.domains.length > 0))) {
          return true;
        }
        return ['success', 'deployed', 'active'].includes(latestStatus);
      }
    );

    report.deploymentStatus = asText(finalDeployment.latestStatus) || undefined;
    report.bindingState = asText(finalDeployment.bindingState) || undefined;
    report.providerErrorCode = asText(finalDeployment.providerErrorCode) || undefined;
    report.analyticsStatus = asText(finalDeployment.analytics?.status) || undefined;

    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    assert.ok(environment, 'sandbox environment row should exist');
    const environmentMetadata = (environment?.metadata || {}) as JsonRecord;
    assert.ok(environmentMetadata.deploymentState, 'deploymentState should be written to sandbox metadata');
    checkpoint('deployment_state_persisted', 'passed', {
      bindingState: environmentMetadata.deploymentState?.bindingState || null,
      provisioningPhase: environmentMetadata.deploymentState?.provisioningPhase || null,
      providerErrorCode: environmentMetadata.deploymentState?.providerErrorCode || null,
    });

    const publicUrl =
      asText(finalDeployment.latestUrl) ||
      asText(finalDeployment.latestStaticUrl) ||
      (Array.isArray(finalDeployment.domains) && finalDeployment.domains.length > 0
        ? asText(finalDeployment.domains[0])
        : '');
    if (publicUrl) {
      report.publicUrl = publicUrl;
      const publicProbe = await pollPublicDeployment(publicUrl, report.marker);
      report.publicProbeError = publicProbe.error;
      report.publicReachabilityStatus = publicProbe.reachable ? 'passed' : 'unverified';
      report.publicMarkerStatus = publicProbe.markerFound ? 'passed' : publicProbe.reachable ? 'failed' : 'unverified';
      report.analyticsBootstrapStatus = publicProbe.analyticsBootstrapFound
        ? 'passed'
        : publicProbe.reachable
          ? 'failed'
          : 'unverified';
      report.publicMarkerLocation = publicProbe.markerLocation;

      if (!publicProbe.reachable && REQUIRE_PUBLIC_REACHABILITY) {
        throw new Error(`public URL could not be verified from this environment: ${publicProbe.error || 'unknown error'}`);
      }
      if (publicProbe.reachable) {
        assert.equal(publicProbe.status, 200, `public URL should return HTTP 200, got ${publicProbe.status}`);
        assert.equal(publicProbe.markerFound, true, 'public deployment should contain marker in HTML or linked script assets');
        assert.equal(publicProbe.unresolvedEnvPlaceholderFound, false, 'public HTML should not contain unresolved Vite env placeholders');
        checkpoint('public_url_reachable', 'passed', {
          publicUrl,
          status: publicProbe.status,
          markerFound: publicProbe.markerFound,
          markerLocation: publicProbe.markerLocation || null,
          analyticsBootstrapFound: publicProbe.analyticsBootstrapFound,
          assetUrls: publicProbe.assetUrls,
        });
        if (publicProbe.analyticsBootstrapFound) {
          checkpoint('analytics_bootstrap_published', 'passed', {
            analyticsBootstrapFound: true,
          });
          const browserVisit = await visitPublicDeploymentWithBrowser(publicUrl);
          report.browserVisitStatus = browserVisit.status;
          report.browserVisitScreenshot = browserVisit.screenshotPath;
          report.browserVisitError = browserVisit.error;
          report.browserAnalyticsSendStatus = browserVisit.analyticsSendStatus;
          report.browserPageErrors = browserVisit.pageErrors;
          if (browserVisit.ok) {
            checkpoint('browser_visit_public_url', 'passed', {
              publicUrl,
              screenshotPath: browserVisit.screenshotPath || null,
              analyticsSendStatus: browserVisit.analyticsSendStatus ?? null,
              pageErrors: browserVisit.pageErrors || [],
              waitMs: BROWSER_VISIT_WAIT_MS,
            });
          } else if (browserVisit.status === 'skipped') {
            checkpoint('browser_visit_skipped', 'passed', {
              reason: 'set ONECEO_E2E_BROWSER_VISIT=true to execute public URL JavaScript',
            });
          } else {
            checkpoint('browser_visit_public_url', 'failed', {
              publicUrl,
              error: browserVisit.error || null,
              analyticsSendStatus: browserVisit.analyticsSendStatus ?? null,
              pageErrors: browserVisit.pageErrors || [],
            });
            throw new Error(`public browser visit failed: ${browserVisit.error || 'unknown error'}`);
          }
        } else {
          checkpoint('analytics_bootstrap_missing', 'failed', {
            analyticsBootstrapFound: false,
            note: 'public HTML is reachable, but the runtime analytics bootstrap was not published',
          });
          throw new Error('public deployment is reachable but OneCEO analytics bootstrap was not published');
        }
      } else {
        checkpoint('public_url_reachability_unverified', 'passed', {
          publicUrl,
          error: publicProbe.error || null,
          requirePublicReachability: REQUIRE_PUBLIC_REACHABILITY,
        });
      }

      const analyticsAfterVisit = await poll<JsonRecord>(
        'analytics status after visit',
        REQUIRE_ANALYTICS_TRACKING ? ANALYTICS_TRACKING_TIMEOUT_MS : 2 * 60_000,
        async () => getApiData<JsonRecord>(`${API_BASE}/api/task-creation/sessions/${sessionId}/deployment?refresh=1`, cookieSession!.cookie),
        (value) => {
          const status = asText(value?.analytics?.status).toLowerCase();
          return REQUIRE_ANALYTICS_TRACKING ? status === 'tracking' : status === 'bound' || status === 'tracking';
        }
      );
      report.analyticsStatus = asText(analyticsAfterVisit.analytics?.status) || report.analyticsStatus;
      report.analyticsTrackingStatus =
        asText(analyticsAfterVisit.analytics?.status).toLowerCase() === 'tracking'
          ? 'passed'
          : BROWSER_VISIT_ENABLED
            ? 'failed'
            : 'unverified';
      checkpoint('analytics_status', 'passed', {
        analyticsStatus: analyticsAfterVisit.analytics?.status || null,
        requireTracking: REQUIRE_ANALYTICS_TRACKING,
        browserVisitEnabled: BROWSER_VISIT_ENABLED,
        pageviews: analyticsAfterVisit.analytics?.pageviews ?? null,
        visits: analyticsAfterVisit.analytics?.visits ?? null,
      });
    } else {
      assert.ok(
        report.bindingState === 'repair_required' || report.bindingState === 'provider_error',
        'missing public URL is only acceptable with explicit repair/provider state'
      );
      checkpoint('deployment_provider_state', 'passed', {
        bindingState: report.bindingState || null,
        providerErrorCode: report.providerErrorCode || null,
      });
    }

    const dbSession = await taskCreationSessionDAO.getSession(sessionId);
    assert.ok(dbSession, 'session should exist in DB during run');
    checkpoint('db_session_exists', 'passed', {
      dbStatus: dbSession?.status || null,
    });

    report.passed = true;
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    report.error = message;
    checkpoint('failure', 'failed', { message });
    throw error;
  } finally {
    if (!KEEP_RESOURCES) {
      if (orchestratorSessionId) {
        try {
          await e2bConnector.killSandbox(orchestratorSessionId);
          await sandboxExecutionEnvironmentDAO.updateStatus(orchestratorSessionId, 'closed');
          report.sandboxCleanup = 'killed';
        } catch (error) {
          report.sandboxCleanup = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (cookieSession?.cookie && sessionId) {
        try {
          await deleteApi(`${API_BASE}/api/task-creation/sessions/${sessionId}`, cookieSession.cookie);
          report.sessionCleanup = 'deleted';
        } catch (error) {
          report.sessionCleanup = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } else {
      report.sandboxCleanup = 'skipped_by_env';
      report.sessionCleanup = 'skipped_by_env';
    }

    report.finishedAt = new Date().toISOString();
    try {
      await writeReport(report);
    } catch (reportError) {
      console.error('[e2e] write report failed:', reportError);
    }
  }
}

void main()
  .then(() => {
    console.log('[e2e] deployment main chain passed');
  })
  .catch((error) => {
    console.error('[e2e] deployment main chain failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
