import { e2bConfig } from '../config/e2b-config';

type OpencodeHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type OpencodePartInput = {
  type: string;
  text?: string;
  mime?: string;
  url?: string;
  name?: string;
};

type OpencodePendingQuestionRecord = {
  id: string;
  sessionID?: string;
  questions?: Array<Record<string, unknown>>;
  tool?: Record<string, unknown>;
};

type OpencodeEventHandler = (event: Record<string, unknown>) => void;

function resolveTimeoutMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1000, Math.floor(parsed));
}

function resolveHttpTimeoutMs(): number {
  return resolveTimeoutMs(process.env.OPENCODE_HTTP_TIMEOUT_MS, 20000);
}

function resolvePromptTimeoutMs(): number {
  const raw = process.env.OPENCODE_PROMPT_TIMEOUT_MS || process.env.OPENCODE_HTTP_TIMEOUT_MS;
  return resolveTimeoutMs(raw, 120000);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizeBaseUrl(baseUrl) + normalizedPath);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (!key) continue;
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function buildHeaders(
  baseHeaders?: Record<string, string>,
  trafficAccessToken?: string
): Record<string, string> {
  const headers: Record<string, string> = { ...(baseHeaders || {}) };
  if (trafficAccessToken) {
    headers['e2b-traffic-access-token'] = trafficAccessToken;
  }
  return headers;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = resolveTimeoutMs(init.timeoutMs, resolveHttpTimeoutMs());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureServerReady(baseUrl: string, trafficAccessToken?: string) {
  const url = buildUrl(baseUrl, '/global/health');
  const headers = buildHeaders({}, trafficAccessToken);
  const resp = await fetchWithTimeout(url.toString(), { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`opencode health check failed: ${resp.status} ${body}`);
  }
  return true;
}

async function createSession(
  baseUrl: string,
  input: { directory?: string; title?: string },
  trafficAccessToken?: string
) {
  const url = buildUrl(baseUrl, '/session', input.directory ? { directory: input.directory } : undefined);
  const headers = buildHeaders({ 'Content-Type': 'application/json' }, trafficAccessToken);
  const body: Record<string, unknown> = {};
  if (input.title) body.title = input.title;
  const resp = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`opencode create session failed: ${resp.status} ${text}`);
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  if (!id) {
    throw new Error('opencode create session response missing id');
  }
  return { id, raw: parsed };
}

async function sendPrompt(
  baseUrl: string,
  input: { sessionId: string; directory?: string; parts: OpencodePartInput[] },
  trafficAccessToken?: string
) {
  if (!input.sessionId) {
    throw new Error('opencode sessionId is required');
  }
  const url = buildUrl(
    baseUrl,
    `/session/${encodeURIComponent(input.sessionId)}/message`,
    input.directory ? { directory: input.directory } : undefined
  );
  const headers = buildHeaders({ 'Content-Type': 'application/json' }, trafficAccessToken);
  const parts = input.parts
    .map((part) => ({
      type: part.type,
      text: part.text,
      mime: part.mime,
      url: part.url,
      name: part.name,
    }))
    .filter((part) => Boolean(part.type));
  if (parts.length === 0) {
    throw new Error('opencode prompt parts are required');
  }
  const resp = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ parts }),
    timeoutMs: resolvePromptTimeoutMs(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`opencode send prompt failed: ${resp.status} ${text}`);
  }
  // Avoid waiting on a potentially long-lived response body.
  try {
    resp.body?.cancel();
  } catch {
    // ignore cancel errors
  }
  return '';
}

async function getSessionDiff(
  baseUrl: string,
  input: { sessionId: string; messageId?: string },
  trafficAccessToken?: string
) {
  if (!input.sessionId) {
    throw new Error('opencode sessionId is required');
  }
  const query: Record<string, string> = {};
  if (input.messageId) {
    query.messageID = input.messageId;
  }
  const url = buildUrl(baseUrl, `/session/${encodeURIComponent(input.sessionId)}/diff`, query);
  const headers = buildHeaders({}, trafficAccessToken);
  const resp = await fetchWithTimeout(url.toString(), { headers });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`opencode session diff failed: ${resp.status} ${text}`);
  }
  return JSON.parse(text) as unknown;
}

