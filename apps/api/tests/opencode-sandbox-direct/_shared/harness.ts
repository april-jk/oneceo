import '../../../src/config/env';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export const API_BASE = process.env.TASK_CREATION_API_BASE || 'http://127.0.0.1:4000';
export const WS_URL = process.env.TASK_CREATION_WS_URL || 'ws://127.0.0.1:4000/ws/task-creation';

export type WsMessage = {
  type?: string;
  sessionId?: string;
  content?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SseEventRecord = {
  id?: number;
  type?: string;
  eventType?: string;
  sessionId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  receivedAt: number;
};

export type ScenarioContext = {
  suiteId: string;
  ws: WsHarness;
  sessionId?: string;
  opencodeSessionId?: string;
  orchestratorSessionId?: string;
  prompts: string[];
};

export type ScenarioResult = {
  name: string;
  passed: boolean;
  startedAt: string;
  finishedAt: string;
  details: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SSE_CONNECT_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.DIRECT_TEST_SSE_CONNECT_TIMEOUT_MS || 20000)
);
const WS_MESSAGE_BUFFER_MAX = Math.max(
  200,
  Number(process.env.DIRECT_TEST_WS_BUFFER_MAX || 5000)
);
const SSE_EVENT_BUFFER_MAX = Math.max(
  200,
  Number(process.env.DIRECT_TEST_SSE_BUFFER_MAX || 5000)
);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonSafe(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class WsHarness {
  private readonly ws: WebSocket;
  private readonly emitter = new EventEmitter();
  readonly messages: Array<WsMessage & { receivedAt: number }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (raw) => {
      const parsed = parseJsonSafe(raw.toString());
      if (!parsed || typeof parsed !== 'object') return;
      const record = { ...(parsed as WsMessage), receivedAt: Date.now() };
      this.messages.push(record);
      if (this.messages.length > WS_MESSAGE_BUFFER_MAX) {
        this.messages.splice(0, this.messages.length - WS_MESSAGE_BUFFER_MAX);
      }
      this.emitter.emit('message', record);
    });
  }

  static async connect(url: string, timeoutMs: number = 20000): Promise<WsHarness> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`WebSocket connect timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new WsHarness(ws);
  }

  send(payload: Record<string, unknown>) {
    this.ws.send(JSON.stringify(payload));
  }

  async waitFor(
    predicate: (message: WsMessage & { receivedAt: number }) => boolean,
    timeoutMs: number,
    hint: string
  ): Promise<WsMessage & { receivedAt: number }> {
    for (const msg of this.messages) {
      if (predicate(msg)) return msg;
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.emitter.off('message', onMessage);
        reject(new Error(`waitFor timeout: ${hint}`));
      }, timeoutMs);

      const onMessage = (msg: WsMessage & { receivedAt: number }) => {
        if (!predicate(msg)) return;
        clearTimeout(timer);
        this.emitter.off('message', onMessage);
        resolve(msg);
      };

      this.emitter.on('message', onMessage);
    });
  }

  async waitForWelcome(timeoutMs: number = 15000) {
    return this.waitFor(
      (msg) =>
        msg.type === 'agent_message' &&
        asText(msg.content).includes('欢迎使用 Altus 任务创建助手'),
      timeoutMs,
      'welcome message'
    );
  }

  close() {
    this.ws.close();
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

export async function getSessionMessages(sessionId: string) {
  return fetchJson<{ success: boolean; data: any[] }>(
    `${API_BASE}/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`
  );
}

export async function sendDirectInput(
  ctx: ScenarioContext,
  content: string,
  options?: { includeSessionId?: boolean; waitAfterSendMs?: number }
) {
  const beforeSend = Date.now();
  const payload: Record<string, unknown> = {
    type: 'opencode_input',
    content,
    metadata: {
      altusMode: 'sandbox',
      executor: 'opencode',
      ...(ctx.opencodeSessionId ? { opencodeSessionId: ctx.opencodeSessionId } : {}),
      ...(ctx.orchestratorSessionId ? { orchestratorSessionId: ctx.orchestratorSessionId } : {}),
    },
  };
  if (options?.includeSessionId !== false && ctx.sessionId) {
    payload.sessionId = ctx.sessionId;
  }

  ctx.ws.send(payload);

  const accepted = await ctx.ws.waitFor(
    (msg) => msg.type === 'opencode_status' && asText(msg.content).includes('OpenCode 已接收输入'),
    Number(process.env.OPENCODE_DIRECT_ACCEPT_TIMEOUT_MS || 180000),
    'opencode accepted status'
  );

  const sessionId = asText(accepted.sessionId);
  if (sessionId) ctx.sessionId = sessionId;
  const metadata = (accepted.metadata || {}) as Record<string, unknown>;
  const opencodeSessionId = asText(metadata.opencodeSessionId);
  const orchestratorSessionId = asText(metadata.orchestratorSessionId);
  if (opencodeSessionId) ctx.opencodeSessionId = opencodeSessionId;
  if (orchestratorSessionId) ctx.orchestratorSessionId = orchestratorSessionId;

  if (options?.waitAfterSendMs && options.waitAfterSendMs > 0) {
    await sleep(options.waitAfterSendMs);
  }

  return { accepted, beforeSend };
}

export async function waitForOpencodeEventAfter(
  ws: WsHarness,
  afterMs: number,
  timeoutMs: number,
  hint: string
) {
  return ws.waitFor(
    (msg) => msg.type === 'opencode_event' && msg.receivedAt >= afterMs,
    timeoutMs,
    hint
  );
}

function parseSseFrame(rawFrame: string): { id?: number; data?: string } | null {
  const frame = rawFrame.replace(/\r\n/g, '\n').trim();
  if (!frame) return null;
  const lines = frame.split('\n');
  let id: number | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('id:')) {
      const rawId = line.slice(3).trim();
      const asNum = Number(rawId);
      if (Number.isFinite(asNum)) id = asNum;
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
      continue;
    }
  }

  if (dataLines.length === 0) return null;
  return { id, data: dataLines.join('\n') };
}

export class SseHarness {
  private readonly events: SseEventRecord[] = [];
  private readonly emitter = new EventEmitter();
  private readonly abortController = new AbortController();
  private readerLoop: Promise<void>;

  private constructor() {
    this.readerLoop = Promise.resolve();
  }

  static async connect(args: {
    sessionId: string;
    opencodeSessionId?: string;
    since?: number;
  }): Promise<SseHarness> {
    const params = new URLSearchParams();
    if (args.opencodeSessionId) params.set('opencodeSessionId', args.opencodeSessionId);
    if (args.since) params.set('since', String(args.since));
    const url = `${API_BASE}/api/task-creation/sessions/${encodeURIComponent(args.sessionId)}/opencode/events${
      params.toString() ? `?${params.toString()}` : ''
    }`;

    const harness = new SseHarness();
    const connectAbort = new AbortController();
    const connectTimer = setTimeout(() => {
      connectAbort.abort(new Error(`SSE connect timeout after ${SSE_CONNECT_TIMEOUT_MS}ms`));
    }, SSE_CONNECT_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.any([harness.abortController.signal, connectAbort.signal]),
    }).finally(() => clearTimeout(connectTimer));

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`SSE connect failed: HTTP ${response.status} ${text}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    harness.readerLoop = (async () => {
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIndex = buffer.indexOf('\n\n');
        while (splitIndex >= 0) {
          const rawFrame = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          const frame = parseSseFrame(rawFrame);
          if (frame?.data) {
            const payload = parseJsonSafe(frame.data);
            if (payload && typeof payload === 'object') {
              const record: SseEventRecord = {
                id: frame.id,
                type: asText((payload as any).type),
                eventType:
                  asText((payload as any).eventType) ||
                  asText(((payload as any).metadata || {}).eventType),
                sessionId: asText((payload as any).sessionId),
                content: asText((payload as any).content),
                metadata: ((payload as any).metadata || {}) as Record<string, unknown>,
                createdAt: asText((payload as any).createdAt) || undefined,
                receivedAt: Date.now(),
              };
              harness.events.push(record);
              if (harness.events.length > SSE_EVENT_BUFFER_MAX) {
                harness.events.splice(0, harness.events.length - SSE_EVENT_BUFFER_MAX);
              }
              harness.emitter.emit('event', record);
            }
          }
          splitIndex = buffer.indexOf('\n\n');
        }
      }
    })().catch((error) => {
      if ((error as Error)?.name !== 'AbortError') {
        harness.emitter.emit('error', error);
      }
    });

    return harness;
  }

  getEvents() {
    return [...this.events];
  }

  async waitFor(
    predicate: (event: SseEventRecord) => boolean,
    timeoutMs: number,
    hint: string
  ): Promise<SseEventRecord> {
    for (const event of this.events) {
      if (predicate(event)) return event;
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.emitter.off('event', onEvent);
        reject(new Error(`SSE wait timeout: ${hint}`));
      }, timeoutMs);

      const onEvent = (event: SseEventRecord) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        this.emitter.off('event', onEvent);
        resolve(event);
      };

      this.emitter.on('event', onEvent);
      this.emitter.once('error', (error) => {
        clearTimeout(timer);
        this.emitter.off('event', onEvent);
        reject(error);
      });
    });
  }

  async close() {
    this.abortController.abort();
    await this.readerLoop.catch(() => undefined);
  }
}

export function assertSessionContext(ctx: ScenarioContext) {
  assert.ok(ctx.sessionId, 'sessionId should be available');
  assert.ok(ctx.orchestratorSessionId, 'orchestratorSessionId should be available');
}

export function markScenarioStart(name: string) {
  const startedAt = new Date().toISOString();
  console.log(`\n[scenario:start] ${name} @ ${startedAt}`);
  return startedAt;
}

export function markScenarioEnd(
  name: string,
  startedAt: string,
  details: Record<string, unknown>
): ScenarioResult {
  const finishedAt = new Date().toISOString();
  console.log(`[scenario:done] ${name} @ ${finishedAt}`);
  return {
    name,
    passed: true,
    startedAt,
    finishedAt,
    details,
  };
}

export async function settle(ms: number) {
  await sleep(ms);
}
