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

const originalFetch = global.fetch;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
});

function createState(runId: string, sessionId: string) {
  return new AltusRunState({
    runId,
    sessionId,
    userId: 'user-1',
    model: 'altus-model',
    userInput: '帮我开发 2048 小游戏',
    sessionTitle: 'Build 2048',
    connectors: [],
    mcpProviders: [],
    skillCatalog: [],
    skills: [],
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

test('execute completes after tool round and final assistant response', async () => {
  const state = createState('run-coordinator-complete', 'session-coordinator-complete');
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
  assert.equal(eventCalls[5]?.payload.toolName, 'complete_task');
  assert.equal(eventCalls[6]?.payload.toolName, 'complete_task');
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
    ['run_status', 'run_status', 'run_status', 'tool_call_started', 'tool_call_completed', 'assistant_message']
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

  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'tool_call_started', 'clarification_requested']
  );
  assert.equal(eventCalls[3]?.payload.question, '你希望是网页版本还是原生版本？');
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

  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['run_status', 'run_status', 'clarification_requested']
  );
  assert.equal(eventCalls[2]?.payload.question, '你希望优化哪些方面？比如颜色、布局还是动画？');
});

test('execute retries transient upstream timeout before completing', async () => {
  const state = createState('run-coordinator-retry', 'session-coordinator-retry');
  const lifecycleCalls: string[] = [];

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
