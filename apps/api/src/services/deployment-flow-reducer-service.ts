import type { TaskSessionProjectProfile } from './task-session-project-profile-service';

export type DeploymentFlowState =
  | 'idle'
  | 'profiling'
  | 'adapting'
  | 'compliance_checking'
  | 'publishing'
  | 'polling_provider'
  | 'verifying_public_access'
  | 'succeeded'
  | 'failed_repairable'
  | 'failed_terminal';

export type DeploymentFlowEvent =
  | { type: 'PROFILE_READY'; profile: TaskSessionProjectProfile }
  | { type: 'ADAPTATION_DONE' }
  | { type: 'COMPLIANCE_READY'; ok: boolean; errors?: string[] }
  | { type: 'PUBLISH_STARTED'; deploymentId?: string }
  | { type: 'PROVIDER_STATUS'; status: string; url?: string }
  | { type: 'PUBLIC_ACCESS_VERIFIED'; statusCode: number; url: string }
  | { type: 'REPAIR_REQUIRED'; category: string; checks?: string[] }
  | { type: 'TERMINAL_FAILURE'; reason: string };

export type DeploymentFlowSnapshot = {
  state: DeploymentFlowState;
  lastEventType?: DeploymentFlowEvent['type'];
  deploymentId?: string;
  url?: string;
  providerStatus?: string;
  repairCategory?: string;
  checks?: string[];
  errors?: string[];
  profile?: Pick<TaskSessionProjectProfile, 'runtimeFamily' | 'deployability' | 'analyticsStatus'>;
};

function normalizeProviderStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isProviderFailureStatus(value: unknown) {
  return ['failed', 'crashed', 'removed'].includes(normalizeProviderStatus(value));
}

function isProviderPendingStatus(value: unknown) {
  return ['building', 'deploying', 'initializing', 'queued', 'waiting', 'pending'].includes(
    normalizeProviderStatus(value)
  );
}

export function reduceDeploymentFlow(
  current: DeploymentFlowSnapshot,
  event: DeploymentFlowEvent
): DeploymentFlowSnapshot {
  const base: DeploymentFlowSnapshot = {
    ...current,
    lastEventType: event.type,
  };
  switch (event.type) {
    case 'PROFILE_READY':
      return {
        ...base,
        state: 'profiling',
        profile: {
          runtimeFamily: event.profile.runtimeFamily,
          deployability: event.profile.deployability,
          analyticsStatus: event.profile.analyticsStatus,
        },
      };
    case 'ADAPTATION_DONE':
      return {
        ...base,
        state: 'adapting',
      };
    case 'COMPLIANCE_READY':
      return {
        ...base,
        state: event.ok ? 'compliance_checking' : 'failed_repairable',
        errors: event.errors || [],
        repairCategory: event.ok ? undefined : 'template_compliance',
      };
    case 'PUBLISH_STARTED':
      if (current.state === 'failed_repairable' || current.state === 'failed_terminal') {
        return {
          ...base,
          errors: ['publish blocked until profile/adapt/compliance is rerun'],
        };
      }
      return {
        ...base,
        state: 'publishing',
        deploymentId: event.deploymentId || current.deploymentId,
      };
    case 'PROVIDER_STATUS':
      if (isProviderFailureStatus(event.status)) {
        return {
          ...base,
          state: 'failed_repairable',
          providerStatus: event.status,
          url: event.url || current.url,
          repairCategory: 'deployment_failed',
        };
      }
      return {
        ...base,
        state: isProviderPendingStatus(event.status) ? 'polling_provider' : 'verifying_public_access',
        providerStatus: event.status,
        url: event.url || current.url,
      };
    case 'PUBLIC_ACCESS_VERIFIED':
      return {
        ...base,
        state: event.statusCode >= 200 && event.statusCode < 300 ? 'succeeded' : 'failed_repairable',
        url: event.url,
        checks: [`public_status_${event.statusCode}`],
        repairCategory: event.statusCode >= 200 && event.statusCode < 300 ? undefined : 'deployment_failed',
      };
    case 'REPAIR_REQUIRED':
      return {
        ...base,
        state: 'failed_repairable',
        repairCategory: event.category,
        checks: event.checks || [],
      };
    case 'TERMINAL_FAILURE':
      return {
        ...base,
        state: 'failed_terminal',
        errors: [event.reason],
      };
    default:
      return base;
  }
}

export function createDeploymentFlowSnapshot(): DeploymentFlowSnapshot {
  return {
    state: 'idle',
  };
}
