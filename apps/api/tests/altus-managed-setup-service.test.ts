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
import { altusClarificationTransitionAgent } from '../src/services/altus-clarification-transition-agent';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';
import { sessionMcpRecoveryService } from '../src/services/session-mcp-recovery-service';
import { resolveOpencodeWorkspacePath } from '../src/utils/opencode-workspace';
import { sessionConnectorService } from '../src/services/session-connector-service';

process.env.ALTUS_CLARIFICATION_TRANSITION_DISABLED = 'true';

afterEach(() => {
  mock.reset();
  delete process.env.OPENCODE_TASK_WORKSPACE_ROOT;
  process.env.ALTUS_CLARIFICATION_TRANSITION_DISABLED = 'true';
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

test('buildConversationMessages keeps runtime state before the latest user message', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个管理后台系统',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '网页应用',
      metadata: {},
    },
  ] as any);

  const service = new AltusManagedSetupService();
  const messages = await service.buildConversationMessages('session-context-order', '网页应用', 'SYSTEM PROMPT', {
    turnStatePrompt: '# Current turn state\n- latest_user_message_type: user_response',
  });

  assert.equal(messages.at(-2)?.role, 'system');
  assert.match(String(messages.at(-2)?.content), /latest_user_message_type: user_response/);
  assert.equal(messages.at(-1)?.role, 'user');
  assert.equal(messages.at(-1)?.content, '网页应用');
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

test('buildTaskIntentProfile accepts a direct answer to pending artifact clarification without chaining another question', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个管理后台系统',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '网页应用',
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
    'session-direct-artifact-answer',
    '网页应用',
    'user_response'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.equal(profile.clarificationTransition?.nextState, 'ready_to_execute');
  assert.deepEqual(profile.clarificationTransition?.assumptions, ['网页应用']);
});

test('buildTaskIntentProfile treats unrelated user_response as a new turn instead of reusing stale clarification', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个企业管理系统',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次希望使用哪种开发语言或框架？如果没有指定，我将按仓库现有技术栈继续。',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '你帮我查查最近半导体行业的年报',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    pendingQuestion: '这次希望使用哪种开发语言或框架？如果没有指定，我将按仓库现有技术栈继续。',
    pendingOptions: undefined,
    pendingClarificationType: 'tech_stack',
  }) as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-stale-clarification-new-turn',
    '你帮我查查最近半导体行业的年报',
    'user_response'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.doesNotMatch(profile.clarificationQuestion, /开发语言或框架/);
});

test('buildTaskIntentProfile accepts LLM advisory transition instead of forcing artifact clarification', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我想想，我想做个用户管理系统，应该怎么做',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => null as any);
  mock.method(altusClarificationTransitionAgent, 'propose', async () => ({
    action: 'switch_to_advisory_mode',
    reason: 'user asks for advice before implementation',
  }) as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-advisory-transition',
    '帮我想想，我想做个用户管理系统，应该怎么做',
    'user_input'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.equal(profile.clarificationTransition?.nextState, 'advisory');
});

test('buildTaskIntentProfile treats explicit code-only delivery as enough acceptance scope', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content:
        '请用纯 HTML、CSS 和少量原生 JavaScript 开发一个工业企业官网，包含首页、产品页、公司介绍页和联系页。不要使用后端框架，只完成完整网站代码。',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => null as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-code-only-delivery',
    '请用纯 HTML、CSS 和少量原生 JavaScript 开发一个工业企业官网，包含首页、产品页、公司介绍页和联系页。不要使用后端框架，只完成完整网站代码。',
    'user_input'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.doesNotMatch(profile.clarificationQuestion, /上一条补充信息/);
});

test('buildTaskIntentProfile falls back instead of surfacing invalid no-pending transition', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content:
        '请用纯 HTML、CSS 和少量原生 JavaScript 开发一个展示型网站，包含首页、产品页、公司介绍页和联系页。不要使用后端框架，只完成完整网站代码。',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => null as any);
  mock.method(altusClarificationTransitionAgent, 'propose', async () => ({
    action: 'answer_clarification',
    clarificationType: 'acceptance_requirement',
    answer: '完整代码',
    confidence: 'high',
    reason: 'invalid tool when there is no pending question',
  }) as any);

  const service = new AltusManagedSetupService();
  const currentText =
    '请用纯 HTML、CSS 和少量原生 JavaScript 开发一个展示型网站，包含首页、产品页、公司介绍页和联系页。不要使用后端框架，只完成完整网站代码。';
  const profile = await service.buildTaskIntentProfile(
    'session-invalid-no-pending-transition',
    currentText,
    'user_input'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.doesNotMatch(profile.clarificationQuestion, /上一条补充信息/);
});

