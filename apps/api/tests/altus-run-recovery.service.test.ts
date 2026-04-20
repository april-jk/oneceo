import assert from 'node:assert/strict';
import test from 'node:test';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { AltusRunRecoveryService } from '../src/services/altus-run-recovery-service';
import { AltusRunRedisStateService } from '../src/services/altus-run-redis-state-service';
import type { RedisCommandPort, RedisStreamEntry } from '../src/services/redis-client-service';

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
    this.sets.get(key)?.delete(member);
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

test('altus run recovery service rebuilds run state from db facts while preserving loop recovery metadata', async () => {
  const redis = new FakeRedisPort();
  const redisState = new AltusRunRedisStateService(redis);
  const service = new AltusRunRecoveryService(redisState);

  await redisState.setRecoverySnapshot({
    userId: 'user-rebuild-1',
    sessionId: 'session-rebuild-1',
    runId: 'run-rebuild-1',
    status: 'running',
    sequence: 2,
    stream: {
      latestSequence: 2,
      latestEventType: 'tool_call_completed',
    },
    loop: {
      lastTransitionReason: 'model_retryable_error',
      recoveryMode: 'model_retry',
      currentRound: 2,
      maxRounds: 192,
      plainTextRecoveryUsed: false,
      lastToolName: 'write_file',
      lastToolCallId: 'tool-rebuild-1',
    },
  });

  const runDaoAny = taskSessionRunDAO as any;
  const sessionDaoAny = taskCreationSessionDAO as any;
  const originalGetLatestRun = runDaoAny.getLatestRun;
  const originalGetRun = runDaoAny.getRun;
  const originalGetLatestRunEventSequence = runDaoAny.getLatestRunEventSequence;
  const originalGetSandboxBindingBySession = runDaoAny.getSandboxBindingBySession;
  const originalGetMcpToolSnapshot = runDaoAny.getMcpToolSnapshot;
  const originalGetSession = sessionDaoAny.getSession;

  runDaoAny.getLatestRun = async (sessionId: string) => ({
    id: 'run-rebuild-1',
    sessionId,
    status: 'running',
    model: 'gpt-rebuild',
    startedAt: new Date('2026-04-03T13:00:00.000Z'),
    completedAt: null,
    stopReason: null,
    mcpToolSnapshotId: 'mcp-rebuild-1',
  });
  runDaoAny.getRun = async () => ({
    id: 'run-rebuild-1',
    sessionId: 'session-rebuild-1',
    status: 'running',
    model: 'gpt-rebuild',
    startedAt: new Date('2026-04-03T13:00:00.000Z'),
    completedAt: null,
    stopReason: null,
    mcpToolSnapshotId: 'mcp-rebuild-1',
  });
  runDaoAny.getLatestRunEventSequence = async () => 8;
  runDaoAny.getSandboxBindingBySession = async () => ({
    sandboxId: 'sandbox-rebuild-1',
    workspaceRoot: '/workspace/rebuild',
    metadataJson: { reused: true },
    updatedAt: new Date('2026-04-03T13:01:00.000Z'),
  });
  runDaoAny.getMcpToolSnapshot = async () => ({
    snapshotJson: {
      providers: [{ providerId: 'provider-rebuild-1' }],
    },
    createdAt: new Date('2026-04-03T13:02:00.000Z'),
  });
  sessionDaoAny.getSession = async () => ({
    id: 'session-rebuild-1',
    userId: 'user-rebuild-1',
  });

  try {
    const latest = await service.reconcileLatestRun('session-rebuild-1', 'user-rebuild-1');
    assert.equal(latest?.id, 'run-rebuild-1');

    const state = await redisState.getRunState({
      userId: 'user-rebuild-1',
      sessionId: 'session-rebuild-1',
      runId: 'run-rebuild-1',
    });
    const recovery = await redisState.getRecoverySnapshot({
      userId: 'user-rebuild-1',
      sessionId: 'session-rebuild-1',
      runId: 'run-rebuild-1',
    });

    assert.equal(state?.status, 'running');
    assert.equal(state?.sequence, 8);
    assert.equal(state?.model, 'gpt-rebuild');
    assert.equal(recovery?.status, 'running');
    assert.equal(recovery?.sandbox.sandboxId, 'sandbox-rebuild-1');
    assert.deepEqual(recovery?.connectorRuntime.providerIds, ['provider-rebuild-1']);
    assert.equal(recovery?.stream.latestSequence, 8);
    assert.equal(recovery?.loop.lastTransitionReason, 'model_retryable_error');
    assert.equal(recovery?.loop.recoveryMode, 'model_retry');
    assert.equal(recovery?.loop.currentRound, 2);
    assert.equal(recovery?.loop.lastToolName, 'write_file');
  } finally {
    runDaoAny.getLatestRun = originalGetLatestRun;
    runDaoAny.getRun = originalGetRun;
    runDaoAny.getLatestRunEventSequence = originalGetLatestRunEventSequence;
    runDaoAny.getSandboxBindingBySession = originalGetSandboxBindingBySession;
    runDaoAny.getMcpToolSnapshot = originalGetMcpToolSnapshot;
    sessionDaoAny.getSession = originalGetSession;
  }
});

