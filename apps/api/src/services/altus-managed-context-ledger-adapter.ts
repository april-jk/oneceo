import { createHash } from 'node:crypto';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../db/dao';
import { asText, pickObject, toIso } from './altus-managed-shared';

export type ManagedContextLedgerEntryKind =
  | 'user_message'
  | 'assistant_message'
  | 'assistant_tool_use'
  | 'tool_result'
  | 'clarification_request'
  | 'clarification_answer'
  | 'attachment_ref'
  | 'skill_selection'
  | 'state_transition'
  | 'status_projection'
  | 'mcp_provider_snapshot';

export type ManagedContextLedgerEntrySource = 'message' | 'run_event' | 'snapshot' | 'recovery';

export type ManagedContextLedgerEntry = {
  id: string;
  sessionId: string;
  runId?: string | null;
  kind: ManagedContextLedgerEntryKind;
  source: ManagedContextLedgerEntrySource;
  sourceId: string;
  sequence: number;
  createdAt: string | null;
  role?: string | null;
  content?: string | null;
  messageType?: string | null;
  toolUseId?: string | null;
  toolName?: string | null;
  arguments?: Record<string, unknown> | null;
  result?: unknown;
  status?: 'pending' | 'ok' | 'error' | null;
  metadata?: Record<string, unknown>;
};

export type ManagedContextLedgerView = {
  sessionId: string;
  runId?: string | null;
  ledgerCursor: string;
  sourceHash: string;
  entries: ManagedContextLedgerEntry[];
};

type ConversationMessageRecord = {
  id?: string | null;
  sessionId?: string | null;
  role?: string | null;
  content?: string | null;
  messageType?: string | null;
  metadata?: unknown;
  messageKey?: string | null;
  timelineCursor?: number | null;
  createdAt?: unknown;
};

type RunEventRecord = {
  id?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  eventType?: string | null;
  sequence?: number | null;
  payloadJson?: unknown;
  createdAt?: unknown;
};

type LedgerAdapterDeps = {
  getMessages?: (sessionId: string) => Promise<ConversationMessageRecord[]>;
  getRun?: (runId: string) => Promise<{ id: string; sessionId: string } | null>;
  listRunEvents?: (runId: string) => Promise<RunEventRecord[]>;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeToolArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return pickObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  const picked = pickObject(value);
  return Object.keys(picked).length > 0 ? picked : null;
}

function normalizeEventPayload(event: RunEventRecord) {
  return pickObject(event.payloadJson);
}

export class AltusManagedContextLedgerAdapter {
  constructor(private readonly deps: LedgerAdapterDeps = {}) {}

  async buildForSession(input: { sessionId: string; runId?: string | null }): Promise<ManagedContextLedgerView> {
    const sessionId = asText(input.sessionId);
    if (!sessionId) {
      throw new Error('sessionId 不能为空');
    }
    const messages = await (this.deps.getMessages || taskCreationSessionDAO.getMessages.bind(taskCreationSessionDAO))(
      sessionId
    );
    let runEvents: RunEventRecord[] = [];
    const runId = asText(input.runId);
    if (runId) {
      const getRun = this.deps.getRun || taskSessionRunDAO.getRun.bind(taskSessionRunDAO);
      const run = await getRun(runId);
      if (!run || run.sessionId !== sessionId) {
        throw new Error('managed run 不存在或不属于当前会话');
      }
      runEvents = await (this.deps.listRunEvents || taskSessionRunDAO.listRunEvents.bind(taskSessionRunDAO))(runId);
    }
    return this.buildFromRecords({ sessionId, runId: runId || null, messages, runEvents });
  }

