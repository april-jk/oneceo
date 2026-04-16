import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskSessionConnectorBindingDAO } from '../src/db/dao';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';

afterEach(() => {
  mock.restoreAll();
});

test('migrateLegacyNotionBindingsToRemoteSse rewrites attached notion bindings to pending recover', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      taskSessionId: 'session-1',
      connectorKey: 'notion',
      desiredState: 'attached',
      runtimeTransport: 'streamable_http',
    },
  ] as any);
  const updateMock = mock.method(taskSessionConnectorBindingDAO, 'updateRuntime', async () => ({} as any));
  const invalidateMock = mock.method(
    taskSessionRedisCacheService,
    'invalidateConnectorProjectionBySessionId',
    async () => undefined as any
  );

  const serviceAny = sessionMcpRecoveryService as any;
  const migratedCount = await serviceAny.migrateLegacyNotionBindingsToRemoteSse('session-1');

  assert.equal(migratedCount, 1);
  assert.equal(updateMock.mock.callCount(), 1);
  assert.equal(updateMock.mock.calls[0]?.arguments[0], 'session-1');
  assert.equal(updateMock.mock.calls[0]?.arguments[1], 'notion');
  const patch = updateMock.mock.calls[0]?.arguments[2] as Record<string, unknown>;
  assert.equal(patch.runtimeStatus, 'pending_recover');
  assert.equal(patch.runtimeProviderId, null);
  assert.deepEqual(patch.runtimeAttachedToolsJson, []);
  assert.equal(patch.runtimeTransport, 'remote_sse');
  assert.equal(patch.lastError, 'notion_remote_sse_migration_pending_recover');
  assert.ok(patch.recoveryQueuedAt instanceof Date);
  assert.equal(invalidateMock.mock.callCount(), 1);
  assert.equal(invalidateMock.mock.calls[0]?.arguments[0], 'session-1');
});

test('migrateLegacyNotionBindingsToRemoteSse clears detached notion bindings to remote_sse', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByConnectorKey', async () => [
    {
      taskSessionId: 'session-2',
      connectorKey: 'notion',
      desiredState: 'detached',
      runtimeTransport: 'streamable_http',
    },
  ] as any);
  const updateMock = mock.method(taskSessionConnectorBindingDAO, 'updateRuntime', async () => ({} as any));
  const invalidateMock = mock.method(
    taskSessionRedisCacheService,
    'invalidateConnectorProjectionBySessionId',
    async () => undefined as any
  );

  const serviceAny = sessionMcpRecoveryService as any;
  const migratedCount = await serviceAny.migrateLegacyNotionBindingsToRemoteSse();

  assert.equal(migratedCount, 1);
  const patch = updateMock.mock.calls[0]?.arguments[2] as Record<string, unknown>;
  assert.equal(patch.runtimeStatus, 'detached');
  assert.equal(patch.runtimeProviderId, null);
  assert.deepEqual(patch.runtimeAttachedToolsJson, []);
  assert.equal(patch.runtimeTransport, 'remote_sse');
  assert.equal(patch.lastError, null);
  assert.equal(patch.recoveryQueuedAt, null);
  assert.equal(invalidateMock.mock.callCount(), 1);
  assert.equal(invalidateMock.mock.calls[0]?.arguments[0], 'session-2');
});
