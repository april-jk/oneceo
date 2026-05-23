import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationSessionDAO, taskSessionRunDAO } from '../src/db/dao';
import { altusManagedStreamService } from '../src/services/altus-managed-stream-service';
import { AltusRunEventWriter } from '../src/services/altus-run-event-writer';

afterEach(() => {
  mock.reset();
});

test('appendRunEvent projects managed tool terminal events into conversation timeline before publish', async () => {
  const callOrder: string[] = [];
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => {
    callOrder.push('run_event');
    return {
      id: 'run-event-1',
      sequence: 7,
      createdAt: new Date('2026-04-07T06:50:00.000Z'),
    } as any;
  });
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async (input: any) => {
    callOrder.push('timeline_projection');
    return input;
  });
  const publishMock = mock.method(altusManagedStreamService, 'publish', () => {
    callOrder.push('sse_publish');
  });
  const redisCalls: any[] = [];
  const writer = new AltusRunEventWriter({
    appendRunEvent: async (input: any) => {
      callOrder.push('redis_event');
      redisCalls.push(input);
    },
  } as any);

  await writer.appendRunEvent('run-1', 'session-1', 'user-1', 'tool_call_completed', {
    toolName: 'read_file',
    toolCallId: 'tool-1',
    content: '工具 read_file 已完成',
    transitionReason: 'tool_result_continue',
    currentRound: 3,
    maxRounds: 192,
    arguments: {
      path: '/workspace/README.md',
    },
    outputPreview: 'ok',
    debug: {
      rawError: 'internal only',
    },
  });

  assert.equal(addMessageMock.mock.callCount(), 1);
  const [projection] = addMessageMock.mock.calls[0]?.arguments as any[];
  assert.equal(projection.sessionId, 'session-1');
  assert.equal(projection.role, 'agent');
  assert.equal(projection.messageType, 'executor_event');
  assert.equal(projection.content, '工具 read_file 已完成');
  assert.equal(projection.metadata?.eventType, 'tool_call_completed');
  assert.equal(projection.metadata?.executionMode, 'managed');
  assert.equal(projection.metadata?.executor, 'altus');
  assert.equal(projection.metadata?.messageKey, 'managed:run-1:tool:tool-1');
  assert.equal(projection.metadata?.toolCallId, 'tool-1');
  assert.deepEqual(projection.metadata?.arguments, {
    path: '/workspace/README.md',
  });
  assert.equal(projection.metadata?.transitionReason, undefined);
  assert.equal(projection.metadata?.currentRound, undefined);
  assert.equal(projection.metadata?.maxRounds, undefined);
  assert.equal(projection.metadata?.debug, undefined);

  assert.equal(redisCalls.length, 1);
  assert.equal(redisCalls[0]?.eventType, 'tool_call_completed');
  assert.equal(redisCalls[0]?.payload.transitionReason, 'tool_result_continue');
  assert.equal(redisCalls[0]?.payload.currentRound, 3);
  assert.equal(redisCalls[0]?.payload.maxRounds, 192);
  assert.deepEqual(redisCalls[0]?.payload.debug, {
    rawError: 'internal only',
  });

  assert.equal(publishMock.mock.callCount(), 1);
  const publishArgs = publishMock.mock.calls[0]?.arguments as any[];
  assert.equal(publishArgs[0], 'run-1');
  assert.equal(publishArgs[1]?.eventType, 'tool_call_completed');
  assert.equal(publishArgs[1]?.sequence, 7);

  assert.deepEqual(callOrder, ['run_event', 'timeline_projection', 'redis_event', 'sse_publish']);
});

test('appendRunEvent projects browser screenshot evidence for replay actions', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-browser-1',
    sequence: 9,
    createdAt: new Date('2026-05-22T06:50:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async (input: any) => input);
  mock.method(altusManagedStreamService, 'publish', () => undefined);
  const writer = new AltusRunEventWriter({
    appendRunEvent: async () => undefined,
  } as any);

  await writer.appendRunEvent('run-browser-1', 'session-browser-1', 'user-browser-1', 'tool_call_completed', {
    toolName: 'browser_interact',
    toolCallId: 'tool-browser-1',
    content: '视觉检测步骤已完成',
    browserScreenshot: {
      type: 'browser_screenshot',
      kind: 'browser_action_screenshot',
      status: 'captured',
      storageKey: 'sessions/session-browser-1/browser-actions/step.png',
      mimeType: 'image/png',
      width: 1280,
      height: 720,
      capturedAt: '2026-05-22T06:50:00.000Z',
      source: {
        sandboxId: 'sandbox-1',
        cdpPort: 9222,
        url: 'http://127.0.0.1:3000/',
      },
    },
  });

  const [projection] = addMessageMock.mock.calls[0]?.arguments as any[];
  assert.equal(projection.metadata?.browserScreenshot?.status, 'captured');
  assert.equal(projection.metadata?.browserScreenshot?.storageKey, 'sessions/session-browser-1/browser-actions/step.png');
  assert.equal(projection.metadata?.browserScreenshot?.source?.cdpPort, 9222);
});