async function getSessionMessages(
  baseUrl: string,
  input: { sessionId: string; directory?: string },
  trafficAccessToken?: string
) {
  if (!input.sessionId) {
    throw new Error('opencode sessionId is required');
  }
  const url = buildUrl(
    baseUrl,
    `/session/${encodeURIComponent(input.sessionId)}/message`,
    input.directory ? { directory: input.directory } : undefined
  );
  const headers = buildHeaders({}, trafficAccessToken);
  const resp = await fetchWithTimeout(url.toString(), {
    headers,
    timeoutMs: resolvePromptTimeoutMs(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`opencode session messages failed: ${resp.status} ${text}`);
  }
  return JSON.parse(text || '[]') as unknown;
}

async function listQuestions(
  baseUrl: string,
  input: { directory?: string },
  trafficAccessToken?: string
) {
  const url = buildUrl(baseUrl, '/question', input.directory ? { directory: input.directory } : undefined);
  const headers = buildHeaders({}, trafficAccessToken);
  const resp = await fetchWithTimeout(url.toString(), { headers });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`opencode list questions failed: ${resp.status} ${text}`);
  }
  return JSON.parse(text || '[]') as OpencodePendingQuestionRecord[];
}

async function replyQuestion(
  baseUrl: string,
  input: { requestId: string; directory?: string; answers: string[][] },
  trafficAccessToken?: string
) {
  if (!input.requestId) {
    throw new Error('opencode requestId is required');
  }
  const url = buildUrl(
    baseUrl,
    `/question/${encodeURIComponent(input.requestId)}/reply`,
    input.directory ? { directory: input.directory } : undefined
  );
  const headers = buildHeaders({ 'Content-Type': 'application/json' }, trafficAccessToken);
  const resp = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ answers: input.answers || [] }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`opencode reply question failed: ${resp.status} ${text}`);
  }
  return text;
}

async function doRequest(
  baseUrl: string,
  input: {
    method: string;
    path: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  },
  trafficAccessToken?: string
): Promise<OpencodeHttpResponse> {
  const url = buildUrl(baseUrl, input.path, input.query);
  const headers = buildHeaders(input.headers, trafficAccessToken);
  if (input.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetchWithTimeout(url.toString(), {
    method: input.method || 'GET',
    headers,
    body: input.body,
    timeoutMs: resolveHttpTimeoutMs(),
  });
  const body = await resp.text();
  const flatHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    flatHeaders[key] = value;
  });
  return {
    status: resp.status,
    headers: flatHeaders,
    body,
  };
}

async function subscribeEvents(
  baseUrl: string,
  input: { directory?: string; onEvent: OpencodeEventHandler; signal?: AbortSignal },
  trafficAccessToken?: string
) {
  const url = buildUrl(baseUrl, '/global/event', input.directory ? { directory: input.directory } : undefined);
  const headers = buildHeaders({ Accept: 'text/event-stream' }, trafficAccessToken);
  const resp = await fetch(url.toString(), { headers, signal: input.signal });
  if (!resp.ok || !resp.body) {
    const text = await resp.text();
    throw new Error(`opencode subscribe events failed: ${resp.status} ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const dataLines: string[] = [];
  let eventName = '';
  const emit = () => {
    if (dataLines.length === 0 && !eventName) return;
    const raw = dataLines.join('\n').trim();
    dataLines.length = 0;
    try {
      if (!raw) {
        if (eventName) {
          input.onEvent({ type: eventName });
        }
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (eventName && !parsed.type) {
        parsed.type = eventName;
      }
      input.onEvent(parsed);
    } catch (error) {
      console.warn('[OPENCODE_EVENT_PARSE_ERROR]', error);
    } finally {
      eventName = '';
    }
  };

  const flush = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line) {
        emit();
        continue;
      }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    flush(decoder.decode(value, { stream: true }));
  }
  emit();
}

export const opencodeHttpClient = {
  ensureServerReady,
  createSession,
  sendPrompt,
  getSessionDiff,
  getSessionMessages,
  listQuestions,
  replyQuestion,
  doRequest,
  subscribeEvents,
  buildUrl,
  opencodePort: e2bConfig.opencodePort,
};
