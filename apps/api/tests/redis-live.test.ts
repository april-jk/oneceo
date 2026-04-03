import test from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { AltusRunRedisStateService } from '../src/services/altus-run-redis-state-service';
import { RedisClientService } from '../src/services/redis-client-service';
import { hashRedisKeyPart, redisKeyspace } from '../src/services/redis-keyspace';
import { TaskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';

function getRedisUrl() {
  return String(process.env.REDIS_URL || '').trim();
}

test('live redis integration writes run state, recovery snapshot and terminal cleanup', async (t) => {
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
  const recoveryKey = redisKeyspace.runRecovery({
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

  await service.setRecoverySnapshot({
    userId,
    sessionId,
    runId,
    status: 'running',
    sequence: 1,
    model: 'live-model',
    sandbox: {
      sandboxId: 'sandbox-live',
      workspaceRoot: '/workspace',
      reused: true,
      updatedAt: new Date('2026-04-03T12:00:00.000Z'),
    },
    connectorRuntime: {
      providerIds: ['provider-live'],
      updatedAt: new Date('2026-04-03T12:00:01.000Z'),
    },
    stream: {
      latestSequence: 1,
      latestEventType: 'run_status',
    },
  });
  const recoveryRaw = await raw.get(recoveryKey);
  assert.ok(recoveryRaw);
  const recovery = JSON.parse(recoveryRaw) as {
    status: string;
    connectorRuntime: { providerIds: string[] };
    stream: { latestSequence: number };
  };
  assert.equal(recovery.status, 'running');
  assert.deepEqual(recovery.connectorRuntime.providerIds, ['provider-live']);
  assert.equal(recovery.stream.latestSequence, 1);

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

  await service.clearStopRequest({
    userId,
    sessionId,
    runId,
  });
  await service.clearRecoverySnapshot({
    userId,
    sessionId,
    runId,
  });
  assert.equal(await raw.get(stopKey), null);
  assert.equal(await raw.get(recoveryKey), null);
});

test('live redis integration writes session workspace cache, recent page and session-event stream', async (t) => {
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
  const userId = `live-session-user-${suffix}`;
  const sessionId = `live-session-${suffix}`;
  const tenantKey = userId;
  t.after(async () => {
    const keys = await raw.keys(`oneceo:v1:tenant:${tenantKey}*`);
    if (keys.length > 0) {
      await raw.del(...keys);
    }
    raw.disconnect();
  });

  const commandPort = new RedisClientService();
  const service = new TaskSessionRedisCacheService(commandPort);
  t.after(async () => {
    await commandPort.disconnect?.();
  });

  await service.setWorkspaceTree({
    userId,
    sessionId,
    payload: {
      root: '/workspace',
      items: [{ path: 'src', type: 'dir' }],
    },
  });
  await service.setRecentMessagesPage({
    userId,
    sessionId,
    payload: {
      messages: [{ id: 'm-1', role: 'user', content: 'hello redis' }],
      source: 'recent_cache',
    },
  });
  await service.appendSessionEvent({
    userId,
    sessionId,
    eventType: 'status_update',
    messageType: 'status_update',
    eventId: 501,
    createdAt: new Date().toISOString(),
    messageKey: `session-event:${sessionId}:501`,
    content: 'processing',
    metadata: { sessionEventSeq: 501 },
  });

  const treeKey = redisKeyspace.workspaceTree({
    tenantKey,
    sessionId,
    pathHash: hashRedisKeyPart('root'),
  });
  const recentKey = redisKeyspace.messagesRecent({
    tenantKey,
    sessionId,
  });
  const eventStreamKey = redisKeyspace.sessionEventsStream({
    tenantKey,
    sessionId,
  });

  const treeRaw = await raw.get(treeKey);
  const recentRaw = await raw.get(recentKey);
  const streamRows = await raw.xrange(eventStreamKey, '-', '+');

  assert.ok(treeRaw);
  assert.ok(recentRaw);
  assert.ok(streamRows.length >= 1);

  const recent = JSON.parse(recentRaw) as { source: string; messages: Array<{ content: string }> };
  assert.equal(recent.source, 'recent_cache');
  assert.equal(recent.messages[0]?.content, 'hello redis');
});
