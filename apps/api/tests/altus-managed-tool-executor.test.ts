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
  assert.deepEqual(
    events.map((item) => item.eventType),
    ['tool_call_started', 'tool_call_completed']
  );
  assert.equal(events[1]?.payload.outputPreview, '{"ok":true}');
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
  assert.equal(events[1]?.eventType, 'tool_call_failed');
  assert.equal(events[1]?.payload.error, 'sanitized:connector_guide_blocked:github');
});