test('appendRunEvent projects contentful run_status into conversation timeline before publish', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-2',
    sequence: 8,
    createdAt: new Date('2026-04-07T06:51:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async (input: any) => input);
  const publishMock = mock.method(altusManagedStreamService, 'publish', () => {});
  const redisCalls: any[] = [];
  const writer = new AltusRunEventWriter({
    appendRunEvent: async (input: any) => {
      redisCalls.push(input);
    },
  } as any);

  await writer.appendRunEvent('run-2', 'session-2', 'user-2', 'run_status', {
    status: 'running',
    content: '正在分析上一步结果并决定下一步操作',
  });

  assert.equal(addMessageMock.mock.callCount(), 1);
  const [projection] = addMessageMock.mock.calls[0]?.arguments as any[];
  assert.equal(projection.sessionId, 'session-2');
  assert.equal(projection.role, 'system');
  assert.equal(projection.messageType, 'status_update');
  assert.equal(projection.content, '正在分析上一步结果并决定下一步操作');
  assert.equal(projection.metadata?.eventType, 'run_status');
  assert.equal(projection.metadata?.executionMode, 'managed');
  assert.equal(projection.metadata?.executor, 'altus');
  assert.equal(projection.metadata?.messageKey, 'managed:run-2:run_status:8');
  assert.equal(redisCalls.length, 1);
  assert.equal(redisCalls[0]?.eventType, 'run_status');
  assert.equal(publishMock.mock.callCount(), 1);
});

test('appendRunEvent does not project tool_call_progress to conversation timeline', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-3',
    sequence: 9,
    createdAt: new Date('2026-04-07T06:52:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async () => null as any);
  mock.method(altusManagedStreamService, 'publish', () => {});
  const writer = new AltusRunEventWriter({
    appendRunEvent: async () => {},
  } as any);

  await writer.appendRunEvent('run-3', 'session-3', 'user-3', 'tool_call_progress', {
    toolName: 'read_file',
    toolCallId: 'tool-progress-1',
    content: '正在准备工具 read_file',
  });

  assert.equal(addMessageMock.mock.callCount(), 0);
});

test('appendRunEvent does not project starting run_status into conversation timeline', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-4',
    sequence: 10,
    createdAt: new Date('2026-04-22T14:10:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async () => null as any);
  const publishMock = mock.method(altusManagedStreamService, 'publish', () => {});
  const redisCalls: any[] = [];
  const writer = new AltusRunEventWriter({
    appendRunEvent: async (input: any) => {
      redisCalls.push(input);
    },
  } as any);

  await writer.appendRunEvent('run-4', 'session-4', 'user-4', 'run_status', {
    status: 'starting',
    content: '正在准备 sandbox 与运行环境',
  });

  assert.equal(addMessageMock.mock.callCount(), 0);
  assert.equal(redisCalls.length, 1);
  assert.equal(redisCalls[0]?.eventType, 'run_status');
  assert.equal(publishMock.mock.callCount(), 1);
});

test('appendRunEvent does not project ask_user tool events into conversation timeline', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-5',
    sequence: 11,
    createdAt: new Date('2026-04-23T09:00:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async () => null as any);
  const publishMock = mock.method(altusManagedStreamService, 'publish', () => {});
  const writer = new AltusRunEventWriter({
    appendRunEvent: async () => {},
  } as any);

  await writer.appendRunEvent('run-5', 'session-5', 'user-5', 'tool_call_started', {
    toolName: 'ask_user',
    toolCallId: 'tool-ask-1',
    content: '调用工具 ask_user',
    arguments: {
      question: '你想要网页还是脚本？',
    },
  });

  assert.equal(addMessageMock.mock.callCount(), 0);
  assert.equal(publishMock.mock.callCount(), 1);
});

test('appendRunEvent only projects todowrite after completion', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-6',
    sequence: 12,
    createdAt: new Date('2026-04-23T09:05:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async (input: any) => input);
  mock.method(altusManagedStreamService, 'publish', () => {});
  const writer = new AltusRunEventWriter({
    appendRunEvent: async () => {},
  } as any);

  await writer.appendRunEvent('run-6', 'session-6', 'user-6', 'tool_call_started', {
    toolName: 'todowrite',
    toolCallId: 'tool-todo-1',
    content: '调用工具 todowrite',
    arguments: {
      todos: [{ content: '修改后端主链', status: 'in_progress' }],
    },
  });
  await writer.appendRunEvent('run-6', 'session-6', 'user-6', 'tool_call_completed', {
    toolName: 'todowrite',
    toolCallId: 'tool-todo-1',
    content: '工具 todowrite 已完成',
    arguments: {
      todos: [{ content: '修改后端主链', status: 'in_progress' }],
    },
  });

  assert.equal(addMessageMock.mock.callCount(), 1);
  const [projection] = addMessageMock.mock.calls[0]?.arguments as any[];
  assert.equal(projection.metadata?.toolName, 'todowrite');
  assert.equal(projection.metadata?.eventType, 'tool_call_completed');
});
