import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { taskSessionConnectorBindingDAO } from '../src/db/dao/task-session-connector-binding.dao';
import { managedImageObjectService } from '../src/services/managed-image-object-service';
import { AltusManagedSetupService } from '../src/services/altus-managed-setup-service';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { resolveOpencodeWorkspacePath } from '../src/utils/opencode-workspace';

afterEach(() => {
  mock.reset();
  delete process.env.OPENCODE_TASK_WORKSPACE_ROOT;
});

const tmpDirsToRemove = new Set<string>();

afterEach(async () => {
  for (const target of tmpDirsToRemove) {
    await rm(target, { recursive: true, force: true });
  }
  tmpDirsToRemove.clear();
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

test('buildConversationMessages injects latest successful todowrite snapshot as system context', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'agent',
      messageType: 'executor_event',
      content: '工具 todowrite 已完成',
      metadata: {
        eventType: 'tool_call_completed',
        toolName: 'todowrite',
        arguments: {
          todos: [
            { content: '梳理需求边界', status: 'completed' },
            { content: '修改后端主链', status: 'in_progress', activeForm: '正在修改后端主链' },
          ],
        },
      },
    },
    {
      role: 'user',
      messageType: 'user_input',
      content: '继续做',
      metadata: {},
    },
  ] as any);

  const service = new AltusManagedSetupService();
  const messages = await service.buildConversationMessages('session-todo', '继续做', 'SYSTEM PROMPT');

  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[0]?.content, 'SYSTEM PROMPT');
  assert.equal(messages[1]?.role, 'system');
  assert.match(String(messages[1]?.content), /Current todo snapshot/);
  assert.match(String(messages[1]?.content), /\[completed\] 梳理需求边界/);
  assert.match(String(messages[1]?.content), /\[in_progress\] 修改后端主链/);
});

test('buildTaskIntentProfile keeps trivial single-point tasks off the todo path', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '把这个按钮文案改成提交',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => null as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile('session-simple-task', '把这个按钮文案改成提交', 'user_input');

  assert.equal(profile.todoRequired, false);
  assert.equal(profile.todoReason, 'none');
  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
});

test('buildTaskIntentProfile suppresses tech-stack clarification when workspace root already constrains the stack', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'oneceo-managed-setup-'));
  tmpDirsToRemove.add(workspaceRoot);
  process.env.OPENCODE_TASK_WORKSPACE_ROOT = workspaceRoot;
  const sessionId = 'session-tech-stack-hint';
  const sessionWorkspaceRoot = resolveOpencodeWorkspacePath(sessionId);
  await mkdir(sessionWorkspaceRoot, { recursive: true });
  await writeFile(
    path.join(sessionWorkspaceRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'tech-stack-hint',
        dependencies: {
          react: '^19.0.0',
          vite: '^7.0.0',
        },
      },
      null,
      2
    ),
    { encoding: 'utf8' }
  );
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '开发一个管理后台',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => null as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(sessionId, '开发一个管理后台', 'user_input');

  assert.equal(profile.clarificationType, 'scope_boundary');
  assert.doesNotMatch(profile.clarificationQuestion, /开发语言或框架/);
});

test('buildTaskIntentProfile keeps clarifying the same field when a user response does not answer the pending clarification type', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个企业管理系统',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '先按你觉得合适的方式做',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    pendingQuestion: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    pendingOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
    pendingClarificationType: 'artifact_type',
  }) as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-repeat-clarification',
    '先按你觉得合适的方式做',
    'user_response'
  );

  assert.equal(profile.needsClarification, true);
  assert.equal(profile.clarificationType, 'artifact_type');
  assert.match(profile.clarificationQuestion, /我还需要先确认这一点/);
});
