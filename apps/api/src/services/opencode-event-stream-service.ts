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

function asTrimmedText(value: unknown): string {
  return asText(value).trim();
}

function normalizeEventPath(value: unknown): string {
  const text = asTrimmedText(value);
  if (!text) return '';
  return text.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function isInternalWorkspacePath(path: string): boolean {
  const normalized = normalizeEventPath(path).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('/.opencode/') ||
    normalized.includes('/.git/') ||
    normalized.includes('/node_modules/')
  );
}

function pickEventPathPreview(event: Record<string, unknown>): string[] {
  const properties =
    event.properties && typeof event.properties === 'object'
      ? (event.properties as Record<string, unknown>)
      : {};
  const rawPaths = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeEventPath(value);
    if (normalized) {
      rawPaths.add(normalized);
    }
  };

  push(event.directory);
  push(properties.path);
  push(properties.file);
  push(properties.target);
  push(properties.cwd);

  const part =
    properties.part && typeof properties.part === 'object'
      ? (properties.part as Record<string, unknown>)
      : {};
  push(part.path);
  push(part.file);

  const diff = Array.isArray(properties.diff) ? properties.diff : [];
  for (const item of diff) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    push(record.path);
    push(record.file);
    push(record.oldPath);
    push(record.newPath);
  }

  return Array.from(rawPaths);
}

function buildSessionDiffPreview(event: Record<string, unknown>): Record<string, unknown> | null {
  const properties =
    event.properties && typeof event.properties === 'object'
      ? (event.properties as Record<string, unknown>)
      : {};
  const diff = Array.isArray(properties.diff) ? properties.diff : [];
  if (diff.length === 0) return null;

  const preview = diff
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const path =
        normalizeEventPath(record.path) ||
        normalizeEventPath(record.file) ||
        normalizeEventPath(record.newPath) ||
        normalizeEventPath(record.oldPath);
      if (!path || isInternalWorkspacePath(path)) {
        return null;
      }
      return {
        path,
        type: asTrimmedText(record.type) || asTrimmedText(record.status) || 'updated',
      };
    })
    .filter((item): item is { path: string; type: string } => Boolean(item))
    .slice(0, 20);

  return {
    diffCount: diff.length,
    files: preview,
  };
}

function projectEventForTransport(eventType: string, event: Record<string, unknown>): Record<string, unknown> {
  const properties =
    event.properties && typeof event.properties === 'object'
      ? (event.properties as Record<string, unknown>)
      : {};
  const part =
    properties.part && typeof properties.part === 'object'
      ? (properties.part as Record<string, unknown>)
      : {};

  const projected: Record<string, unknown> = {
    type: eventType || asTrimmedText(event.type) || 'unknown',
  };

  const directory = normalizeEventPath(event.directory);
  if (directory) {
    projected.directory = directory;
  }

  if (eventType === 'session.diff') {
    const diffPreview = buildSessionDiffPreview(event);
    projected.properties = diffPreview ? diffPreview : {};
    return projected;
  }

  const nextProperties: Record<string, unknown> = {};
  const role = asTrimmedText(properties.role);
  if (role) nextProperties.role = role;
  const state = asTrimmedText(properties.state) || asTrimmedText(properties.status);
  if (state) nextProperties.state = state;
  const path = normalizeEventPath(properties.path) || normalizeEventPath(properties.file);
  if (path) nextProperties.path = path;
  const command = asTrimmedText(properties.command) || asTrimmedText(properties.name);
  if (command) nextProperties.command = command;
  const text = asTrimmedText(properties.text) || asTrimmedText(properties.message);
  if (text) nextProperties.text = text.slice(0, 500);

  if (Object.keys(part).length > 0) {
    const projectedPart: Record<string, unknown> = {};
    const partId = asTrimmedText(part.id) || asTrimmedText(properties.partId);
    if (partId) projectedPart.id = partId;
    const partType = asTrimmedText(part.type) || asTrimmedText(properties.type);
    if (partType) projectedPart.type = partType;
    const partTool = asTrimmedText(part.tool) || asTrimmedText(part.name);
    if (partTool) projectedPart.tool = partTool;
    const partPath = normalizeEventPath(part.path) || normalizeEventPath(part.file);
    if (partPath) projectedPart.path = partPath;
    const partText = asTrimmedText(part.text) || asTrimmedText(part.content);
    if (partText) projectedPart.text = partText.slice(0, 500);
    if (Object.keys(projectedPart).length > 0) {
      nextProperties.part = projectedPart;
    }
  }

  if (Object.keys(nextProperties).length > 0) {
    projected.properties = nextProperties;
  }
  return projected;
}

