import test from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { AltusRunRedisStateService } from '../src/services/altus-run-redis-state-service';
import { RedisClientService } from '../src/services/redis-client-service';
import { redisKeyspace } from '../src/services/redis-keyspace';

function getRedisUrl() {
  return String(process.env.REDIS_URL || '').trim();
}

test('live redis integration writes run state and stream entries', async (t) => {
  process.env.ONECEO_REDIS_ENABLED = 'true';
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    t.skip('REDIS_URL 未设置，跳过 live redis 集成测试');
    return;
  }

  const raw = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await raw.connect();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const userId = `live-user-${suffix}`;
  const sessionId = `live-session-${suffix}`;
  const runId = `live-run-${suffix}`;
  const tenantKey = userId;
  t.after(async () => {
    const keys = await raw.keys(`oneceo:v1:tenant:${tenantKey}*`);
    if (keys.length > 0) {
      await raw.del(...keys);
    }
    raw.disconnect();
  });

  const commandPort = new RedisClientService();
  const service = new AltusRunRedisStateService(commandPort);
  t.after(async () => {
    await commandPort.disconnect?.();
  });

  await service.registerRun({
    userId,
    sessionId,
    runId,
    model: 'live-model',
    status: 'queued',
  });

  await service.appendRunEvent({
    userId,
    sessionId,
    runId,
    eventId: 'evt-live-1',
    eventType: 'run_status',
    sequence: 1,
    payload: {
      status: 'running',
      content: 'run started',
    },
  });

  await service.syncRunStatus({
    userId,
    sessionId,
    runId,
    status: 'running',
    sequence: 1,
    model: 'live-model',
  });

  const stateKey = redisKeyspace.runState({
    tenantKey,
    sessionId,
    runId,
  });
  const ownerKey = redisKeyspace.runOwner({
    tenantKey,
    sessionId,
    runId,
  });
  const heartbeatKey = redisKeyspace.runHeartbeat({
    tenantKey,
    sessionId,
    runId,
  });
  const stopKey = redisKeyspace.runStop({
    tenantKey,
    sessionId,
    runId,
  });
  const activeRunsKey = redisKeyspace.activeRuns(tenantKey);
  const streamKey = redisKeyspace.runEventsStream({
    tenantKey,
    sessionId,
    runId,
  });

  const stateRaw = await raw.get(stateKey);
  const ownerRaw = await raw.get(ownerKey);
  const heartbeatRaw = await raw.get(heartbeatKey);
  const activeRuns = await raw.smembers(activeRunsKey);
  const streamRows = await raw.xrange(streamKey, '-', '+');

  assert.ok(stateRaw);
  assert.ok(ownerRaw);
  assert.ok(heartbeatRaw);
  const state = JSON.parse(stateRaw) as { status: string; sequence: number; model?: string };
  assert.equal(state.status, 'running');
  assert.equal(state.sequence, 1);
  assert.equal(state.model, 'live-model');
  assert.deepEqual(activeRuns, [runId]);
  assert.ok(streamRows.length >= 1);
  assert.equal(
    streamRows.some((row) => row?.[1]?.includes('eventType') && row?.[1]?.includes('run_status')),
    true
  );

  await service.requestStop(
    {
      userId,
      sessionId,
      runId,
    },
    'user_interrupt'
  );
  const stopRaw = await raw.get(stopKey);
  assert.ok(stopRaw);

  await service.syncRunStatus({
    userId,
    sessionId,
    runId,
    status: 'completed',
    sequence: 1,
    model: 'live-model',
  });

  const activeRunsAfter = await raw.smembers(activeRunsKey);
  const ownerAfter = await raw.get(ownerKey);
  const heartbeatAfter = await raw.get(heartbeatKey);
  const terminalStateRaw = await raw.get(stateKey);
  assert.deepEqual(activeRunsAfter, []);
  assert.equal(ownerAfter, null);
  assert.equal(heartbeatAfter, null);
  assert.ok(terminalStateRaw);
  const terminalState = JSON.parse(terminalStateRaw) as { status: string };
  assert.equal(terminalState.status, 'completed');
});
