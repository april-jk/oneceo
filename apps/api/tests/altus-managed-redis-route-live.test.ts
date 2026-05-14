import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { after, beforeEach, test } from 'node:test';
import express from 'express';
import Redis from 'ioredis';
import altusManagedRoutes from '../src/routes/altus-managed-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { closeDatabaseConnection } from '../src/config/database';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { altusManagedSetupService } from '../src/services/altus-managed-setup-service';
import { altusRunCoordinator } from '../src/services/altus-run-coordinator';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { redisClientService } from '../src/services/redis-client-service';
import { altusRunRedisStateService } from '../src/services/altus-run-redis-state-service';
import { deriveTenantKeyForRedis, redisKeyspace } from '../src/services/redis-keyspace';

process.env.ONECEO_REDIS_ENABLED = 'true';
process.env.REDIS_URL = 'redis://127.0.0.1:6379/13';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const inspector = new Redis(process.env.REDIS_URL!);
const runDaoAny = taskSessionRunDAO as any;
const sessionDaoAny = taskCreationSessionDAO as any;
const setupAny = altusManagedSetupService as any;
const coordinatorAny = altusRunCoordinator as any;
const recoveryAny = sessionMcpRecoveryService as any;
const fileStoreAny = taskCreationFileMemoryStore as any;

const originalFindActiveRun = runDaoAny.findActiveRun;
const originalCreateRun = runDaoAny.createRun;
const originalAppendRunEvent = runDaoAny.appendRunEvent;
const originalGetLatestRunEventSequence = runDaoAny.getLatestRunEventSequence;
const originalGetRun = runDaoAny.getRun;
const originalGetLatestRun = runDaoAny.getLatestRun;
const originalListRunEvents = runDaoAny.listRunEvents;
const originalGetSandboxBindingBySession = runDaoAny.getSandboxBindingBySession;
const originalGetMcpToolSnapshot = runDaoAny.getMcpToolSnapshot;
const originalGetSession = sessionDaoAny.getSession;
const originalEnsureOwnership = setupAny.ensureSessionOwnership;
const originalCaptureConnectorSnapshot = setupAny.captureConnectorSnapshot;
const originalCaptureMcpToolSnapshot = setupAny.captureMcpToolSnapshot;
const originalPersistTimelineMessage = setupAny.persistTimelineMessage;
const originalUpdateSessionLifecycle = setupAny.updateSessionLifecycle;
const originalExecute = coordinatorAny.execute;
const originalEnsureRecovered = recoveryAny.ensureSessionRecovered;
const originalGetSessionFile = fileStoreAny.getSession;

function buildIds(prefix: string) {
  const normalized = prefix.padEnd(12, '1').slice(0, 12);
  return {
    sessionId: `11111111-1111-4111-8111-${normalized}`,
    runId: `22222222-2222-4222-8222-${normalized}`,
    userId: '33333333-3333-4333-8333-333333333333',
  };
}

function buildScope(
  sessionId: string,
  runId: string,
  userId = '33333333-3333-4333-8333-333333333333'
) {
  return {
    sessionId,
    runId,
    userId,
    tenantKey: deriveTenantKeyForRedis(userId),
  };
}

