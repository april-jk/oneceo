import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { taskSessionConnectorBindingDAO } from '../src/db/dao/task-session-connector-binding.dao';
import { managedImageObjectService } from '../src/services/managed-image-object-service';
import { AltusManagedSetupService } from '../src/services/altus-managed-setup-service';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { sessionConnectorService } from '../src/services/session-connector-service';

afterEach(() => {
  mock.reset();
});

test('buildConversationMessages injects attachment context and avoids duplicating current user input', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '请查看附件',
      metadata: {
        attachmentContext: [
          {
            name: 'notes.md',
            path: 'uploads/notes.md',
            size: 12,
            mimeType: 'text/markdown',
            excerpt: '# Important notes',
            truncated: false,
            extractedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
      },
    },
  ] as any);

  const service = new AltusManagedSetupService();
  const messages = await service.buildConversationMessages('session-1', '请查看附件', 'SYSTEM PROMPT');

  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[0]?.content, 'SYSTEM PROMPT');
  assert.equal(messages[1]?.role, 'system');
  assert.match(String(messages[1]?.content), /uploads\/notes\.md/);
  assert.match(String(messages[1]?.content), /# Important notes/);

  const userMessages = messages.filter((item) => item.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0]?.content, '请查看附件');
});

test('buildConversationMessages converts image attachments into multimodal user content', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '看看这个图讲了什么\n\n[Attached: screenshot.png -> uploads/screenshot.png]',
      metadata: {
        attachments: [
          {
            name: 'screenshot.png',
            path: 'uploads/screenshot.png',
            size: 128,
            mimeType: 'image/png',
            externalObjectKey: 'managed-images/session-1/msg-1/screenshot.png',
          },
        ],
      },
    },
  ] as any);
  mock.method(
    managedImageObjectService,
    'getSignedDownloadUrl',
    async () => 'https://images.example.com/signed/screenshot.png?token=abc'
  );

  const service = new AltusManagedSetupService();
  const messages = await service.buildConversationMessages(
    'session-1',
    '看看这个图讲了什么\n\n[Attached: screenshot.png -> uploads/screenshot.png]',
    'SYSTEM PROMPT'
  );

  const userMessages = messages.filter((item) => item.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.ok(Array.isArray(userMessages[0]?.content));
  const parts = userMessages[0]?.content as Array<any>;
  assert.equal(parts[0]?.type, 'text');
  assert.match(String(parts[0]?.text), /看看这个图讲了什么/);
  assert.equal(parts[1]?.type, 'image_url');
  assert.equal(parts[1]?.image_url?.url, 'https://images.example.com/signed/screenshot.png?token=abc');
});

test('ensureSandbox provisions through sandboxAgentProvisionService to enforce paused-sandbox recovery gate', async () => {
  const provisionMock = mock.method(sandboxAgentProvisionService, 'provisionWithLock', async () => ({
    sessionId: 'sandbox-new',
    allocationSource: 'reused_session',
  }) as any);
  const upsertMock = mock.method(taskSessionRunDAO, 'upsertSandboxBinding', async () => ({} as any));
  const recoverMock = mock.method(sessionMcpRecoveryService, 'ensureSessionRecovered', async () => undefined as any);
  const executorMock = mock.method(taskCreationFileMemoryStore, 'updateSessionExecutor', async () => undefined);
  const runtimeBindingMock = mock.method(taskCreationFileMemoryStore, 'updateRuntimeBinding', async () => undefined);

  const service = new AltusManagedSetupService();
  const result = await service.ensureSandbox('session-1', 'Demo session');

  assert.equal(provisionMock.mock.callCount(), 1);
  const provisionInput = provisionMock.mock.calls[0]?.arguments[0] as Record<string, unknown>;
  assert.equal(provisionInput.executor, 'altus');
  assert.equal((provisionInput.metadata as Record<string, unknown>)?.taskSessionId, 'session-1');
  assert.equal((provisionInput.metadata as Record<string, unknown>)?.sandboxExecutor, 'altus');
  assert.equal(upsertMock.mock.callCount(), 1);
  assert.equal(executorMock.mock.callCount(), 1);
  assert.equal(runtimeBindingMock.mock.callCount(), 1);
  assert.equal((runtimeBindingMock.mock.calls[0]?.arguments[1] as any)?.executor, 'altus');
  assert.equal((runtimeBindingMock.mock.calls[0]?.arguments[1] as any)?.orchestratorSessionId, 'sandbox-new');
  assert.equal(result.sandboxId, 'sandbox-new');
  assert.equal(result.reused, true);
  assert.equal(recoverMock.mock.callCount(), 1);
});

