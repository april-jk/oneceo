import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  __resetSandboxArchiveJobDepsForTest,
  __setSandboxArchiveJobDepsForTest,
  runSandboxArchiveJobOnceForTest,
} from '../src/services/sandbox-archive-job';

type ReadyEnvRecord = {
  sessionId: string;
  vmName: string | null;
  status: 'ready';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

const envMap = new Map<string, ReadyEnvRecord>();
const archiveCalls: Array<{ sessionId: string; reason: string }> = [];
const pauseCalls: string[] = [];
const metadataUpdates: Array<{ sessionId: string; patch: Record<string, unknown> }> = [];
const statusUpdates: Array<{ sessionId: string; status: string }> = [];

function nowMinusMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

beforeEach(() => {
  envMap.clear();
  archiveCalls.length = 0;
  pauseCalls.length = 0;
  metadataUpdates.length = 0;
  statusUpdates.length = 0;

  process.env.E2B_TIMEOUT_MS = '600000';
  process.env.E2B_ARCHIVE_PRE_TIMEOUT_BUFFER_MS = '120000';
  process.env.E2B_ARCHIVE_PENDING_NOTICE_MS = '300000';

  __resetSandboxArchiveJobDepsForTest();
  __setSandboxArchiveJobDepsForTest({
    sandboxExecutionEnvironmentDAO: {
      listByStatus: async () => Array.from(envMap.values()),
      updateStatus: async (sessionId: string, status: string) => {
        statusUpdates.push({ sessionId, status });
        return null as any;
      },
    } as any,
    archiveSandboxWorkspace: async (sessionId: string, reason: string) => {
      archiveCalls.push({ sessionId, reason });
      return {
        uploaded: true,
        archiveKey: `sessions/${sessionId}/workspace.tar.gz`,
        snapshotKey: `sessions/${sessionId}/snapshots/1.tar.gz`,
        metadataKey: `sessions/${sessionId}/metadata.json`,
        archivedAt: new Date().toISOString(),
        sha256: 'hash',
        sizeBytes: 123,
        taskSessionId: sessionId,
        workspaceRoot: `/workspace/${sessionId}`,
      };
    },
    isArchiveStorageConfigured: () => true,
    e2bConnector: {
      pauseSandbox: async (sessionId: string) => {
        pauseCalls.push(sessionId);
      },
    } as any,
    setSandboxMetadata: async (sessionId: string, patch: Record<string, unknown>) => {
      metadataUpdates.push({ sessionId, patch });
      const env = envMap.get(sessionId);
      if (env) {
        env.metadata = { ...env.metadata, ...patch };
        envMap.set(sessionId, env);
      }
    },
  });
});

afterEach(() => {
  __resetSandboxArchiveJobDepsForTest();
});

test('before timeout window: does not archive or pause, only marks pending update notice', async () => {
  const sessionId = 'archive-job-before-timeout';
  envMap.set(sessionId, {
    sessionId,
    vmName: null,
    status: 'ready',
    metadata: {
      sandboxProvider: 'e2b',
      taskSessionId: 'task-before',
      pendingArchiveUpdate: true,
      e2b: { timeoutMs: 600000 },
      lastActiveAt: nowMinusMs(120000),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await runSandboxArchiveJobOnceForTest();

  assert.equal(archiveCalls.length, 0);
  assert.equal(pauseCalls.length, 0);
  assert.ok(metadataUpdates.some((item) => item.patch.archiveStatus === 'pending_update'));
});

test('within timeout window + dirty: archives then pauses sandbox', async () => {
  const sessionId = 'archive-job-dirty-timeout';
  envMap.set(sessionId, {
    sessionId,
    vmName: null,
    status: 'ready',
    metadata: {
      sandboxProvider: 'e2b',
      taskSessionId: 'task-dirty',
      pendingArchiveUpdate: true,
      e2b: { timeoutMs: 600000 },
      lastActiveAt: nowMinusMs(9 * 60 * 1000),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await runSandboxArchiveJobOnceForTest();

  assert.equal(archiveCalls.length, 1);
  assert.equal(archiveCalls[0].sessionId, sessionId);
  assert.equal(archiveCalls[0].reason, 'idle_timeout');
  assert.deepEqual(pauseCalls, [sessionId]);
});

test('within timeout window + clean snapshot: skips archive upload and pauses', async () => {
  const sessionId = 'archive-job-clean-timeout';
  envMap.set(sessionId, {
    sessionId,
    vmName: null,
    status: 'ready',
    metadata: {
      sandboxProvider: 'e2b',
      taskSessionId: 'task-clean',
      pendingArchiveUpdate: false,
      e2b: { timeoutMs: 600000 },
      lastActiveAt: nowMinusMs(9 * 60 * 1000),
      r2ArchiveKey: 'sessions/task-clean/workspace.tar.gz',
      lastArchivedAt: nowMinusMs(2 * 60 * 1000),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await runSandboxArchiveJobOnceForTest();

  assert.equal(archiveCalls.length, 0);
  assert.deepEqual(pauseCalls, [sessionId]);
  assert.ok(metadataUpdates.some((item) => item.patch.archiveStatus === 'up_to_date'));
});
