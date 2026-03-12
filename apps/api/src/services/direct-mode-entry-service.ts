import {
  directCapabilityInterceptAgent,
  type DirectCapabilityInterceptAgent,
} from '../agents/task-creation/layers/direct-capability-intercept-agent';
import {
  directModeCapabilityRegistry,
  type DirectModeCapabilityRegistry,
} from './direct-mode-capability-registry';
import type {
  DirectModeCapabilityExecutionInput,
  DirectModeCapabilityExecutionResult,
  DirectModeEntryDecision,
} from './direct-mode-capability-types';

type DirectModeEntryServiceDeps = {
  agent: Pick<DirectCapabilityInterceptAgent, 'decide'>;
  registry: Pick<DirectModeCapabilityRegistry, 'listCapabilityIds' | 'execute' | 'getDisplayName'>;
};

export class DirectModeEntryService {
  private readonly deps: DirectModeEntryServiceDeps;

  constructor(deps?: Partial<DirectModeEntryServiceDeps>) {
    this.deps = {
      agent: deps?.agent || directCapabilityInterceptAgent,
      registry: deps?.registry || directModeCapabilityRegistry,
    };
  }

  async decide(input: { content: string }): Promise<DirectModeEntryDecision> {
    return this.deps.agent.decide({
      content: input.content,
      availableCapabilities: this.deps.registry.listCapabilityIds(),
    });
  }

  getCapabilityDisplayName(decision: DirectModeEntryDecision): string {
    if (decision.action !== 'platform_capability') return '';
    return this.deps.registry.getDisplayName(decision.capabilityId);
  }

  async execute(
    decision: DirectModeEntryDecision,
    input: DirectModeCapabilityExecutionInput
  ): Promise<DirectModeCapabilityExecutionResult> {
    if (decision.action !== 'platform_capability') {
      throw new Error('当前判定不是平台能力执行');
    }
    return this.deps.registry.execute(decision.capabilityId, input);
  }
}

export const directModeEntryService = new DirectModeEntryService();
