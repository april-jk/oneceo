import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DirectModeEntryService } from '../src/services/direct-mode-entry-service';
import type {
  DirectModeCapabilityExecutionInput,
  DirectModeEntryDecision,
} from '../src/services/direct-mode-capability-types';

test('executes platform capability when decision matches registry', async () => {
  const calls: Array<{ capabilityId: string; input: DirectModeCapabilityExecutionInput }> = [];
  const service = new DirectModeEntryService({
    agent: {
      decide: async (): Promise<DirectModeEntryDecision> => ({
        action: 'platform_capability',
        capabilityId: 'deploy_session_website',
        confidence: 0.99,
        reason: 'explicit deploy',
        source: 'heuristic',
      }),
    } as any,
    registry: {
      listCapabilityIds: () => ['deploy_session_website'] as const,
      getDisplayName: () => '网站部署',
      execute: async (capabilityId, input) => {
        calls.push({ capabilityId, input });
        return {
          capabilityId,
          message: 'deploy ok',
        };
      },
    } as any,
  });

  const decision = await service.decide({ content: '帮我部署这个网站' });
  assert.equal(decision.action, 'platform_capability');
  assert.equal(service.getCapabilityDisplayName(decision), '网站部署');

  const result = await service.execute(decision, {
    taskSessionId: 'task-1',
    content: '帮我部署这个网站',
  });
  assert.equal(result.message, 'deploy ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.capabilityId, 'deploy_session_website');
});

test('does not execute registry for passthrough decision', async () => {
  const service = new DirectModeEntryService({
    agent: {
      decide: async (): Promise<DirectModeEntryDecision> => ({
        action: 'passthrough',
        confidence: 0.95,
        reason: 'dev task',
        source: 'heuristic',
      }),
    } as any,
    registry: {
      listCapabilityIds: () => [] as const,
      getDisplayName: () => '',
      execute: async () => {
        throw new Error('should not execute');
      },
    } as any,
  });

  const decision = await service.decide({ content: '帮我开发一个新页面' });
  assert.equal(decision.action, 'passthrough');
  await assert.rejects(
    service.execute(decision, {
      taskSessionId: 'task-2',
      content: '帮我开发一个新页面',
    }),
    /不是平台能力执行/
  );
});

