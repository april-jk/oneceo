import type { OsacMessage } from '../clients/osac-client';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { osacConnectionManager } from './osac-connection-manager';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';

function isSandboxNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const texts: string[] = [];
  const pushText = (value: unknown) => {
    if (!value) return;
    const text = String(value);
    if (text) texts.push(text);
  };
  if (error instanceof Error) {
    pushText(error.message);
    pushText(error.name);
    pushText((error as any).cause);
  }
  pushText(error);
  const serialized = (() => {
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  })();
  pushText(serialized);
  const normalized = texts.join(' | ').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('sandbox was not found') || normalized.includes('sandbox not found')) {
    return true;
  }
  if (normalized.includes('paused sandbox') && normalized.includes('not found')) {
    return true;
  }
  if (normalized.includes('the sandbox was not found')) {
    return true;
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return true;
  }
  return false;
}

async function markSandboxClosed(orchestratorSessionId: string) {
  try {
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (!environment) return;
    if (environment.status === 'closed') return;
    await sandboxExecutionEnvironmentDAO.updateStatus(
      orchestratorSessionId,
      'closed',
      environment.vmName ?? null
    );
  } catch (error) {
    console.warn('[OPENCODE_EVENT_STREAM_MARK_CLOSED_FAILED]', orchestratorSessionId, error);
  }
}

type StreamEntry = {
  abort: AbortController;
  running: Promise<void>;
  seq: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFilterByWorkspace(): boolean {
  const raw = String(process.env.OPENCODE_EVENT_FILTER_DIRECTORY || 'false').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function findSessionId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findSessionId(item);
      if (hit) return hit;
    }
    return '';
  }
  const record = value as Record<string, unknown>;
  const direct =
    (typeof record.sessionID === 'string' && record.sessionID.trim()) ||
    (typeof record.sessionId === 'string' && record.sessionId.trim());
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const hit = findSessionId(child);
    if (hit) return hit;
  }
  return '';
}

function normalizeEvent(event: Record<string, unknown>) {
  if (event.payload && typeof event.payload === 'object') {
    const payload = event.payload as Record<string, unknown>;
    if (event.directory) {
      return { ...payload, directory: event.directory };
    }
    return payload;
  }
  return event;
}

function toEventMessage(
  orchestratorSessionId: string,
  entry: StreamEntry,
  normalized: Record<string, unknown>
): OsacMessage {
  const eventType =
    (typeof normalized.type === 'string' && normalized.type.trim()) || 'unknown';
  const opencodeSessionId = findSessionId(normalized);
  entry.seq += 1;
  return {
    type: 'OPENCODE_EVENT',
    payload: {
      seq: entry.seq,
      timestamp: Date.now(),
      eventType,
      event: normalized,
      orchestratorSessionId,
      opencodeSessionId: opencodeSessionId || undefined,
    },
  };
}

export class OpencodeEventStreamService {
  private streams = new Map<string, StreamEntry>();
  private retryIntervalMs = Number(process.env.OPENCODE_EVENT_RETRY_INTERVAL_MS || 1500);

  async ensureStream(input: {
    orchestratorSessionId: string;
    baseUrl: string;
    workspaceRoot?: string;
    trafficAccessToken?: string;
  }): Promise<void> {
    if (this.streams.has(input.orchestratorSessionId)) {
      return;
    }

    const abort = new AbortController();
    const entry: StreamEntry = {
      abort,
      running: Promise.resolve(),
      seq: 0,
    };
    this.streams.set(input.orchestratorSessionId, entry);

    entry.running = (async () => {
      while (!abort.signal.aborted) {
        try {
          await opencodeHttpClient.subscribeEvents(
            input.baseUrl,
            {
              directory: shouldFilterByWorkspace() ? input.workspaceRoot : undefined,
              signal: abort.signal,
              onEvent: (event) => {
                const normalized = normalizeEvent(event);
                const currentDir =
                  typeof (normalized as Record<string, unknown>).directory === 'string'
                    ? String((normalized as Record<string, unknown>).directory).trim()
                    : '';
                if (input.workspaceRoot && !currentDir) {
                  normalized.directory = input.workspaceRoot;
                }
                const message = toEventMessage(input.orchestratorSessionId, entry, normalized);
                osacConnectionManager.emitExternalMessage(input.orchestratorSessionId, message);
              },
            },
            input.trafficAccessToken
          );
        } catch (error) {
          if (abort.signal.aborted) {
            break;
          }
          if (isSandboxNotFoundError(error)) {
            await markSandboxClosed(input.orchestratorSessionId);
            this.streams.delete(input.orchestratorSessionId);
            abort.abort();
            break;
          }
          const message: OsacMessage = {
            type: 'OPENCODE_ERROR',
            payload: {
              code: 'event_stream_error',
              message: error instanceof Error ? error.message : String(error),
              stage: 'event_subscribe',
              orchestratorSessionId: input.orchestratorSessionId,
            },
          };
          osacConnectionManager.emitExternalMessage(input.orchestratorSessionId, message);
          await sleep(this.retryIntervalMs);
        }
      }
    })();
  }

  async stopStream(orchestratorSessionId: string): Promise<void> {
    const entry = this.streams.get(orchestratorSessionId);
    if (!entry) return;
    this.streams.delete(orchestratorSessionId);
    entry.abort.abort();
    try {
      await entry.running;
    } catch {
      // ignore
    }
  }
}

export const opencodeEventStreamService = new OpencodeEventStreamService();
