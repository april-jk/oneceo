import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { AltusRunCoordinator } from '../src/services/altus-run-coordinator';
import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { AltusRunState } from '../src/services/altus-run-state';
import { buildManagedMcpToolName } from '../src/services/altus-managed-shared';
import { connectorGuideService } from '../src/services/connector-guide-service';
import { osacAgentService } from '../src/services/osac-agent-service';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';
import { taskSessionAltusMemoryService } from '../src/services/task-session-altus-memory-service';
import { taskSessionSkillStateService } from '../src/services/task-session-skill-state-service';

const originalFetch = global.fetch;

(connectorGuideService as any).buildPromptSections = async () => ({
  instructionsSection: '',
  reminderSection: '',
  attachedConnectorKeys: [],
});

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
});

function createState(
  runId: string,
  sessionId: string,
  userInput = '帮我开发 2048 小游戏',
  messageType: 'user_input' | 'user_response' = 'user_input',
) {
  return new AltusRunState({
    runId,
    sessionId,
    userId: 'user-1',
    model: 'altus-model',
    userInput,
    messageType,
    sessionTitle: 'Build 2048',
    connectors: [],
    mcpProviders: [],
    skillCatalog: [],
    skills: [],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
  });
}

function createSseResponse(blocks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const block of blocks) {
        controller.enqueue(encoder.encode(block));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

test('readStreamedModelChoice emits assistant delta callbacks while accumulating final content', async () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);
  const assistantDeltas: Array<{ delta: string; fullText: string }> = [];

  const result = await (coordinator as any).readStreamedModelChoice({
    response: createSseResponse([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
    signal: new AbortController().signal,
    onAssistantTextDelta: async (deltaText: string, fullText: string) => {
      assistantDeltas.push({ delta: deltaText, fullText });
    },
  });

  assert.equal(result.content, '你好，世界');
  assert.deepEqual(assistantDeltas, [
    { delta: '你好', fullText: '你好' },
    { delta: '，世界', fullText: '你好，世界' },
  ]);
});

test('resolveDeploymentCompletionIntent accepts deployment status polling as completion evidence', () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);

  const intent = (coordinator as any).resolveDeploymentCompletionIntent('帮我部署当前项目');

  assert.equal(intent.mode, 'deploy');
  assert.equal(intent.requiresManagedSuccess, true);
  assert.deepEqual(intent.acceptedToolNames, [
    'deploy_application',
    'redeploy_application',
    'get_application_deployment_status',
  ]);
});

test('resolveDeploymentCompletionIntent ignores negated deploy wording and non-deployable sessions', () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);

  const negatedIntent = (coordinator as any).resolveDeploymentCompletionIntent(
    '请写一个 HTML 邮件模板，不要部署。'
  );
  assert.equal(negatedIntent.mode, 'none');
  assert.equal(negatedIntent.requiresManagedSuccess, false);

  const profiledIntent = (coordinator as any).resolveDeploymentCompletionIntent('请按最佳方案直接继续。', {
    mode: 'non_deployable_artifact',
    reason: 'historical_explicit_no_deploy',
    recentUserMessages: ['请写一个 HTML 邮件模板，不要部署。'],
    explicitNoDeploy: true,
    explicitNoWeb: true,
    webArtifactRequested: false,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: true,
    deploymentAllowed: false,
  });
  assert.equal(profiledIntent.mode, 'none');
  assert.equal(profiledIntent.requiresManagedSuccess, false);

  const sourceOnlyWebsiteIntent = (coordinator as any).resolveDeploymentCompletionIntent(
    '先给我源码文件。',
    {
      mode: 'deployable_web_app',
      reason: 'historical_deployable_request',
      recentUserMessages: ['做一个纯 HTML 企业官网，包含首页、关于我们和联系我们，先给我源码文件。'],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: true,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
    }
  );
  assert.equal(sourceOnlyWebsiteIntent.mode, 'none');
  assert.equal(sourceOnlyWebsiteIntent.requiresManagedSuccess, false);
});

test('buildPostToolRunStatusContent uses user-friendly wording instead of command echo', () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);

  assert.equal(
    (coordinator as any).buildPostToolRunStatusContent({
      toolName: 'write_file',
      args: { path: 'src/index.html' },
      outcome: 'completed',
    }),
    '页面框架已经搭好，我继续把样式和交互补完整'
  );

  assert.equal(
    (coordinator as any).buildPostToolRunStatusContent({
      toolName: 'shell_execute',
      args: { command: 'cd /workspace && npm install' },
      outcome: 'completed',
    }),
    '这一步已经跑完了，我继续处理后面的内容'
  );

  assert.equal(
    (coordinator as any).buildPostToolRunStatusContent({
      toolName: 'shell_execute',
      args: { command: 'cd /workspace && npm start' },
      outcome: 'failed',
    }),
    '刚才那一步执行没成功，我换个方式继续'
  );
});

test('deployment status evidence only unlocks completion after non-transient success state', () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);
  const intent = (coordinator as any).resolveDeploymentCompletionIntent('帮我部署当前项目');

  assert.equal(
    (coordinator as any).isManagedDeploymentEvidenceSuccessful(intent, {
      toolName: 'get_application_deployment_status',
      status: 'success',
      deploymentStatus: 'building',
      summary: 'still building',
    }),
    false
  );
  assert.equal(
    (coordinator as any).isManagedDeploymentEvidenceSuccessful(intent, {
      toolName: 'get_application_deployment_status',
      status: 'success',
      deploymentStatus: 'success',
      summary: 'deployment ready',
    }),
    true
  );
});

test('getMaxToolRounds allows larger website-generation budgets while keeping a hard ceiling', () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);
  const originalValue = process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS;
  try {
    process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS = '';
    assert.equal((coordinator as any).getMaxToolRounds(), 192);

    process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS = '600';
    assert.equal((coordinator as any).getMaxToolRounds(), 384);
  } finally {
    if (originalValue === undefined) {
      delete process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS;
    } else {
      process.env.ALTUS_MANAGED_MAX_TOOL_ROUNDS = originalValue;
    }
  }
});