test('buildTaskIntentProfile clears a pending clarification when LLM detects advisory mode', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个用户管理系统',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '先帮我做个方案',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    pendingQuestion: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    pendingOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
    pendingClarificationType: 'artifact_type',
  }) as any);
  mock.method(altusClarificationTransitionAgent, 'propose', async () => ({
    action: 'switch_to_advisory_mode',
    reason: 'user asks for proposal instead of choosing delivery artifact',
  }) as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-pending-advisory-transition',
    '先帮我做个方案',
    'user_response'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.equal(profile.clarificationTransition?.nextState, 'advisory');
});

test('buildTaskIntentProfile treats platform capability questions as current-turn advisory without stale artifact context', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个 HTML 官网',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'assistant_message',
      content: '已准备 index.html、package.json 和 oneceo.manifest.json。',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '能用vercel部署吗',
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
    'session-vercel-capability-advisory',
    '能用vercel部署吗',
    'user_response'
  );

  assert.equal(profile.mode, 'neutral');
  assert.equal(profile.webArtifactRequested, false);
  assert.equal(profile.deployRequested, false);
  assert.equal(profile.deploymentAllowed, false);
  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.equal(profile.platformCapabilityIntent?.mode, 'answer_capability');
  assert.equal(profile.platformCapabilityIntent?.topic, 'vercel');
  assert.equal(profile.clarificationTransition?.nextState, 'advisory');
});

test('buildTaskIntentProfile accepts user delegation to Altus defaults through transition tool', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我做一个管理后台',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次希望使用哪种开发语言或框架？如果没有指定，我将按仓库现有技术栈继续。',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '你推荐就行',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    pendingQuestion: '这次希望使用哪种开发语言或框架？如果没有指定，我将按仓库现有技术栈继续。',
    pendingOptions: undefined,
    pendingClarificationType: 'tech_stack',
  }) as any);
  mock.method(altusClarificationTransitionAgent, 'propose', async () => ({
    action: 'delegate_to_agent_default',
    clarificationType: 'tech_stack',
    assumedDefault: 'Use the repository default stack.',
    confidence: 'high',
    targetCapability: 'project.local_scaffold',
    reason: 'user delegates the stack choice',
  }) as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-default-delegation',
    '你推荐就行',
    'user_response'
  );

  assert.equal(profile.needsClarification, false);
  assert.equal(profile.clarificationType, 'none');
  assert.equal(profile.clarificationTransition?.nextState, 'ready_to_execute');
  assert.deepEqual(profile.clarificationTransition?.assumptions, ['Use the repository default stack.']);
});

test('buildTaskIntentProfile routes protected capability delegation to user confirmation', async () => {
  mock.method(taskCreationSessionDAO, 'getMessages', async () => [
    {
      role: 'user',
      messageType: 'user_input',
      content: '帮我部署这个应用',
      metadata: {},
    },
    {
      role: 'agent',
      messageType: 'clarification_request',
      content: '这次只需要源码，还是还需要本地可运行、测试通过，或可以直接部署？',
      metadata: {},
    },
    {
      role: 'user',
      messageType: 'user_response',
      content: '你决定',
      metadata: {},
    },
  ] as any);
  mock.method(taskCreationFileMemoryStore, 'getSession', async () => ({
    pendingQuestion: '这次只需要源码，还是还需要本地可运行、测试通过，或可以直接部署？',
    pendingOptions: ['只要源码', '本地可运行', '测试通过', '可直接部署'],
    pendingClarificationType: 'acceptance_requirement',
  }) as any);
  mock.method(altusClarificationTransitionAgent, 'propose', async () => ({
    action: 'delegate_to_agent_default',
    clarificationType: 'acceptance_requirement',
    assumedDefault: 'Deploy to production.',
    confidence: 'medium',
    targetCapability: 'deploy.production',
    reason: 'user delegates delivery choice',
  }) as any);

  const service = new AltusManagedSetupService();
  const profile = await service.buildTaskIntentProfile(
    'session-protected-capability-confirmation',
    '你决定',
    'user_response'
  );

  assert.equal(profile.needsClarification, true);
  assert.equal(profile.clarificationType, 'acceptance_requirement');
  assert.match(profile.clarificationQuestion, /生产环境/);
  assert.equal(profile.clarificationTransition?.nextState, 'risk_confirmation');
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
