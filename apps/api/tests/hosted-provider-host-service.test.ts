import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OsacMessage } from '../src/clients/osac-client';
import { HostedProviderHostService } from '../src/services/hosted-provider-host-service';

function createHarness(input?: {
  binding?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  executeResult?: unknown;
}) {
  let handler: ((sessionId: string, message: OsacMessage) => void | Promise<void>) | null = null;
  const sent: Array<{ sessionId: string; message: OsacMessage }> = [];
  const calls: unknown[] = [];
  const service = new HostedProviderHostService({
    connectionManager: {
      registerMessageHandler(next) {
        handler = next;
      },
      sendDirect(sessionId, message) {
        sent.push({ sessionId, message });
        return true;
      },
    },
    bindingDAO: {
      async getByTaskSessionAndConnectorKey() {
        return input?.binding === undefined
          ? {
              desiredState: 'attached',
              runtimeProviderId: 'provider-1',
              profileId: 'profile-1',
            }
          : input.binding;
      },
    },
    sessionDAO: {
      async getSession() {
        return input?.session === undefined ? { userId: 'user-1' } : input.session;
      },
    },
    vercelService: {
      async executeRpc(call) {
        calls.push(call);
        return input?.executeResult ?? { tools: [] };
      },
    },
  });
  service.initialize();
  assert.ok(handler);
  return { handler, sent, calls };
}

test('hosted provider host routes vercel backend rpc requests and responds with result', async () => {
  const harness = createHarness({
    executeResult: { tools: [{ name: 'vercel_list_projects' }] },
  });

  await harness.handler('orchestrator-1', {
    type: 'BACKEND_MCP_RPC_REQUEST',
    requestId: 'backend_mcp_rpc_1',
    payload: {
      sessionId: 'orchestrator-1',
      taskSessionId: 'task-1',
      providerId: 'provider-1',
      connectorKey: 'vercel',
      backendProvider: 'vercel',
      method: 'tools/list',
      params: {},
    },
  });

  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].sessionId, 'orchestrator-1');
  assert.equal(harness.sent[0].message.type, 'BACKEND_MCP_RPC_RESPONSE');
  assert.equal(harness.sent[0].message.requestId, 'backend_mcp_rpc_1');
  assert.equal(harness.sent[0].message.payload?.isError, false);
  assert.deepEqual(harness.sent[0].message.payload?.result, {
    tools: [{ name: 'vercel_list_projects' }],
  });
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0], {
    method: 'tools/list',
    params: {},
    runtimeContext: {
      connectorKey: 'vercel',
      taskSessionId: 'task-1',
      userId: 'user-1',
      profileId: 'profile-1',
    },
  });
});

test('hosted provider host rejects mismatched vercel provider binding', async () => {
  const harness = createHarness({
    binding: {
      desiredState: 'attached',
      runtimeProviderId: 'different-provider',
      profileId: 'profile-1',
    },
  });

  await harness.handler('orchestrator-1', {
    type: 'BACKEND_MCP_RPC_REQUEST',
    requestId: 'backend_mcp_rpc_2',
    payload: {
      sessionId: 'orchestrator-1',
      taskSessionId: 'task-1',
      providerId: 'provider-1',
      connectorKey: 'vercel',
      backendProvider: 'vercel',
      method: 'tools/list',
      params: {},
    },
  });

  assert.equal(harness.calls.length, 0);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].message.type, 'BACKEND_MCP_RPC_RESPONSE');
  assert.equal(harness.sent[0].message.requestId, 'backend_mcp_rpc_2');
  assert.equal(harness.sent[0].message.payload?.isError, true);
  assert.equal((harness.sent[0].message.payload?.error as Record<string, unknown>)?.code, 'hosted_provider_rpc_failed');
});
