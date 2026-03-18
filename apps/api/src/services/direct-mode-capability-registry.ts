import {
  DIRECT_MODE_CAPABILITY_IDS,
  type DirectModeCapabilityExecutionInput,
  type DirectModeCapabilityExecutionResult,
  type DirectModeCapabilityId,
} from './direct-mode-capability-types';
import {
  executeDirectModeDeploymentCapability,
} from './direct-mode-deployment-capability-service';

type DirectModeCapabilityHandler = (
  input: DirectModeCapabilityExecutionInput
) => Promise<DirectModeCapabilityExecutionResult>;

function createRegistry(): Record<DirectModeCapabilityId, DirectModeCapabilityHandler> {
  return {
    deploy_session_website: (input) => executeDirectModeDeploymentCapability('deploy_session_website', input),
    redeploy_session_website: (input) => executeDirectModeDeploymentCapability('redeploy_session_website', input),
    rollback_session_deployment: (input) => executeDirectModeDeploymentCapability('rollback_session_deployment', input),
    get_session_deployment_status: (input) => executeDirectModeDeploymentCapability('get_session_deployment_status', input),
  };
}

const DISPLAY_NAMES: Record<DirectModeCapabilityId, string> = {
  deploy_session_website: '网站部署',
  redeploy_session_website: '重新部署',
  rollback_session_deployment: '部署回滚',
  get_session_deployment_status: '部署状态查询',
};

export class DirectModeCapabilityRegistry {
  private readonly handlers: Record<DirectModeCapabilityId, DirectModeCapabilityHandler>;

  constructor(handlers?: Partial<Record<DirectModeCapabilityId, DirectModeCapabilityHandler>>) {
    this.handlers = {
      ...createRegistry(),
      ...(handlers || {}),
    } as Record<DirectModeCapabilityId, DirectModeCapabilityHandler>;
  }

  listCapabilityIds(): readonly DirectModeCapabilityId[] {
    return DIRECT_MODE_CAPABILITY_IDS.filter((item) => typeof this.handlers[item] === 'function');
  }

  getDisplayName(capabilityId: DirectModeCapabilityId): string {
    return DISPLAY_NAMES[capabilityId] || capabilityId;
  }

  async execute(
    capabilityId: DirectModeCapabilityId,
    input: DirectModeCapabilityExecutionInput
  ): Promise<DirectModeCapabilityExecutionResult> {
    const handler = this.handlers[capabilityId];
    if (!handler) {
      throw new Error(`未注册的平台能力: ${capabilityId}`);
    }
    return handler(input);
  }
}

export const directModeCapabilityRegistry = new DirectModeCapabilityRegistry();

