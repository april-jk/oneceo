import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  sandboxExecutionEnvironmentDAO,
  taskSessionConnectorBindingDAO,
  taskSessionMcpRecoveryJobDAO,
} from '../src/db/dao';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { taskSessionRedisCacheService } from '../src/services/task-session-redis-cache-service';

afterEach(() => {
  mock.restoreAll();
});

test('isSessionAlreadyRecovered accepts notion only on the Composio brokered transport', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      taskSessionId: 'session-1',
      connectorKey: 'notion',
      desiredState: 'attached',
      orchestratorSessionId: 'orch-1',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-notion',
      runtimeTransport: 'api_brokered_mcp',
      runtimeAttachedToolsJson: [{ toolName: 'notion__COMPOSIO_SEARCH_TOOLS' }],
      recoveryCompletedAt: new Date(),
    },
  ] as any);
  mock.method(taskSessionMcpRecoveryJobDAO, 'listActiveByTaskSession', async () => [] as any);

  const serviceAny = sessionMcpRecoveryService as any;
  const recovered = await serviceAny.isSessionAlreadyRecovered('session-1', 'orch-1');

  assert.equal(recovered, true);
});

test('isSessionAlreadyRecovered rejects legacy notion remote_sse bindings', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      taskSessionId: 'session-1',
      connectorKey: 'notion',
      desiredState: 'attached',
      orchestratorSessionId: 'orch-1',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-notion',
      runtimeTransport: 'remote_sse',
      runtimeAttachedToolsJson: [{ toolName: 'notion_list_pages' }],
      recoveryCompletedAt: new Date(),
    },
  ] as any);
  mock.method(taskSessionMcpRecoveryJobDAO, 'listActiveByTaskSession', async () => [] as any);

  const serviceAny = sessionMcpRecoveryService as any;
  const recovered = await serviceAny.isSessionAlreadyRecovered('session-1', 'orch-1');

  assert.equal(recovered, false);
});

test('isSessionAlreadyRecovered accepts Supabase only on the Composio brokered transport', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      taskSessionId: 'session-1',
      connectorKey: 'supabase',
      desiredState: 'attached',
      orchestratorSessionId: 'orch-1',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-supabase',
      runtimeTransport: 'api_brokered_mcp',
      runtimeAttachedToolsJson: [{ toolName: 'supabase__COMPOSIO_SEARCH_TOOLS' }],
      recoveryCompletedAt: new Date(),
    },
  ] as any);
  mock.method(taskSessionMcpRecoveryJobDAO, 'listActiveByTaskSession', async () => [] as any);

  const serviceAny = sessionMcpRecoveryService as any;
  const recovered = await serviceAny.isSessionAlreadyRecovered('session-1', 'orch-1');

  assert.equal(recovered, true);
});

test('isSessionAlreadyRecovered rejects legacy Supabase remote bindings', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      taskSessionId: 'session-1',
      connectorKey: 'supabase',
      desiredState: 'attached',
      orchestratorSessionId: 'orch-1',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-supabase-legacy',
      runtimeTransport: 'http_stream',
      runtimeAttachedToolsJson: [{ toolName: 'supabase_list_projects' }],
      recoveryCompletedAt: new Date(),
    },
  ] as any);
  mock.method(taskSessionMcpRecoveryJobDAO, 'listActiveByTaskSession', async () => [] as any);

  const serviceAny = sessionMcpRecoveryService as any;
  const recovered = await serviceAny.isSessionAlreadyRecovered('session-1', 'orch-1');

  assert.equal(recovered, false);
});

test('markPendingRecoverByOrchestratorSessionId does not rewrite Composio notion transport to remote_sse', async () => {
  mock.method(sandboxExecutionEnvironmentDAO, 'getBySessionId', async () => ({
    sessionId: 'orch-1',
    metadata: {
      taskSessionId: 'session-1',
    },
  }) as any);
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      id: 'binding-1',
      taskSessionId: 'session-1',
      connectorKey: 'notion',
      desiredState: 'attached',
      runtimeTransport: 'api_brokered_mcp',
    },
  ] as any);
  const updateMock = mock.method(
    taskSessionConnectorBindingDAO,
    'updateRuntimeByBindingId',
    async () => ({} as any)
  );
  mock.method(
    taskSessionRedisCacheService,
    'invalidateConnectorProjectionBySessionId',
    async () => undefined as any
  );

  await sessionMcpRecoveryService.markPendingRecoverByOrchestratorSessionId('orch-1');

  assert.equal(updateMock.mock.callCount(), 1);
  assert.equal(updateMock.mock.calls[0]?.arguments[0], 'binding-1');
  const patch = updateMock.mock.calls[0]?.arguments[1] as Record<string, unknown>;
  assert.equal(patch.runtimeStatus, 'pending_recover');
  assert.equal(patch.runtimeTransport, undefined);
  assert.equal(patch.lastError, 'sandbox_unavailable_pending_recover');
});
