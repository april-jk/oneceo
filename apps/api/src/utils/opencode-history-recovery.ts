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
  generation?: number;
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

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
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

function buildStructuralMetadata(
  eventType: string,
  event: Record<string, unknown>,
  context: RecoveryContext,
  extra?: Record<string, unknown>
) {
  return {
    runtimeGeneration: context.generation,
    orchestratorSessionId: context.orchestratorSessionId,
    opencodeSessionId: context.opencodeSessionId,
    workspacePath: context.workspacePath,
    source: 'opencode_native_history',
    eventType,
    event,
    ...(extra || {}),
    rawPayload: {
      eventType,
      event,
    },
  } satisfies Record<string, unknown>;
}

function normalizeNativeMessageInfo(record: Record<string, unknown>, context: RecoveryContext) {
  const info = toRecord(record.info);
  const role = (asText(info.role) || asText(record.role)).toLowerCase();
  const created = resolveMessageTimestamp(record);
  const recordTime = toRecord(record.time);
  const infoTime = toRecord(info.time);
  const completed =
    asNumber(recordTime.completed) ||
    asNumber(recordTime.ended) ||
    asNumber(infoTime.completed) ||
    asNumber(infoTime.ended);
  const sessionID =
    asText(record.sessionID) ||
    asText(record.sessionId) ||
    asText(info.sessionID) ||
    asText(info.sessionId) ||
    context.opencodeSessionId;
  const id = asText(record.id) || asText(info.id);
  const parentID = asText(record.parentID) || asText(record.parentId) || asText(info.parentID) || asText(info.parentId);
  const providerID =
    asText(record.providerID) ||
    asText(record.providerId) ||
    asText(info.providerID) ||
    asText(info.providerId);
  const modelID =
    asText(record.modelID) ||
    asText(record.modelId) ||
    asText(info.modelID) ||
    asText(info.modelId);

  if (role === 'assistant') {
    return {
      ...info,
      ...record,
      id,
      sessionID,
      role: 'assistant',
      parentID: parentID || undefined,
      providerID: providerID || undefined,
      modelID: modelID || undefined,
      time: {
        created,
        ...(completed ? { completed } : {}),
      },
    } satisfies Record<string, unknown>;
  }

  return {
    ...info,
    ...record,
    id,
    sessionID,
    role: role || 'user',
    time: {
      created,
    },
  } satisfies Record<string, unknown>;
}

function normalizeNativePart(
  rawPart: Record<string, unknown>,
  messageInfo: Record<string, unknown>,
  context: RecoveryContext
) {
  const type = asText(rawPart.type).toLowerCase();
  const id = asText(rawPart.id) || asText(rawPart.callID) || `${type || 'part'}_${messageInfo.id}`;
  const sessionID = asText(rawPart.sessionID) || asText(rawPart.sessionId) || context.opencodeSessionId;
  const messageID = asText(rawPart.messageID) || asText(rawPart.messageId) || asText(messageInfo.id);

  return {
    ...rawPart,
    id,
    type: type || asText(rawPart.type),
    sessionID,
    messageID,
  } satisfies Record<string, unknown>;
}

function buildMessageUpdatedMetadata(
  messageInfo: Record<string, unknown>,
  context: RecoveryContext
) {
  const event = {
    type: 'message.updated',
    directory: context.workspacePath,
    properties: {
      info: messageInfo,
      role: asText(messageInfo.role).toLowerCase() || undefined,
    },
  } satisfies Record<string, unknown>;
  return buildStructuralMetadata('message.updated', event, context, {
    messageId: asText(messageInfo.id) || undefined,
    role: asText(messageInfo.role).toLowerCase() || undefined,
  });
}

function buildPartUpdatedMetadata(
  part: Record<string, unknown>,
  messageInfo: Record<string, unknown>,
  context: RecoveryContext
) {
  const role = asText(messageInfo.role).toLowerCase() || undefined;
  const event = {
    type: 'message.part.updated',
    directory: context.workspacePath,
    properties: {
      part,
      role,
      message: {
        id: asText(messageInfo.id) || undefined,
        role,
        parentID: asText(messageInfo.parentID) || undefined,
        time: toRecord(messageInfo.time),
      },
    },
  } satisfies Record<string, unknown>;
  return buildStructuralMetadata('message.part.updated', event, context, {
    messageId: asText(messageInfo.id) || undefined,
    partId: asText(part.id) || undefined,
    role,
  });
}

function buildAssistantFinalMetadata(
  partId: string | undefined,
  messageInfo: Record<string, unknown>,
  context: RecoveryContext
) {
  const event = {
    type: 'message.final',
    directory: context.workspacePath,
    properties: {
      part: {
        id: partId || undefined,
        type: 'text',
        messageID: asText(messageInfo.id) || undefined,
        sessionID: context.opencodeSessionId,
      },
      role: 'assistant',
      message: {
        id: asText(messageInfo.id) || undefined,
        role: 'assistant',
        parentID: asText(messageInfo.parentID) || undefined,
        time: toRecord(messageInfo.time),
      },
    },
  } satisfies Record<string, unknown>;
  return buildStructuralMetadata('message.final', event, context, {
    messageId: asText(messageInfo.id) || undefined,
    partId: partId || undefined,
    role: 'assistant',
  });
}

