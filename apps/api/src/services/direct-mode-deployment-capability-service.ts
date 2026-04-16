import { taskCreationSessionDAO } from '../db/dao';
import type { RailwayDeploymentPanelData } from './railway-deployment-service';
import {
  buildTaskSessionDeploymentResponse,
  executeTaskSessionDeploymentAction,
  formatTaskSessionDeploymentStatus,
  getTaskSessionDeploymentErrorMessage,
  resolveTaskSessionEnvironment,
  resolveTaskSessionRecord,
} from './task-session-deployment-runtime-service';
import type {
  DirectModeCapabilityExecutionInput,
  DirectModeCapabilityExecutionResult,
  DirectModeCapabilityId,
} from './direct-mode-capability-types';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function requireSessionUserId(taskSessionId: string): Promise<string> {
  const session = await taskCreationSessionDAO.getSession(taskSessionId);
  const userId = asText(session?.userId);
  if (!userId) {
    throw new Error('当前会话尚未绑定用户，暂时无法调用平台功能');
  }
  return userId;
}

function buildCapabilityMetadata(
  capabilityId: DirectModeCapabilityId,
  panel?: RailwayDeploymentPanelData,
  extra?: Record<string, unknown>
) {
  return {
    directModeIntercepted: true,
    capabilityId,
    latestStatus: panel?.latestStatus,
    latestUrl: panel?.latestStaticUrl || panel?.latestUrl,
    deploymentId: panel?.deploymentId,
    ...extra,
  };
}

export async function executeDirectModeDeploymentCapability(
  capabilityId: DirectModeCapabilityId,
  input: DirectModeCapabilityExecutionInput
): Promise<DirectModeCapabilityExecutionResult> {
  const session = await resolveTaskSessionRecord(input.taskSessionId);
  if (!session) {
    throw new Error('会话不存在');
  }

  const userId = await requireSessionUserId(input.taskSessionId);
  const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment({ session });

  if (capabilityId === 'get_session_deployment_status') {
    const panel = await buildTaskSessionDeploymentResponse({
      userId,
      session,
      resolvedEnvironment: environment,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    return {
      capabilityId,
      message: formatTaskSessionDeploymentStatus(panel),
      metadata: buildCapabilityMetadata(capabilityId, panel),
    };
  }

  if (capabilityId === 'deploy_session_website') {
    const result = await executeTaskSessionDeploymentAction({
      action: 'deploy',
      taskSessionId: input.taskSessionId,
      userId,
      session,
      workspacePath: input.workspacePath,
      resolvedEnvironment: environment,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    return {
      capabilityId,
      message: `已触发网站部署。${formatTaskSessionDeploymentStatus(result.panel)}`,
      metadata: buildCapabilityMetadata(capabilityId, result.panel, {
        action: result.actionResult.action,
      }),
    };
  }

  if (capabilityId === 'redeploy_session_website') {
    const result = await executeTaskSessionDeploymentAction({
      action: 'redeploy',
      taskSessionId: input.taskSessionId,
      userId,
      session,
      resolvedEnvironment: environment,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    return {
      capabilityId,
      message: `已发起重新部署。${formatTaskSessionDeploymentStatus(result.panel)}`,
      metadata: buildCapabilityMetadata(capabilityId, result.panel, {
        action: result.actionResult.action,
        requestedDeploymentId: result.targetDeploymentId,
      }),
    };
  }

  if (capabilityId === 'rollback_session_deployment') {
    const result = await executeTaskSessionDeploymentAction({
      action: 'rollback',
      taskSessionId: input.taskSessionId,
      userId,
      session,
      resolvedEnvironment: environment,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    return {
      capabilityId,
      message: `已发起回滚。${formatTaskSessionDeploymentStatus(result.panel)}`,
      metadata: buildCapabilityMetadata(capabilityId, result.panel, {
        action: result.actionResult.action,
        requestedDeploymentId: result.targetDeploymentId,
      }),
    };
  }

  throw new Error(getTaskSessionDeploymentErrorMessage(new Error(`未支持的部署能力: ${capabilityId}`)));
}

export function getDirectModeDeploymentErrorMessage(error: unknown) {
  return getTaskSessionDeploymentErrorMessage(error);
}
