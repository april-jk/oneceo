import { createHash } from 'node:crypto';

const REDIS_PREFIX = 'oneceo:v1';

export const redisTtlSeconds = {
  workspaceCache: 120,
  skillSessionState: 1800,
  connectorsMe: 120,
  connectorDraft: 24 * 60 * 60,
  recentMessages: 600,
  historyCursor: 1800,
  projection: 1800,
  connectorProjection: 60,
  idempotency: 24 * 60 * 60,
  runState: 24 * 60 * 60,
  runOwner: 30,
  runHeartbeat: 60,
  runStop: 24 * 60 * 60,
  runRecovery: 72 * 60 * 60,
  sessionEventsStream: 72 * 60 * 60,
  runStream: 72 * 60 * 60,
} as const;

export const redisStreamMaxLen = {
  sessionEvents: 5000,
  runEvents: 2000,
} as const;

export type RedisRunScope = {
  tenantKey: string;
  sessionId: string;
  runId: string;
};

export type RedisSessionScope = {
  tenantKey: string;
  sessionId: string;
};

export type RedisUserScope = {
  tenantKey: string;
  userId: string;
};

function ensureSegment(value: string, name: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`missing_redis_${name}`);
  }
  return normalized;
}

function scopePrefix(input: RedisSessionScope) {
  return `${REDIS_PREFIX}:tenant:${ensureSegment(input.tenantKey, 'tenant_key')}:session:${ensureSegment(
    input.sessionId,
    'session_id'
  )}`;
}

function userPrefix(input: RedisUserScope) {
  return `${REDIS_PREFIX}:tenant:${ensureSegment(input.tenantKey, 'tenant_key')}:user:${ensureSegment(
    input.userId,
    'user_id'
  )}`;
}

export function deriveTenantKeyForRedis(userId: string, explicitTenantKey?: string | null) {
  const normalizedUserId = ensureSegment(userId, 'user_id');
  return String(explicitTenantKey || '').trim() || normalizedUserId;
}

export function hashRedisKeyPart(value: string) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

export function redisSessionScopePrefix(input: RedisSessionScope) {
  return scopePrefix(input);
}

export const redisKeyspace = {
  userIdempotency(input: RedisUserScope & { operation: string; requestHash: string }) {
    return `${userPrefix(input)}:idempotency:${ensureSegment(input.operation, 'operation')}:${ensureSegment(
      input.requestHash,
      'request_hash'
    )}`;
  },
  workspaceDir(input: RedisSessionScope & { pathHash: string }) {
    return `${scopePrefix(input)}:cache:workspace:dir:${ensureSegment(input.pathHash, 'path_hash')}`;
  },
  workspaceTree(input: RedisSessionScope & { pathHash: string }) {
    return `${scopePrefix(input)}:cache:workspace:tree:${ensureSegment(input.pathHash, 'path_hash')}`;
  },
  workspaceFile(input: RedisSessionScope & { pathHash: string }) {
    return `${scopePrefix(input)}:cache:workspace:file:${ensureSegment(input.pathHash, 'path_hash')}`;
  },
  messagesRecent(input: RedisSessionScope) {
    return `${scopePrefix(input)}:cache:messages:recent`;
  },
  skillSessionState(input: RedisSessionScope) {
    return `${scopePrefix(input)}:cache:skills:session-state`;
  },
  historyCursor(input: RedisSessionScope) {
    return `${scopePrefix(input)}:cursor:history`;
  },
  connectorProjection(input: RedisSessionScope) {
    return `${scopePrefix(input)}:projection:connectors`;
  },
  connectorsMe(input: RedisUserScope) {
    return `${userPrefix(input)}:cache:connectors:me`;
  },
  connectorDraft(input: RedisUserScope & { draftId: string }) {
    return `${userPrefix(input)}:draft:connectors:${ensureSegment(input.draftId, 'draft_id')}`;
  },
  runtimeProjection(input: RedisSessionScope) {
    return `${scopePrefix(input)}:projection:runtime`;
  },
  activeRuns(tenantKey: string) {
    return `${REDIS_PREFIX}:tenant:${ensureSegment(tenantKey, 'tenant_key')}:ops:runs:active`;
  },
  runState(input: RedisRunScope) {
    return `${scopePrefix(input)}:run:${ensureSegment(input.runId, 'run_id')}:state`;
  },
  runOwner(input: RedisRunScope) {
    return `${scopePrefix(input)}:run:${ensureSegment(input.runId, 'run_id')}:owner`;
  },
  runHeartbeat(input: RedisRunScope) {
    return `${scopePrefix(input)}:run:${ensureSegment(input.runId, 'run_id')}:heartbeat`;
  },
  runStop(input: RedisRunScope) {
    return `${scopePrefix(input)}:run:${ensureSegment(input.runId, 'run_id')}:stop`;
  },
  runRecovery(input: RedisRunScope) {
    return `${scopePrefix(input)}:run:${ensureSegment(input.runId, 'run_id')}:recovery`;
  },
  sessionEventsStream(input: RedisSessionScope) {
    return `${scopePrefix(input)}:stream:session-events`;
  },
  runEventsStream(input: RedisRunScope) {
    return `${scopePrefix(input)}:run:${ensureSegment(input.runId, 'run_id')}:stream`;
  },
};
