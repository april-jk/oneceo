import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { sandboxExecutionEnvironmentDAO } from '../src/db/dao';
import {
  clearSandboxDirty,
  extractInactivityTimeoutMs,
  extractPendingArchiveUpdate,
  markSandboxDirty,
  touchSandbox,
} from '../src/services/sandbox-activity-service';

type EnvRecord = {
  sessionId: string;
  metadata: Record<string, unknown>;
};

const envMap = new Map<string, EnvRecord>();

const daoAny = sandboxExecutionEnvironmentDAO as any;
const originalGetBySessionId = daoAny.getBySessionId;
const originalUpdateMetadata = daoAny.updateMetadata;

before(() => {
  daoAny.getBySessionId = async (sessionId: string) => envMap.get(sessionId) || null;
  daoAny.updateMetadata = async (sessionId: string, metadata: Record<string, unknown>) => {
    const existing = envMap.get(sessionId);
    if (!existing) return null;
    existing.metadata = metadata;
    envMap.set(sessionId, existing);
    return { ...existing };
  };
});

after(() => {
  daoAny.getBySessionId = originalGetBySessionId;
  daoAny.updateMetadata = originalUpdateMetadata;
});

beforeEach(() => {
  envMap.clear();
});

test('marks and clears dirty flag for archive update', async () => {
  const sessionId = 'sandbox-activity-dirty-1';
  envMap.set(sessionId, {
    sessionId,
    metadata: {
      taskSessionId: 'task-1',
      archiveStatus: 'archived',
    },
  });

  await markSandboxDirty(sessionId, 'opencode_file_change');
  const marked = envMap.get(sessionId)?.metadata || {};
  assert.equal(extractPendingArchiveUpdate(marked), true);
  assert.equal(marked.lastDirtyReason, 'opencode_file_change');
  assert.equal(marked.archiveStatus, 'pending_update');

  await clearSandboxDirty(sessionId);
  const cleared = envMap.get(sessionId)?.metadata || {};
  assert.equal(extractPendingArchiveUpdate(cleared), false);
  assert.ok(typeof cleared.lastDirtyFlushedAt === 'string');
});

test('touchSandbox force mode updates lastActive metadata', async () => {
  const sessionId = 'sandbox-activity-touch-1';
  envMap.set(sessionId, {
    sessionId,
    metadata: {
      taskSessionId: 'task-touch-1',
    },
  });

  await touchSandbox(sessionId, 'opencode_sse_event', { force: true });
  const metadata = envMap.get(sessionId)?.metadata || {};
  assert.equal(metadata.lastActiveReason, 'opencode_sse_event');
  assert.ok(typeof metadata.lastActiveAt === 'string');
});

test('extractInactivityTimeoutMs prefers e2b timeout metadata', async () => {
  const timeoutFromE2b = extractInactivityTimeoutMs({
    e2b: {
      timeoutMs: 600000,
    },
  });
  assert.equal(timeoutFromE2b, 600000);

  const timeoutFromFallback = extractInactivityTimeoutMs({
    sandboxTimeoutMs: 480000,
  });
  assert.equal(timeoutFromFallback, 480000);

  const timeoutMissing = extractInactivityTimeoutMs({});
  assert.equal(timeoutMissing, null);
});
