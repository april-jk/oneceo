import test from 'node:test';
import assert from 'node:assert/strict';
import { AltusRunRedisStateService } from '../src/services/altus-run-redis-state-service';
import { RedisClientService, type RedisCommandPort, type RedisStreamEntry } from '../src/services/redis-client-service';
import { deriveTenantKeyForRedis, hashRedisKeyPart, redisKeyspace } from '../src/services/redis-keyspace';

class FakeRedisPort implements RedisCommandPort {
  readonly json = new Map<string, unknown>();
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly streams = new Map<string, RedisStreamEntry[]>();

  isEnabled() {
    return true;
  }

  async getJson<T>(key: string) {
    return (this.json.get(key) as T | undefined) ?? null;
  }

  async setJson(key: string, value: unknown) {
    this.json.set(key, value);
  }

  async setString(key: string, value: string) {
    this.strings.set(key, value);
    return true;
  }

  async getString(key: string) {
    return this.strings.get(key) ?? null;
  }

  async delete(key: string) {
    this.json.delete(key);
    this.strings.delete(key);
    this.streams.delete(key);
  }

  async addSetMember(key: string, member: string) {
    const next = this.sets.get(key) || new Set<string>();
    next.add(member);
    this.sets.set(key, next);
  }

  async removeSetMember(key: string, member: string) {
    const next = this.sets.get(key);
    next?.delete(member);
  }

  async listSetMembers(key: string) {
    return Array.from(this.sets.get(key) || []);
  }

  async deleteByPrefix(prefix: string) {
    let deleted = 0;
    for (const key of Array.from(this.json.keys())) {
      if (key.startsWith(prefix)) {
        this.json.delete(key);
        deleted += 1;
      }
    }
    for (const key of Array.from(this.strings.keys())) {
      if (key.startsWith(prefix)) {
        this.strings.delete(key);
        deleted += 1;
      }
    }
    for (const key of Array.from(this.streams.keys())) {
      if (key.startsWith(prefix)) {
        this.streams.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async appendStream(key: string, fields: Record<string, string | number | boolean | null | undefined>) {
    const entries = this.streams.get(key) || [];
    entries.push({
      id: `stream-${entries.length + 1}`,
      fields: Object.fromEntries(
        Object.entries(fields)
          .filter(([, value]) => value !== undefined)
          .map(([field, value]) => [field, value === null ? '' : String(value)])
      ),
    });
    this.streams.set(key, entries);
    return entries[entries.length - 1]?.id || null;
  }

  async readStream(key: string) {
    return this.streams.get(key) || [];
  }
}

test('redis keyspace follows tenant -> session -> run hierarchy', () => {
  assert.equal(deriveTenantKeyForRedis('user-1'), 'user-1');
  assert.equal(deriveTenantKeyForRedis('user-1', 'tenant-9'), 'tenant-9');
  assert.match(hashRedisKeyPart('/workspace/src/index.ts'), /^[a-f0-9]{16}$/);

  assert.equal(
    redisKeyspace.messagesRecent({ tenantKey: 'tenant-1', sessionId: 'session-1' }),
    'oneceo:v1:tenant:tenant-1:session:session-1:cache:messages:recent'
  );
  assert.equal(
    redisKeyspace.runEventsStream({ tenantKey: 'tenant-1', sessionId: 'session-1', runId: 'run-1' }),
    'oneceo:v1:tenant:tenant-1:session:session-1:run:run-1:stream'
  );
});

test('redis client stays disabled unless ONECEO_REDIS_ENABLED is explicitly true', () => {
  const previousToggle = process.env.ONECEO_REDIS_ENABLED;
  const previousUrl = process.env.REDIS_URL;
  try {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    delete process.env.ONECEO_REDIS_ENABLED;
    assert.equal(new RedisClientService().isEnabled(), false);

    process.env.ONECEO_REDIS_ENABLED = 'false';
    assert.equal(new RedisClientService().isEnabled(), false);

    process.env.ONECEO_REDIS_ENABLED = 'true';
    assert.equal(new RedisClientService().isEnabled(), true);
  } finally {
    if (previousToggle === undefined) {
      delete process.env.ONECEO_REDIS_ENABLED;
    } else {
      process.env.ONECEO_REDIS_ENABLED = previousToggle;
    }
    if (previousUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousUrl;
    }
  }
});

test('altus redis state service writes minimal run coordination keys and stream events', async () => {
  const fakeRedis = new FakeRedisPort();
  const service = new AltusRunRedisStateService(fakeRedis);

  await service.registerRun({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    model: 'gpt-test',
    status: 'queued',
  });

  const stateKey = redisKeyspace.runState({
    tenantKey: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
  });
  const activeRunsKey = redisKeyspace.activeRuns('user-1');
  const state = (await fakeRedis.getJson<{
    status: string;
    sequence: number;
    model?: string | null;
  }>(stateKey)) || { status: '', sequence: -1 };

  assert.equal(state.status, 'queued');
  assert.equal(state.sequence, 0);
  assert.equal(state.model, 'gpt-test');
  assert.equal(fakeRedis.sets.get(activeRunsKey)?.has('run-1'), true);

  await service.appendRunEvent({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    eventId: 'evt-1',
    eventType: 'run_status',
    sequence: 1,
    payload: {
      status: 'running',
      content: 'started',
    },
  });

  const events = await service.listRunEvents({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    afterSequence: 0,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, 'run_status');
  assert.equal(events[0]?.payload.status, 'running');

  await service.setRecoverySnapshot({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'running',
    sequence: 1,
    model: 'gpt-test',
    sandbox: {
      sandboxId: 'sbx-1',
      workspaceRoot: '/workspace',
      reused: true,
      updatedAt: new Date('2026-04-03T11:00:00.000Z'),
    },
    connectorRuntime: {
      providerIds: ['provider-a'],
      updatedAt: new Date('2026-04-03T11:01:00.000Z'),
    },
    stream: {
      latestSequence: 1,
      latestEventType: 'run_status',
    },
  });
  const recovery = await service.getRecoverySnapshot({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
  });
  assert.equal(recovery?.status, 'running');
  assert.deepEqual(recovery?.connectorRuntime.providerIds, ['provider-a']);
  assert.equal(recovery?.stream.latestSequence, 1);
  assert.deepEqual(await service.listActiveRuns('user-1'), ['run-1']);
  assert.equal(
    await service.hasLiveHeartbeat({
      userId: 'user-1',
      sessionId: 'session-1',
      runId: 'run-1',
    }),
    true
  );

  await service.syncRunStatus({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'completed',
    sequence: 1,
  });

  const terminalState = (await fakeRedis.getJson<{ status: string }>(stateKey)) || { status: '' };
  assert.equal(terminalState.status, 'completed');
  assert.equal(fakeRedis.sets.get(activeRunsKey)?.has('run-1'), false);

  await service.clearStopRequest({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
  });
  await service.clearRecoverySnapshot({
    userId: 'user-1',
    sessionId: 'session-1',
    runId: 'run-1',
  });
  assert.equal(
    await service.getRecoverySnapshot({
      userId: 'user-1',
      sessionId: 'session-1',
      runId: 'run-1',
    }),
    null
  );
});
