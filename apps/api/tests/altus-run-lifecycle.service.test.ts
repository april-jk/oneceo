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

test('markFailed persists sanitized error timeline and failed event', async () => {
  const state = createState('run-failed', 'session-failed');
  const rawError =
    'debug_open_page_repeat_blocked: same_target=http://127.0.0.1:8080 same_reason=tool_execution_failed repeat_count=2 last_error=exit status 1';
  state.markFailed(rawError);

  const updateRunStatusMock = mock.method(taskSessionRunDAO, 'updateRunStatus', async () => ({}) as any);
  const setupService = {
    updateSessionLifecycle: mock.fn(async () => {}),
    persistTimelineMessage: mock.fn(async () => {}),
  };
  const eventWriter = {
    appendRunEvent: mock.fn(async () => ({ sequence: 3, payload: {} })),
  };

  const service = new AltusRunLifecycleService(setupService as any, eventWriter as any);
  await service.markFailed(state, rawError);

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
      content: '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。',
      metadata: {
        runId: 'run-failed',
        error: '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。',
        reasonCode: 'debug_open_page_repeat_blocked',
      },
      messageKey: 'managed:run-failed:failed_assistant',
    },
  ]);

  assert.deepEqual((setupService.persistTimelineMessage as any).mock.calls[1]?.arguments, [
    {
      sessionId: 'session-failed',
      role: 'system',
      messageType: 'error',
      content: '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。',
      metadata: {
        runId: 'run-failed',
        error: '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。',
        reasonCode: 'debug_open_page_repeat_blocked',
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
      content: '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。',
      error: '视觉检测暂时无法继续：同一个预览地址连续未能打开。平台已停止重复尝试以避免继续消耗积分，并保留了已完成的检查记录；请先确认预览服务、端口或文件路径后重新运行。',
      reasonCode: 'debug_open_page_repeat_blocked',
      internalView: {
        detail: rawError,
      },
    },
  ]);
});
