type HistoryMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  messageType: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type RecoveryContext = {
  taskSessionId: string;
  orchestratorSessionId: string;
  opencodeSessionId: string;
  workspacePath: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizePath(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  return text.replace(/\\/g, '/').replace(/\/+$/, '');
}

function resolveMessageTimestamp(record: Record<string, unknown>): number {
  const info = toRecord(record.info);
  const time = toRecord(info.time);
  const candidates = [
    time.created,
    time.updated,
    record.createdAt,
    record.updatedAt,
    record.timestamp,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      const asDate = Date.parse(candidate);
      if (Number.isFinite(asDate)) {
        return asDate;
      }
    }
  }

  return Date.now();
}

function resolveSessionId(record: Record<string, unknown>): string {
  const info = toRecord(record.info);
  return (
    asText(record.id) ||
    asText(record.sessionID) ||
    asText(record.sessionId) ||
    asText(info.id) ||
    asText(info.sessionID) ||
    asText(info.sessionId)
  );
}

function resolveSessionWorkspace(record: Record<string, unknown>): string {
  const info = toRecord(record.info);
  const path = toRecord(record.path);
  const infoPath = toRecord(info.path);
  return (
    normalizePath(record.directory) ||
    normalizePath(record.workspacePath) ||
    normalizePath(path.root) ||
    normalizePath(path.cwd) ||
    normalizePath(infoPath.root) ||
    normalizePath(infoPath.cwd)
  );
}

function buildToolSummary(part: Record<string, unknown>): string {
  const toolName =
    asText(part.tool) ||
    asText(part.name) ||
    asText(toRecord(part.call).name) ||
    'tool';
  const state = toRecord(part.state);
  const status =
    asText(state.status) ||
    asText(state.state) ||
    asText(part.status);
  return status ? `[Tool] ${toolName} · ${status}` : `[Tool] ${toolName}`;
}

function buildToolMetadata(part: Record<string, unknown>, context: RecoveryContext) {
  const toolName =
    asText(part.tool) ||
    asText(part.name) ||
    asText(toRecord(part.call).name) ||
    'tool';
  return {
    orchestratorSessionId: context.orchestratorSessionId,
    opencodeSessionId: context.opencodeSessionId,
    workspacePath: context.workspacePath,
    source: 'opencode_native_history',
    eventType: 'message.part.updated',
    rawPayload: {
      eventType: 'message.part.updated',
      event: {
        type: 'message.part.updated',
        directory: context.workspacePath,
        properties: {
          part: {
            id: asText(part.id) || undefined,
            type: 'tool',
            tool: toolName,
            name: toolName,
            state: toRecord(part.state),
          },
        },
      },
    },
  } satisfies Record<string, unknown>;
}

function buildAssistantTextMetadata(partId: string | undefined, context: RecoveryContext) {
  return {
    orchestratorSessionId: context.orchestratorSessionId,
    opencodeSessionId: context.opencodeSessionId,
    workspacePath: context.workspacePath,
    source: 'opencode_native_history',
    eventType: 'message.final',
    rawPayload: {
      eventType: 'message.final',
      event: {
        type: 'message.final',
        directory: context.workspacePath,
        properties: {
          part: {
            id: partId || undefined,
            type: 'text',
          },
        },
      },
    },
  } satisfies Record<string, unknown>;
}

export function pickRecoveredOpencodeSessionId(
  sessions: unknown[],
  workspacePath: string,
  preferredSessionId?: string
): string | null {
  const normalizedWorkspace = normalizePath(workspacePath);
  const preferred = asText(preferredSessionId);
  const records = sessions
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>);

  if (preferred) {
    const preferredHit = records.find((record) => resolveSessionId(record) === preferred);
    if (preferredHit) {
      return preferred;
    }
  }

  const matched = records
    .map((record) => ({
      id: resolveSessionId(record),
      workspace: resolveSessionWorkspace(record),
      timestamp: resolveMessageTimestamp(record),
    }))
    .filter((item) => item.id && (!normalizedWorkspace || item.workspace === normalizedWorkspace))
    .sort((left, right) => right.timestamp - left.timestamp);

  return matched[0]?.id || null;
}

export function normalizeOpencodeNativeMessages(
  messages: unknown[],
  context: RecoveryContext
): HistoryMessage[] {
  const result: HistoryMessage[] = [];

  const push = (
    role: HistoryMessage['role'],
    messageType: string,
    content: string,
    createdAtMs: number,
    sequence: number,
    metadata?: Record<string, unknown>,
    idSuffix?: string
  ) => {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) return;
    result.push({
      id: `${context.opencodeSessionId}:${createdAtMs}:${sequence}${idSuffix ? `:${idSuffix}` : ''}`,
      role,
      messageType,
      content: normalizedContent,
      metadata: {
        ...(metadata || {}),
        timestamp: createdAtMs,
        sessionEventSeq: createdAtMs * 1000 + sequence,
      },
      createdAt: new Date(createdAtMs).toISOString(),
    });
  };

  messages
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>)
    .sort((left, right) => resolveMessageTimestamp(left) - resolveMessageTimestamp(right))
    .forEach((record) => {
      const info = toRecord(record.info);
      const role = (asText(info.role) || asText(record.role)).toLowerCase();
      const createdAtMs = resolveMessageTimestamp(record);
      const parts = Array.isArray(record.parts) ? record.parts : [];
      let sequence = 0;

      if (role === 'user') {
        const userText = parts
          .filter((part) => toRecord(part).type === 'text')
          .map((part) => asText(toRecord(part).text) || asText(toRecord(part).content))
          .filter(Boolean)
          .join('\n\n') || asText(record.content);

        push(
          'user',
          'opencode_user_input',
          userText,
          createdAtMs,
          sequence++,
          {
            orchestratorSessionId: context.orchestratorSessionId,
            opencodeSessionId: context.opencodeSessionId,
            workspacePath: context.workspacePath,
            source: 'opencode_native_history',
          },
          asText(info.id) || asText(record.id) || 'user'
        );
        return;
      }

      if (role !== 'assistant') {
        return;
      }

      const textParts: string[] = [];
      let textPartId = '';
      for (const rawPart of parts) {
        const part = toRecord(rawPart);
        const partType = asText(part.type).toLowerCase();
        if (partType === 'tool' || partType === 'tool-call' || partType === 'tool_call') {
          push(
            'agent',
            'opencode_event',
            buildToolSummary(part),
            createdAtMs,
            sequence++,
            buildToolMetadata(part, context),
            asText(part.id) || asText(part.callID) || 'tool'
          );
          continue;
        }
        if (partType === 'text') {
          const text = asText(part.text) || asText(part.content);
          if (text) {
            textParts.push(text);
            if (!textPartId) {
              textPartId = asText(part.id);
            }
          }
        }
      }

      const assistantText = textParts.join('\n\n') || asText(record.content);
      push(
        'agent',
        'opencode_event',
        assistantText,
        createdAtMs,
        sequence++,
        buildAssistantTextMetadata(textPartId || undefined, context),
        textPartId || asText(info.id) || asText(record.id) || 'assistant'
      );
    });

  return result;
}
