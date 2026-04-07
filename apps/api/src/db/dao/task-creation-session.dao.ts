/**
 * 任务创建会话 DAO
 * 
 * 提供任务创建会话的数据库操作方法
 */

import { randomUUID } from 'node:crypto';
import { db } from '../../config/database';
import {
  taskCreationSessions,
  conversationMessages,
  taskSessionRecentMessages,
  intentRecognitionResults,
  taskDescriptions,
  executionPlans,
  searchRecords,
  type NewTaskCreationSession,
  type NewIntentRecognitionResult,
  type NewTaskDescription,
  type NewExecutionPlan,
  type NewSearchRecord,
} from '../schema';
import { eq, desc, asc, sql, inArray } from 'drizzle-orm';
import {
  buildTimelineMessageKey,
  normalizeMessageTimelineMetadata,
  normalizeRuntimeGenerationValue,
} from '../../utils/task-message-identity';

type ConversationMessageWriteInput = {
  id?: string;
  sessionId: string;
  role: string;
  content: string;
  messageType?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | string;
};

type RecentMessageSnapshotInput = {
  id?: string;
  role: string;
  content: string;
  messageType?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | string;
};

/**
 * 任务创建会话 DAO 类
 */
export class TaskCreationSessionDAO {
  private static readonly RECENT_MESSAGE_LIMIT = 50;
  private readonly recentStoragePrunedAt = new Map<string, number>();
  private readonly recentMetadataCompactedAt = new Map<string, number>();

  private createId(id?: string) {
    return id ?? randomUUID();
  }

  private asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private sanitizeTimelineMetadataForStorage(metadataRaw: unknown): Record<string, unknown> {
    const metadata = this.asRecord(metadataRaw);
    const slim: Record<string, unknown> = {};

    for (const key of [
      'messageKey',
      'runId',
      'timestamp',
      'sessionEventSeq',
      'timelineCursor',
      'runtimeGeneration',
      'runtimeGenerationBoundary',
      'orchestratorSessionId',
      'opencodeSessionId',
      'workspacePath',
      'stage',
      'tone',
      'streamKey',
      'partId',
      'eventType',
      'toolName',
      'partType',
      'eventRole',
      'eventState',
      'executor',
      'itemId',
      'itemType',
      'itemStatus',
      'itemText',
      'command',
      'outputPreview',
      'exitCode',
      'fileChanges',
      'filePaths',
      'commandCategory',
      'targetPath',
      'approvalText',
      'approvalOptions',
      'attachments',
      'skills',
      'attachmentContext',
      'attachmentContextIncluded',
      'originalInput',
      'question',
      'options',
      'codexRestoreStatus',
      'codexRestoreAt',
      'codexRestoreSourceKey',
      'previousExecutorSessionId',
      'codexRestoreFailureReason',
    ]) {
      if (metadata[key] !== undefined) {
        slim[key] = metadata[key];
      }
    }

    const eventFromMeta = this.asRecord(metadata.event);
    const rawPayload = this.asRecord(metadata.rawPayload);
    const eventFromPayload = this.asRecord(rawPayload.event);
    const event = Object.keys(eventFromMeta).length > 0 ? eventFromMeta : eventFromPayload;
    const properties = this.asRecord(event.properties);
    const part = this.asRecord(properties.part);

    const toolName =
      this.asText(slim.toolName) ||
      this.asText(part.tool) ||
      this.asText(part.name) ||
      this.asText(properties.tool) ||
      this.asText(properties.name);
    if (toolName) {
      slim.toolName = toolName;
    }

    const partType = this.asText(slim.partType) || this.asText(part.type);
    if (partType) {
      slim.partType = partType;
    }

    const eventRole = this.asText(slim.eventRole) || this.asText(part.role);
    if (eventRole) {
      slim.eventRole = eventRole;
    }

    const eventState =
      this.asText(slim.eventState) ||
      this.asText(this.asRecord(properties.state).state) ||
      this.asText(properties.state) ||
      this.asText(properties.status);
    if (eventState) {
      slim.eventState = eventState;
    }

    const resolvedPartId =
      this.asText(slim.partId) ||
      this.asText(part.id) ||
      this.asText(part.callID) ||
      this.asText(properties.partId) ||
      this.asText(properties.callID);
    if (resolvedPartId) {
      slim.partId = resolvedPartId;
    }

    if (Object.keys(event).length > 0) {
      const slimProps: Record<string, unknown> = {};
      const slimPart: Record<string, unknown> = {};
      for (const key of ['id', 'callID', 'type', 'role', 'tool', 'name']) {
        const value = this.asText(part[key]);
        if (value) {
          slimPart[key] = value;
        }
      }
      if (Object.keys(slimPart).length > 0) {
        slimProps.part = slimPart;
      }
      for (const key of ['tool', 'name', 'partId', 'callID', 'status']) {
        const value = this.asText(properties[key]);
        if (value) {
          slimProps[key] = value;
        }
      }
      if (eventState) {
        slimProps.state = { state: eventState };
      }
      if (Object.keys(slimProps).length > 0) {
        slim.event = { properties: slimProps };
      }
    }

    return slim;
  }