test('altus run recovery service clears stale stop and recovery snapshots for terminal runs', async () => {
  const redis = new FakeRedisPort();
  const redisState = new AltusRunRedisStateService(redis);
  const service = new AltusRunRecoveryService(redisState);

  await redisState.registerRun({
    userId: 'user-terminal-1',
    sessionId: 'session-terminal-1',
    runId: 'run-terminal-1',
    status: 'running',
    model: 'gpt-terminal',
  });
  await redisState.requestStop(
    {
      userId: 'user-terminal-1',
      sessionId: 'session-terminal-1',
      runId: 'run-terminal-1',
    },
    'user_interrupt'
  );
  await redisState.setRecoverySnapshot({
    userId: 'user-terminal-1',
    sessionId: 'session-terminal-1',
    runId: 'run-terminal-1',
    status: 'running',
    sequence: 3,
    stream: {
      latestSequence: 3,
      latestEventType: 'run_status',
    },
  });

  const runDaoAny = taskSessionRunDAO as any;
  const sessionDaoAny = taskCreationSessionDAO as any;
  const originalGetLatestRun = runDaoAny.getLatestRun;
  const originalGetRun = runDaoAny.getRun;
  const originalGetLatestRunEventSequence = runDaoAny.getLatestRunEventSequence;
  const originalGetSession = sessionDaoAny.getSession;

  runDaoAny.getLatestRun = async (sessionId: string) => ({
    id: 'run-terminal-1',
    sessionId,
    status: 'completed',
    model: 'gpt-terminal',
    startedAt: new Date('2026-04-03T13:05:00.000Z'),
    completedAt: new Date('2026-04-03T13:06:00.000Z'),
    stopReason: null,
    mcpToolSnapshotId: null,
  });
  runDaoAny.getRun = async () => ({
    id: 'run-terminal-1',
    sessionId: 'session-terminal-1',
    status: 'completed',
    model: 'gpt-terminal',
    startedAt: new Date('2026-04-03T13:05:00.000Z'),
    completedAt: new Date('2026-04-03T13:06:00.000Z'),
    stopReason: null,
    mcpToolSnapshotId: null,
  });
  runDaoAny.getLatestRunEventSequence = async () => 4;
  sessionDaoAny.getSession = async () => ({
    id: 'session-terminal-1',
    userId: 'user-terminal-1',
  });

  try {
    await service.reconcileLatestRun('session-terminal-1', 'user-terminal-1');
    const recovery = await redisState.getRecoverySnapshot({
      userId: 'user-terminal-1',
      sessionId: 'session-terminal-1',
      runId: 'run-terminal-1',
    });
    const stopReason = await redis.getString('oneceo:v1:tenant:user-terminal-1:session:session-terminal-1:run:run-terminal-1:stop');
    const state = await redisState.getRunState({
      userId: 'user-terminal-1',
      sessionId: 'session-terminal-1',
      runId: 'run-terminal-1',
    });

    assert.equal(recovery, null);
    assert.equal(stopReason, null);
    assert.equal(state?.status, 'completed');
  } finally {
    runDaoAny.getLatestRun = originalGetLatestRun;
    runDaoAny.getRun = originalGetRun;
    runDaoAny.getLatestRunEventSequence = originalGetLatestRunEventSequence;
    sessionDaoAny.getSession = originalGetSession;
  }
});
