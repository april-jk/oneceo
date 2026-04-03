import { taskCreationSessionDAO } from '../db/dao/task-creation-session.dao';
import { redisClientService, type RedisCommandPort } from './redis-client-service';
import {
  deriveTenantKeyForRedis,
  hashRedisKeyPart,
  redisKeyspace,
  redisSessionScopePrefix,
  redisStreamMaxLen,
  redisTtlSeconds,
} from './redis-keyspace';

type SessionRedisScope = {
  userId: string;
  sessionId: string;
  tenantKey?: string | null;
};

type HistoryCursorSnapshot = {
  beforeCursor: number | null;
  oldestCursor: number | null;
  newestCursor: number | null;
  updatedAt: string;
};

type SessionEventEnvelope = {
  sessionId: string;
  userId: string;
  tenantKey: string;
  eventType: string;
  messageType: string;
  eventId: number;
  createdAt: string;
  messageKey: string;
  content: string;
  metadata: Record<string, unknown>;
};

function toRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asPositiveNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class TaskSessionRedisCacheService {
  private readonly sessionScopeCache = new Map<string, { scope: { userId: string; tenantKey: string }; updatedAt: number }>();
  private readonly sessionScopeTtlMs = 60_000;

  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isEnabled() {
    return this.redis.isEnabled();
  }

  private buildScope(input: SessionRedisScope) {
    return {
      userId: input.userId,
      sessionId: input.sessionId,
      tenantKey: deriveTenantKeyForRedis(input.userId, input.tenantKey),
    };
  }

  async resolveScopeBySession(sessionId: string) {
    const cached = this.sessionScopeCache.get(sessionId);
    const now = Date.now();
    if (cached && now - cached.updatedAt < this.sessionScopeTtlMs) {
      return cached.scope;
    }
    const session = await taskCreationSessionDAO.getSession(sessionId);
    const userId = String(session?.userId || '').trim();
    if (!userId) {
      return null;
    }
    const scope = {
      userId,
      tenantKey: deriveTenantKeyForRedis(userId),
    };
    this.sessionScopeCache.set(sessionId, { scope, updatedAt: now });
    return scope;
  }

  private workspaceScopePrefix(input: SessionRedisScope) {
    const scope = this.buildScope(input);
    return `${redisSessionScopePrefix(scope)}:cache:workspace:`;
  }

  private toWorkspacePathHash(value: string) {
    return hashRedisKeyPart(value);
  }

  async getWorkspaceDir(input: SessionRedisScope & { cacheKey: string }) {
    const scope = this.buildScope(input);
    return this.redis.getJson<Record<string, unknown>>(
      redisKeyspace.workspaceDir({
        ...scope,
        pathHash: this.toWorkspacePathHash(input.cacheKey),
      })
    );
  }

  async setWorkspaceDir(input: SessionRedisScope & { cacheKey: string; payload: Record<string, unknown> }) {
    const scope = this.buildScope(input);
    await this.redis.setJson(
      redisKeyspace.workspaceDir({
        ...scope,
        pathHash: this.toWorkspacePathHash(input.cacheKey),
      }),
      input.payload,
      redisTtlSeconds.workspaceCache
    );
  }

  async getWorkspaceTree(input: SessionRedisScope) {
    const scope = this.buildScope(input);
    return this.redis.getJson<Record<string, unknown>>(
      redisKeyspace.workspaceTree({
        ...scope,
        pathHash: this.toWorkspacePathHash('root'),
      })
    );
  }

  async setWorkspaceTree(input: SessionRedisScope & { payload: Record<string, unknown> }) {
    const scope = this.buildScope(input);
    await this.redis.setJson(
      redisKeyspace.workspaceTree({
        ...scope,
        pathHash: this.toWorkspacePathHash('root'),
      }),
      input.payload,
      redisTtlSeconds.workspaceCache
    );
  }

  async getWorkspaceFile(input: SessionRedisScope & { path: string }) {
    const scope = this.buildScope(input);
    return this.redis.getJson<Record<string, unknown>>(
      redisKeyspace.workspaceFile({
        ...scope,
        pathHash: this.toWorkspacePathHash(input.path),
      })
    );
  }

  async setWorkspaceFile(input: SessionRedisScope & { path: string; payload: Record<string, unknown> }) {
    const scope = this.buildScope(input);
    await this.redis.setJson(
      redisKeyspace.workspaceFile({
        ...scope,
        pathHash: this.toWorkspacePathHash(input.path),
      }),
      input.payload,
      redisTtlSeconds.workspaceCache
    );
  }

  async invalidateWorkspace(input: SessionRedisScope) {
    await this.redis.deleteByPrefix(this.workspaceScopePrefix(input));
  }

  async invalidateWorkspaceBySessionId(sessionId: string) {
    const scope = await this.resolveScopeBySession(sessionId);
    if (!scope) return;
    await this.invalidateWorkspace({
      sessionId,
      ...scope,
    });
  }

  async getRecentMessagesPage(input: SessionRedisScope) {
    const scope = this.buildScope(input);
    return this.redis.getJson<Record<string, unknown>>(redisKeyspace.messagesRecent(scope));
  }

  async setRecentMessagesPage(input: SessionRedisScope & { payload: Record<string, unknown> }) {
    const scope = this.buildScope(input);
    await this.redis.setJson(redisKeyspace.messagesRecent(scope), input.payload, redisTtlSeconds.recentMessages);
  }

  async getHistoryCursor(input: SessionRedisScope) {
    const scope = this.buildScope(input);
    return this.redis.getJson<HistoryCursorSnapshot>(redisKeyspace.historyCursor(scope));
  }

  async setHistoryCursor(input: SessionRedisScope & { beforeCursor?: number | null; oldestCursor?: number | null; newestCursor?: number | null }) {
    const scope = this.buildScope(input);
    await this.redis.setJson(
      redisKeyspace.historyCursor(scope),
      {
        beforeCursor: asPositiveNumber(input.beforeCursor),
        oldestCursor: asPositiveNumber(input.oldestCursor),
        newestCursor: asPositiveNumber(input.newestCursor),
        updatedAt: new Date().toISOString(),
      } satisfies HistoryCursorSnapshot,
      redisTtlSeconds.historyCursor
    );
  }

  async appendSessionEvent(input: SessionRedisScope & {
    eventType: string;
    messageType: string;
    eventId: number;
    createdAt: string;
    messageKey: string;
    content: string;
    metadata: Record<string, unknown>;
  }) {
    const scope = this.buildScope(input);
    const envelope: SessionEventEnvelope = {
      sessionId: scope.sessionId,
      userId: scope.userId,
      tenantKey: scope.tenantKey,
      eventType: input.eventType,
      messageType: input.messageType,
      eventId: Math.max(0, Math.floor(input.eventId || 0)),
      createdAt: input.createdAt,
      messageKey: input.messageKey,
      content: input.content,
      metadata: toRecord(input.metadata),
    };
    await this.redis.appendStream(
      redisKeyspace.sessionEventsStream(scope),
      {
        eventType: envelope.eventType,
        messageType: envelope.messageType,
        eventId: envelope.eventId,
        createdAt: envelope.createdAt,
        messageKey: envelope.messageKey,
        content: envelope.content,
        sessionId: envelope.sessionId,
        userId: envelope.userId,
        tenantKey: envelope.tenantKey,
        metadata: JSON.stringify(envelope.metadata),
      },
      {
        maxLen: redisStreamMaxLen.sessionEvents,
        ttlSeconds: redisTtlSeconds.sessionEventsStream,
      }
    );
  }

  async appendSessionEventForSessionId(input: {
    sessionId: string;
    eventType: string;
    messageType: string;
    eventId: number;
    createdAt: string;
    messageKey: string;
    content: string;
    metadata: Record<string, unknown>;
  }) {
    const scope = await this.resolveScopeBySession(input.sessionId);
    if (!scope) return;
    await this.appendSessionEvent({
      ...scope,
      ...input,
    });
  }

  async listSessionEvents(input: SessionRedisScope & { afterEventId?: number | null }) {
    const scope = this.buildScope(input);
    const rows = await this.redis.readStream(redisKeyspace.sessionEventsStream(scope));
    const afterEventId = asPositiveNumber(input.afterEventId);
    return rows
      .map((row) => {
        const eventId = Number(row.fields.eventId || 0);
        if (afterEventId !== null && eventId <= afterEventId) {
          return null;
        }
        let metadata: Record<string, unknown> = {};
        try {
          metadata = toRecord(JSON.parse(row.fields.metadata || '{}'));
        } catch {
          metadata = {};
        }
        return {
          eventId,
          eventType: row.fields.eventType || 'opencode_event',
          messageType: row.fields.messageType || 'opencode_event',
          createdAt: row.fields.createdAt || new Date().toISOString(),
          messageKey: row.fields.messageKey || '',
          content: row.fields.content || '',
          metadata,
        };
      })
      .filter(Boolean) as Array<{
      eventId: number;
      eventType: string;
      messageType: string;
      createdAt: string;
      messageKey: string;
      content: string;
      metadata: Record<string, unknown>;
    }>;
  }
}

export const taskSessionRedisCacheService = new TaskSessionRedisCacheService();