test('getModelRetryLimit defaults higher for transient upstream fetch failures while keeping a ceiling', () => {
  const coordinator = new AltusRunCoordinator({} as any, {} as any, {} as any);
  const originalValue = process.env.ALTUS_MANAGED_MODEL_RETRIES;
  try {
    process.env.ALTUS_MANAGED_MODEL_RETRIES = '';
    assert.equal((coordinator as any).getModelRetryLimit(), 3);

    process.env.ALTUS_MANAGED_MODEL_RETRIES = '20';
    assert.equal((coordinator as any).getModelRetryLimit(), 5);
  } finally {
    if (originalValue === undefined) {
      delete process.env.ALTUS_MANAGED_MODEL_RETRIES;
    } else {
      process.env.ALTUS_MANAGED_MODEL_RETRIES = originalValue;
    }
  }
});

test('execute requests clarification before sandbox when managed intent shape requires it', async () => {
  const state = createState(
    'run-coordinator-clarification-gate',
    'session-coordinator-clarification-gate',
    '帮我做一个企业管理系统。'
  );
  state.input.taskIntentProfile = {
    mode: 'neutral',
    reason: 'unknown',
    recentUserMessages: ['帮我做一个企业管理系统。'],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: false,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: false,
    needsClarification: true,
    clarificationQuestion: '请先确认这个系统的主要使用角色、必须包含的核心模块，以及本次是只要源码、本地运行，还是需要部署上线？',
    clarificationType: 'artifact_type',
    clarificationOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
    todoRequired: false,
    todoReason: 'none',
  };

  const timelineCalls: Array<Record<string, unknown>> = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setPendingClarificationMock = mock.method(
    taskCreationFileMemoryStore,
    'setPendingClarification',
    async () => undefined,
  );

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-should-not-start',
      workspaceRoot: '/workspace/should-not-start',
      reused: false,
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      timelineCalls.push(input);
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
    syncLoopSnapshot: mock.fn(async () => undefined),
  };

  global.fetch = mock.fn(async () => {
    throw new Error('fetch_should_not_run_before_clarification');
  }) as typeof fetch;

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any,
  );

  await coordinator.execute(state, new AbortController());

  assert.equal((setupService.ensureSandbox as any).mock.callCount(), 0);
  assert.equal(setPendingClarificationMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['waiting_user']);
  assert.equal(state.status, 'waiting_user');
  assert.equal(timelineCalls.length, 1);
  assert.equal(timelineCalls[0]?.messageType, 'clarification_request');
  assert.match(String(timelineCalls[0]?.content || ''), /主要使用角色/);
  assert.deepEqual(timelineCalls[0]?.metadata?.options, ['网页应用', '后端 API', '本地脚本', '完整业务系统']);
  assert.equal(timelineCalls[0]?.metadata?.clarificationType, 'artifact_type');
  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['clarification_requested'],
  );
  assert.equal(eventCalls[0]?.payload.options?.[0], '网页应用');
  assert.equal(eventCalls[0]?.payload.clarificationType, 'artifact_type');
});

test('execute re-enters clarification gate for unresolved user_response before sandbox', async () => {
  const state = createState(
    'run-coordinator-repeat-clarify',
    'session-coordinator-repeat-clarify',
    '先按你觉得合适的方式做'
  );
  state.input.messageType = 'user_response';
  state.input.taskIntentProfile = {
    mode: 'neutral',
    reason: 'unknown',
    recentUserMessages: ['帮我做一个企业管理系统。', '先按你觉得合适的方式做'],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: false,
    deployRequested: false,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: false,
    needsClarification: true,
    clarificationQuestion: '我还需要先确认这一点：这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？',
    clarificationType: 'artifact_type',
    clarificationOptions: ['网页应用', '后端 API', '本地脚本', '完整业务系统'],
    todoRequired: false,
    todoReason: 'none',
  };

  const timelineCalls: Array<Record<string, unknown>> = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setPendingClarificationMock = mock.method(
    taskCreationFileMemoryStore,
    'setPendingClarification',
    async () => undefined,
  );

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-should-not-start',
      workspaceRoot: '/workspace/should-not-start',
      reused: false,
    })),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      timelineCalls.push(input);
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
    syncLoopSnapshot: mock.fn(async () => undefined),
  };

  global.fetch = mock.fn(async () => {
    throw new Error('fetch_should_not_run_before_repeated_clarification');
  }) as typeof fetch;

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any,
  );

  await coordinator.execute(state, new AbortController());

  assert.equal((setupService.ensureSandbox as any).mock.callCount(), 0);
  assert.equal(setPendingClarificationMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['waiting_user']);
  assert.equal(state.status, 'waiting_user');
  assert.equal(timelineCalls[0]?.metadata?.clarificationType, 'artifact_type');
  assert.deepEqual(timelineCalls[0]?.metadata?.options, ['网页应用', '后端 API', '本地脚本', '完整业务系统']);
  assert.equal(eventCalls[0]?.payload.clarificationType, 'artifact_type');
});

