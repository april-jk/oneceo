import { hostname } from 'node:os';
import type { ManagedRunStatus } from '../db/dao/task-session-run.dao';
import { redisClientService, type RedisCommandPort } from './redis-client-service';
import { deriveTenantKeyForRedis, redisKeyspace, redisStreamMaxLen, redisTtlSeconds } from './redis-keyspace';

type RunRedisContext = {
  userId: string;
  sessionId: string;
  runId: string;
  tenantKey?: string | null;
};

type RunStatusSnapshot = {
  tenantKey: string;
  userId: string;
  sessionId: string;
  runId: string;
  model?: string | null;
  status: ManagedRunStatus;
  sequence: number;
  startedAt?: string | null;
  completedAt?: string | null;
  stopReason?: string | null;
  updatedAt: string;
};

type RunEventEnvelope = {
  tenantKey: string;
  userId: string;
  sessionId: string;
  runId: string;
  eventId: string;
  eventType: string;
  sequence: number;
  producedAt: string;
  producer: string;
  payload: Record<string, unknown>;
};

function toIso(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class AltusRunRedisStateService {
  private readonly ownerToken = `${hostname()}:${process.pid}`;

  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isEnabled() {
    return this.redis.isEnabled();
  }

  private buildScope(input: RunRedisContext) {
    const tenantKey = deriveTenantKeyForRedis(input.userId, input.tenantKey);
    return {
      tenantKey,
      sessionId: input.sessionId,
      runId: input.runId,
      userId: input.userId,
    };
  }

  private buildState(input: RunRedisContext & {
    status: ManagedRunStatus;
    sequence?: number;
    model?: string | null;
    startedAt?: Date | string | null;
    completedAt?: Date | string | null;
    stopReason?: string | null;
  }): RunStatusSnapshot {
    const scope = this.buildScope(input);
    return {
      tenantKey: scope.tenantKey,
      userId: scope.userId,
      sessionId: scope.sessionId,
      runId: scope.runId,
      model: input.model || null,
      status: input.status,
      sequence: Math.max(0, Math.floor(input.sequence || 0)),
      startedAt: toIso(input.startedAt),
      completedAt: toIso(input.completedAt),
      stopReason: input.stopReason || null,
      updatedAt: new Date().toISOString(),
    };
  }

  async registerRun(input: RunRedisContext & { model?: string | null; status?: ManagedRunStatus }) {
    const scope = this.buildScope(input);
    const state = this.buildState({
      ...input,
      status: input.status || 'queued',
      sequence: 0,
    });
    await this.redis.setJson(redisKeyspace.runState(scope), state, redisTtlSeconds.runState);
    await this.redis.setString(redisKeyspace.runOwner(scope), this.ownerToken, {
      ttlSeconds: redisTtlSeconds.runOwner,
    });
    await this.redis.setString(redisKeyspace.runHeartbeat(scope), new Date().toISOString(), {
      ttlSeconds: redisTtlSeconds.runHeartbeat,
    });
    await this.redis.delete(redisKeyspace.runStop(scope));
    await this.redis.addSetMember(redisKeyspace.activeRuns(scope.tenantKey), scope.runId);
  }

  async syncRunStatus(input: RunRedisContext & {
    status: ManagedRunStatus;
    sequence?: number;
    model?: string | null;
    startedAt?: Date | string | null;
    completedAt?: Date | string | null;
    stopReason?: string | null;
  }) {
    const scope = this.buildScope(input);
    const existing = await this.redis.getJson<RunStatusSnapshot>(redisKeyspace.runState(scope));
    const next = {
      ...(existing || this.buildState(input)),
      status: input.status,
      sequence: Math.max(
        existing?.sequence || 0,
        Number.isFinite(input.sequence as number) ? Math.floor(Number(input.sequence || 0)) : existing?.sequence || 0
      ),
      model: input.model ?? existing?.model ?? null,
      startedAt: toIso(input.startedAt) ?? existing?.startedAt ?? null,
      completedAt: toIso(input.completedAt) ?? existing?.completedAt ?? null,
      stopReason: input.stopReason ?? existing?.stopReason ?? null,
      updatedAt: new Date().toISOString(),
    } satisfies RunStatusSnapshot;
    await this.redis.setJson(redisKeyspace.runState(scope), next, redisTtlSeconds.runState);

    if (input.status === 'completed' || input.status === 'failed' || input.status === 'stopped') {
      await this.redis.removeSetMember(redisKeyspace.activeRuns(scope.tenantKey), scope.runId);
      await this.redis.delete(redisKeyspace.runOwner(scope));
      await this.redis.delete(redisKeyspace.runHeartbeat(scope));
      return;
    }

    await this.redis.addSetMember(redisKeyspace.activeRuns(scope.tenantKey), scope.runId);
    await this.touchHeartbeat(scope);
    await this.redis.setString(redisKeyspace.runOwner(scope), this.ownerToken, {
      ttlSeconds: redisTtlSeconds.runOwner,
    });
  }

  async touchHeartbeat(input: RunRedisContext) {
    const scope = this.buildScope(input);
    await this.redis.setString(redisKeyspace.runHeartbeat(scope), new Date().toISOString(), {
      ttlSeconds: redisTtlSeconds.runHeartbeat,
    });
  }

  async requestStop(input: RunRedisContext, reason: string) {
    const scope = this.buildScope(input);
    await this.redis.setJson(
      redisKeyspace.runStop(scope),
      {
        reason,
        requestedAt: new Date().toISOString(),
        runId: scope.runId,
        sessionId: scope.sessionId,
        userId: scope.userId,
      },
      redisTtlSeconds.runStop
    );
  }

  async appendRunEvent(
    input: RunRedisContext & {
      eventId: string;
      eventType: string;
      sequence: number;
      producedAt?: string;
      producer?: string;
      payload: Record<string, unknown>;
    }
  ) {
    const scope = this.buildScope(input);
    const envelope: RunEventEnvelope = {
      tenantKey: scope.tenantKey,
      userId: scope.userId,
      sessionId: scope.sessionId,
      runId: scope.runId,
      eventId: input.eventId,
      eventType: input.eventType,
      sequence: Math.max(0, Math.floor(input.sequence || 0)),
      producedAt: input.producedAt || new Date().toISOString(),
      producer: input.producer || 'apps/api',
      payload: toRecord(input.payload),
    };
    await this.redis.appendStream(
      redisKeyspace.runEventsStream(scope),
      {
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        sequence: envelope.sequence,
        producedAt: envelope.producedAt,
        producer: envelope.producer,
        tenantKey: envelope.tenantKey,
        userId: envelope.userId,
        sessionId: envelope.sessionId,
        runId: envelope.runId,
        payload: JSON.stringify(envelope.payload),
      },
      {
        maxLen: redisStreamMaxLen.runEvents,
        ttlSeconds: redisTtlSeconds.runStream,
      }
    );

    const maybeStatus = typeof envelope.payload.status === 'string' ? (envelope.payload.status as ManagedRunStatus) : null;
    const existing = await this.redis.getJson<RunStatusSnapshot>(redisKeyspace.runState(scope));
    await this.redis.setJson(
      redisKeyspace.runState(scope),
      {
        ...(existing || this.buildState({ ...scope, status: maybeStatus || 'queued' })),
        sequence: Math.max(existing?.sequence || 0, envelope.sequence),
        status: maybeStatus || existing?.status || 'queued',
        updatedAt: envelope.producedAt,
      },
      redisTtlSeconds.runState
    );
  }

  async listRunEvents(input: RunRedisContext & { afterSequence?: number | null }) {
    const scope = this.buildScope(input);
    const rows = await this.redis.readStream(redisKeyspace.runEventsStream(scope));
    const afterSequence =
      typeof input.afterSequence === 'number' && Number.isFinite(input.afterSequence)
        ? Math.max(0, Math.floor(input.afterSequence))
        : null;
    return rows
      .map((row) => {
        const sequence = Number(row.fields.sequence || 0);
        if (afterSequence !== null && sequence <= afterSequence) {
          return null;
        }
        const payloadRaw = row.fields.payload || '{}';
        let payload: Record<string, unknown> = {};
        try {
          payload = toRecord(JSON.parse(payloadRaw));
        } catch {
          payload = {};
        }
        return {
          sequence,
          eventType: row.fields.eventType || 'message',
          payload,
        };
      })
      .filter(Boolean) as Array<{
      sequence: number;
      eventType: string;
      payload: Record<string, unknown>;
    }>;
  }
}

export const altusRunRedisStateService = new AltusRunRedisStateService();