function shouldSkipInternalWorkspaceEvent(eventType: string, event: Record<string, unknown>): boolean {
  const lowerType = asTrimmedText(eventType || event.type).toLowerCase();
  const paths = pickEventPathPreview(event);
  if (paths.length === 0) {
    return false;
  }
  const nonInternalPaths = paths.filter((path) => !isInternalWorkspacePath(path));
  if (nonInternalPaths.length > 0) {
    return false;
  }
  return (
    lowerType === 'session.diff' ||
    lowerType.startsWith('file.') ||
    lowerType.startsWith('message.part.') ||
    lowerType === 'command.executed'
  );
}

function asFinitePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function buildSessionEventSeq(seq: unknown, timestamp: unknown): number | undefined {
  const ts = asFinitePositiveNumber(timestamp);
  const seqNum = asFinitePositiveNumber(seq);
  if (ts !== null) {
    const tsInt = Math.floor(ts);
    const tail = seqNum !== null ? Math.floor(seqNum) % 1000 : 0;
    const combined = tsInt * 1000 + tail;
    if (Number.isSafeInteger(combined) && combined > 0) {
      return combined;
    }
    return tsInt > 0 ? tsInt : undefined;
  }
  if (seqNum !== null) {
    return Math.floor(seqNum);
  }
  return undefined;
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
  sessionEventSeq?: number;
}) => void;

