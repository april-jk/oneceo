import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { AltusRunCoordinator } from '../src/services/altus-run-coordinator';
import { AltusRunState } from '../src/services/altus-run-state';
import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { connectorGuideService } from '../src/services/connector-guide-service';

const originalFetch = global.fetch;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
});

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

test('execute emits starting feedback before running and reuses a stable assistant message key', async () => {
  const state = createState('run-first-feedback', 'session-first-feedback');
  const timelineCalls: Array<Record<string, unknown>> = [];
  const eventCalls: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const lifecycleCalls: string[] = [];

  mock.method(connectorGuideService, 'buildPromptSections', async () => ({
    instructionsSection: '',
    reminderSection: '',
  }));

  const setupService = {
    ensureSandbox: mock.fn(async () => ({
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-first-feedback',
      reused: false,
    })),
    buildConversationMessages: mock.fn(async (_sessionId: string, input: string, systemPrompt: string) => [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]),
    refreshInlineImageUrls: mock.fn(async (messages: any[]) => messages),
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
    )
  ) as typeof fetch;

  mock.method(AltusManagedToolRuntime.prototype, 'execute', async () => ({
    type: 'complete' as const,
    summary: '2048 已完成并写入 workspace。',
    verification: ['已写入 index.html'],
  }));

  const coordinator = new AltusRunCoordinator(
    setupService as any,
    eventWriter as any,
    lifecycleService as any
  );

  await coordinator.execute(state, new AbortController());

  assert.deepEqual(lifecycleCalls, ['running', 'completed']);
  assert.equal(eventCalls[0]?.eventType, 'run_status');
  assert.equal(eventCalls[0]?.payload.status, 'starting');
  assert.equal(eventCalls[1]?.eventType, 'run_status');
  assert.equal(eventCalls[1]?.payload.status, 'running');
  assert.equal(eventCalls.at(-1)?.eventType, 'assistant_message');
  assert.equal(eventCalls.at(-1)?.payload.messageKey, 'managed:run-first-feedback:assistant');
  assert.equal(
    timelineCalls.find((item) => item.messageType === 'assistant_message')?.messageKey,
    'managed:run-first-feedback:assistant'
  );
});