function sessionRecord(sessionId: string, userId = '33333333-3333-4333-8333-333333333333') {
  return {
    id: sessionId,
    userId,
    title: 'Managed Session',
    status: 'in_progress',
    stage: 'executing',
    mode: 'altus',
    executor: 'altus',
    runtime: {},
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware());
  app.use('/api/altus-managed', altusManagedRoutes);
  const sockets = new Set<Socket>();

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function testFetch(input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('connection', 'close');
  return fetch(input, {
    ...init,
    headers,
  });
}

beforeEach(async () => {
  await inspector.flushdb();
  runDaoAny.findActiveRun = async () => null;
  runDaoAny.createRun = async (input: { sessionId: string; model?: string | null }) => ({
    id: '22222222-2222-4222-8222-aaaaaaaaaaaa',
    sessionId: input.sessionId,
    status: 'queued',
    mode: 'managed',
    model: input.model || 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  });
  runDaoAny.appendRunEvent = async (input: { runId: string; eventType: string; payloadJson: Record<string, unknown> }) => ({
    id: `event-${input.eventType}`,
    runId: input.runId,
    eventType: input.eventType,
    sequence: 1,
    payloadJson: input.payloadJson,
  });
  runDaoAny.getLatestRunEventSequence = async () => 1;
  runDaoAny.getLatestRun = async (sessionId: string) => ({
    id: '22222222-2222-4222-8222-aaaaaaaaaaaa',
    sessionId,
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    mcpToolSnapshotId: 'mcp-snapshot',
  });
  runDaoAny.getRun = async (runId: string) => ({
    id: runId,
    sessionId: '11111111-1111-4111-8111-aaaaaaaaaaaa',
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    mcpToolSnapshotId: 'mcp-snapshot',
  });
  runDaoAny.getSandboxBindingBySession = async (sessionId: string) => ({
    id: `binding-${sessionId}`,
    sessionId,
    sandboxId: 'sandbox-live',
    workspaceRoot: '/workspace',
    status: 'ready',
    metadataJson: { reused: true },
    updatedAt: new Date(),
    lastActiveAt: new Date(),
  });
  runDaoAny.getMcpToolSnapshot = async () => ({
    id: 'mcp-snapshot',
    snapshotJson: {
      providers: [{ providerId: 'provider-live' }],
    },
    createdAt: new Date(),
  });
  runDaoAny.listRunEvents = async () => {
    throw new Error('db run-event fallback should not be used when redis stream is populated');
  };
  sessionDaoAny.getSession = async (sessionId: string) => sessionRecord(sessionId);
  setupAny.ensureSessionOwnership = async () => undefined;
  setupAny.captureConnectorSnapshot = async () => ({ snapshotId: 'connector-snapshot', statuses: [] });
  setupAny.captureMcpToolSnapshot = async () => ({ snapshotId: 'mcp-snapshot', providers: [] });
  setupAny.persistTimelineMessage = async () => undefined;
  setupAny.updateSessionLifecycle = async () => undefined;
  coordinatorAny.execute = async () => undefined;
  recoveryAny.ensureSessionRecovered = async () => undefined;
  fileStoreAny.getSession = async (sessionId: string) => sessionRecord(sessionId);
});

after(async () => {
  runDaoAny.findActiveRun = originalFindActiveRun;
  runDaoAny.createRun = originalCreateRun;
  runDaoAny.appendRunEvent = originalAppendRunEvent;
  runDaoAny.getLatestRunEventSequence = originalGetLatestRunEventSequence;
  runDaoAny.getRun = originalGetRun;
  runDaoAny.getLatestRun = originalGetLatestRun;
  runDaoAny.listRunEvents = originalListRunEvents;
  runDaoAny.getSandboxBindingBySession = originalGetSandboxBindingBySession;
  runDaoAny.getMcpToolSnapshot = originalGetMcpToolSnapshot;
  sessionDaoAny.getSession = originalGetSession;
  setupAny.ensureSessionOwnership = originalEnsureOwnership;
  setupAny.captureConnectorSnapshot = originalCaptureConnectorSnapshot;
  setupAny.captureMcpToolSnapshot = originalCaptureMcpToolSnapshot;
  setupAny.persistTimelineMessage = originalPersistTimelineMessage;
  setupAny.updateSessionLifecycle = originalUpdateSessionLifecycle;
  coordinatorAny.execute = originalExecute;
  recoveryAny.ensureSessionRecovered = originalEnsureRecovered;
  fileStoreAny.getSession = originalGetSessionFile;
  await inspector.flushdb();
  await inspector.quit();
  await redisClientService.disconnect?.();
  await closeDatabaseConnection().catch(() => undefined);
});

test('live route: POST /sessions/:sessionId/runs writes run coordination keys and run stream', async () => {
  const server = await startServer();
  const ids = buildIds('aaaaaaaaaaaa');
  runDaoAny.createRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'queued',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  });
  const scope = buildScope(ids.sessionId, ids.runId, ids.userId);

  try {
    const response = await testFetch(`${server.origin}/api/altus-managed/sessions/${ids.sessionId}/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': ids.userId,
      },
      body: JSON.stringify({ content: 'start managed run' }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.id, ids.runId);

    const runState = JSON.parse((await inspector.get(redisKeyspace.runState(scope))) || 'null');
    const runOwner = await inspector.get(redisKeyspace.runOwner(scope));
    const runHeartbeat = await inspector.get(redisKeyspace.runHeartbeat(scope));
    const runRecovery = JSON.parse((await inspector.get(redisKeyspace.runRecovery(scope))) || 'null');
    const activeRuns = await inspector.smembers(redisKeyspace.activeRuns(scope.tenantKey));
    const runStreamRows = await inspector.xrange(redisKeyspace.runEventsStream(scope), '-', '+');

    assert.equal(runState.runId, ids.runId);
    assert.equal(runState.status, 'queued');
    assert.equal(runState.sequence, 1);
    assert.ok(runOwner);
    assert.ok(runHeartbeat);
    assert.equal(runRecovery.runId, ids.runId);
    assert.equal(runRecovery.status, 'queued');
    assert.equal(runRecovery.sandbox.sandboxId, 'sandbox-live');
    assert.deepEqual(runRecovery.connectorRuntime.providerIds, ['provider-live']);
    assert.deepEqual(activeRuns, [ids.runId]);
    assert.equal(runStreamRows.length, 1);
  } finally {
    await server.close();
  }
});

test('live route: GET /sessions/:sessionId/runs/latest reconciles recovery snapshot from db facts', async () => {
  const server = await startServer();
  const ids = buildIds('dddddddddddd');
  const scope = buildScope(ids.sessionId, ids.runId, ids.userId);
  runDaoAny.getLatestRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    mcpToolSnapshotId: 'mcp-snapshot',
  });
  runDaoAny.getRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    mcpToolSnapshotId: 'mcp-snapshot',
  });
  sessionDaoAny.getSession = async () => sessionRecord(ids.sessionId, ids.userId);

  try {
    assert.equal(await inspector.get(redisKeyspace.runRecovery(scope)), null);

    const response = await testFetch(`${server.origin}/api/altus-managed/sessions/${ids.sessionId}/runs/latest`, {
      headers: { 'x-test-user-id': ids.userId },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.id, ids.runId);

    const stateRaw = await inspector.get(redisKeyspace.runState(scope));
    const recoveryRaw = await inspector.get(redisKeyspace.runRecovery(scope));
    assert.ok(stateRaw);
    assert.ok(recoveryRaw);
    const recovery = JSON.parse(recoveryRaw!) as {
      status: string;
      sandbox: { sandboxId: string | null };
      connectorRuntime: { providerIds: string[] };
    };
    assert.equal(recovery.status, 'running');
    assert.equal(recovery.sandbox.sandboxId, 'sandbox-live');
    assert.deepEqual(recovery.connectorRuntime.providerIds, ['provider-live']);
  } finally {
    await server.close();
  }
});

test('live route: GET /runs/:runId/stream replays redis run stream before db fallback', async () => {
  const server = await startServer();
  const ids = buildIds('bbbbbbbbbbbb');
  const scope = buildScope(ids.sessionId, ids.runId, ids.userId);
  runDaoAny.getRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  });
  sessionDaoAny.getSession = async () => sessionRecord(ids.sessionId, ids.userId);

  await altusRunRedisStateService.registerRun({
    runId: ids.runId,
    sessionId: ids.sessionId,
    userId: ids.userId,
    model: 'test-model',
    status: 'running',
  });
  await altusRunRedisStateService.appendRunEvent({
    runId: ids.runId,
    sessionId: ids.sessionId,
    userId: ids.userId,
    eventId: 'event-1',
    eventType: 'run_status',
    sequence: 3,
    payload: {
      status: 'running',
      content: 'from redis run stream',
      transitionReason: 'model_retryable_error',
      currentRound: 2,
      maxRounds: 192,
    },
  });

  try {
    const rows = await inspector.xrange(redisKeyspace.runEventsStream(scope), '-', '+');
    assert.equal(rows.length, 1);

    const response = await testFetch(`${server.origin}/api/altus-managed/runs/${ids.runId}/stream?afterSequence=2`, {
      headers: { 'x-test-user-id': ids.userId },
    });
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';

    try {
      for (let i = 0; i < 4; i += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (text.includes('from redis run stream')) {
          break;
        }
      }
    } finally {
      await response.body?.cancel().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    assert.match(text, /from redis run stream/);
    assert.match(text, /event: run_status/);
    assert.doesNotMatch(text, /transitionReason/);
    assert.doesNotMatch(text, /currentRound/);
    assert.doesNotMatch(text, /maxRounds/);

    const persistedRows = await inspector.xrange(redisKeyspace.runEventsStream(scope), '-', '+');
    const serialized = JSON.stringify(persistedRows);
    assert.match(serialized, /transitionReason/);
    assert.match(serialized, /model_retryable_error/);
  } finally {
    await server.close();
  }
});

test('live route: GET /runs/:runId/stream rejects missing auth even when query userId is present', async () => {
  const server = await startServer();
  const ids = buildIds('eeeeeeeeeeee');
  const scope = buildScope(ids.sessionId, ids.runId, ids.userId);
  runDaoAny.getRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  });
  sessionDaoAny.getSession = async () => sessionRecord(ids.sessionId, ids.userId);

  await altusRunRedisStateService.registerRun({
    runId: ids.runId,
    sessionId: ids.sessionId,
    userId: ids.userId,
    model: 'test-model',
    status: 'running',
  });
  await altusRunRedisStateService.appendRunEvent({
    runId: ids.runId,
    sessionId: ids.sessionId,
    userId: ids.userId,
    eventId: 'event-query-user',
    eventType: 'assistant_message',
    sequence: 4,
    payload: {
      content: 'from query user id auth',
    },
  });

  try {
    const response = await testFetch(
      `${server.origin}/api/altus-managed/runs/${ids.runId}/stream?afterSequence=3&userId=${ids.userId}`
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('live route: GET /runs/:runId/stream rejects foreign authenticated user even if query userId matches owner', async () => {
  const server = await startServer();
  const ids = buildIds('ffffffffffff');
  runDaoAny.getRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'running',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  });
  sessionDaoAny.getSession = async () => sessionRecord(ids.sessionId, ids.userId);

  try {
    const response = await testFetch(
      `${server.origin}/api/altus-managed/runs/${ids.runId}/stream?userId=${ids.userId}`,
      {
        headers: { 'x-test-user-id': '44444444-4444-4444-8444-444444444444' },
      }
    );
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});

test('live route: POST /runs/:runId/stop writes redis stop request', async () => {
  const server = await startServer();
  const ids = buildIds('cccccccccccc');
  const scope = buildScope(ids.sessionId, ids.runId, ids.userId);
  runDaoAny.getRun = async () => ({
    id: ids.runId,
    sessionId: ids.sessionId,
    status: 'completed',
    mode: 'managed',
    model: 'test-model',
    stopReason: null,
    startedAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
  });
  runDaoAny.getLatestRunEventSequence = async () => 2;

  try {
    const response = await testFetch(`${server.origin}/api/altus-managed/runs/${ids.runId}/stop`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': ids.userId,
      },
      body: JSON.stringify({ reason: 'user_interrupt' }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.id, ids.runId);

    const raw = await inspector.get(redisKeyspace.runStop(scope));
    assert.ok(raw);
    const stored = JSON.parse(raw!);
    assert.equal(stored.reason, 'user_interrupt');
    assert.equal(stored.runId, ids.runId);
    assert.equal(stored.sessionId, ids.sessionId);
  } finally {
    await server.close();
  }
});