test('execute completes after tool round and final assistant response', async () => {
  const state = createState('run-coordinator-complete', 'session-coordinator-complete');
  state.input.memoryContextPrompt = '## Altus Memory Context\n- 项目规范：输出需可直接运行';
  state.input.sessionAltusMemory = {
    version: 1,
    summary: {
      goal: '实现 2048 小游戏',
      latestOutcome: '尚未开始',
      openQuestions: [],
    },
    constraints: ['使用现有技术栈'],
    decisions: [],
    workingNotes: [],
    updatedAt: '2026-04-21T16:10:00.000Z',
  };
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-coordinator-complete',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => {
      assert.match(systemPrompt, /You are Altus/);
      assert.match(systemPrompt, /Altus Memory Context/);
      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];
    }),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  let fetchCount = 0;
  global.fetch = mock.fn(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-1',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: JSON.stringify({
                        path: 'index.html',
                        content: '<html></html>',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '2048 已完成并写入 workspace。',
                      verification: ['已写入 index.html'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: fetchCount === 1 ? ('result' as const) : ('complete' as const),
    ...(fetchCount === 1
      ? {
          content: JSON.stringify({
            path: 'index.html',
            bytes: 13,
          }),
        }
      : {
          summary: '2048 已完成并写入 workspace。',
          verification: ['已写入 index.html'],
        }),
  }));
  mock.method(taskSessionSkillStateService, 'markResidentSkillsMaterialized', async () => undefined);
  const markMaterializedMock = mock.method(taskSessionAltusMemoryService, 'markMaterialized', async (input: any) => ({
    ...(input.state || {}),
    sandboxMaterialization: {
      sandboxId: input.sandboxId,
      workspaceRoot: input.workspaceRoot,
      materializedAt: '2026-04-21T16:11:00.000Z',
    },
  }));
  const flushAltusMemoryMock = mock.method(taskSessionAltusMemoryService, 'saveSandboxFileMemoryToDb', async (input: any) => ({
    version: 2,
    summary: {
      goal: '实现 2048 小游戏',
      latestOutcome: '2048 已完成并写入 workspace。',
      openQuestions: [],
    },
    constraints: ['使用现有技术栈'],
    decisions: [],
    workingNotes: [],
    updatedAt: '2026-04-21T16:12:00.000Z',
    lastWriterRunId: input.runId,
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 2);
  assert.equal(executeMock.mock.callCount(), 2);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');
  assert.equal(state.sandboxId, 'sandbox-1');
  assert.equal(state.workspaceRoot, '/workspace/session-coordinator-complete');
  assert.equal(markMaterializedMock.mock.callCount(), 1);
  assert.equal(flushAltusMemoryMock.mock.callCount(), 1);
  assert.equal(state.input.sessionAltusMemory?.summary?.latestOutcome, '2048 已完成并写入 workspace。');

  const timelineCall = setupCalls.find((entry) => entry.type === 'timeline') as any;
  assert.equal(timelineCall.input.messageType, 'assistant_message');
  assert.equal(timelineCall.input.content, '2048 已完成并写入 workspace。\n\n验证:\n- 已写入 index.html');

  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'tool_call_started', 'tool_call_completed', 'run_status', 'tool_call_started', 'tool_call_completed', 'assistant_message']
  );
  assert.equal(eventCalls[0]?.payload.status, 'starting');
  assert.equal(eventCalls[2]?.payload.toolName, 'write_file');
  assert.equal(eventCalls[3]?.payload.toolName, 'write_file');
  assert.match(String(eventCalls[4]?.payload.content || ''), /页面框架已经搭好|继续把样式和交互补完整/);
  assert.equal(eventCalls[5]?.payload.toolName, 'complete_task');
  assert.equal(eventCalls[6]?.payload.toolName, 'complete_task');
});

