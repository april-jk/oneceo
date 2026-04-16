import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import {
  getRailwayDeploymentPanel,
  triggerRailwayDeploy,
  triggerRailwayRedeploy,
  triggerRailwayRollback,
  waitForRailwayDeploymentAfterSourceSync,
  waitForRailwayDeploymentPublicReachability,
  type DeploymentResourceBindingData,
  type RailwayDeploymentActionResult,
  type RailwayDeploymentPanelData,
} from './railway-deployment-service';
import {
  publishTaskSessionWorkspaceToRepository,
  type DeploymentTemplateBaselineData,
  type DeploymentWorkspacePublishReport,
} from './task-creation-deployment-source-service';
import {
  platformDeploymentAccountService,
  refreshManagedServiceSourceConnection,
} from './platform-deployment-account-service';
import { setSandboxMetadata } from './sandbox-activity-service';
import {
  buildTaskSessionAnalyticsPanel,
  prepareTaskSessionAnalyticsBinding,
} from './task-session-deployment-analytics-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

type TaskSessionDeploymentEnvironment = {
  sessionId: string;
  metadata: unknown;
} | null;

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

export async function resolveTaskSessionRecord(sessionId: string): Promise<FileSessionRecord | null> {
  return taskCreationFileMemoryStore.getSession(sessionId);
}

