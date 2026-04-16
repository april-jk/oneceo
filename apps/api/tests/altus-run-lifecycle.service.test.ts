import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { taskSessionRunDAO } from '../src/db/dao';
import { AltusRunLifecycleService } from '../src/services/altus-run-lifecycle-service';
import { AltusRunState } from '../src/services/altus-run-state';

afterEach(() => {
  mock.reset();
});

function createState(runId: string, sessionId: string) {
  return new AltusRunState({
    runId,
    sessionId,
    userId: 'user-1',
    model: 'altus-model',
    userInput: 'build feature',
    sessionTitle: 'Demo session',
    connectors: [],
    mcpProviders: [],
    skillCatalog: [],
    skills: [],
  });
}

test('markCompleted updates run status, session lifecycle, and completion event', async () => {
  const state = createState('run-complete', 'session-complete');
  state.markCompleted();

  const updateRunStatusMock = mock.method(taskSessionRunDAO, 'updateRunStatus', async () => ({}) as any);
  const setupService = {
    updateSessionLifecycle: mock.fn(async () => {}),
    persistTimelineMessage: mock.fn(async () => {}),
  };
  const eventWriter = {
    appendRunEvent: mock.fn(async () => ({ sequence: 2, payload: {} })),
  };

  const service = new AltusRunLifecycleService(setupService as any, eventWriter as any);
  await service.markCompleted(state);

  assert.equal(updateRunStatusMock.mock.callCount(), 1);
  assert.equal(updateRunStatusMock.mock.calls[0]?.arguments[0], 'run-complete');
  assert.equal(updateRunStatusMock.mock.calls[0]?.arguments[1], 'completed');

  assert.equal((setupService.updateSessionLifecycle as any).mock.callCount(), 1);
  assert.deepEqual((setupService.updateSessionLifecycle as any).mock.calls[0]?.arguments, [
    'session-complete',
    {
      status: 'completed',
      stage: 'completed',
      phase: 'delivery',
      clearClarification: true,
    },
  ]);

  assert.equal((eventWriter.appendRunEvent as any).mock.callCount(), 1);
  assert.deepEqual((eventWriter.appendRunEvent as any).mock.calls[0]?.arguments, [
    'run-complete',
    'session-complete',
    'user-1',
    'run_completed',
    {
      status: 'completed',
      content: 'managed run 已完成',
      deliverables: [],
    },
  ]);
});

test('markFailed persists error timeline and failed event', async () => {
  const state = createState('run-failed', 'session-failed');
  state.markFailed('tool schema invalid');

  const updateRunStatusMock = mock.method(taskSessionRunDAO, 'updateRunStatus', async () => ({}) as any);
  const setupService = {
    updateSessionLifecycle: mock.fn(async () => {}),
    persistTimelineMessage: mock.fn(async () => {}),
  };
  const eventWriter = {
    appendRunEvent: mock.fn(async () => ({ sequence: 3, payload: {} })),
  };

  const service = new AltusRunLifecycleService(setupService as any, eventWriter as any);
  await service.markFailed(state, 'tool schema invalid');

  assert.equal(updateRunStatusMock.mock.callCount(), 1);
  assert.equal(updateRunStatusMock.mock.calls[0]?.arguments[0], 'run-failed');
  assert.equal(updateRunStatusMock.mock.calls[0]?.arguments[1], 'failed');

  assert.deepEqual((setupService.updateSessionLifecycle as any).mock.calls[0]?.arguments, [
    'session-failed',
    {
      status: 'failed',
      stage: 'failed',
      phase: 'repair',
      clearClarification: true,
    },
  ]);

  assert.equal((setupService.persistTimelineMessage as any).mock.callCount(), 2);

  assert.deepEqual((setupService.persistTimelineMessage as any).mock.calls[0]?.arguments, [
    {
      sessionId: 'session-failed',
      role: 'agent',
      messageType: 'assistant_message',
      content: '本次执行失败：tool schema invalid',
      metadata: {
        runId: 'run-failed',
        error: 'tool schema invalid',
      },
      messageKey: 'managed:run-failed:failed_assistant',
    },
  ]);

  assert.deepEqual((setupService.persistTimelineMessage as any).mock.calls[1]?.arguments, [
    {
      sessionId: 'session-failed',
      role: 'system',
      messageType: 'error',
      content: 'Altus managed 运行失败：tool schema invalid',
      metadata: {
        runId: 'run-failed',
      },
      messageKey: 'managed:run-failed:failed',
    },
  ]);

  assert.deepEqual((eventWriter.appendRunEvent as any).mock.calls[0]?.arguments, [
    'run-failed',
    'session-failed',
    'user-1',
    'run_failed',
    {
      status: 'failed',
      content: 'Altus managed 运行失败：tool schema invalid',
      error: 'tool schema invalid',
    },
  ]);
});
