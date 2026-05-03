import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { taskSessionRunDAO } from '../src/db/dao';
import { AltusManagedAskUserPairingService } from '../src/services/altus-managed-ask-user-pairing-service';

afterEach(() => {
  mock.reset();
});

test('ask_user pairing classifies direct answer, delegation, advisory scope and redirect from transition profile', () => {
  const service = new AltusManagedAskUserPairingService({ appendRunEvent: async () => ({}) } as any);

  assert.equal(service.classifyAnswer({ answer: '网页应用' }), 'direct_answer');
  assert.equal(
    service.classifyAnswer({
      answer: '你决定',
      taskIntentProfile: {
        clarificationTransition: {
          nextState: 'ready_to_execute',
          reason: 'delegate_to_agent_default',
        },
      } as any,
    }),
    'delegated_to_agent'
  );
  assert.equal(
    service.classifyAnswer({
      answer: '先做方案',
      taskIntentProfile: {
        clarificationTransition: {
          nextState: 'advisory',
          reason: 'switch_to_advisory_mode',
        },
      } as any,
    }),
    'scope_softening'
  );
  assert.equal(
    service.classifyAnswer({
      answer: '不用了，帮我做另一个系统',
      taskIntentProfile: {
        clarificationTransition: {
          nextState: 'new_turn',
          reason: 'restart_as_new_turn',
        },
      } as any,
    }),
    'redirect'
  );
  assert.equal(service.classifyAnswer({ answer: '取消' }), 'cancelled');
});

test('ask_user pairing closes pending clarification with clarification_answered and tool_result events', async () => {
  const eventCalls: Array<{ runId: string; eventType: string; payload: Record<string, unknown> }> = [];
  const service = new AltusManagedAskUserPairingService({
    appendRunEvent: async (runId: string, _sessionId: string, _userId: string, eventType: string, payload: Record<string, unknown>) => {
      eventCalls.push({ runId, eventType, payload });
      return { sequence: eventCalls.length };
    },
  } as any);
  const updateRunStatusMock = mock.method(taskSessionRunDAO, 'updateRunStatus', async () => ({} as any));
  const clearPendingMock = mock.method(taskCreationFileMemoryStore, 'clearPendingClarification', async () => {});

  const result = await service.closePending({
    sessionId: 'session-answer-1',
    userId: 'user-answer-1',
    pending: {
      runId: 'run-waiting-1',
      sessionId: 'session-answer-1',
      toolCallId: 'tool-ask-1',
      toolName: 'ask_user',
      messageKey: 'managed:run-waiting-1:clarification',
      question: '交付什么？',
    },
    answer: '网页应用',
    answerRunId: 'run-answer-1',
    answerMessageKey: 'managed:run-answer-1:user_response',
  });

  assert.equal(result.closed, true);
  assert.equal(result.answerKind, 'direct_answer');
  assert.deepEqual(
    eventCalls.map((entry) => entry.eventType),
    ['clarification_answered', 'tool_call_completed', 'run_status']
  );
  assert.equal(eventCalls[0]?.runId, 'run-waiting-1');
  assert.equal(eventCalls[0]?.payload.toolCallId, 'tool-ask-1');
  assert.equal(eventCalls[0]?.payload.answerKind, 'direct_answer');
  assert.equal(eventCalls[1]?.payload.toolName, 'ask_user');
  assert.equal((eventCalls[1]?.payload.result as any)?.answerMessageKey, 'managed:run-answer-1:user_response');
  assert.equal(updateRunStatusMock.mock.callCount(), 1);
  assert.equal(clearPendingMock.mock.callCount(), 1);
});

test('ask_user pairing resolves pending ask_user from latest waiting run events when memory lacks protocol metadata', async () => {
  const service = new AltusManagedAskUserPairingService({ appendRunEvent: async () => ({}) } as any);
  mock.method(taskSessionRunDAO, 'getLatestRun', async () => ({
    id: 'run-waiting-fallback',
    sessionId: 'session-fallback',
    status: 'waiting_user',
  }) as any);
  mock.method(taskSessionRunDAO, 'listRunEvents', async () => [
    {
      id: 'event-start',
      eventType: 'tool_call_started',
      sequence: 1,
      payloadJson: {
        toolName: 'ask_user',
        toolCallId: 'tool-fallback',
        arguments: { question: '交付什么？' },
      },
    },
  ] as any);

  const pending = await service.resolvePending('session-fallback', {
    id: 'session-fallback',
    title: 'fallback',
    status: 'waiting_user',
    pendingQuestion: '交付什么？',
  } as any);

  assert.equal(pending?.runId, 'run-waiting-fallback');
  assert.equal(pending?.toolCallId, 'tool-fallback');
  assert.equal(pending?.messageKey, 'managed:run-waiting-fallback:clarification');
});