type ProjectedEventPayload = {
  content: string;
  metadata: Record<string, unknown>;
};

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
  private persistChains = new Map<string, Promise<void>>();
  private memoryPersistChains = new Map<string, Promise<void>>();

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
    sessionEventSeq?: number;
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
          sessionEventSeq: payload.sessionEventSeq,
        });
      } catch (error) {
        console.warn('[OPENCODE_EVENT_FAST_LISTENER_ERROR]', error);
      }
    }
  }

  projectForClient(input: {
    orchestratorSessionId: string;
    opencodeSessionId?: string;
    eventType: string;
    event: Record<string, unknown>;
    seq: number;
    timestamp: number;
    sessionEventSeq?: number;
  }): {
    type: 'opencode_event';
    content: string;
    metadata: Record<string, unknown>;
  } {
    const projected = this.buildProjectedEventPayload({
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId,
      eventType: input.eventType,
      event: input.event,
      seq: input.seq,
      timestamp: input.timestamp,
      sessionEventSeq: input.sessionEventSeq,
    });
    return {
      type: 'opencode_event',
      content: projected.content,
      metadata: projected.metadata,
    };
  }

  private compactText(value: string, maxLen: number = 320): string {
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...`;
  }

  private extractStreamContentForDisplay(eventType: string, event: Record<string, unknown>) {
    if (eventType !== 'message.part.delta' && eventType !== 'message.part.updated') {
      return null;
    }
    const properties =
      event.properties && typeof event.properties === 'object'
        ? (event.properties as Record<string, unknown>)
        : {};
    const part =
      properties.part && typeof properties.part === 'object'
        ? (properties.part as Record<string, unknown>)
        : {};
    const partType = (asTrimmedText(part.type) || asTrimmedText(properties.type)).toLowerCase();
    if (partType && partType !== 'text') {
      return null;
    }
    const delta = asTrimmedText(properties.delta);
    const text =
      asTrimmedText(part.text) || asTrimmedText(part.content) || asTrimmedText(properties.text);
    if (!delta && !text) return null;
    const partId = asTrimmedText(part.id) || asTrimmedText(part.callID) || asTrimmedText(properties.partId);
    return {
      text: delta || text,
      partId,
      isDelta: Boolean(delta),
    };
  }

  private summarizeEventForDisplay(eventType: string, event: Record<string, unknown>): string {
    const properties =
      event.properties && typeof event.properties === 'object'
        ? (event.properties as Record<string, unknown>)
        : {};
    const part =
      properties.part && typeof properties.part === 'object'
        ? (properties.part as Record<string, unknown>)
        : {};
    const partType = (asTrimmedText(part.type) || asTrimmedText(properties.type)).toLowerCase();
    const toolName =
      asTrimmedText(part.tool) ||
      asTrimmedText(part.name) ||
      asTrimmedText(properties.tool) ||
      asTrimmedText(properties.name);

    if (eventType === 'message.updated') {
      const info =
        properties.info && typeof properties.info === 'object'
          ? (properties.info as Record<string, unknown>)
          : {};
      const state =
        asTrimmedText(info.state) ||
        asTrimmedText(info.status) ||
        asTrimmedText(properties.state) ||
        asTrimmedText(properties.status);
      const role = asTrimmedText(info.role) || asTrimmedText(properties.role);
      if (state || role) {
        return `[Message] ${[role, state].filter(Boolean).join(' · ')}`;
      }
    }

    if (eventType === 'message.part.updated' || eventType === 'message.part.delta') {
      const partState =
        part.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : {};
      const partStatus = asTrimmedText(partState.state) || asTrimmedText(partState.status);
      if (partType === 'tool') {
        const summary = asTrimmedText(part.summary) || asTrimmedText(properties.summary);
        const suffix = summary || partStatus;
        const label = toolName || 'tool';
        return suffix ? `[Tool] ${label} · ${suffix}` : `[Tool] ${label}`;
      }
      if (partType === 'text') {
        const text =
          asTrimmedText(part.text) ||
          asTrimmedText(part.content) ||
          asTrimmedText(properties.text);
        if (text) return this.compactText(text, 320);
        return partStatus ? `[Text] ${partStatus}` : '[Text] updated';
      }
      if (partType === 'file') {
        const filePath = asTrimmedText(part.path) || asTrimmedText(properties.path);
        return filePath ? `[File] ${filePath}` : '[File] updated';
      }
    }

    if (eventType === 'command.executed') {
      const name = asTrimmedText(properties.name) || asTrimmedText(properties.command);
      const args = asTrimmedText(properties.arguments);
      const output = this.compactText(asTrimmedText(properties.output), 140);
      const command = [name, args].filter(Boolean).join(' ');
      if (command && output) return `[Command] ${command} -> ${output}`;
      return command ? `[Command] ${command}` : '[Command] executed';
    }

    if (eventType === 'file.edited') {
      const path = asTrimmedText(properties.file) || asTrimmedText(properties.path);
      return path ? `[File] edited ${path}` : '[File] edited';
    }

    if (eventType.startsWith('pty.')) {
      const command = asTrimmedText(properties.command);
      const cwd = asTrimmedText(properties.cwd);
      const exitCode = asTrimmedText(properties.exitCode);
      const suffix = [command, cwd ? `cwd=${cwd}` : '', exitCode ? `exit=${exitCode}` : '']
        .filter(Boolean)
        .join(' · ');
      return suffix ? `[PTY] ${suffix}` : `[PTY] ${eventType}`;
    }

    const fallback =
      asTrimmedText(properties.text) ||
      asTrimmedText(properties.message) ||
      asTrimmedText(part.text) ||
      asTrimmedText(part.content);
    if (fallback) return this.compactText(fallback, 320);
    return '';
  }

  private buildProjectedEventPayload(input: {
    orchestratorSessionId: string;
    opencodeSessionId?: string;
    eventType: string;
    event: Record<string, unknown>;
    seq: number;
    timestamp: number;
    sessionEventSeq?: number;
  }): ProjectedEventPayload {
    const hasValidInputSeq =
      typeof input.sessionEventSeq === 'number' &&
      Number.isFinite(input.sessionEventSeq) &&
      input.sessionEventSeq > 0;
    const sessionEventSeq = hasValidInputSeq
      ? input.sessionEventSeq
      : buildSessionEventSeq(input.seq, input.timestamp);
    const projectedEvent = projectEventForTransport(input.eventType, input.event);
    const metadata: Record<string, unknown> = {
      orchestratorSessionId: input.orchestratorSessionId,
      opencodeSessionId: input.opencodeSessionId || undefined,
      eventType: input.eventType,
      seq: input.seq,
      timestamp: input.timestamp,
      ...(typeof sessionEventSeq === 'number' ? { sessionEventSeq } : {}),
      event: projectedEvent,
      rawPayload: { eventType: input.eventType, event: projectedEvent },
    };

    const stream = this.extractStreamContentForDisplay(input.eventType, input.event);
    if (stream) {
      metadata.stream = true;
      metadata.streamDelta = stream.isDelta === true;
      if (stream.partId) {
        metadata.partId = stream.partId;
      }
      return {
        content: stream.text,
        metadata,
      };
    }

    return {
      content: this.summarizeEventForDisplay(input.eventType, input.event),
      metadata,
    };
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
    if (this.persistQueue.length === 0) {
      if (this.persistTimer) {
        clearInterval(this.persistTimer);
        this.persistTimer = null;
      }
      return;
    }
    const run = async () => {
      if (this.persistQueue.length === 0) return;
      const batch = this.persistQueue.splice(0, this.persistQueue.length);
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
    };

    this.persistFlushInProgress = this.persistFlushInProgress.then(run, run);
    await this.persistFlushInProgress;
    if (this.persistQueue.length === 0 && this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
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

  private shouldPersistAtomicImmediately(
    eventType: string,
    info: { partType: string }
  ): boolean {
    if (eventType.startsWith('file.')) return true;
    if (eventType.startsWith('pty.')) return true;
    if (eventType === 'command.executed' || eventType === 'session.diff') return true;
    if ((eventType === 'message.part.updated' || eventType === 'message.part.delta') && info.partType && info.partType !== 'text') {
      return true;
    }
    return false;
  }

  private async enqueueMemoryPersist(entry: PersistEntry): Promise<void> {
    const run = async () => {
      await taskCreationFileMemoryStore.addMessagesBatch(entry.sessionId, [
        {
          role: entry.role,
          messageType: entry.messageType,
          content: entry.content,
          metadata: entry.metadata,
          createdAt: entry.createdAt,
        },
      ]);
    };

    const previous = this.memoryPersistChains.get(entry.sessionId) || Promise.resolve();
    const next = previous.then(run, run).catch((error) => {
      console.warn('[OPENCODE_EVENT_PERSIST_MEMORY_FAILED]', entry.sessionId, error);
    });
    this.memoryPersistChains.set(entry.sessionId, next);
    await next.finally(() => {
      if (this.memoryPersistChains.get(entry.sessionId) === next) {
        this.memoryPersistChains.delete(entry.sessionId);
      }
    });
  }

  private getCachedBinding(orchestratorSessionId: string): SessionBinding | null {
    const cached = this.sessionBindings.get(orchestratorSessionId);
    if (!cached) return null;
    if (Date.now() - cached.updatedAt >= this.sessionBindingTtlMs) {
      return null;
    }
    return cached;
  }

  private shouldPersistEventRecord(
    eventType: string,
    info: { partType: string },
    content: string
  ): boolean {
    const lowerEventType = String(eventType || '').trim().toLowerCase();
    const lowerPartType = String(info.partType || '').trim().toLowerCase();

    // 文本消息的正式持久化由 opencode-remote-service 的 final aggregate 负责。
    // 这里不再把 SSE 过程态事件写入正式消息存储，避免 recent/history 被 delta、message.updated、
    // reasoning/step-start 等临时片段污染。
    if (lowerEventType === 'message.updated') return false;
    if (lowerEventType === 'message.final' || lowerEventType === 'message.completed' || lowerEventType === 'message.done') {
      return false;
    }
    if (lowerEventType === 'message.part.updated' || lowerEventType === 'message.part.delta') {
      if (lowerPartType === 'tool' || lowerPartType === 'file') {
        return Boolean(content);
      }
      return false;
    }

    if (content) return true;
    if (eventType.startsWith('file.')) return true;
    if (eventType.startsWith('pty.')) return true;
    if (eventType === 'command.executed') return true;
    if (eventType === 'session.diff' || eventType === 'session.idle' || eventType === 'session.error') {
      return true;
    }
    if ((eventType === 'message.part.updated' || eventType === 'message.part.delta') && info.partType && info.partType !== 'text') {
      return true;
    }
    return false;
  }

  private async enqueuePersist(orchestratorSessionId: string, payload: {
    opencodeSessionId?: string;
    eventType: string;
    event: Record<string, unknown>;
    seq: number;
    timestamp: number;
  }): Promise<void> {
    const run = async () => {
      const binding = this.getCachedBinding(orchestratorSessionId) || await this.resolveBoundSession(orchestratorSessionId);
      if (!binding || binding.mode !== 'sandbox') return;
      const eventType = payload.eventType;
      if (shouldSkipInternalWorkspaceEvent(eventType, payload.event)) {
        return;
      }
      const info = this.extractEventInfo(payload.event);
      if (info.role === 'user') {
        return;
      }

      if (eventType === 'command.executed' && !this.shouldPersistCommandEvent(info.properties)) {
        return;
      }
      if (eventType.startsWith('pty.') &&
        !asTrimmedText(info.properties.data) &&
        !asTrimmedText(info.properties.text) &&
        !asTrimmedText(info.properties.command) &&
        !asTrimmedText(info.properties.exitCode)
      ) {
        return;
      }

      if ((eventType === 'message.part.updated' || eventType === 'message.part.delta') && info.partType === 'tool') {
        if (!this.shouldPersistToolEvent(info)) {
          return;
        }
      }

      const projected = this.buildProjectedEventPayload({
        orchestratorSessionId,
        opencodeSessionId: payload.opencodeSessionId,
        eventType,
        event: payload.event,
        seq: payload.seq,
        timestamp: payload.timestamp,
      });
      const content = projected.content;
      if (!this.shouldPersistEventRecord(eventType, info, content)) {
        const flushNow = this.shouldFlushPersistImmediately(eventType, payload.event);
        if (flushNow) {
          await this.flushPersistQueue(true);
        }
        return;
      }

      const createdAt = new Date(payload.timestamp || Date.now()).toISOString();
      const persistEntry: PersistEntry = {
        sessionId: binding.sessionId,
        role: 'agent',
        messageType: 'opencode_event',
        content,
        metadata: projected.metadata,
        createdAt,
      };

      await this.enqueueMemoryPersist(persistEntry);
      this.persistQueue.push(persistEntry);

      const flushNow = this.shouldFlushPersistImmediately(eventType, payload.event);
      const flushImmediately = flushNow || this.shouldPersistAtomicImmediately(eventType, info);
      if (flushImmediately) {
        await this.flushPersistQueue(true);
      } else {
        this.schedulePersistFlush();
      }
    };

    const previous = this.persistChains.get(orchestratorSessionId) || Promise.resolve();
    const next = previous.then(run, run).catch((error) => {
      console.warn('[OPENCODE_EVENT_PERSIST_ENQUEUE_FAILED]', error);
    });
    this.persistChains.set(orchestratorSessionId, next);
    await next.finally(() => {
      if (this.persistChains.get(orchestratorSessionId) === next) {
        this.persistChains.delete(orchestratorSessionId);
      }
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
              onEvent: async (event) => {
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
                  sessionEventSeq: buildSessionEventSeq(payloadRecord.seq, payloadRecord.timestamp),
                };
                void touchSandbox(input.orchestratorSessionId, 'opencode_sse_event');
                void sessionConnectorService.noteUsageFromEvent(
                  input.orchestratorSessionId,
                  fastEvent
                );
                await this.enqueuePersist(input.orchestratorSessionId, fastPayload);
                this.emitFast(input.orchestratorSessionId, fastPayload);
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
