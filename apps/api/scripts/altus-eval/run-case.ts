import path from 'node:path';
import { readFile } from 'node:fs/promises';

import WebSocket from 'ws';

import { DEFAULT_SUITE_PATH, ensureDir, parseCliArgs, loadSuite, writeJsonFile } from './io.js';

type WsMessage = {
  type?: string;
  content?: string;
  message?: string;
  question?: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function detectOutcome(message: WsMessage): 'completed' | 'failed' | 'waiting_user' | null {
  const type = asText(message.type).toLowerCase();
  const content = asText(message.content || message.message).toLowerCase();
  const metadata = message.metadata || {};
  const outcome = asText((metadata as any).outcome).toLowerCase();
  const stage = asText((metadata as any).stage).toLowerCase();
  const eventType = asText((metadata as any).eventType).toLowerCase();

  if (outcome === 'completed') return 'completed';
  if (outcome === 'failed') return 'failed';
  if (eventType === 'session.error') return 'failed';
  if (eventType === 'session.idle') return 'completed';

  if (type === 'status_update' || type === 'opencode_status' || type === 'agent_message') {
    if (content.includes('执行完成') || content.includes('completed')) return 'completed';
    if (content.includes('执行失败') || content.includes('failed')) return 'failed';
    if (content.includes('需要你补充关键信息') || stage === 'clarifying') return 'waiting_user';
  }
  if (type === 'clarification_request') return 'waiting_user';
  return null;
}

async function loginAndGetCookie(apiBase: string): Promise<string> {
  const accountPath = path.resolve(process.cwd(), '../web/e2e/playwright-test-account.json');
  const account = JSON.parse(await readFile(accountPath, 'utf8'));
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`auth login failed: ${response.status} ${text}`);
  }

  const setCookie = response.headers.get('set-cookie') || '';
  const matched = setCookie.match(/(?:^|,\s*)app_session_id=([^;,\s]+)/);
  if (!matched?.[1]) {
    throw new Error('auth login succeeded but set-cookie missing app_session_id');
  }
  return `app_session_id=${matched[1]}`;
}

async function fetchJson(apiBase: string, cookie: string, route: string): Promise<any> {
  const response = await fetch(`${apiBase}${route}`, {
    headers: {
      cookie,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`request failed for ${route}: ${response.status} ${text}`);
  }
  return response.json();
}

async function waitForTurn(
  ws: WebSocket,
  prompt: string,
  state: {
    sessionId: string | null;
    transcript: WsMessage[];
  },
  timeoutMs: number
): Promise<'completed' | 'failed' | 'waiting_user' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve('timeout');
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      let message: WsMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      state.transcript.push(message);
      if (!state.sessionId && asText(message.sessionId)) {
        state.sessionId = asText(message.sessionId);
      }
      const outcome = detectOutcome(message);
      if (!outcome || settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(outcome);
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve('failed');
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.send(
      JSON.stringify({
        type: 'user_input',
        sessionId: state.sessionId || undefined,
        content: prompt,
      })
    );
  });
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const apiBase = typeof options['api-base'] === 'string' ? options['api-base'] : 'http://localhost:4000';
  const wsBase = typeof options['ws-url'] === 'string' ? options['ws-url'] : 'ws://localhost:4000/ws/task-creation';
  const suitePath =
    typeof options.suite === 'string' ? path.resolve(process.cwd(), options.suite) : DEFAULT_SUITE_PATH;
  const runDir = typeof options['run-dir'] === 'string' ? path.resolve(process.cwd(), options['run-dir']) : '';
  const caseId = typeof options['case-id'] === 'string' ? options['case-id'] : '';
  const timeoutMs = typeof options.timeout === 'string' ? Number.parseInt(options.timeout, 10) : 180000;

  if (!runDir) {
    throw new Error('--run-dir is required');
  }
  if (!caseId) {
    throw new Error('--case-id is required');
  }

  const suite = await loadSuite(suitePath);
  const targetCase = suite.cases.find((item) => item.case_id === caseId);
  if (!targetCase) {
    throw new Error(`case not found: ${caseId}`);
  }

  const prompts =
    Array.isArray(targetCase.prompt_sequence) && targetCase.prompt_sequence.length > 0
      ? targetCase.prompt_sequence
      : targetCase.prompt
        ? [targetCase.prompt]
        : [];

  if (prompts.length === 0) {
    throw new Error(`case has no prompt payload: ${caseId}`);
  }

  const cookie = await loginAndGetCookie(apiBase);
  const ws = new WebSocket(wsBase, {
    headers: {
      Cookie: cookie,
    },
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const state = {
    sessionId: null as string | null,
    transcript: [] as WsMessage[],
  };

  const turnResults: Array<{ prompt: string; outcome: string }> = [];
  for (const prompt of prompts) {
    const outcome = await waitForTurn(ws, prompt, state, timeoutMs);
    turnResults.push({ prompt, outcome });
    if (outcome === 'failed' || outcome === 'timeout') {
      break;
    }
  }

  ws.close();

  const sessionId = state.sessionId;
  const artifactDir = path.join(runDir, 'artifacts', caseId);
  await ensureDir(artifactDir);

  let sessionDetail: any = null;
  let recentMessages: any = null;
  let fullMessages: any = null;
  let workspaceTree: any = null;
  let latestRun: any = null;
  let deployment: any = null;

  if (sessionId) {
    sessionDetail = await fetchJson(apiBase, cookie, `/api/task-creation/sessions/${encodeURIComponent(sessionId)}`);
    recentMessages = await fetchJson(
      apiBase,
      cookie,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages/recent`
    ).catch(() => null);
    fullMessages = await fetchJson(
      apiBase,
      cookie,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`
    ).catch(() => null);
    workspaceTree = await fetchJson(
      apiBase,
      cookie,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/workspace/tree`
    ).catch(() => null);
    latestRun = await fetchJson(
      apiBase,
      cookie,
      `/api/altus-managed/sessions/${encodeURIComponent(sessionId)}/runs/latest`
    ).catch(() => null);
    deployment = await fetchJson(
      apiBase,
      cookie,
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/deployment`
    ).catch(() => null);
  }

  await writeJsonFile(path.join(runDir, 'artifacts', `${caseId}.json`), {
    caseId,
    prompts,
    turnResults,
    sessionId,
    sessionDetail,
    recentMessages,
    fullMessages,
    workspaceTree,
    latestRun,
    deployment,
    transcript: state.transcript,
  });

  if (sessionId) {
    process.stdout.write(`${sessionId}\n`);
    return;
  }
  process.stdout.write('NO_SESSION_ID\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