test('execute preserves richer assistant text when complete_task summary is concise', async () => {
  const state = createState('run-coordinator-preserve-assistant', 'session-coordinator-preserve-assistant');
  const setupCalls: Record<string, unknown>[] = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-preserve-assistant',
      workspaceRoot: '/workspace/session-coordinator-preserve-assistant',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, _eventType: string, payload: Record<string, unknown>) => ({
      sequence: 1,
      payload,
    })),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  const detailedAssistantContent =
    '已查询并汇总 2026 年 4 月 9 日美股市场要点：\n- 标普与纳指期货盘前走强\n- 市场关注通胀与降息路径\n- 盘前成交情绪偏谨慎';

  global.fetch = mock.fn(async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: detailedAssistantContent,
              tool_calls: [
                {
                  id: 'tool-complete-preserve-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '已查询并汇总2026年4月9日美股市场最新动态。',
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: '已查询并汇总2026年4月9日美股市场最新动态。',
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(executeMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);

  const timelineCall = setupCalls.find((entry) => (entry as any).input?.messageType === 'assistant_message') as any;
  assert.ok(timelineCall);
  assert.equal(timelineCall.input.content, detailedAssistantContent);
});

test('execute blocks deployment completion until managed deployment succeeds', async () => {
  const state = createState(
    'run-coordinator-deployment-guard',
    'session-coordinator-deployment-guard',
    '帮我部署当前项目'
  );
  state.input.taskIntentProfile = {
    mode: 'deployable_web_app',
    reason: 'latest_deployable_request',
    recentUserMessages: ['帮我部署当前项目'],
    explicitNoDeploy: false,
    explicitNoWeb: false,
    webArtifactRequested: false,
    deployRequested: true,
    scriptArtifactRequested: false,
    emailTemplateRequested: false,
    deploymentAllowed: true,
  };
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-deployment-guard',
      workspaceRoot: '/workspace/session-coordinator-deployment-guard',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async () => undefined),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(
      async (
        _runId: string,
        _sessionId: string,
        _userId: string,
        eventType: string,
        payload: Record<string, unknown>
      ) => {
        eventCalls.push({ eventType, payload });
        return {
          sequence: eventCalls.length,
          payload,
        };
      }
    ),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  let fetchCount = 0;
  global.fetch = mock.fn(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-complete-before-deploy',
                    type: 'function',
                    function: {
                      name: 'complete_task',
                      arguments: JSON.stringify({
                        summary: '2048小游戏已成功部署并启动调试服务。',
                        verification: ['本地调试页可访问'],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fetchCount === 2) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-deploy-1',
                    type: 'function',
                    function: {
                      name: 'deploy_application',
                      arguments: JSON.stringify({}),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-after-deploy',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '应用已完成线上发布。',
                      verification: ['托管部署成功'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(
    AltusManagedToolRuntime.prototype,
    'execute',
    async (toolName: string) => {
      if (toolName === 'deploy_application') {
        return {
          type: 'result' as const,
          content: JSON.stringify({
            status: 'success',
            summary: '发布完成',
            deploymentStatus: 'SUCCESS',
            url: 'https://example.up.railway.app',
          }),
        };
      }

      return {
        type: 'complete' as const,
        summary:
          fetchCount === 1
            ? '2048小游戏已成功部署并启动调试服务。'
            : '应用已完成线上发布。',
        verification:
          fetchCount === 1
            ? ['本地调试页可访问']
            : ['托管部署成功'],
      };
    }
  );

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 3);
  assert.equal(executeMock.mock.callCount(), 3);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');

  const blockedComplete = eventCalls.find(
    (entry) =>
      entry.eventType === 'tool_call_failed' &&
      entry.payload.toolName === 'complete_task'
  );
  assert.ok(blockedComplete);
  assert.equal(
    blockedComplete.payload.error,
    '线上部署尚未完成，Altus 将继续修复并重试发布。'
  );

  const completedToolNames = eventCalls
    .filter((entry) => entry.eventType === 'tool_call_completed')
    .map((entry) => entry.payload.toolName);
  assert.deepEqual(completedToolNames, ['deploy_application', 'complete_task']);

  const deployCompleted = eventCalls.find(
    (entry) =>
      entry.eventType === 'tool_call_completed' &&
      entry.payload.toolName === 'deploy_application'
  );
  assert.ok(deployCompleted);
  assert.deepEqual(deployCompleted?.payload.userView, {
    summary: '发布完成',
    preview: '访问地址 https://example.up.railway.app',
    detail: '发布完成\n当前状态：SUCCESS\n访问地址：https://example.up.railway.app',
  });
  assert.match(String(deployCompleted?.payload.internalView?.detail || ''), /工具: deploy_application/);
  assert.match(String(deployCompleted?.payload.internalView?.detail || ''), /deploymentStatus: SUCCESS/);
  assert.match(String(deployCompleted?.payload.internalView?.detail || ''), /url: https:\/\/example\.up\.railway\.app/);
});

test('execute emits deliverables_ready before final assistant message when complete_task returns attachments', async () => {
  const state = createState('run-coordinator-deliverables', 'session-coordinator-deliverables');
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-deliverable-1',
      workspaceRoot: '/workspace/session-coordinator-deliverables',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  const deliverables = [
    {
      id: 'deliverable-1',
      runId: state.input.runId,
      path: 'outputs/final.docx',
      name: 'final.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1024,
      downloadPath: '/api/task-creation/sessions/session-coordinator-deliverables/deliverables/deliverable-1/download',
    },
  ];

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-ready',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '已完成最终文档交付。',
                      verification: ['已输出 final.docx'],
                      attachments: ['outputs/final.docx'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: '已完成最终文档交付。',
    verification: ['已输出 final.docx'],
    attachments: ['outputs/final.docx'],
  }));

  const deliverableService = {
    persistManagedRunDeliverables: mock.fn(async () => deliverables),
  };

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any,
    deliverableService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(executeMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'tool_call_started', 'deliverables_ready', 'tool_call_completed', 'assistant_message']
  );
  assert.deepEqual(eventCalls[3]?.payload.deliverables, deliverables);

  const deliverablesReadyTimeline = setupCalls.find(
    (entry) => (entry as any).input?.messageKey === `managed:${state.input.runId}:deliverables_ready`
  ) as any;
  assert.ok(deliverablesReadyTimeline);
  assert.equal(deliverablesReadyTimeline.input.messageType, 'status_update');
  assert.equal(deliverablesReadyTimeline.input.content, '交付文件已生成');

  const assistantTimeline = setupCalls.find(
    (entry) => (entry as any).input?.messageType === 'assistant_message'
  ) as any;
  assert.ok(assistantTimeline);
  assert.equal(assistantTimeline.input.content, '已完成最终文档交付。\n\n验证:\n- 已输出 final.docx');
});

test('execute injects skill catalog prompt before active skill body', async () => {
  const state = new AltusRunState({
    runId: 'run-coordinator-skills',
    sessionId: 'session-coordinator-skills',
    userId: 'user-1',
    model: 'altus-model',
    userInput: '帮我做一个演示文稿',
    sessionTitle: 'Build PPT',
    connectors: [],
    skillCatalog: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        revisionNumber: 3,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
    skills: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        renderedMarkdown: '# Skill Brief\n\nDo the work.',
        revisionNumber: 3,
        resourceSummary: {
          totalCount: 2,
          referenceCount: 1,
          templateCount: 1,
          paths: ['references/slide-structure-guide.md', 'templates/business-deck-outline.md'],
        },
      },
    ],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
  });

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-skills',
      workspaceRoot: '/workspace/session-coordinator-skills',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => {
      assert.match(systemPrompt, /# Available skills catalog/);
      assert.match(systemPrompt, /office-ppt: 创建专业演示文稿/);
      assert.match(systemPrompt, /# Active skills/);
      assert.match(systemPrompt, /# Skill Brief/);
      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];
    }),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async () => {}),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async () => ({ sequence: 1, payload: {} })),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {}),
    markWaitingUser: mock.fn(async () => {}),
    markCompleted: mock.fn(async () => {}),
    markFailed: mock.fn(async () => {}),
    markStopped: mock.fn(async () => {}),
  };

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-skills',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: 'done',
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: 'done',
  }));
  mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => ({
    changed: true,
  }) as any);

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());
  assert.equal((setupService.buildConversationMessages as any).mock.callCount(), 1);
});