  private dedupeRecentWindowRows<
    T extends { messageKey: string | null; timelineCursor: number | null; createdAt?: Date | string | null }
  >(rows: T[]): T[] {
    if (!Array.isArray(rows) || rows.length <= 1) {
      return rows;
    }
    const byKey = new Map<string, T>();
    for (const row of rows) {
      const key = typeof row.messageKey === 'string' ? row.messageKey.trim() : '';
      if (!key) {
        continue;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const rowCursor = Number(row.timelineCursor || 0);
      const existingCursor = Number(existing.timelineCursor || 0);
      if (rowCursor > existingCursor) {
        byKey.set(key, row);
        continue;
      }
      if (rowCursor === existingCursor) {
        const rowCreatedAt = Date.parse(String(row.createdAt || '')) || 0;
        const existingCreatedAt = Date.parse(String(existing.createdAt || '')) || 0;
        if (rowCreatedAt >= existingCreatedAt) {
          byKey.set(key, row);
        }
      }
    }
    return [...byKey.values()]
      .sort((left, right) => {
        const cursorDelta = Number(left.timelineCursor || 0) - Number(right.timelineCursor || 0);
        if (cursorDelta !== 0) {
          return cursorDelta;
        }
        return (Date.parse(String(left.createdAt || '')) || 0) - (Date.parse(String(right.createdAt || '')) || 0);
      })
      .slice(-TaskCreationSessionDAO.RECENT_MESSAGE_LIMIT);
  }

  private isUuid(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
  }

  private asPositiveNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  private resolveMessageOrderCursor(message: { timelineCursor?: unknown; metadata?: unknown; createdAt?: unknown }) {
    const timelineCursor = this.asPositiveNumber(message.timelineCursor);
    if (timelineCursor !== null) {
      return timelineCursor;
    }
    const metadata =
      message.metadata && typeof message.metadata === 'object'
        ? (message.metadata as Record<string, unknown>)
        : {};
    const metadataTimelineCursor = this.asPositiveNumber(metadata.timelineCursor);
    if (metadataTimelineCursor !== null) {
      return metadataTimelineCursor;
    }
    const sessionEventSeq = this.asPositiveNumber(metadata.sessionEventSeq);
    if (sessionEventSeq !== null) {
      return sessionEventSeq;
    }
    const createdAt =
      message.createdAt instanceof Date
        ? message.createdAt.getTime()
        : Date.parse(String(message.createdAt || ''));
    return Number.isFinite(createdAt) && createdAt > 0 ? createdAt * 1000 : null;
  }

  private resolveMetadataEvent(message: { metadata?: unknown }) {
    const metadata = this.asRecord(message?.metadata);
    const event = this.asRecord(metadata.event);
    if (Object.keys(event).length > 0) {
      return event;
    }
    const rawPayload = this.asRecord(metadata.rawPayload);
    return this.asRecord(rawPayload.event);
  }

  private resolveOpencodeEventPartType(message: { metadata?: unknown }) {
    const event = this.resolveMetadataEvent(message);
    const properties = this.asRecord(event.properties);
    const part = this.asRecord(properties.part);
    return (this.asText(part.type) || this.asText(properties.type)).toLowerCase();
  }

  private isEmptySessionDiff(message: { metadata?: unknown; content?: unknown }) {
    const metadata = this.asRecord(message?.metadata);
    if (this.asText(metadata.eventType).toLowerCase() !== 'session.diff') {
      return false;
    }
    if (this.asText(message?.content)) {
      return false;
    }
    const event = this.resolveMetadataEvent(message);
    const properties = this.asRecord(event.properties);
    const diff = Array.isArray(properties.diff) ? properties.diff : [];
    return diff.length === 0;
  }

  private isConversationStorageNoise(message: {
    messageType?: unknown;
    content?: unknown;
    metadata?: unknown;
  }) {
    const messageType = this.asText(message.messageType);
    if (messageType !== 'opencode_event') {
      return false;
    }

    const metadata = this.asRecord(message.metadata);
    const eventType = this.asText(metadata.eventType).toLowerCase();
    const source = this.asText(metadata.source).toLowerCase();
    const content = this.asText(message.content);
    const partType = this.resolveOpencodeEventPartType(message);

    if (source === 'stream_checkpoint') return true;
    if (content.startsWith('[Message] ')) return true;
    if (eventType === 'message.updated') return true;
    if (this.isEmptySessionDiff(message)) return true;

    if (eventType === 'message.part.updated' || eventType === 'message.part.delta') {
      if (partType === 'tool' || partType === 'file') {
        return !content;
      }
      return true;
    }

    if ((eventType === 'message.final' || eventType === 'message.completed' || eventType === 'message.done') && !content) {
      return true;
    }

    if (!content && partType && partType !== 'tool' && partType !== 'file') {
      return true;
    }

    return false;
  }

  private sortMessagesByTimeline<T extends { id?: unknown; timelineCursor?: unknown; metadata?: unknown; createdAt?: unknown }>(messages: T[]) {
    return [...messages].sort((left, right) => {
      const leftCursor = this.resolveMessageOrderCursor(left);
      const rightCursor = this.resolveMessageOrderCursor(right);
      if (leftCursor !== null && rightCursor !== null && leftCursor !== rightCursor) {
        return leftCursor - rightCursor;
      }
      if (leftCursor !== null && rightCursor === null) return 1;
      if (leftCursor === null && rightCursor !== null) return -1;

      const leftCreatedAt =
        left.createdAt instanceof Date
          ? left.createdAt.getTime()
          : Number(Date.parse(String(left.createdAt || ''))) || 0;
      const rightCreatedAt =
        right.createdAt instanceof Date
          ? right.createdAt.getTime()
          : Number(Date.parse(String(right.createdAt || ''))) || 0;
      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }

      return String(left.id || '').localeCompare(String(right.id || ''));
    });
  }

