import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { AltusManagedToolExecutor } from '../src/services/altus-managed-tool-executor';
import type { ToolCall } from '../src/services/altus-managed-shared';

function createToolCall(name: string, id = 'tool-1'): ToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: '{}',
    },
  };
}

test('executeToolCall emits started and completed events around a serial runtime result', async () => {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const executor = new AltusManagedToolExecutor({
    runId: 'run-1',
    sessionId: 'session-1',
    userId: 'user-1',
    runtime: {
      execute: mock.fn(async () => ({
        type: 'result',
        content: '{"ok":true}',
      })),
    } as any,
    eventWriter: {
      appendRunEvent: mock.fn(async (_runId, _sessionId, _userId, eventType, payload) => {
        events.push({ eventType, payload: payload as Record<string, unknown> });
      }),
    } as any,
    buildToolEventContent: (toolName, phase) => `${toolName}:${phase}`,
    sanitizeToolEventError: (_toolName, errorMessage) => errorMessage,
  });

  const envelope = await executor.executeToolCall({
    toolCall: createToolCall('read_file'),
    args: { path: 'src/index.ts' },
    signal: new AbortController().signal,
    onResult: () => ({
      transitionReason: 'tool_result_continue',
      recoveryMode: 'none',
      eventPayload: { outputPreview: '{"ok":true}' },
    }),
  });

  assert.equal(envelope.status, 'result');
  assert.equal(envelope.transitionReason, 'tool_result_continue');
  assert.equal(envelope.toolResultEnvelope.status, 'ok');
  assert.equal(envelope.toolResultEnvelope.toolUseId, 'tool-1');
  assert.equal(envelope.toolResultEnvelope.contentForModel, '{"ok":true}');
  assert.deepEqual(
    events.map((item) => item.eventType),
    ['tool_call_started', 'tool_call_completed']
  );
  assert.equal(events[1]?.payload.outputPreview, '{"ok":true}');
  assert.equal((events[1]?.payload.toolResultEnvelope as any)?.status, 'ok');
});

test('executeToolCall emits failed event and returns recoverable envelope when runtime throws', async () => {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const executor = new AltusManagedToolExecutor({
    runId: 'run-2',
    sessionId: 'session-2',
    userId: 'user-2',
    runtime: {
      execute: mock.fn(async () => {
        throw new Error('connector_guide_blocked:github');
      }),
    } as any,
    eventWriter: {
      appendRunEvent: mock.fn(async (_runId, _sessionId, _userId, eventType, payload) => {
        events.push({ eventType, payload: payload as Record<string, unknown> });
      }),
    } as any,
    buildToolEventContent: (toolName, phase) => `${toolName}:${phase}`,
    sanitizeToolEventError: (_toolName, errorMessage) => `sanitized:${errorMessage}`,
  });

  const envelope = await executor.executeToolCall({
    toolCall: createToolCall('mcp__search_repositories__123456789abc', 'tool-mcp'),
    args: {},
    signal: new AbortController().signal,
    onFailure: (_rawError, sanitizedError) => ({
      transitionReason: 'tool_failed_but_recoverable',
      recoveryMode: 'tool_repair',
      eventPayload: { userView: { summary: sanitizedError } },
    }),
  });

  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.rawError, 'connector_guide_blocked:github');
  assert.equal(envelope.toolResultEnvelope.status, 'error');
  assert.equal(envelope.toolResultEnvelope.errorCode, 'connector_guide_required');
  assert.equal(envelope.toolResultEnvelope.retryable, true);
  assert.match(envelope.toolResultEnvelope.contentForModel, /load_connector_guide/);
  assert.equal(events[1]?.eventType, 'tool_call_failed');
  assert.equal(events[1]?.payload.error, 'sanitized:connector_guide_blocked:github');
  assert.equal((events[1]?.payload.toolResultEnvelope as any)?.errorCode, 'connector_guide_required');
});

