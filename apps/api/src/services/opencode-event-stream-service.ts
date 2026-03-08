import type { OsacMessage } from '../clients/osac-client';
import { randomUUID } from 'node:crypto';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import { osacConnectionManager } from './osac-connection-manager';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../db/dao';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { ensureDatabaseConnection } from '../config/database';
import { touchSandbox } from './sandbox-activity-service';
import { sessionConnectorService } from './session-connector-service';

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

type PersistEntry = {
  sessionId: string;
  role: 'agent';
  messageType: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type SessionBinding = {
  sessionId: string;
  mode?: string;
  updatedAt: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
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

type FastEventListener = (payload: {
  orchestratorSessionId: string;
  opencodeSessionId?: string;
  eventType: string;
  event: Record<string, unknown>;
  seq: number;
  timestamp: number;
}) => void;

export class OpencodeEventStreamService {
  private streams = new Map<string, StreamEntry>();
  private listeners = new Map<string, Set<FastEventListener>>();
  private retryIntervalMs = Number(process.env.OPENCODE_EVENT_RETRY_INTERVAL_MS || 1500);
  private streamTextState = new Map<string, { text: string; updatedAt: number }>();
  private streamTextMaxEntries = Number(process.env.OPENCODE_EVENT_STREAM_STATE_MAX || 1000);
  private sessionBindings = new Map<string, SessionBinding>();
  private sessionBindingTtlMs = Number(process.env.OPENCODE_EVENT_BINDING_TTL_MS || 15000);
  private persistQueue: PersistEntry[] = [];
  private persistTimer: NodeJS.Timeout | null = null;
  private persistIntervalMs = Number(process.env.OPENCODE_EVENT_PERSIST_INTERVAL_MS || 1000);
  private persistFlushInProgress: Promise<void> = Promise.resolve();

  subscribe(orchestratorSessionId: string, listener: FastEventListener): () => void {
    if (!orchestratorSessionId) {
      return () => undefined;
    }
    const set = this.listeners.get(orchestratorSessionId) || new Set<FastEventListener>();
    set.add(listener);
    this.listeners.set(orchestratorSessionId, set);
    return () => {
      const next = this.listeners.get(orchestratorSessionId);
      if (!next) return;
      next.delete(listener);
      if (next.size === 0) {
        this.listeners.delete(orchestratorSessionId);
      }
    };
  }

  bindSession(orchestratorSessionId: string, sessionId: string, mode?: string) {
    if (!orchestratorSessionId || !sessionId) return;
    this.sessionBindings.set(orchestratorSessionId, {
      sessionId,
      mode,
      updatedAt: Date.now(),
    });
  }

  private emitFast(orchestratorSessionId: string, payload: {
    opencodeSessionId?: string;
    eventType: string;
    event: Record<string, unknown>;
    seq: number;
    timestamp: number;
  }) {
    const listeners = this.listeners.get(orchestratorSessionId);
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) {
      try {
        listener({
          orchestratorSessionId,
          opencodeSessionId: payload.opencodeSessionId,
          eventType: payload.eventType,
          event: payload.event,
          seq: payload.seq,
          timestamp: payload.timestamp,
        });
      } catch (error) {
        console.warn('[OPENCODE_EVENT_FAST_LISTENER_ERROR]', error);
      }
    }
  }

  private buildStreamKey(orchestratorSessionId: string, opencodeSessionId: string | undefined, partId: string) {
    return `${orchestratorSessionId}::${opencodeSessionId || ''}::${partId || 'text'}`;
  }

  private extractEventInfo(event: Record<string, unknown>) {
    const eventType = typeof event.type === 'string' ? event.type : '';
    const properties = (event.properties && typeof event.properties === 'object')
      ? event.properties as Record<string, unknown>
      : {};
    const part = (properties.part && typeof properties.part === 'object')
      ? properties.part as Record<string, unknown>
      : {};
    const message = (properties.message && typeof properties.message === 'object')
      ? properties.message as Record<string, unknown>
      : {};
    const partType = ((part.type as string) || (properties.type as string) || '').toLowerCase();
    const toolName =
      ((part.tool as string) || (part.name as string) || (properties.tool as string) || (properties.name as string) || '')
        .toLowerCase();
    const partId = (part.id as string) || (part.callID as string) || (properties.partId as string) || '';
    const role =
      (message.role as string) ||
      (properties.role as string) ||
      (part.role as string) ||
      '';
    return { eventType, properties, part, partType, toolName, partId, role: role.toLowerCase() };
  }

  private shouldPersistCommandEvent(properties: Record<string, unknown>): boolean {
    const command = (properties.command as string) || (properties.cmd as string) || '';
    const output =
      (properties.stdout as string) ||
      (properties.output as string) ||
      (properties.text as string) ||
      '';
    const error = (properties.error as string) || '';
    return Boolean(command || output || error);
  }

  private shouldPersistToolEvent(info: { toolName: string; part: Record<string, unknown>; properties: Record<string, unknown> }): boolean {
    if (!info.toolName) return false;
    if (info.toolName === 'todoread') return false;
    const state = (info.part.state && typeof info.part.state === 'object') ? info.part.state as Record<string, unknown> : {};
    const rawInput =
      (state.input as string) ||
      (info.part.input as string) ||
      (info.properties.input as string) ||
      (info.properties.command as string) ||
      '';
    const rawOutput =
      (state.output as string) ||
      (info.properties.output as string) ||
      (info.properties.stdout as string) ||
      '';
    const error = (state.error as string) || (info.properties.error as string) || '';
    const status = (state.status as string) || (info.properties.status as string) || '';
    if (['bash', 'shell', 'cmd'].includes(info.toolName)) {
      return Boolean(rawInput || rawOutput || error || status);
    }
    return true;
  }

  private pruneStreamState() {
    const maxEntries = Number.isFinite(this.streamTextMaxEntries)
      ? Math.max(200, this.streamTextMaxEntries)
      : 1000;
    if (this.streamTextState.size <= maxEntries) return;
    const entries = Array.from(this.streamTextState.entries());
    entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const removeCount = entries.length - maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      this.streamTextState.delete(entries[i][0]);
    }
  }

  private applyStreamDelta(
    orchestratorSessionId: string,
    opencodeSessionId: string | undefined,
    event: Record<string, unknown>
  ): Record<string, unknown> {
    const eventType = typeof event.type === 'string' ? event.type : '';
    if (eventType !== 'message.part.updated' && eventType !== 'message.part.delta') {
      return event;
    }
    const properties = (event.properties && typeof event.properties === 'object')
      ? { ...(event.properties as Record<string, unknown>) }
      : {};
    const part = (properties.part && typeof properties.part === 'object')
      ? { ...(properties.part as Record<string, unknown>) }
      : {};
    const partType = typeof part.type === 'string'
      ? part.type
      : typeof properties.type === 'string'
        ? properties.type
        : '';
    if (partType && partType.toLowerCase() !== 'text') {
      return event;
    }
    const partId =
      (typeof part.id === 'string' && part.id) ||
      (typeof properties.partId === 'string' && properties.partId) ||
      '';
    const delta =
      (typeof properties.delta === 'string' && properties.delta) ||
      '';
    const fullText =
      (typeof part.text === 'string' && part.text) ||
      (typeof part.content === 'string' && part.content) ||
      (typeof properties.text === 'string' && properties.text) ||
      '';
    if (!delta && !fullText) {
      return event;
    }

    // 没有 partId 的增量分片无法稳定归属到同一流，避免错误拼接导致文本乱序。
    if (!partId) {
      return event;
    }

    const key = this.buildStreamKey(orchestratorSessionId, opencodeSessionId, partId);
    const prev = this.streamTextState.get(key)?.text || '';
    let nextText = fullText || prev;
    let nextDelta = delta;

    if (!nextDelta && fullText) {
      if (prev && fullText.startsWith(prev)) {
        nextDelta = fullText.slice(prev.length);
      } else {
        nextDelta = fullText;
      }
    }
    if (!nextText && nextDelta) {
      nextText = `${prev}${nextDelta}`;
    } else if (nextDelta && fullText) {
      nextText = fullText;
    }

    if (nextText) {
      this.streamTextState.set(key, { text: nextText, updatedAt: Date.now() });
      this.pruneStreamState();
    }

    if (!nextDelta) {
      return event;
    }

    return {
      ...event,
      properties: {
        ...properties,
        delta: nextDelta,
        part: part,
      },
    };
  }

  private async resolveBoundSession(orchestratorSessionId: string): Promise<SessionBinding | null> {
    const cached = this.sessionBindings.get(orchestratorSessionId);
    if (cached && Date.now() - cached.updatedAt < this.sessionBindingTtlMs) {
      return cached;
    }
    const session = await taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId);
    if (!session) {
      return null;
    }
    const binding: SessionBinding = {
      sessionId: session.id,
      mode: session.mode,
      updatedAt: Date.now(),
    };
    this.sessionBindings.set(orchestratorSessionId, binding);
    return binding;
  }

  private schedulePersistFlush() {
    if (this.persistIntervalMs <= 0) {
      void this.flushPersistQueue(true);
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setInterval(() => {
      void this.flushPersistQueue();
    }, this.persistIntervalMs);
    if (this.persistTimer && typeof this.persistTimer.unref === 'function') {
      this.persistTimer.unref();
    }
  }

  private async flushPersistQueue(force: boolean = false) {
    if (this.persistQueue.length === 0) return;
    const run = async () => {
      if (this.persistQueue.length === 0) return;
      const batch = this.persistQueue.splice(0, this.persistQueue.length);
      const grouped = new Map<string, PersistEntry[]>();
      for (const item of batch) {
        const list = grouped.get(item.sessionId) || [];
        list.push(item);
        grouped.set(item.sessionId, list);
      }
      try {
        await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
        const dbBatch = batch.map((item) => {
          const createdAt = (() => {
            if (typeof item.createdAt === 'string') {
              const parsed = new Date(item.createdAt);
              if (!Number.isNaN(parsed.getTime())) return parsed;
            }
            return new Date();
          })();
          return {
            id: randomUUID(),
            sessionId: item.sessionId,
            role: item.role,
            messageType: item.messageType,
            content: item.content,
            metadata: item.metadata,
            createdAt,
          };
        });
        await taskCreationSessionDAO.addMessages(dbBatch);
      } catch (error) {
        console.warn('[OPENCODE_EVENT_PERSIST_DB_FAILED]', error);
        this.persistQueue.unshift(...batch);
        return;
      }
      for (const [sessionId, list] of grouped.entries()) {
        try {
          await taskCreationFileMemoryStore.addMessagesBatch(
            sessionId,
            list.map((item) => ({
              role: item.role,
              messageType: item.messageType,
              content: item.content,
              metadata: item.metadata,
              createdAt: item.createdAt,
            }))
          );
        } catch (error) {
          console.warn('[OPENCODE_EVENT_PERSIST_MEMORY_FAILED]', sessionId, error);
        }
      }
    };

    this.persistFlushInProgress = this.persistFlushInProgress.then(run, run);
    await this.persistFlushInProgress;
    if (force && this.persistQueue.length > 0) {
      await this.flushPersistQueue(true);
    }
  }

  private shouldFlushPersistImmediately(eventType: string, event: Record<string, unknown>): boolean {
    const lower = String(eventType || '').trim().toLowerCase();
    if (!lower) return false;
    if (
      lower === 'message.final' ||
      lower === 'message.completed' ||
      lower === 'message.done' ||
      lower === 'session.idle' ||
      lower === 'session.completed' ||
      lower === 'session.error'
    ) {
      return true;
    }

    if (lower === 'message.updated') {
      const properties = (event.properties && typeof event.properties === 'object')
        ? (event.properties as Record<string, unknown>)
        : {};
      const info = (properties.info && typeof properties.info === 'object')
        ? (properties.info as Record<string, unknown>)
        : {};
      const state = String(info.state || info.status || properties.state || properties.status || '')
        .trim()
        .toLowerCase();
      return state === 'completed' || state === 'done' || state === 'success' || state === 'failed';
    }

    return false;
  }

  private summarizeEventForHistory(eventType: string, event: Record<string, unknown>): string {
    const properties = (event.properties && typeof event.properties === 'object') ? event.properties as Record<string, unknown> : {};
    const part = (properties.part && typeof properties.part === 'object') ? properties.part as Record<string, unknown> : {};
    const partType = ((part.type as string) || (properties.type as string) || '').toLowerCase();
    const toolName = (part.tool as string) || (part.name as string) || (properties.tool as string) || (properties.name as string) || '';
    if (eventType === 'message.part.updated' || eventType === 'message.part.delta') {
      if (partType === 'tool') {
        return toolName ? `${toolName}` : '';
      }
      if (partType === 'file') {
        const filePath = (part.path as string) || (properties.path as string) || '';
        return filePath ? `${filePath}` : '';
      }
      const text = (part.text as string) || (part.content as string) || (properties.text as string) || '';
      if (text) return text;
    }
    if (eventType === 'command.executed') {
      const cmd = (properties.command as string) || (properties.name as string) || '';
      return cmd || '';
    }
    if (eventType.startsWith('file.')) {
      const path = (properties.file as string) || (properties.path as string) || '';
      return path || '';
    }
    if (eventType === 'session.diff') {
      return '';
    }
    return '';
  }

  private buildEventPreviewForHistory(event: Record<string, unknown>): Record<string, unknown> {
    const properties = (event.properties && typeof event.properties === 'object') ? event.properties as Record<string, unknown> : {};
    const part = (properties.part && typeof properties.part === 'object') ? properties.part as Record<string, unknown> : {};
    const partType = (part.type as string) || (properties.type as string) || '';
    const previewPart: Record<string, unknown> = {};
    if (partType) previewPart.type = partType;
    if (part.id) previewPart.id = part.id;
    if (part.callID) previewPart.callID = part.callID;
    if (part.tool || part.name) previewPart.tool = part.tool || part.name;
    if (part.state && typeof part.state === 'object') {
      const state = part.state as Record<string, unknown>;
      previewPart.state = {
        input: state.input,
        output: state.output,
        error: state.error,
        status: state.status,
      };
    }
    if (part.input) previewPart.input = part.input;
    const previewProps: Record<string, unknown> = {};
    if (Object.keys(previewPart).length > 0) previewProps.part = previewPart;
    if (properties.command) previewProps.command = properties.command;
    if (properties.partId) previewProps.partId = properties.partId;
    if (properties.cwd) previewProps.cwd = properties.cwd;
    if (properties.path || properties.file) previewProps.path = properties.path || properties.file;
    if (properties.diff) previewProps.diff = properties.diff;
    return {
      type: event.type,
      properties: previewProps,
      directory: (event as Record<string, unknown>).directory,
    };
  }

  private enqueuePersist(orchestratorSessionId: string, payload: {
    opencodeSessionId?: string;
    eventType: string;
    event: Record<string, unknown>;
    seq: number;
    timestamp: number;
  }) {
    void (async () => {
      const binding = await this.resolveBoundSession(orchestratorSessionId);
      if (!binding || binding.mode !== 'sandbox') return;
      const createdAt = new Date(payload.timestamp || Date.now()).toISOString();
      const eventPreview = this.buildEventPreviewForHistory(payload.event);
      const metadata: Record<string, unknown> = {
        orchestratorSessionId,
        opencodeSessionId: payload.opencodeSessionId || undefined,
        eventType: payload.eventType,
        seq: payload.seq,
        timestamp: payload.timestamp,
        event: eventPreview,
        rawPayload: { eventType: payload.eventType, event: eventPreview },
      };

      const eventType = payload.eventType;
      const info = this.extractEventInfo(payload.event);
      const flushNow = this.shouldFlushPersistImmediately(eventType, payload.event);
      if (info.role === 'user') {
        if (flushNow) {
          void this.flushPersistQueue(true);
        }
        return;
      }

      if (eventType === 'command.executed' && !this.shouldPersistCommandEvent(info.properties)) {
        return;
      }
      if (eventType.startsWith('pty.') && !asText(info.properties.data) && !asText(info.properties.text)) {
        return;
      }
      if (eventType.startsWith('file.') || eventType === 'session.diff') {
        // always persist
      } else if (
        eventType !== 'message.final' &&
        eventType !== 'message.part.updated' &&
        eventType !== 'message.part.delta' &&
        eventType !== 'command.executed'
      ) {
        if (flushNow) {
          void this.flushPersistQueue(true);
        }
        return;
      }

      if ((eventType === 'message.part.updated' || eventType === 'message.part.delta') && info.partType === 'tool') {
        if (!this.shouldPersistToolEvent(info)) {
          return;
        }
      }

      // 处理文本流：计算 delta 并在重置时追加上一段文本，避免刷新丢失。
      if (eventType === 'message.part.updated' || eventType === 'message.part.delta') {
        const properties = (payload.event.properties && typeof payload.event.properties === 'object')
          ? payload.event.properties as Record<string, unknown>
          : {};
        const part = (properties.part && typeof properties.part === 'object')
          ? properties.part as Record<string, unknown>
          : {};
        const partType = ((part.type as string) || (properties.type as string) || '').toLowerCase();
        if (!partType || partType === 'text') {
          // 文本流由 opencode-remote-service 统一聚合为 message.final，
          // 这里不再落盘 text delta，避免用户回声与乱序拼接污染历史。
          return;
        }
      }

      const content = this.summarizeEventForHistory(payload.eventType, payload.event);
      if (!content) {
        const stillPersist =
          eventType === 'session.diff' ||
          eventType.startsWith('file.') ||
          eventType.startsWith('pty.') ||
          eventType === 'command.executed';
        if (!stillPersist) {
          if (flushNow) {
            void this.flushPersistQueue(true);
          }
          return;
        }
      }
      this.persistQueue.push({
        sessionId: binding.sessionId,
        role: 'agent',
        messageType: 'opencode_event',
        content,
        metadata,
        createdAt,
      });
      this.schedulePersistFlush();
      if (flushNow) {
        void this.flushPersistQueue(true);
      }
    })().catch((error) => {
      console.warn('[OPENCODE_EVENT_PERSIST_ENQUEUE_FAILED]', error);
    });
  }

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
                const payloadRecord =
                  message.payload && typeof message.payload === 'object'
                    ? (message.payload as Record<string, unknown>)
                    : {};
                const opencodeSessionId = asText(payloadRecord.opencodeSessionId).trim() || undefined;
                const eventRecord =
                  payloadRecord.event && typeof payloadRecord.event === 'object'
                    ? (payloadRecord.event as Record<string, unknown>)
                    : (normalized as Record<string, unknown>);
                const fastEvent = this.applyStreamDelta(
                  input.orchestratorSessionId,
                  opencodeSessionId,
                  eventRecord
                );
                const fastPayload = {
                  opencodeSessionId,
                  eventType: asText(payloadRecord.eventType) || 'unknown',
                  event: fastEvent,
                  seq: Number(payloadRecord.seq || 0),
                  timestamp: Number(payloadRecord.timestamp || Date.now()),
                };
                void touchSandbox(input.orchestratorSessionId, 'opencode_sse_event');
                void sessionConnectorService.noteUsageFromEvent(
                  input.orchestratorSessionId,
                  fastEvent
                );
                this.emitFast(input.orchestratorSessionId, fastPayload);
                this.enqueuePersist(input.orchestratorSessionId, fastPayload);
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
    await this.flushPersistQueue(true);
  }
}

export const opencodeEventStreamService = new OpencodeEventStreamService();