test('captureMcpToolSnapshot only exposes connected bindings with live provider ids', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      connectorKey: 'github',
      desiredState: 'attached',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-connected',
      runtimeTransport: 'remote_sse',
      runtimeEnvVersion: 1,
      runtimeAttachedToolsJson: [{ providerId: 'provider-connected', toolName: 'github_list_repos' }],
    },
    {
      connectorKey: 'notion',
      desiredState: 'attached',
      runtimeStatus: 'failed',
      runtimeProviderId: 'provider-failed',
      runtimeTransport: 'remote_sse',
      runtimeEnvVersion: 2,
      runtimeAttachedToolsJson: [{ providerId: 'provider-failed', toolName: 'notion_list_pages' }],
    },
    {
      connectorKey: 'slack',
      desiredState: 'attached',
      runtimeStatus: 'pending_recover',
      runtimeProviderId: 'provider-pending',
      runtimeTransport: 'remote_sse',
      runtimeEnvVersion: 3,
      runtimeAttachedToolsJson: [],
    },
  ] as any);
  const snapshotMock = mock.method(taskSessionRunDAO, 'createMcpToolSnapshot', async (input: any) => ({
    id: 'snapshot-1',
    snapshotJson: input.snapshotJson,
  }));

  const service = new AltusManagedSetupService();
  const result = await service.captureMcpToolSnapshot('session-1');

  assert.equal(snapshotMock.mock.callCount(), 1);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0]?.providerId, 'provider-connected');
  assert.match(JSON.stringify(snapshotMock.mock.calls[0]?.arguments[0]), /github_list_repos/);
  assert.doesNotMatch(JSON.stringify(snapshotMock.mock.calls[0]?.arguments[0]), /notion_list_pages/);
});

test('captureMcpToolSnapshot exposes only Composio brokered Notion tools', async () => {
  mock.method(taskSessionConnectorBindingDAO, 'listByTaskSessionId', async () => [
    {
      connectorKey: 'notion',
      desiredState: 'attached',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-notion-composio',
      runtimeTransport: 'api_brokered_mcp',
      runtimeEnvVersion: 1,
      runtimeAttachedToolsJson: [{ providerId: 'provider-notion-composio', toolName: 'notion__COMPOSIO_SEARCH_TOOLS' }],
    },
    {
      connectorKey: 'notion',
      desiredState: 'attached',
      runtimeStatus: 'connected',
      runtimeProviderId: 'provider-notion-legacy',
      runtimeTransport: 'remote_sse',
      runtimeEnvVersion: 1,
      runtimeAttachedToolsJson: [{ providerId: 'provider-notion-legacy', toolName: 'notion_list_pages' }],
    },
  ] as any);
  const snapshotMock = mock.method(taskSessionRunDAO, 'createMcpToolSnapshot', async (input: any) => ({
    id: 'snapshot-notion',
    snapshotJson: input.snapshotJson,
  }));

  const service = new AltusManagedSetupService();
  const result = await service.captureMcpToolSnapshot('session-1');

  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0]?.providerId, 'provider-notion-composio');
  assert.match(JSON.stringify(snapshotMock.mock.calls[0]?.arguments[0]), /notion__COMPOSIO_SEARCH_TOOLS/);
  assert.doesNotMatch(JSON.stringify(snapshotMock.mock.calls[0]?.arguments[0]), /notion_list_pages/);
});

test('captureConnectorSnapshot forces recovery before reading connector statuses', async () => {
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    id: 'session-1',
    runtime: {
      orchestratorSessionId: 'orch-1',
    },
  }) as any);
  const recoverMock = mock.method(sessionMcpRecoveryService, 'ensureSessionRecovered', async () => true);
  const listMock = mock.method(sessionConnectorService, 'listSessionConnectors', async () => [
    {
      connectorKey: 'vercel',
      attached: true,
      attachedProfileName: 'Vercel Default',
      selectedProfileName: 'Vercel Default',
      authorizedRepositories: [],
      runtimeStatus: 'connected',
    },
  ] as any);
  const snapshotMock = mock.method(taskSessionRunDAO, 'createConnectorSnapshot', async (input: any) => ({
    id: 'snapshot-connector-1',
    snapshotJson: input.snapshotJson,
  }));

  const service = new AltusManagedSetupService();
  const result = await service.captureConnectorSnapshot('session-1', 'user-1');

  assert.equal(recoverMock.mock.callCount(), 1);
  assert.deepEqual(recoverMock.mock.calls[0]?.arguments, ['session-1', 'orch-1']);
  assert.equal(listMock.mock.callCount(), 1);
  assert.equal(snapshotMock.mock.callCount(), 1);
  assert.equal(result.statuses[0]?.runtimeStatus, 'connected');
});
