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

test('appendRunEvent keeps non-tool events out of conversation projection', async () => {
  mock.method(taskSessionRunDAO, 'appendRunEvent', async () => ({
    id: 'run-event-2',
    sequence: 8,
    createdAt: new Date('2026-04-07T06:51:00.000Z'),
  }) as any);
  const addMessageMock = mock.method(taskCreationSessionDAO, 'addMessage', async () => null as any);
  const publishMock = mock.method(altusManagedStreamService, 'publish', () => {});
  const redisCalls: any[] = [];
  const writer = new AltusRunEventWriter({
    appendRunEvent: async (input: any) => {
      redisCalls.push(input);
    },
  } as any);

  await writer.appendRunEvent('run-2', 'session-2', 'user-2', 'run_status', {
    status: 'running',
    content: '运行中',
  });

  assert.equal(addMessageMock.mock.callCount(), 0);
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