test('executeToolCall maps missing mcp provider into retryable model-visible envelope', async () => {
  const executor = new AltusManagedToolExecutor({
    runId: 'run-3',
    sessionId: 'session-3',
    userId: 'user-3',
    runtime: {
      execute: mock.fn(async () => {
        throw new Error('GitHub 连接器运行态已丢失，当前正在重新恢复，请稍后重试。');
      }),
    } as any,
    eventWriter: {
      appendRunEvent: mock.fn(async () => {}),
    } as any,
    buildToolEventContent: (toolName, phase) => `${toolName}:${phase}`,
    sanitizeToolEventError: (_toolName, errorMessage) => errorMessage,
  });

  const envelope = await executor.executeToolCall({
    toolCall: createToolCall('mcp__search_repositories__123456789abc', 'tool-mcp-provider'),
    args: {},
    signal: new AbortController().signal,
    modelRoundId: 2,
  });

  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.toolResultEnvelope.errorCode, 'mcp_provider_not_found');
  assert.equal(envelope.toolResultEnvelope.retryable, true);
  assert.equal(envelope.toolResultEnvelope.modelRoundId, '2');
  assert.match(envelope.toolResultEnvelope.contentForModel, /MCP provider runtime is missing/);
});

test('executeToolCall maps deployment not allowed into non-retryable envelope', async () => {
  const executor = new AltusManagedToolExecutor({
    runId: 'run-4',
    sessionId: 'session-4',
    userId: 'user-4',
    runtime: {
      execute: mock.fn(async () => {
        throw new Error('deployment_tool_not_allowed_without_explicit_request');
      }),
    } as any,
    eventWriter: {
      appendRunEvent: mock.fn(async () => {}),
    } as any,
    buildToolEventContent: (toolName, phase) => `${toolName}:${phase}`,
    sanitizeToolEventError: () => '当前任务没有明确部署请求，Altus 已阻止误触发部署，并将继续按交付物生成处理。',
  });

  const envelope = await executor.executeToolCall({
    toolCall: createToolCall('deploy_application', 'tool-deploy'),
    args: {},
    signal: new AbortController().signal,
    modelRoundId: 3,
  });

  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.toolResultEnvelope.errorCode, 'deployment_not_allowed');
  assert.equal(envelope.toolResultEnvelope.retryable, false);
  assert.match(envelope.toolResultEnvelope.contentForModel, /Deployment is not allowed/);
});

test('executeToolCall lets coordinator stop repeated debug_open_page retries', async () => {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const executor = new AltusManagedToolExecutor({
    runId: 'run-debug-repeat',
    sessionId: 'session-debug-repeat',
    userId: 'user-debug-repeat',
    runtime: {
      execute: mock.fn(async () => {
        throw new Error('debug_open_page_repeat_blocked: same_target=http://127.0.0.1:3000 same_reason=debug_target_unreachable');
      }),
    } as any,
    eventWriter: {
      appendRunEvent: mock.fn(async (_runId, _sessionId, _userId, eventType, payload) => {
        events.push({ eventType, payload: payload as Record<string, unknown> });
      }),
    } as any,
    buildToolEventContent: (toolName, phase) => `${toolName}:${phase}`,
    sanitizeToolEventError: () => '同一个预览目标连续打开失败，平台已停止重复截图重试。',
  });

  const envelope = await executor.executeToolCall({
    toolCall: createToolCall('debug_open_page', 'tool-debug-repeat'),
    args: { url: 'http://127.0.0.1:3000/' },
    signal: new AbortController().signal,
    modelRoundId: 4,
    onFailure: () => ({
      transitionReason: 'tool_failed_user_action_required',
      recoveryMode: 'awaiting_user',
      errorCode: 'debug_open_page_repeat_blocked',
      retryable: false,
      sanitizedError: '同一个预览目标连续打开失败，平台已停止重复截图重试。',
    }),
  });

  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.transitionReason, 'tool_failed_user_action_required');
  assert.equal(envelope.recoveryMode, 'awaiting_user');
  assert.equal(envelope.toolResultEnvelope.errorCode, 'debug_open_page_repeat_blocked');
  assert.equal(envelope.toolResultEnvelope.retryable, false);
  assert.match(envelope.toolResultEnvelope.contentForModel, /Do not call debug_open_page again/i);
  assert.equal(events[1]?.payload.error, '同一个预览目标连续打开失败，平台已停止重复截图重试。');
});