function summarizeRenderablePart(part: Record<string, unknown>): string {
  const type = asText(part.type).toLowerCase();
  if (type === 'text') {
    return asText(part.text) || asText(part.content);
  }
  if (type === 'reasoning') {
    return asText(part.text) || asText(part.content);
  }
  if (type === 'tool' || type === 'tool-call' || type === 'tool_call') {
    return buildToolSummary(part);
  }
  return '';
}

export function pickRecoveredOpencodeSessionId(
  sessions: unknown[],
  workspacePath: string,
  preferredSessionId?: string
): string | null {
  return listRecoveredOpencodeSessionIds(sessions, workspacePath, preferredSessionId)[0] || null;
}

export function listRecoveredOpencodeSessionIds(
  sessions: unknown[],
  workspacePath: string,
  preferredSessionId?: string
): string[] {
  const normalizedWorkspace = normalizePath(workspacePath);
  const preferred = asText(preferredSessionId);
  const records = sessions
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>);

  if (preferred) {
    const preferredHit = records.find((record) => resolveSessionId(record) === preferred);
    if (preferredHit) {
      const rest = records
        .map((record) => ({
          id: resolveSessionId(record),
          workspace: resolveSessionWorkspace(record),
          timestamp: resolveMessageTimestamp(record),
        }))
        .filter((item) => item.id && item.id !== preferred && (!normalizedWorkspace || item.workspace === normalizedWorkspace))
        .sort((left, right) => right.timestamp - left.timestamp)
        .map((item) => item.id);
      return [preferred, ...rest];
    }
  }

  const matched = records
    .map((record) => ({
      id: resolveSessionId(record),
      workspace: resolveSessionWorkspace(record),
      timestamp: resolveMessageTimestamp(record),
    }))
    .filter((item) => item.id && (!normalizedWorkspace || item.workspace === normalizedWorkspace))
    .sort((left, right) => right.timestamp - left.timestamp)
    .map((item) => item.id);

  return matched;
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
    idSuffix?: string,
    options?: { allowEmpty?: boolean }
  ) => {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent && options?.allowEmpty !== true) return;
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
      const messageInfo = normalizeNativeMessageInfo(record, context);
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
            runtimeGeneration: context.generation,
            orchestratorSessionId: context.orchestratorSessionId,
            opencodeSessionId: context.opencodeSessionId,
            workspacePath: context.workspacePath,
            source: 'opencode_native_history',
            opencodeMessageId: asText(messageInfo.id) || undefined,
          },
          asText(info.id) || asText(record.id) || 'user'
        );
        return;
      }

      if (role !== 'assistant') {
        return;
      }

      push(
        'agent',
        'opencode_event',
        '',
        createdAtMs,
        sequence++,
        buildMessageUpdatedMetadata(messageInfo, context),
        `${asText(messageInfo.id) || 'assistant'}:message`,
        { allowEmpty: true }
      );

      let finalAssistantText = '';
      let finalAssistantPartId = '';
      for (const rawPart of parts) {
        const part = normalizeNativePart(toRecord(rawPart), messageInfo, context);
        const partType = asText(part.type).toLowerCase();
        const content = summarizeRenderablePart(part);
        if (partType === 'tool' || partType === 'tool-call' || partType === 'tool_call') {
          push(
            'agent',
            'opencode_event',
            content,
            createdAtMs,
            sequence++,
            buildPartUpdatedMetadata(part, messageInfo, context),
            `${asText(messageInfo.id) || 'assistant'}:${asText(part.id) || 'tool'}`
          );
          continue;
        }
        if (partType === 'text' || partType === 'reasoning') {
          push(
            'agent',
            'opencode_event',
            content,
            createdAtMs,
            sequence++,
            buildPartUpdatedMetadata(part, messageInfo, context),
            `${asText(messageInfo.id) || 'assistant'}:${asText(part.id) || partType}`
          );
          if (partType === 'text' && content) {
            finalAssistantText = finalAssistantText ? `${finalAssistantText}\n\n${content}` : content;
            if (!finalAssistantPartId) {
              finalAssistantPartId = asText(part.id);
            }
          }
        }
      }

      const assistantText = finalAssistantText || asText(record.content);
      if (assistantText) {
        push(
          'agent',
          'opencode_event',
          assistantText,
          createdAtMs,
          sequence++,
          buildAssistantFinalMetadata(finalAssistantPartId || undefined, messageInfo, context),
          `${asText(messageInfo.id) || 'assistant'}:final`
        );
      }
    });

  return result;
}

export function hasRenderableAssistantReply(
  messages: Array<Pick<HistoryMessage, 'role' | 'messageType' | 'content'> | null | undefined>
): boolean {
  return messages.some((message) => {
    if (!message) return false;
    const content = asText(message.content);
    if (!content) return false;
    if (message.role === 'agent' || message.role === 'system') {
      return true;
    }
    return message.messageType !== 'opencode_user_input' && message.messageType.startsWith('opencode_');
  });
}
