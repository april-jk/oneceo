export const DIRECT_MODE_CAPABILITY_IDS = [
  'deploy_session_website',
  'redeploy_session_website',
  'rollback_session_deployment',
  'get_session_deployment_status',
] as const;

export type DirectModeCapabilityId = (typeof DIRECT_MODE_CAPABILITY_IDS)[number];

export type DirectModeInterceptSource = 'heuristic' | 'llm' | 'fallback';

export type DirectModeEntryDecision =
  | {
      action: 'platform_capability';
      capabilityId: DirectModeCapabilityId;
      confidence: number;
      reason: string;
      source: DirectModeInterceptSource;
    }
  | {
      action: 'passthrough';
      confidence: number;
      reason: string;
      source: DirectModeInterceptSource;
    };

export type DirectModeCapabilityExecutionInput = {
  taskSessionId: string;
  content: string;
  orchestratorSessionId?: string;
  workspacePath?: string;
};

export type DirectModeCapabilityExecutionResult = {
  capabilityId: DirectModeCapabilityId;
  message: string;
  metadata?: Record<string, unknown>;
};