  private isRecentMessageTableUnavailable(error: unknown): boolean {
    const err = error as { message?: unknown; query?: unknown; cause?: { message?: unknown } } | undefined;
    const messageParts = [
      error instanceof Error ? error.message : String(error),
      typeof err?.query === 'string' ? err.query : '',
      typeof err?.cause?.message === 'string' ? err.cause.message : '',
    ];
    const message = messageParts.join(' | ').toLowerCase();
    const isRecentStorageError =
      message.includes('task_session_recent_messages') ||
      message.includes('conversation_message_timeline_cursor_seq');
    return (
      isRecentStorageError &&
      (
        message.includes('does not exist') ||
        message.includes('relation') ||
        message.includes('no such table') ||
        message.includes('column') ||
        message.includes('undefined column') ||
        message.includes('unknown column') ||
        message.includes('has no column named') ||
        message.includes('no such column')
      )
    );
  }

  private decorateStoredMessage<
    T extends {
      messageKey?: string | null;
      timelineCursor?: number | null;
      runtimeGeneration?: number | null;
      metadata?: unknown;
      createdAt?: unknown;
    }
  >(message: T): T & { metadata: Record<string, unknown> } {
    const metadata = normalizeMessageTimelineMetadata(message.metadata, message.createdAt, 0);
    if (message.messageKey) {
      metadata.messageKey = message.messageKey;
    }
    if (typeof message.timelineCursor === 'number' && Number.isFinite(message.timelineCursor) && message.timelineCursor > 0) {
      metadata.timelineCursor = Math.floor(message.timelineCursor);
    }
    if (
      typeof message.runtimeGeneration === 'number' &&
      Number.isFinite(message.runtimeGeneration) &&
      message.runtimeGeneration > 0
    ) {
      metadata.runtimeGeneration = Math.floor(message.runtimeGeneration);
    }
    return {
      ...message,
      metadata,
    };
  }