  buildFromRecords(input: {
    sessionId: string;
    runId?: string | null;
    messages?: ConversationMessageRecord[];
    runEvents?: RunEventRecord[];
  }): ManagedContextLedgerView {
    const sessionId = asText(input.sessionId);
    const entries: ManagedContextLedgerEntry[] = [];

    for (const [index, message] of (input.messages || []).entries()) {
      entries.push(...this.messageToEntries(sessionId, message, index));
    }
    for (const event of input.runEvents || []) {
      const entry = this.runEventToEntry(sessionId, input.runId || null, event);
      if (entry) {
        entries.push(entry);
      }
    }

    const ordered = entries.sort((left, right) => {
      if (left.createdAt && right.createdAt && left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left.sequence - right.sequence || left.id.localeCompare(right.id);
    });

    const cursor = this.buildLedgerCursor(input.messages || [], input.runEvents || []);
    return {
      sessionId,
      runId: input.runId || null,
      ledgerCursor: cursor,
      sourceHash: hashJson({
        sessionId,
        runId: input.runId || null,
        cursor,
        entries: ordered.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          sourceId: entry.sourceId,
          sequence: entry.sequence,
          createdAt: entry.createdAt,
          toolUseId: entry.toolUseId,
          toolName: entry.toolName,
          status: entry.status,
        })),
      }),
      entries: ordered,
    };
  }

  private messageToEntries(
    sessionId: string,
    message: ConversationMessageRecord,
    index: number
  ): ManagedContextLedgerEntry[] {
    const metadata = pickObject(message.metadata);
    const sourceId = asText(message.messageKey) || asText(message.id) || `message:${index}`;
    const base = {
      sessionId,
      runId: asText(metadata.runId) || null,
      source: 'message' as const,
      sourceId,
      sequence: Number(message.timelineCursor || 0) || index + 1,
      createdAt: toIso(message.createdAt),
      role: asText(message.role) || null,
      content: typeof message.content === 'string' ? message.content : null,
      messageType: asText(message.messageType) || null,
      metadata,
    };
    const kind = this.resolveMessageKind(message, metadata);
    const entries: ManagedContextLedgerEntry[] = [
      {
        ...base,
        id: `message:${sourceId}`,
        kind,
        status: null,
      },
    ];

    if (Array.isArray(metadata.attachments) && metadata.attachments.length > 0) {
      entries.push({
        ...base,
        id: `message:${sourceId}:attachments`,
        kind: 'attachment_ref',
        result: metadata.attachments,
      });
    }
    if (Array.isArray(metadata.skills) && metadata.skills.length > 0) {
      entries.push({
        ...base,
        id: `message:${sourceId}:skills`,
        kind: 'skill_selection',
        result: metadata.skills,
      });
    }
    return entries;
  }

  private resolveMessageKind(
    message: ConversationMessageRecord,
    metadata: Record<string, unknown>
  ): ManagedContextLedgerEntryKind {
    const messageType = asText(message.messageType);
    if (messageType === 'clarification_request') return 'clarification_request';
    if (messageType === 'clarification_answer' || metadata.clarificationAnswer === true) {
      return 'clarification_answer';
    }
    if (messageType === 'managed_status' || messageType === 'opencode_event') return 'status_projection';
    const role = asText(message.role);
    if (role === 'user') return 'user_message';
    if (role === 'assistant' || role === 'agent') return 'assistant_message';
    if (asText(metadata.toolCallId)) return 'status_projection';
    return 'state_transition';
  }

  private runEventToEntry(
    sessionId: string,
    runId: string | null,
    event: RunEventRecord
  ): ManagedContextLedgerEntry | null {
    const payload = normalizeEventPayload(event);
    const eventType = asText(event.eventType);
    const sequence = Number(event.sequence || 0);
    const sourceId = asText(event.id) || `${eventType}:${sequence}`;
    const toolUseId = asText(payload.toolCallId) || asText(payload.toolUseId) || asText(payload.id) || null;
    const toolName = asText(payload.toolName) || asText(payload.name) || null;
    const base = {
      id: `run_event:${sourceId}`,
      sessionId,
      runId: asText(event.runId) || runId,
      source: 'run_event' as const,
      sourceId,
      sequence: 1_000_000 + sequence,
      createdAt: toIso(event.createdAt),
      metadata: payload,
    };

    if (eventType === 'tool_call_started') {
      return {
        ...base,
        kind: 'assistant_tool_use',
        toolUseId,
        toolName,
        arguments: normalizeToolArguments(payload.arguments),
        status: 'pending',
      };
    }
    if (eventType === 'tool_call_completed') {
      const toolResultEnvelope = pickObject(payload.toolResultEnvelope);
      return {
        ...base,
        kind: 'tool_result',
        toolUseId,
        toolName,
        result: Object.keys(toolResultEnvelope).length > 0 ? toolResultEnvelope : payload.result ?? payload.output ?? payload,
        status: 'ok',
      };
    }
    if (eventType === 'clarification_answered') {
      return {
        ...base,
        kind: 'clarification_answer',
        toolUseId,
        toolName,
        content: asText(payload.answer) || asText(payload.content) || null,
        result: payload,
        status: 'ok',
      };
    }
    if (eventType === 'tool_call_failed') {
      const toolResultEnvelope = pickObject(payload.toolResultEnvelope);
      return {
        ...base,
        kind: 'tool_result',
        toolUseId,
        toolName,
        result: Object.keys(toolResultEnvelope).length > 0 ? toolResultEnvelope : payload.error || payload,
        status: 'error',
      };
    }
    if (eventType === 'clarification_requested') {
      return {
        ...base,
        kind: 'clarification_request',
        content: asText(payload.question) || null,
        status: 'pending',
      };
    }
    if (eventType === 'mcp_provider_snapshot') {
      return {
        ...base,
        kind: 'mcp_provider_snapshot',
        result: payload,
        status: null,
      };
    }
    if (eventType) {
      return {
        ...base,
        kind: 'state_transition',
        status: null,
      };
    }
    return null;
  }

  private buildLedgerCursor(messages: ConversationMessageRecord[], runEvents: RunEventRecord[]) {
    const lastMessage = messages[messages.length - 1];
    const lastEvent = runEvents[runEvents.length - 1];
    return [
      `messages:${messages.length}:${asText(lastMessage?.messageKey) || asText(lastMessage?.id) || 'none'}`,
      `events:${runEvents.length}:${Number(lastEvent?.sequence || 0)}`,
    ].join('|');
  }
}

export const altusManagedContextLedgerAdapter = new AltusManagedContextLedgerAdapter();
