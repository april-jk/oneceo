import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { AltusRunCoordinator } from '../src/services/altus-run-coordinator';
import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { AltusRunState } from '../src/services/altus-run-state';

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
  });
}

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
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, eventType: string, payload: Record<string, unknown>) => {
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
    ['run_status', 'tool_call_started', 'tool_call_completed', 'run_status', 'tool_call_started', 'tool_call_completed', 'assistant_message']
  );
  assert.equal(eventCalls[1]?.payload.toolName, 'write_file');
  assert.equal(eventCalls[2]?.payload.toolName, 'write_file');
  assert.equal(eventCalls[4]?.payload.toolName, 'complete_task');
  assert.equal(eventCalls[5]?.payload.toolName, 'complete_task');
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
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, eventType: string, payload: Record<string, unknown>) => {
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
      assert.match(String(messages.at(-1)?.content || ''), /plain assistant text does not complete a managed run/i);
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
    ['run_status', 'run_status', 'tool_call_started', 'tool_call_completed', 'assistant_message']
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
    persistTimelineMessage: mock.fn(async (input: Record<string, unknown>) => {
      setupCalls.push({ type: 'timeline', input });
    }),
  };

  const eventWriter = {
    appendRunEvent: mock.fn(async (_runId: string, _sessionId: string, eventType: string, payload: Record<string, unknown>) => {
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
    ['run_status', 'tool_call_started', 'clarification_requested']
  );
  assert.equal(eventCalls[2]?.payload.question, '你希望是网页版本还是原生版本？');
});