test('execute syncs resolved skills after sandbox becomes ready', async () => {
  const state = new AltusRunState({
    runId: 'run-coordinator-skill-sync',
    sessionId: 'session-coordinator-skill-sync',
    userId: 'user-1',
    model: 'altus-model',
    userInput: '帮我做一个演示文稿',
    sessionTitle: 'Build PPT',
    connectors: [],
    mcpProviders: [],
    skillCatalog: [],
    skills: [
      {
        sourceType: 'platform',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        slug: 'office-ppt',
        name: 'PPT 办公',
        description: '创建专业演示文稿',
        category: 'office',
        renderedMarkdown: '# office-ppt',
        revisionNumber: 3,
        resourceSummary: {
          totalCount: 1,
          referenceCount: 1,
          templateCount: 0,
          paths: ['references/slide-structure-guide.md'],
        },
      },
    ],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
  });

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-skill-sync',
      workspaceRoot: '/workspace/session-coordinator-skill-sync',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async () => [
      { role: 'system', content: 'You are Altus' },
      { role: 'user', content: '帮我做一个演示文稿' },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async () => undefined),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async () => ({ sequence: 1, payload: {} })),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => undefined),
    markWaitingUser: mock.fn(async () => undefined),
    markCompleted: mock.fn(async () => undefined),
    markFailed: mock.fn(async () => undefined),
    markStopped: mock.fn(async () => undefined),
  };

  const syncSkillsMock = mock.method(sandboxSkillSyncService, 'syncResolvedSkills', async () => ({
    changed: true,
  }) as any);

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '演示文稿已完成。',
                      verification: ['已生成大纲'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: '演示文稿已完成。',
    verification: ['已生成大纲'],
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(syncSkillsMock.mock.callCount(), 1);
  assert.deepEqual(syncSkillsMock.mock.calls[0]?.arguments[0], {
    taskSessionId: 'session-coordinator-skill-sync',
    orchestratorSessionId: 'sandbox-skill-sync',
    skills: state.input.skills,
  });
});

test('execute does not complete on plain assistant text and continues until complete_task', async () => {
  const state = createState('run-coordinator-no-autocomplete', 'session-coordinator-no-autocomplete');
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-3',
      workspaceRoot: '/workspace/session-coordinator-no-autocomplete',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  let fetchCount = 0;
  global.fetch = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    const payload = init?.body ? JSON.parse(String(init.body)) : null;
    if (fetchCount === 2) {
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      assert.equal(messages.at(-1)?.role, 'user');
      assert.match(String(messages.at(-1)?.content || ''), /continue from the latest tool result/i);
    }

    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '工作空间是空的，开始创建 2048 游戏。',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-plain-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '已确认当前工作空间为空，尚未进行文件创建。',
                      verification: ['工作空间目录已检查'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: '已确认当前工作空间为空，尚未进行文件创建。',
    verification: ['工作空间目录已检查'],
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 2);
  assert.equal(executeMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');
  assert.equal(setupCalls.length, 1);
  assert.equal((setupCalls[0] as any).input.content, '已确认当前工作空间为空，尚未进行文件创建。\n\n验证:\n- 工作空间目录已检查');
  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'run_status', 'run_status', 'tool_call_started', 'tool_call_completed', 'assistant_message']
  );
  assert.equal(eventCalls[2]?.payload.transitionReason, 'plain_text_continuation_prompted');
});

test('execute accepts plain assistant text for pure memory identity questions', async () => {
  const state = createState('run-coordinator-memory-chat', 'session-coordinator-memory-chat');
  state.input.userInput = '我是谁';
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];
  const loopSnapshots: Record<string, unknown>[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-memory-chat',
      workspaceRoot: '/workspace/session-coordinator-memory-chat',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push(input);
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
    syncLoopSnapshot: mock.fn(async (_state: any, loop: Record<string, unknown>) => {
      loopSnapshots.push(loop);
    }),
  };

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '你是 watson，OneCEO 的用户，职业是 CEO，位于山东济南。',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => {
    throw new Error('execute should not be called for pure memory identity replies');
  });

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(executeMock.mock.callCount(), 0);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');
  assert.equal(
    loopSnapshots.some((snapshot) => snapshot.lastTransitionReason === 'plain_text_conversation_completed'),
    true
  );
  assert.equal(
    eventCalls.some(
      (entry) =>
        entry.eventType === 'run_status' &&
        entry.payload.transitionReason === 'plain_text_conversation_completed'
    ),
    true
  );
  assert.equal(
    setupCalls.some(
      (entry) =>
        entry.messageType === 'assistant_message' &&
        entry.metadata &&
        (entry.metadata as Record<string, unknown>).completionMode === 'plain_text_conversation'
    ),
    true
  );
});

test('execute requests clarification and transitions to waiting_user', async () => {
  const state = createState('run-coordinator-clarify', 'session-coordinator-clarify');
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-2',
      workspaceRoot: '/workspace/session-coordinator-clarify',
      reused: true,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-ask-1',
                  type: 'function',
                  function: {
                    name: 'ask_user',
                    arguments: JSON.stringify({
                      question: '你希望是网页版本还是原生版本？',
                      options: ['网页版本', '原生版本'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  const setPendingClarificationMock = mock.method(
    taskCreationFileMemoryStore,
    'setPendingClarification',
    async () => {}
  );
  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'ask_user' as const,
    question: '你希望是网页版本还是原生版本？',
    options: ['网页版本', '原生版本'],
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(executeMock.mock.callCount(), 1);
  assert.equal(setPendingClarificationMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['running', 'waiting_user']);
  assert.equal(state.status, 'waiting_user');

  const timelineCall = setupCalls.find((entry) => entry.type === 'timeline') as any;
  assert.equal(timelineCall.input.messageType, 'clarification_request');
  assert.equal(timelineCall.input.content, '你希望是网页版本还是原生版本？');
  assert.equal(timelineCall.input.messageKey, 'managed:run-coordinator-clarify:clarification');

  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'tool_call_started', 'clarification_requested']
  );
  assert.equal(eventCalls[3]?.payload.question, '你希望是网页版本还是原生版本？');
  assert.equal(eventCalls[3]?.payload.messageKey, 'managed:run-coordinator-clarify:clarification');
});

test('execute converts plain assistant clarification into waiting_user', async () => {
  const state = createState('run-coordinator-plain-clarify', 'session-coordinator-plain-clarify');
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-4',
      workspaceRoot: '/workspace/session-coordinator-plain-clarify',
      reused: true,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '你希望优化哪些方面？比如颜色、布局还是动画？',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  const setPendingClarificationMock = mock.method(
    taskCreationFileMemoryStore,
    'setPendingClarification',
    async () => {}
  );
  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => {
    throw new Error('execute should not be called for plain assistant clarification');
  });

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(executeMock.mock.callCount(), 0);
  assert.equal(setPendingClarificationMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['running', 'waiting_user']);
  assert.equal(state.status, 'waiting_user');

  const timelineCall = setupCalls.find((entry) => entry.type === 'timeline') as any;
  assert.equal(timelineCall.input.messageType, 'clarification_request');
  assert.equal(timelineCall.input.content, '你希望优化哪些方面？比如颜色、布局还是动画？');
  assert.equal(timelineCall.input.messageKey, 'managed:run-coordinator-plain-clarify:clarification');

  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'clarification_requested']
  );
  assert.equal(eventCalls[2]?.payload.question, '你希望优化哪些方面？比如颜色、布局还是动画？');
  assert.equal(eventCalls[2]?.payload.messageKey, 'managed:run-coordinator-plain-clarify:clarification');
});