export async function resolveTaskSessionEnvironment(input: {
  session: FileSessionRecord | null;
  orchestratorSessionId?: string | null;
  environment?: TaskSessionDeploymentEnvironment;
}) {
  const explicitOrchestratorSessionId = asText(input.orchestratorSessionId);
  if (explicitOrchestratorSessionId) {
    const explicitEnvironment =
      (await sandboxExecutionEnvironmentDAO.getBySessionId(explicitOrchestratorSessionId)) ||
      input.environment;
    if (explicitEnvironment) {
      return {
        orchestratorSessionId: explicitOrchestratorSessionId,
        environment: explicitEnvironment,
      };
    }
  }

  const runtimeOrchestratorSessionId = asText(input.session?.runtime?.orchestratorSessionId);
  if (runtimeOrchestratorSessionId) {
    const byRuntime = await sandboxExecutionEnvironmentDAO.getBySessionId(runtimeOrchestratorSessionId);
    if (byRuntime) {
      return {
        orchestratorSessionId: runtimeOrchestratorSessionId,
        environment: byRuntime,
      };
    }
  }

  const byTaskSession = input.session ? await findEnvironmentByTaskSessionId(input.session.id) : null;
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

function buildDeploymentResourceBinding(
  sessionProjectKey: string,
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.getProjectAccount>>
): DeploymentResourceBindingData | undefined {
  if (!account) return undefined;
  const normalizedSessionProjectKey = asText(sessionProjectKey);
  const projectKey = asText(account.projectKey) || 'default';
  return {
    projectKey,
    isolationMode:
      normalizedSessionProjectKey && projectKey === normalizedSessionProjectKey ? 'session' : 'default',
    projectModel: 'per_user',
    environmentModel: 'per_session',
    tokenKind: 'project',
    tokenScope: 'railway_project_environment',
    tokenManagedBy: 'oneceo_platform',
    tokenId: account.tokenId,
    tokenRotatedAt: account.tokenRotatedAt,
    repositoryOwner: account.githubRepoOwner,
    repositoryName: account.githubRepoName,
    repositoryFullName: account.githubRepoFullName,
    repositoryUrl: account.githubRepoUrl,
    repositoryBranch: account.githubDefaultBranch,
  };
}

function resolveDeploymentAnalyticsDomain(input: {
  metadata: Record<string, unknown>;
  accountDomain?: string;
  panel?: RailwayDeploymentPanelData | null;
}) {
  const analytics = pickRecord(input.metadata.analytics);
  return (
    asText(input.panel?.latestStaticUrl) ||
    asText(input.panel?.latestUrl) ||
    asText(input.panel?.domains?.[0]) ||
    asText(analytics.domain) ||
    asText(input.accountDomain) ||
    ''
  );
}

async function prepareSessionAnalyticsBindingSafely(input: {
  sessionId: string;
  orchestratorSessionId: string;
  environmentMetadata: unknown;
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureUserAccount>>;
  panel?: RailwayDeploymentPanelData | null;
}) {
  try {
    await prepareTaskSessionAnalyticsBinding({
      sessionId: input.sessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      environmentMetadata: input.environmentMetadata,
      account: input.account,
      domain: resolveDeploymentAnalyticsDomain({
        metadata: pickRecord(input.environmentMetadata),
        accountDomain: input.account.serviceDomain,
        panel: input.panel || null,
      }),
      tag: 'production',
    });
  } catch (error) {
    console.warn('[TASK_SESSION_DEPLOYMENT_ANALYTICS_BINDING_FAILED]', {
      sessionId: input.sessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      error,
    });
  }
}

async function finalizeSessionAnalyticsBinding(input: {
  sessionId: string;
  orchestratorSessionId: string;
  environmentMetadata: unknown;
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureUserAccount>>;
  panel: RailwayDeploymentPanelData;
}) {
  await prepareSessionAnalyticsBindingSafely({
    sessionId: input.sessionId,
    orchestratorSessionId: input.orchestratorSessionId,
    environmentMetadata: input.environmentMetadata,
    account: input.account,
    panel: input.panel,
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

export function getTaskSessionDeploymentErrorMessage(error: unknown) {
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

export function formatTaskSessionDeploymentStatus(panel: RailwayDeploymentPanelData) {
  const parts: string[] = [];
  if (panel.latestStatus) {
    parts.push(`当前部署状态：${panel.latestStatus}`);
  }
  const url = asText(panel.latestStaticUrl || panel.latestUrl);
  if (url) {
    parts.push(`访问地址：${url.replace(/^https?:\/\//, '')}`);
  }
  if (!panel.latestStatus && !url) {
    parts.push(panel.message || '当前还没有可展示的部署结果。');
  }
  return parts.join('；');
}

function buildPlatformDeployment(
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureProjectAccount>>
) {
  return {
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
}

function pickRollbackTarget(panel: RailwayDeploymentPanelData): string {
  const currentId = asText(panel.deploymentId) || asText(panel.deployments[0]?.id);
  const candidate =
    panel.deployments.find((item) => asText(item.id) && asText(item.id) !== currentId)?.id || '';
  return asText(candidate);
}

export async function ensureDeploymentStartedAfterSourceSync(input: {
  waitForSourceSync: () => Promise<RailwayDeploymentActionResult>;
  triggerDeploy: () => Promise<RailwayDeploymentActionResult>;
}): Promise<RailwayDeploymentActionResult> {
  const syncedDeployment = await input.waitForSourceSync();
  if (asText(syncedDeployment.deploymentId)) {
    return syncedDeployment;
  }
  return input.triggerDeploy();
}

export async function buildTaskSessionDeploymentResponse(input: {
  userId: string;
  session: FileSessionRecord | null;
  selectedDeploymentId?: string;
  resolvedEnvironment?: TaskSessionDeploymentEnvironment;
  resolvedOrchestratorSessionId?: string | null;
}): Promise<RailwayDeploymentPanelData> {
  const projectKey = asText(input.session?.id);
  const account = await platformDeploymentAccountService.getProjectAccount(input.userId, projectKey);
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
      resourceBinding: undefined,
    } satisfies RailwayDeploymentPanelData;
  }

  const { environment } = await resolveTaskSessionEnvironment({
    session: input.session,
    orchestratorSessionId: input.resolvedOrchestratorSessionId,
    environment: input.resolvedEnvironment,
  });
  const metadata = pickRecord(environment?.metadata);
  const panel = await getRailwayDeploymentPanel(metadata, {
    platformDeployment: buildPlatformDeployment(account),
    deploymentId: input.selectedDeploymentId,
  });
  const analytics = await buildTaskSessionAnalyticsPanel(metadata);
  return {
    ...panel,
    analytics,
    resourceBinding: buildDeploymentResourceBinding(projectKey, account),
  } satisfies RailwayDeploymentPanelData;
}

type ExecuteTaskSessionDeploymentActionInput = {
  action: 'deploy' | 'redeploy' | 'rollback';
  taskSessionId: string;
  userId: string;
  session: FileSessionRecord | null;
  deploymentId?: string;
  workspacePath?: string;
  resolvedOrchestratorSessionId?: string | null;
  resolvedEnvironment?: TaskSessionDeploymentEnvironment;
};

export type ExecuteTaskSessionDeploymentActionResult = {
  panel: RailwayDeploymentPanelData;
  actionResult: RailwayDeploymentActionResult;
  publishReport?: DeploymentWorkspacePublishReport;
  baseline?: DeploymentTemplateBaselineData;
  targetDeploymentId?: string;
};

export async function executeTaskSessionDeploymentAction(
  input: ExecuteTaskSessionDeploymentActionInput
): Promise<ExecuteTaskSessionDeploymentActionResult> {
  const account = await platformDeploymentAccountService.ensureProjectAccount(
    input.userId,
    input.taskSessionId
  );
  const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment({
    session: input.session,
    orchestratorSessionId: input.resolvedOrchestratorSessionId,
    environment: input.resolvedEnvironment,
  });
  const environmentMetadata = pickRecord(environment?.metadata);
  const platformDeployment = buildPlatformDeployment(account);
  const deploymentMetadata = {
    ...environmentMetadata,
    platformDeployment,
  };

  if (input.action === 'deploy') {
    const workspaceRoot =
      asText(environmentMetadata.opencodeWorkspaceRoot) ||
      asText(input.workspacePath) ||
      resolveOpencodeWorkspacePath(input.taskSessionId);
    if (!orchestratorSessionId || !workspaceRoot) {
      throw new Error('未找到可部署的工作区，请先生成项目文件');
    }

    const deploymentRequestedAt = Date.now();
    await prepareSessionAnalyticsBindingSafely({
      sessionId: input.taskSessionId,
      orchestratorSessionId,
      environmentMetadata,
      account,
    });
    const publishReport = await publishTaskSessionWorkspaceToRepository({
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
    await setSandboxMetadata(orchestratorSessionId, {
      deploymentTemplateBaseline: publishReport.baseline,
    });
    await refreshManagedServiceSourceConnection({
      serviceId: account.serviceId,
      repoFullName: account.githubRepoFullName || '',
      branch: account.githubDefaultBranch || 'main',
    });
    const actionResult = await ensureDeploymentStartedAfterSourceSync({
      waitForSourceSync: () =>
        waitForRailwayDeploymentAfterSourceSync(deploymentMetadata, {
          since: deploymentRequestedAt,
          timeoutMs: 120_000,
          pollIntervalMs: 4_000,
        }),
      triggerDeploy: () => triggerRailwayDeploy(deploymentMetadata),
    });
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
    const panel = await buildTaskSessionDeploymentResponse({
      userId: input.userId,
      session: input.session,
      selectedDeploymentId: actionResult.deploymentId,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    await waitForRailwayDeploymentPublicReachability({
      baseUrl: panel.latestStaticUrl || panel.latestUrl,
      healthPath: '/api/system/health',
    });
    await finalizeSessionAnalyticsBinding({
      sessionId: input.taskSessionId,
      orchestratorSessionId,
      environmentMetadata,
      account,
      panel,
    });
    const refreshedPanel = await buildTaskSessionDeploymentResponse({
      userId: input.userId,
      session: input.session,
      selectedDeploymentId: actionResult.deploymentId,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    return {
      panel: refreshedPanel,
      actionResult,
      publishReport,
      baseline: publishReport.baseline,
    };
  }

  const currentPanel = await buildTaskSessionDeploymentResponse({
    userId: input.userId,
    session: input.session,
    selectedDeploymentId: input.deploymentId,
    resolvedEnvironment: environment,
    resolvedOrchestratorSessionId: orchestratorSessionId,
  });
  await prepareSessionAnalyticsBindingSafely({
    sessionId: input.taskSessionId,
    orchestratorSessionId,
    environmentMetadata,
    account,
    panel: currentPanel,
  });

  const targetDeploymentId =
    input.action === 'rollback'
      ? pickRollbackTarget(currentPanel)
      : asText(input.deploymentId) || asText(currentPanel.deploymentId) || asText(currentPanel.deployments[0]?.id);
  if (!targetDeploymentId) {
    throw new Error(input.action === 'rollback' ? '没有可回滚的历史部署版本' : '当前没有可重新部署的历史版本');
  }

  const actionResult =
    input.action === 'rollback'
      ? await triggerRailwayRollback(deploymentMetadata, targetDeploymentId)
      : await triggerRailwayRedeploy(deploymentMetadata, targetDeploymentId);
  await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);
  const panel = await buildTaskSessionDeploymentResponse({
    userId: input.userId,
    session: input.session,
    selectedDeploymentId: actionResult.deploymentId,
    resolvedOrchestratorSessionId: orchestratorSessionId,
  });
  await waitForRailwayDeploymentPublicReachability({
    baseUrl: panel.latestStaticUrl || panel.latestUrl,
    healthPath: '/api/system/health',
  });
  await finalizeSessionAnalyticsBinding({
    sessionId: input.taskSessionId,
    orchestratorSessionId,
    environmentMetadata,
    account,
    panel,
  });
  const refreshedPanel = await buildTaskSessionDeploymentResponse({
    userId: input.userId,
    session: input.session,
    selectedDeploymentId: actionResult.deploymentId,
    resolvedOrchestratorSessionId: orchestratorSessionId,
  });
  return {
    panel: refreshedPanel,
    actionResult,
    targetDeploymentId,
  };
}
