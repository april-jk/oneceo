import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { sandboxAgentProvisionService } from '../src/services/sandbox-agent-provision-service';

afterEach(() => {
  mock.reset();
});

test('provisionWithLock serializes lifecycle work by task session across executors', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provisionMock = mock.method(sandboxAgentProvisionService, 'provision', async (input: any) => {
    await gate;
    return {
      sessionId: `sandbox-${input.executor}`,
      allocationSource: 'created',
    } as any;
  });

  const first = sandboxAgentProvisionService.provisionWithLock({
    executor: 'altus',
    metadata: {
      taskSessionId: 'session-lock-1',
    },
  });
  const second = sandboxAgentProvisionService.provisionWithLock({
    executor: 'opencode',
    metadata: {
      taskSessionId: 'session-lock-1',
    },
  });

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(provisionMock.mock.callCount(), 1);
  assert.equal(firstResult.sessionId, 'sandbox-altus');
  assert.equal(secondResult.sessionId, 'sandbox-altus');
});
