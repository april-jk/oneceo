import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { sandboxExecutionEnvironmentDAO, taskCreationSessionDAO } from '../db/dao';
import {
  getRailwayDeploymentPanel,
  triggerRailwayRedeploy,
  triggerRailwayRollback,
  waitForRailwayDeploymentAfterSourceSync,
  type RailwayDeploymentActionResult,
  type RailwayDeploymentPanelData,
} from './railway-deployment-service';
import { publishTaskSessionWorkspaceToRepository } from './task-creation-deployment-source-service';
import { platformDeploymentAccountService } from './platform-deployment-account-service';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { setSandboxMetadata } from './sandbox-activity-service';
import type {
  DirectModeCapabilityExecutionInput,
  DirectModeCapabilityExecutionResult,
  DirectModeCapabilityId,
} from './direct-mode-capability-types';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function compactUrl(value: string | undefined): string {
  const text = asText(value);
  return text ? text.replace(/^https?:\/\//, '') : '';
}

async function findEnvironmentByTaskSessionId(taskSessionId: string) {
  const limit = Math.max(50, Math.min(Number(process.env.SANDBOX_RUNTIME_LOOKUP_LIMIT || 500), 5000));
  const environments = await sandboxExecutionEnvironmentDAO.listRecent(limit);
  for (const env of environments) {
    const metadata = pickRecord(env.metadata);
    if (asText(metadata.taskSessionId) === taskSessionId) {
      return env;
    }
  }
  return null;
}

async function resolveTaskSessionRecord(sessionId: string): Promise<FileSessionRecord | null> {
  return taskCreationFileMemoryStore.getSession(sessionId);
}

async function resolveTaskSessionEnvironment(session: FileSessionRecord | null) {
  const orchestratorSessionId = asText(session?.runtime?.orchestratorSessionId);
  if (orchestratorSessionId) {
    const byRuntime = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    if (byRuntime) {
      return {
        orchestratorSessionId,
        environment: byRuntime,
      };
    }
  }

  const byTaskSession = session ? await findEnvironmentByTaskSessionId(session.id) : null;
  if (byTaskSession) {
    return {
      orchestratorSessionId: byTaskSession.sessionId,
      environment: byTaskSession,
    };
  }

  return {
    orchestratorSessionId: '',
    environment: null,
  };
}

async function buildRailwayDeploymentResponse(
  userId: string,
  session: FileSessionRecord | null,
  selectedDeploymentId?: string
) {
  const account = await platformDeploymentAccountService.getUserAccount(userId);
  if (!account) {
    return {
      configured: false,
      canDeploy: true,
      message: '首次部署时将自动准备托管仓库与部署资源，并发布当前工作区内容。',
      activeDeploymentPending: false,
      domains: [],
      deployments: [],
      logs: [],
      missing: [],
    } satisfies RailwayDeploymentPanelData;
  }

  const { environment } = await resolveTaskSessionEnvironment(session);
  const metadata = pickRecord(environment?.metadata);
  return getRailwayDeploymentPanel(metadata, {
    platformDeployment: {
      adminToken: process.env.RAILWAY_ADMIN_TOKEN,
      token: account.accessToken,
      projectId: account.projectId,
      projectName: account.projectName,
      environmentId: account.environmentId,
      environmentName: account.environmentName,
      serviceId: account.serviceId,
      serviceName: account.serviceName,
    },
    deploymentId: selectedDeploymentId,
  });
}

async function persistRailwayDeploymentSelection(
  orchestratorSessionId: string,
  environmentMetadata: unknown,
  payload: RailwayDeploymentActionResult
) {
  if (!orchestratorSessionId) return;
  const metadata = pickRecord(environmentMetadata);
  const railway = pickRecord(metadata.railway);
  await setSandboxMetadata(orchestratorSessionId, {
    railway: {
      ...railway,
      lastDeploymentId: payload.deploymentId || railway.lastDeploymentId || null,
      lastAction: payload.action,
      lastActionAt: new Date().toISOString(),
    },
  });
}

function getDeploymentErrorMessage(error: unknown) {
  const message = asText((error as { message?: unknown })?.message);
  if (!message) {
    return '平台部署失败';
  }
  if (
    message.includes('No GitHub installation found for repo') ||
    message.includes('not found or is not accessible') ||
    message.includes('unable to access')
  ) {
    return '平台部署供应链接入未完成，当前托管仓库尚未授权到部署服务';
  }
  return message;
}

async function requireSessionUserId(taskSessionId: string): Promise<string> {
  const session = await taskCreationSessionDAO.getSession(taskSessionId);
  const userId = asText(session?.userId);
  if (!userId) {
    throw new Error('当前会话尚未绑定用户，暂时无法调用平台功能');
  }
  return userId;
}

function formatDeploymentStatus(panel: RailwayDeploymentPanelData) {
  const parts: string[] = [];
  if (panel.latestStatus) {
    parts.push(`当前部署状态：${panel.latestStatus}`);
  }
  const url = panel.latestStaticUrl || panel.latestUrl;
  if (url) {
    parts.push(`访问地址：${compactUrl(url)}`);
  }
  if (!panel.latestStatus && !url) {
    parts.push(panel.message || '当前还没有可展示的部署结果。');
  }
  return parts.join('；');
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

function pickRollbackTarget(panel: RailwayDeploymentPanelData): string {
  const currentId = asText(panel.deploymentId) || asText(panel.deployments[0]?.id);
  const candidate =
    panel.deployments.find((item) => asText(item.id) && asText(item.id) !== currentId)?.id || '';
  return asText(candidate);
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
  const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment(session);
  const environmentMetadata = pickRecord(environment?.metadata);

  if (capabilityId === 'get_session_deployment_status') {
    const panel = await buildRailwayDeploymentResponse(userId, session);
    return {
      capabilityId,
      message: formatDeploymentStatus(panel),
      metadata: buildCapabilityMetadata(capabilityId, panel),
    };
  }

  if (capabilityId === 'deploy_session_website') {
    const account = await platformDeploymentAccountService.ensureUserAccount(userId);
    const workspaceRoot =
      asText(environmentMetadata.opencodeWorkspaceRoot) ||
      asText(input.workspacePath) ||
      resolveOpencodeWorkspacePath(input.taskSessionId);
    if (!orchestratorSessionId || !workspaceRoot) {
      throw new Error('未找到可部署的工作区，请先生成项目文件');
    }

    const deploymentRequestedAt = Date.now();
    await publishTaskSessionWorkspaceToRepository({
      orchestratorSessionId,
      workspaceRoot,
      repository: {
        owner: account.githubRepoOwner || '',
        name: account.githubRepoName || '',
        fullName: account.githubRepoFullName || '',
        htmlUrl: account.githubRepoUrl,
        defaultBranch: account.githubDefaultBranch || 'main',
      },
      sessionId: input.taskSessionId,
    });

    const platformDeployment = {
      adminToken: process.env.RAILWAY_ADMIN_TOKEN,
      token: account.accessToken,
      projectId: account.projectId,
      projectName: account.projectName,
      environmentId: account.environmentId,
      environmentName: account.environmentName,
      serviceId: account.serviceId,
      serviceName: account.serviceName,
      repository: account.githubRepoFullName,
    };

    const actionResult = await waitForRailwayDeploymentAfterSourceSync(
      {
        ...environmentMetadata,
        platformDeployment,
      },
      {
        since: deploymentRequestedAt,
        timeoutMs: 120_000,
        pollIntervalMs: 4_000,
      }
    );
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const panel = await buildRailwayDeploymentResponse(userId, session, actionResult.deploymentId);
    return {
      capabilityId,
      message: `已触发网站部署。${formatDeploymentStatus(panel)}`,
      metadata: buildCapabilityMetadata(capabilityId, panel, {
        action: actionResult.action,
      }),
    };
  }

  if (capabilityId === 'redeploy_session_website') {
    const account = await platformDeploymentAccountService.ensureUserAccount(userId);
    const panel = await buildRailwayDeploymentResponse(userId, session);
    const targetDeploymentId = asText(panel.deploymentId) || asText(panel.deployments[0]?.id);
    if (!targetDeploymentId) {
      throw new Error('当前没有可重新部署的历史版本');
    }

    const actionResult = await triggerRailwayRedeploy(
      {
        ...environmentMetadata,
        platformDeployment: {
          adminToken: process.env.RAILWAY_ADMIN_TOKEN,
          token: account.accessToken,
          projectId: account.projectId,
          projectName: account.projectName,
          environmentId: account.environmentId,
          environmentName: account.environmentName,
          serviceId: account.serviceId,
          serviceName: account.serviceName,
        },
      },
      targetDeploymentId
    );
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const nextPanel = await buildRailwayDeploymentResponse(userId, session, actionResult.deploymentId);
    return {
      capabilityId,
      message: `已发起重新部署。${formatDeploymentStatus(nextPanel)}`,
      metadata: buildCapabilityMetadata(capabilityId, nextPanel, {
        action: actionResult.action,
        requestedDeploymentId: targetDeploymentId,
      }),
    };
  }

  if (capabilityId === 'rollback_session_deployment') {
    const account = await platformDeploymentAccountService.ensureUserAccount(userId);
    const panel = await buildRailwayDeploymentResponse(userId, session);
    const targetDeploymentId = pickRollbackTarget(panel);
    if (!targetDeploymentId) {
      throw new Error('没有可回滚的历史部署版本');
    }

    const actionResult = await triggerRailwayRollback(
      {
        ...environmentMetadata,
        platformDeployment: {
          adminToken: process.env.RAILWAY_ADMIN_TOKEN,
          token: account.accessToken,
          projectId: account.projectId,
          projectName: account.projectName,
          environmentId: account.environmentId,
          environmentName: account.environmentName,
          serviceId: account.serviceId,
          serviceName: account.serviceName,
        },
      },
      targetDeploymentId
    );
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const nextPanel = await buildRailwayDeploymentResponse(userId, session, actionResult.deploymentId);
    return {
      capabilityId,
      message: `已发起回滚。${formatDeploymentStatus(nextPanel)}`,
      metadata: buildCapabilityMetadata(capabilityId, nextPanel, {
        action: actionResult.action,
        requestedDeploymentId: targetDeploymentId,
      }),
    };
  }

  throw new Error(getDeploymentErrorMessage(new Error(`未支持的部署能力: ${capabilityId}`)));
}

export function getDirectModeDeploymentErrorMessage(error: unknown) {
  return getDeploymentErrorMessage(error);
}