  private async compactRecentMessageMetadata(sessionId: string) {
    const normalizedSessionId = this.asText(sessionId);
    if (!normalizedSessionId) return;
    const now = Date.now();
    const lastCompactedAt = this.recentMetadataCompactedAt.get(normalizedSessionId) ?? 0;
    if (now - lastCompactedAt < 60_000) {
      return;
    }

    await db.execute(sql`
      update ${taskSessionRecentMessages}
      set metadata = jsonb_strip_nulls(
        jsonb_build_object(
          'messageKey', metadata->>'messageKey',
          'runId', metadata->>'runId',
          'timestamp', metadata->'timestamp',
          'sessionEventSeq', metadata->'sessionEventSeq',
          'timelineCursor', metadata->'timelineCursor',
          'runtimeGeneration', metadata->'runtimeGeneration',
          'runtimeGenerationBoundary', metadata->'runtimeGenerationBoundary',
          'orchestratorSessionId', metadata->>'orchestratorSessionId',
          'opencodeSessionId', metadata->>'opencodeSessionId',
          'workspacePath', metadata->>'workspacePath',
          'stage', metadata->>'stage',
          'tone', metadata->>'tone',
          'streamKey', metadata->>'streamKey',
          'attachments', metadata->'attachments',
          'skills', metadata->'skills',
          'attachmentContext', metadata->'attachmentContext',
          'attachmentContextIncluded', metadata->'attachmentContextIncluded',
          'originalInput', metadata->>'originalInput',
          'question', metadata->>'question',
          'options', metadata->'options',
          'partId', coalesce(
            metadata->>'partId',
            metadata#>>'{event,properties,part,id}',
            metadata#>>'{event,properties,part,callID}',
            metadata#>>'{event,properties,partId}',
            metadata#>>'{event,properties,callID}'
          ),
          'eventType', metadata->>'eventType',
          'toolName', coalesce(
            metadata->>'toolName',
            metadata#>>'{event,properties,part,tool}',
            metadata#>>'{event,properties,part,name}',
            metadata#>>'{event,properties,tool}',
            metadata#>>'{event,properties,name}'
          ),
          'partType', coalesce(
            metadata->>'partType',
            metadata#>>'{event,properties,part,type}'
          ),
          'eventRole', coalesce(
            metadata->>'eventRole',
            metadata#>>'{event,properties,part,role}'
          ),
          'eventState', coalesce(
            metadata->>'eventState',
            metadata#>>'{event,properties,state,state}',
            metadata#>>'{event,properties,state}',
            metadata#>>'{event,properties,status}'
          ),
          'event', jsonb_strip_nulls(
            jsonb_build_object(
              'properties', jsonb_strip_nulls(
                jsonb_build_object(
                  'part', jsonb_strip_nulls(
                    jsonb_build_object(
                      'id', metadata#>>'{event,properties,part,id}',
                      'callID', metadata#>>'{event,properties,part,callID}',
                      'type', metadata#>>'{event,properties,part,type}',
                      'role', metadata#>>'{event,properties,part,role}',
                      'tool', metadata#>>'{event,properties,part,tool}',
                      'name', metadata#>>'{event,properties,part,name}'
                    )
                  ),
                  'tool', metadata#>>'{event,properties,tool}',
                  'name', metadata#>>'{event,properties,name}',
                  'partId', metadata#>>'{event,properties,partId}',
                  'callID', metadata#>>'{event,properties,callID}',
                  'status', metadata#>>'{event,properties,status}',
                  'state', case
                    when coalesce(
                      metadata#>>'{event,properties,state,state}',
                      metadata#>>'{event,properties,state}',
                      metadata#>>'{event,properties,status}'
                    ) is not null
                    then jsonb_build_object(
                      'state',
                      coalesce(
                        metadata#>>'{event,properties,state,state}',
                        metadata#>>'{event,properties,state}',
                        metadata#>>'{event,properties,status}'
                      )
                    )
                    else null
                  end
                )
              )
            )
          )
        )
      )
      where ${taskSessionRecentMessages.sessionId} = ${normalizedSessionId}
        and pg_column_size(metadata) > 65536
    `);
    this.recentMetadataCompactedAt.set(normalizedSessionId, now);
  }