test('execute retries transient upstream timeout before completing', async () => {
  const state = createState('run-coordinator-retry', 'session-coordinator-retry');
  const lifecycleCalls: string[] = [];
  const loopSnapshots: Array<Record<string, unknown>> = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-5',
      workspaceRoot: '/workspace/session-coordinator-retry',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async () => {}),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
    syncLoopSnapshot: mock.fn(async (_state: any, loop: Record<string, unknown>) => {
      loopSnapshots.push(loop);
    }),
  };

  let fetchCount = 0;
  global.fetch = mock.fn(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Upstream timeout',
            type: 'upstream_timeout',
            code: 'upstream_timeout',
          },
        }),
        { status: 504, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-retry-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '重试后已恢复并完成。',
                      verification: ['第二次模型请求成功'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: '重试后已恢复并完成。',
    verification: ['第二次模型请求成功'],
  }));
  const delayMock = mock.method(AltusRunCoordinator.prototype as any, 'delay', async () => {});

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 2);
  assert.equal(delayMock.mock.callCount(), 1);
  assert.equal(executeMock.mock.callCount(), 1);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');
  assert.equal(
    loopSnapshots.some((snapshot) => snapshot.lastTransitionReason === 'model_retryable_error'),
    true
  );
  assert.equal(
    eventCalls.some(
      (entry) =>
        entry.eventType === 'run_status' && entry.payload.transitionReason === 'model_retryable_error'
    ),
    true
  );
});

test('execute records plain-text continuation recovery before failing the managed loop', async () => {
  const state = createState('run-coordinator-plain-text-fail', 'session-coordinator-plain-text-fail');
  const lifecycleCalls: string[] = [];
  const loopSnapshots: Array<Record<string, unknown>> = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-plain-text-fail',
      workspaceRoot: '/workspace/session-coordinator-plain-text-fail',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async () => {}),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
    syncLoopSnapshot: mock.fn(async (_state: any, loop: Record<string, unknown>) => {
      loopSnapshots.push(loop);
    }),
  };

  let fetchCount = 0;
  global.fetch = mock.fn(async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: fetchCount === 1 ? '我先分析现有文件结构。' : '继续分析现有文件结构。',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => {
    throw new Error('execute should not be called when the model never emits tool calls');
  });

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 2);
  assert.equal(executeMock.mock.callCount(), 0);
  assert.deepEqual(lifecycleCalls, ['running', 'failed']);
  assert.equal(state.status, 'failed');
  assert.match(state.stopReason || '', /managed_model_plain_text_without_tool_call/);
  assert.equal(
    loopSnapshots.some((snapshot) => snapshot.lastTransitionReason === 'plain_text_continuation_prompted'),
    true
  );
  assert.equal(
    loopSnapshots.some((snapshot) => snapshot.lastTransitionReason === 'plain_text_continuation_failed'),
    true
  );
  assert.equal(
    eventCalls.some(
      (entry) =>
        entry.eventType === 'run_status' && entry.payload.transitionReason === 'plain_text_continuation_prompted'
    ),
    true
  );
  assert.equal(
    eventCalls.some(
      (entry) =>
        entry.eventType === 'run_status' && entry.payload.transitionReason === 'plain_text_continuation_failed'
    ),
    true
  );
});

test('execute consumes streamed tool_call chunks and emits tool_call_progress', async () => {
  const state = createState('run-coordinator-stream', 'session-coordinator-stream');
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-6',
      workspaceRoot: '/workspace/session-coordinator-stream',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async () => {}),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  let fetchCount = 0;
  global.fetch = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = init?.body ? JSON.parse(String(init.body)) : null;
    assert.equal(payload?.stream, true);

    fetchCount += 1;
    if (fetchCount === 1) {
      return createSseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool-stream-1","type":"function","function":{"name":"write_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"index.html\\","}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"content\\":\\"<html></html>\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-stream-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '流式 tool_call 已正确执行。',
                      verification: ['已消费 SSE chunk', '已写入 index.html'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const executeMock = mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: fetchCount === 1 ? ('result' as const) : ('complete' as const),
    ...(fetchCount === 1
      ? {
          content: JSON.stringify({
            path: 'index.html',
            bytes: 13,
          }),
        }
      : {
          summary: '流式 tool_call 已正确执行。',
          verification: ['已消费 SSE chunk', '已写入 index.html'],
        }),
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 2);
  assert.equal(executeMock.mock.callCount(), 2);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');
  assert.ok(eventCalls.some((entry) => entry.eventType === 'tool_call_progress'));
  assert.ok(
    eventCalls.some(
      (entry) =>
        entry.eventType === 'tool_call_progress' &&
        String(entry.payload.rawArguments || '').includes('index.html')
    )
  );
  assert.ok(
    eventCalls.some(
      (entry) =>
        entry.eventType === 'tool_call_started' && entry.payload.toolCallId === 'tool-stream-1'
    )
  );
});