  private prepareConversationMessage(
    data: ConversationMessageWriteInput,
    seed: number
  ) {
    const storageId = this.createId();
    const sourceId = data.id;
    const metadata = normalizeMessageTimelineMetadata(
      this.sanitizeTimelineMetadataForStorage(data.metadata),
      data.createdAt,
      seed
    );
    const runtimeGeneration = normalizeRuntimeGenerationValue(metadata.runtimeGeneration);
    if (runtimeGeneration !== null) {
      metadata.runtimeGeneration = runtimeGeneration;
    }
    const messageKey = buildTimelineMessageKey({
      id: sourceId,
      messageType: data.messageType,
      metadata,
      createdAt: data.createdAt,
    });
    metadata.messageKey = messageKey;
    return {
      id: storageId,
      sessionId: data.sessionId,
      messageKey,
      role: data.role,
      content: data.content,
      messageType: data.messageType || null,
      metadata,
      runtimeGeneration,
      createdAt: data.createdAt,
    };
  }

  private async rebuildRecentMessagesWindow(sessionIds: string[]) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return;
    }

    try {
      for (const sessionId of sessionIds) {
        const latest = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.sessionId, sessionId))
          .orderBy(desc(conversationMessages.timelineCursor), desc(conversationMessages.createdAt), desc(conversationMessages.id))
          .limit(TaskCreationSessionDAO.RECENT_MESSAGE_LIMIT);

        const payload = this.dedupeRecentWindowRows([...latest])
          .sort((left, right) => (left.timelineCursor || 0) - (right.timelineCursor || 0))
          .map((message) => {
            const decorated = this.decorateStoredMessage(message);
            return {
              id: this.createId(),
              sessionId: message.sessionId,
              messageId: message.id,
              messageKey: message.messageKey,
              role: message.role,
              content: message.content,
              messageType: message.messageType,
              metadata: decorated.metadata,
              timelineCursor: message.timelineCursor,
              runtimeGeneration: message.runtimeGeneration,
              createdAt: message.createdAt,
              updatedAt: message.updatedAt,
            };
          });

        await db.transaction(async (tx) => {
          await tx
            .delete(taskSessionRecentMessages)
            .where(eq(taskSessionRecentMessages.sessionId, sessionId));
          if (payload.length === 0) {
            return;
          }
          await tx
            .insert(taskSessionRecentMessages)
            .values(payload)
            .onConflictDoUpdate({
              target: [taskSessionRecentMessages.sessionId, taskSessionRecentMessages.messageKey],
              set: {
                messageId: sql`excluded.message_id`,
                role: sql`excluded.role`,
                content: sql`excluded.content`,
                messageType: sql`excluded.message_type`,
                metadata: sql`excluded.metadata`,
                timelineCursor: sql`excluded.timeline_cursor`,
                runtimeGeneration: sql`excluded.runtime_generation`,
                createdAt: sql`excluded.created_at`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        });
      }
    } catch (error) {
      if (this.isRecentMessageTableUnavailable(error)) {
        return;
      }
      throw error;
    }
  }

  async replaceRecentMessagesSnapshot(sessionId: string, messages: RecentMessageSnapshotInput[]) {
    const snapshot = Array.isArray(messages) ? messages : [];
    const payload = this.dedupeRecentWindowRows(
      snapshot
      .map((message, index) => {
        const createdAt =
          message.createdAt instanceof Date
            ? message.createdAt
            : message.createdAt
              ? new Date(message.createdAt)
              : null;
        const metadata = normalizeMessageTimelineMetadata(message.metadata, message.createdAt, index);
        const sanitizedMetadata = this.sanitizeTimelineMetadataForStorage(metadata);
        const runtimeGeneration = normalizeRuntimeGenerationValue(sanitizedMetadata.runtimeGeneration);
        if (runtimeGeneration !== null) {
          sanitizedMetadata.runtimeGeneration = runtimeGeneration;
        }
        const messageKey = buildTimelineMessageKey({
          id: message.id,
          messageType: message.messageType,
          metadata: sanitizedMetadata,
          createdAt: message.createdAt,
        });
        sanitizedMetadata.messageKey = messageKey;
        const timelineCursor = this.resolveMessageOrderCursor({
          metadata: sanitizedMetadata,
          createdAt: message.createdAt,
        });
        return {
          id: this.createId(),
          sessionId,
          messageId: this.isUuid(message.id) ? message.id : this.createId(),
          messageKey,
          role: message.role,
          content: message.content,
          messageType: message.messageType || null,
          metadata: sanitizedMetadata,
          timelineCursor: timelineCursor || Date.now() * 1000 + index,
          runtimeGeneration,
          ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
          updatedAt: new Date(),
        };
      })
    )
      .sort((left, right) => (left.timelineCursor || 0) - (right.timelineCursor || 0));

    await db.transaction(async (tx) => {
      await tx
        .delete(taskSessionRecentMessages)
        .where(eq(taskSessionRecentMessages.sessionId, sessionId));
      if (payload.length === 0) {
        return;
      }
      await tx
        .insert(taskSessionRecentMessages)
        .values(payload as any)
        .onConflictDoUpdate({
          target: [taskSessionRecentMessages.sessionId, taskSessionRecentMessages.messageKey],
          set: {
            messageId: sql`excluded.message_id`,
            role: sql`excluded.role`,
            content: sql`excluded.content`,
            messageType: sql`excluded.message_type`,
            metadata: sql`excluded.metadata`,
            timelineCursor: sql`excluded.timeline_cursor`,
            runtimeGeneration: sql`excluded.runtime_generation`,
            createdAt: sql`excluded.created_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    });
  }

  private async pruneConversationStorageNoise(sessionId: string) {
    const now = Date.now();
    const lastPrunedAt = this.recentStoragePrunedAt.get(sessionId) ?? 0;
    if (now - lastPrunedAt < 60_000) {
      return 0;
    }

    const stored = await db
      .select({
        id: conversationMessages.id,
        sessionId: conversationMessages.sessionId,
        role: conversationMessages.role,
        content: conversationMessages.content,
        messageType: conversationMessages.messageType,
        metadata: conversationMessages.metadata,
        timelineCursor: conversationMessages.timelineCursor,
        runtimeGeneration: conversationMessages.runtimeGeneration,
        createdAt: conversationMessages.createdAt,
        updatedAt: conversationMessages.updatedAt,
        messageKey: conversationMessages.messageKey,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.sessionId, sessionId));

    const removableIds = stored
      .filter((message) => this.isConversationStorageNoise(message))
      .map((message) => message.id);

    if (removableIds.length === 0) {
      this.recentStoragePrunedAt.set(sessionId, now);
      return 0;
    }

    const chunkSize = 100;
    for (let i = 0; i < removableIds.length; i += chunkSize) {
      const chunk = removableIds.slice(i, i + chunkSize);
      await db.delete(conversationMessages).where(inArray(conversationMessages.id, chunk));
    }

    await this.rebuildRecentMessagesWindow([sessionId]);
    this.recentStoragePrunedAt.set(sessionId, now);
    return removableIds.length;
  }

  /**
   * 创建新的任务创建会话
   */
  async createSession(data: Partial<NewTaskCreationSession> = {}) {
    const [session] = await db
      .insert(taskCreationSessions)
      .values({
        id: this.createId(data.id),
        userId: data.userId,
        status: data.status || 'in_progress',
      })
      .onConflictDoNothing({
        target: taskCreationSessions.id,
      })
      .returning();

    if (session) {
      return session;
    }

    if (data.id) {
      const existing = await this.getSession(data.id);
      if (existing) {
        return existing;
      }
    }

    throw new Error('创建任务会话失败');
  }

  /**
   * 获取会话信息
   */
  async getSession(sessionId: string) {
    const [session] = await db
      .select()
      .from(taskCreationSessions)
      .where(eq(taskCreationSessions.id, sessionId));

    return session;
  }

  /**
   * 如果会话尚未绑定用户，则绑定到当前用户
   */
  async bindUserIfMissing(sessionId: string, userId: string) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    if (session.userId && session.userId.trim()) {
      return session;
    }
    const [updated] = await db
      .update(taskCreationSessions)
      .set({
        userId,
        updatedAt: new Date(),
      })
      .where(eq(taskCreationSessions.id, sessionId))
      .returning();
    return updated;
  }

  /**
   * 更新会话状态
   */
  async updateSessionStatus(
    sessionId: string,
    status: 'in_progress' | 'waiting_user' | 'completed' | 'failed'
  ) {
    const [session] = await db
      .update(taskCreationSessions)
      .set({
        status,
        updatedAt: new Date(),
        completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
      })
      .where(eq(taskCreationSessions.id, sessionId))
      .returning();

    return session;
  }

  /**
   * 添加对话消息
   */
  async addMessage(data: ConversationMessageWriteInput) {
    const [message] = await this.addMessages([data]);
    return message || null;
  }

  /**
   * 批量添加对话消息
   */
  async addMessages(data: ConversationMessageWriteInput[]) {
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    const prepared = data.map((item, idx) => this.prepareConversationMessage(item, idx));
    const deduped = new Map<string, (typeof prepared)[number]>();
    for (const item of prepared) {
      deduped.set(`${item.sessionId}:${item.messageKey}`, item);
    }
    const payload = Array.from(deduped.values()).map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      messageKey: item.messageKey,
      role: item.role,
      content: item.content,
      messageType: item.messageType,
      metadata: item.metadata,
      runtimeGeneration: item.runtimeGeneration,
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      updatedAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    }));

    const messages = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(conversationMessages)
        .values(payload as any)
        .onConflictDoUpdate({
          target: [conversationMessages.sessionId, conversationMessages.messageKey],
          set: {
            role: sql`excluded.role`,
            content: sql`excluded.content`,
            messageType: sql`excluded.message_type`,
            metadata: sql`excluded.metadata`,
            runtimeGeneration: sql`excluded.runtime_generation`,
            updatedAt: sql`NOW()`,
          },
        })
        .returning();
      return rows.map((row) => this.decorateStoredMessage(row));
    });

    await this.rebuildRecentMessagesWindow(Array.from(new Set(payload.map((item) => item.sessionId))));
    return messages;
  }

  /**
   * 获取会话的所有消息
   */
  async getMessages(sessionId: string) {
    const messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.sessionId, sessionId))
      .orderBy(asc(conversationMessages.timelineCursor), conversationMessages.createdAt, conversationMessages.id);

    return this.sortMessagesByTimeline(messages.map((message) => this.decorateStoredMessage(message)));
  }

  /**
   * 获取会话最近热缓存消息
   */
  async getRecentMessages(sessionId: string, limit = TaskCreationSessionDAO.RECENT_MESSAGE_LIMIT) {
    const safeLimit = Math.max(1, Math.min(limit, TaskCreationSessionDAO.RECENT_MESSAGE_LIMIT));
    try {
      await this.compactRecentMessageMetadata(sessionId);
      const recent = await db
        .select()
        .from(taskSessionRecentMessages)
        .where(eq(taskSessionRecentMessages.sessionId, sessionId))
        .orderBy(desc(taskSessionRecentMessages.timelineCursor), desc(taskSessionRecentMessages.createdAt), desc(taskSessionRecentMessages.id))
        .limit(TaskCreationSessionDAO.RECENT_MESSAGE_LIMIT);

      const orderedRecent = this.sortMessagesByTimeline(recent.map((message) => this.decorateStoredMessage(message)));
      return orderedRecent.slice(Math.max(orderedRecent.length - safeLimit, 0));
    } catch (error) {
      if (!this.isRecentMessageTableUnavailable(error)) {
        throw error;
      }
      const fallback = await this.getMessages(sessionId);
      return fallback.slice(Math.max(fallback.length - safeLimit, 0));
    }
  }

  /**
   * 保存意图识别结果
   */
  async saveIntentResult(data: Omit<NewIntentRecognitionResult, 'id'> & { id?: string }) {
    const [result] = await db
      .insert(intentRecognitionResults)
      .values({
        ...data,
        id: this.createId(data.id),
      })
      .returning();

    return result;
  }

  /**
   * 获取会话的意图识别结果
   */
  async getIntentResult(sessionId: string) {
    const [result] = await db
      .select()
      .from(intentRecognitionResults)
      .where(eq(intentRecognitionResults.sessionId, sessionId))
      .orderBy(desc(intentRecognitionResults.createdAt))
      .limit(1);

    return result;
  }

  /**
   * 保存任务描述
   */
  async saveTaskDescription(data: Omit<NewTaskDescription, 'id'> & { id?: string }) {
    const [description] = await db
      .insert(taskDescriptions)
      .values({
        ...data,
        id: this.createId(data.id),
      })
      .returning();

    return description;
  }

  /**
   * 获取会话的任务描述
   */
  async getTaskDescription(sessionId: string) {
    const [description] = await db
      .select()
      .from(taskDescriptions)
      .where(eq(taskDescriptions.sessionId, sessionId))
      .orderBy(desc(taskDescriptions.createdAt))
      .limit(1);

    return description;
  }

  /**
   * 保存执行计划
   */
  async saveExecutionPlan(data: Omit<NewExecutionPlan, 'id'> & { id?: string }) {
    const [plan] = await db
      .insert(executionPlans)
      .values({
        ...data,
        id: this.createId(data.id),
      })
      .returning();

    return plan;
  }

  /**
   * 获取会话的执行计划
   */
  async getExecutionPlan(sessionId: string) {
    const [plan] = await db
      .select()
      .from(executionPlans)
      .where(eq(executionPlans.sessionId, sessionId))
      .orderBy(desc(executionPlans.createdAt))
      .limit(1);

    return plan;
  }

  /**
   * 保存搜索记录
   */
  async saveSearchRecord(data: Omit<NewSearchRecord, 'id'> & { id?: string }) {
    const [record] = await db
      .insert(searchRecords)
      .values({
        ...data,
        id: this.createId(data.id),
      })
      .returning();

    return record;
  }

  /**
   * 获取会话的搜索记录
   */
  async getSearchRecords(sessionId: string) {
    const records = await db
      .select()
      .from(searchRecords)
      .where(eq(searchRecords.sessionId, sessionId))
      .orderBy(searchRecords.createdAt);

    return records;
  }

  /**
   * 获取会话的完整信息（包括所有关联数据）
   */
  async getSessionWithDetails(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const [messages, intentResult, taskDescription, executionPlan, searchRecordsList] =
      await Promise.all([
        this.getMessages(sessionId),
        this.getIntentResult(sessionId),
        this.getTaskDescription(sessionId),
        this.getExecutionPlan(sessionId),
        this.getSearchRecords(sessionId),
      ]);

    return {
      session,
      messages,
      intentResult,
      taskDescription,
      executionPlan,
      searchRecords: searchRecordsList,
    };
  }

  /**
   * 获取最近的会话列表
   */
  async getRecentSessions(limit: number = 10, userId?: string) {
    const query = db
      .select()
      .from(taskCreationSessions)
      .orderBy(desc(taskCreationSessions.createdAt))
      .limit(limit);

    if (userId) {
      query.where(eq(taskCreationSessions.userId, userId));
    }

    return await query;
  }

  /**
   * 获取管理态最近会话列表（不按用户过滤）
   */
  async getRecentSessionsForAdmin(limit: number = 50) {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 5000)) : 50;
    return await db
      .select()
      .from(taskCreationSessions)
      .orderBy(desc(taskCreationSessions.updatedAt), desc(taskCreationSessions.createdAt), desc(taskCreationSessions.id))
      .limit(safeLimit);
  }

  /**
   * 删除会话（级联删除所有关联数据）
   */
  async deleteSession(sessionId: string) {
    await db
      .delete(taskCreationSessions)
      .where(eq(taskCreationSessions.id, sessionId));
  }
}

// 导出单例实例
export const taskCreationSessionDAO = new TaskCreationSessionDAO();