test('execute recovers from connector guide block by loading the guide and retrying the github mcp tool', async () => {
  const managedToolName = buildManagedMcpToolName('provider-1', 'search_repositories');
  const state = new AltusRunState({
    runId: 'run-coordinator-connector-guide-retry',
    sessionId: 'session-coordinator-connector-guide-retry',
    userId: 'user-1',
    model: 'altus-model',
    userInput: '读取一个 GitHub 仓库基础信息',
    sessionTitle: 'GitHub connector guide retry',
    connectors: [
      {
        connectorKey: 'github',
        attached: true,
        desiredState: 'attached',
        runtimeStatus: 'connected',
      },
    ],
    mcpProviders: [
      {
        connectorKey: 'github',
        providerId: 'provider-1',
        tools: [{ providerId: 'provider-1', toolName: 'search_repositories' }],
      },
    ],
    skillCatalog: [],
    skills: [],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
  });
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-guide-retry',
      workspaceRoot: '/workspace/session-coordinator-connector-guide-retry',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => {
      assert.match(systemPrompt, /# Connector MCP Instructions/);
      assert.match(systemPrompt, /# Relevant Connector Guides/);
      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];
    }),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  const buildPromptSectionsMock = mock.method(connectorGuideService, 'buildPromptSections', async () => ({
    instructionsSection: '# Connector MCP Instructions\n\n## github\nRead the guide first.',
    reminderSection: '# Relevant Connector Guides\n\n- github guide active.',
    activeGuides: [
      {
        connectorKey: 'github',
        policyId: 'policy-1',
        revisionId: 'rev-1',
        triggerMode: 'on_attach',
        serverInstructionsMarkdown: 'Read the guide first.',
        guideReminderMarkdown: 'github guide active.',
        blockingRulesMarkdown: 'Verify target repo before writes.',
      },
    ],
  }));
  const getActiveGuideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async () => ({
    connectorKey: 'github',
    policyId: 'policy-1',
    revisionId: 'rev-1',
    triggerMode: 'on_attach',
    serverInstructionsMarkdown: 'Read the guide first.',
    guideReminderMarkdown: 'github guide active.',
    blockingRulesMarkdown: 'Verify target repo before writes.',
  }));
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-1',
    toolName: 'search_repositories',
    result: {
      ok: true,
      items: [{ full_name: 'april-jk/LogDesign' }],
    },
    isError: false,
  }));

  let fetchCount = 0;
  global.fetch = mock.fn(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-github-direct-1',
                    type: 'function',
                    function: {
                      name: managedToolName,
                      arguments: JSON.stringify({
                        query: 'user:april-jk',
                        perPage: 1,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fetchCount === 2) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-load-guide-1',
                    type: 'function',
                    function: {
                      name: 'load_connector_guide',
                      arguments: JSON.stringify({
                        connectorKey: 'github',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fetchCount === 3) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-github-direct-2',
                    type: 'function',
                    function: {
                      name: managedToolName,
                      arguments: JSON.stringify({
                        query: 'user:april-jk',
                        perPage: 1,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-guide-retry-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '已先加载 connector guide，再成功读取 GitHub 仓库信息。',
                      verification: ['首次直连 GitHub MCP 被阻断', '加载 guide 后重试成功'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 4);
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.ok(buildPromptSectionsMock.mock.callCount() >= 1);
  assert.ok(getActiveGuideMock.mock.callCount() >= 3);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(state.status, 'completed');

  const failedCall = eventCalls.find((entry) => entry.eventType === 'tool_call_failed');
  assert.ok(failedCall);
  assert.equal(failedCall?.payload.toolName, managedToolName);
  assert.match(String(failedCall?.payload.error || ''), /connector_guide_blocked:github/);

  const completedToolNames = eventCalls
    .filter((entry) => entry.eventType === 'tool_call_completed')
    .map((entry) => String(entry.payload.toolName || ''));
  assert.deepEqual(completedToolNames, ['load_connector_guide', managedToolName, 'complete_task']);

  const timelineCall = setupCalls.find((entry) => entry.type === 'timeline') as any;
  assert.equal(
    timelineCall.input.content,
    '已先加载 connector guide，再成功读取 GitHub 仓库信息。\n\n验证:\n- 首次直连 GitHub MCP 被阻断\n- 加载 guide 后重试成功'
  );
});

test('execute recovers from connector guide block by loading the guide and retrying the vercel mcp tool', async () => {
  const managedToolName = buildManagedMcpToolName('provider-vercel', 'list_projects');
  const state = new AltusRunState({
    runId: 'run-coordinator-vercel-guide-retry',
    sessionId: 'session-coordinator-vercel-guide-retry',
    userId: 'user-1',
    model: 'altus-model',
    userInput: '读取一个 Vercel 项目基础信息',
    sessionTitle: 'Vercel connector guide retry',
    connectors: [
      {
        connectorKey: 'vercel',
        attached: true,
        desiredState: 'attached',
        runtimeStatus: 'connected',
      },
    ],
    mcpProviders: [
      {
        connectorKey: 'vercel',
        providerId: 'provider-vercel',
        tools: [{ providerId: 'provider-vercel', toolName: 'list_projects' }],
      },
    ],
    skillCatalog: [],
    skills: [],
    taskIntentProfile: {
      mode: 'neutral',
      reason: 'unknown',
      recentUserMessages: [],
      explicitNoDeploy: false,
      explicitNoWeb: false,
      webArtifactRequested: false,
      deployRequested: false,
      scriptArtifactRequested: false,
      emailTemplateRequested: false,
      deploymentAllowed: false,
      needsClarification: false,
      clarificationQuestion: '',
      clarificationType: 'none',
      todoRequired: false,
      todoReason: 'none',
    },
  });
  const setupCalls: Record<string, unknown>[] = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-vercel-guide-retry',
      workspaceRoot: '/workspace/session-coordinator-vercel-guide-retry',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => {
      assert.match(systemPrompt, /# Connector MCP Instructions/);
      assert.match(systemPrompt, /## vercel/);
      return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];
    }),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ eventType, payload });
      return {
        sequence: eventCalls.length,
        payload,
      };
    }),
  };

  const lifecycleService = {
    markRunning: mock.fn(async () => {
      lifecycleCalls.push('running');
    }),
    markWaitingUser: mock.fn(async () => {
      lifecycleCalls.push('waiting_user');
    }),
    markCompleted: mock.fn(async () => {
      lifecycleCalls.push('completed');
    }),
    markFailed: mock.fn(async () => {
      lifecycleCalls.push('failed');
    }),
    markStopped: mock.fn(async () => {
      lifecycleCalls.push('stopped');
    }),
  };

  const buildPromptSectionsMock = mock.method(connectorGuideService, 'buildPromptSections', async () => ({
    instructionsSection: '# Connector MCP Instructions\n\n## vercel\nRead the vercel guide first.',
    reminderSection: '# Relevant Connector Guides\n\n- vercel guide active.',
    activeGuides: [
      {
        connectorKey: 'vercel',
        policyId: 'policy-vercel',
        revisionId: 'rev-vercel-1',
        triggerMode: 'on_attach',
        serverInstructionsMarkdown: 'Read the vercel guide first.',
        guideReminderMarkdown: 'vercel guide active.',
        blockingRulesMarkdown: 'Verify project and environment before writes.',
      },
    ],
  }));
  const getActiveGuideMock = mock.method(connectorGuideService, 'getActiveGuideForConnector', async (_sessionId, connectorKey) => {
    if (connectorKey !== 'vercel') return null;
    return {
      connectorKey: 'vercel',
      policyId: 'policy-vercel',
      revisionId: 'rev-vercel-1',
      triggerMode: 'on_attach',
      serverInstructionsMarkdown: 'Read the vercel guide first.',
      guideReminderMarkdown: 'vercel guide active.',
      blockingRulesMarkdown: 'Verify project and environment before writes.',
    };
  });
  const mcpMock = mock.method(osacAgentService, 'callSessionMcpTool', async () => ({
    providerId: 'provider-vercel',
    toolName: 'list_projects',
    result: {
      ok: true,
      projects: [{ id: 'prj_123', name: 'demo-app' }],
    },
    isError: false,
  }));

  let fetchCount = 0;
  global.fetch = mock.fn(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-vercel-direct-1',
                    type: 'function',
                    function: {
                      name: managedToolName,
                      arguments: JSON.stringify({
                        teamId: 'team_123',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fetchCount === 2) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-load-vercel-guide-1',
                    type: 'function',
                    function: {
                      name: 'load_connector_guide',
                      arguments: JSON.stringify({
                        connectorKey: 'vercel',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (fetchCount === 3) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-vercel-direct-2',
                    type: 'function',
                    function: {
                      name: managedToolName,
                      arguments: JSON.stringify({
                        teamId: 'team_123',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'tool-complete-vercel-guide-retry-1',
                  type: 'function',
                  function: {
                    name: 'complete_task',
                    arguments: JSON.stringify({
                      summary: '已先加载 Vercel connector guide，再成功读取 Vercel 项目信息。',
                      verification: ['首次直连 Vercel MCP 被阻断', '加载 guide 后重试成功'],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.equal(fetchCount, 4);
  assert.equal(mcpMock.mock.callCount(), 1);
  assert.ok(buildPromptSectionsMock.mock.callCount() >= 1);
  assert.ok(getActiveGuideMock.mock.callCount() >= 3);
  assert.deepEqual(lifecycleCalls, ['running', 'completed']);

  const failedCall = eventCalls.find((entry) => entry.eventType === 'tool_call_failed');
  assert.ok(failedCall);
  assert.equal(failedCall?.payload.toolName, managedToolName);
  assert.match(String(failedCall?.payload.error || ''), /connector_guide_blocked:vercel/);

  const completedToolNames = eventCalls
    .filter((entry) => entry.eventType === 'tool_call_completed')
    .map((entry) => String(entry.payload.toolName || ''));
  assert.deepEqual(completedToolNames, ['load_connector_guide', managedToolName, 'complete_task']);

  const timelineCall = setupCalls.find((entry) => entry.type === 'timeline') as any;
  assert.equal(
    timelineCall.input.content,
    '已先加载 Vercel connector guide，再成功读取 Vercel 项目信息。\n\n验证:\n- 首次直连 Vercel MCP 被阻断\n- 加载 guide 后重试成功'
  );
});

test('execute switches to vision model when conversation contains image blocks', async () => {
  const originalVisionModel = process.env.ALTUS_MANAGED_VISION_MODEL;
  process.env.ALTUS_MANAGED_VISION_MODEL = 'qwen3-vl-plus';
  try {
    const state = createState('run-coordinator-vision', 'session-coordinator-vision');

    const setupService = {
      ensureSandbox: mock.fn(async () => ({
        sandboxId: 'sandbox-7',
        workspaceRoot: '/workspace/session-coordinator-vision',
        reused: false,
      })),
      buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: input },
            { type: 'image_url', image_url: { url: 'https://example.com/signed-image.png' } },
          ],
        },
      ]),
      refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
      persistTimelineMessage: mock.fn(async () => {}),
    };

    const eventWriter = {
      appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, _userId: string, _eventType: string, payload: Record<string, unknown>) => ({
        sequence: 1,
        payload,
      })),
    };

    const lifecycleService = {
      markRunning: mock.fn(async () => {}),
      markWaitingUser: mock.fn(async () => {}),
      markCompleted: mock.fn(async () => {}),
      markFailed: mock.fn(async () => {}),
      markStopped: mock.fn(async () => {}),
    };

    let seenPayload: any = null;
    global.fetch = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenPayload = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-complete-vision-1',
                    type: 'function',
                    function: {
                      name: 'complete_task',
                      arguments: JSON.stringify({
                        summary: '已直接使用视觉模型分析图片。',
                        verification: ['请求体模型已切换到视觉模型'],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
      type: 'complete' as const,
      summary: '已直接使用视觉模型分析图片。',
      verification: ['请求体模型已切换到视觉模型'],
    }));

    const coordinator = new AltusRunCoordinator(
      setupService as any,
      eventWriter as any,
      lifecycleService as any
    );

    await coordinator.execute(state, new AbortController());

    assert.equal(seenPayload?.model, 'qwen3-vl-plus');
    assert.equal(seenPayload?.messages?.[1]?.content?.[1]?.type, 'image_url');
  } finally {
    if (originalVisionModel === undefined) {
      delete process.env.ALTUS_MANAGED_VISION_MODEL;
    } else {
      process.env.ALTUS_MANAGED_VISION_MODEL = originalVisionModel;
    }
  }
});
