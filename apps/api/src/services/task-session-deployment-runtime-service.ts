import { taskCreationFileMemoryStore, type FileSessionRecord } from '../agents/task-creation/file-memory-store';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionDeploymentSyncJobDAO,
  taskSessionRunDAO,
} from '../db/dao';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import {
  classifyRailwayDeploymentError,
  getRailwayDeploymentPanel,
  triggerRailwayDeploy,
  triggerRailwayRedeploy,
  triggerRailwayRollback,
  waitForRailwayDeploymentAfterSourceSync,
  waitForRailwayDeploymentPublicReachability,
  type DeploymentResourceBindingData,
  type RailwayDeploymentActionResult,
  type RailwayDeploymentBindingState,
  type RailwayDeploymentPanelData,
  type RailwayDeploymentProviderErrorCode,
  type RailwayDeploymentProvisioningPhase,
} from './railway-deployment-service';
import {
  uploadTaskSessionWorkspaceToRailway,
  type DeploymentTemplateBaselineData,
  type DeploymentWorkspacePublishReport,
} from './task-creation-deployment-source-service';
import { platformDeploymentAccountService } from './platform-deployment-account-service';
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

type TaskSessionDeploymentState = {
  bindingState?: RailwayDeploymentBindingState;
  provisioningPhase?: RailwayDeploymentProvisioningPhase;
  providerErrorCode?: RailwayDeploymentProviderErrorCode;
  providerErrorMessage?: string;
  message?: string;
  lastVerifiedAt?: string;
  projectId?: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  publicUrl?: string;
  publicDomain?: string;
  domainStatus?: string;
  domainStatusMessage?: string;
  resourceBinding?: DeploymentResourceBindingData;
};

type TaskSessionDeploymentSyncPayload = {
  selectedDeploymentId?: string;
  reason?: string;
  requestedAt?: string;
};

let deploymentSyncTimer: NodeJS.Timeout | null = null;
let deploymentSyncRunning = false;
const deploymentSyncRunningSessions = new Set<string>();
const terminalSuccessDeploymentStatuses = new Set(['SUCCESS', 'DEPLOYED', 'ACTIVE']);

function isLiveDeploymentDomainRefreshStatus(value: unknown) {
  const status = asText(value).toLowerCase();
  return (
    status === 'failed' ||
    status === 'repair_required' ||
    status === 'pending_dns' ||
    status === 'pending_certificate'
  );
}

function hasStaleActiveDeploymentDomainMessage(input: {
  domainStatus?: unknown;
  domainStatusMessage?: unknown;
}) {
  return (
    asText(input.domainStatus).toLowerCase() === 'active' &&
    asText(input.domainStatusMessage).includes('等待 DNS 或证书生效')
  );
}

function hasStaleDeploymentAnalyticsMetadata(input: {
  analytics?: unknown;
  publicDomain?: unknown;
  publicUrl?: unknown;
  latestStaticUrl?: unknown;
  latestUrl?: unknown;
  domains?: unknown;
}) {
  const analytics = pickRecord(input.analytics);
  const analyticsDomain = asText(analytics.domain)
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const websiteName = asText(analytics.websiteName);
  const domains = Array.isArray(input.domains) ? input.domains : [];
  const canonicalDomain = (
    asText(input.publicDomain) ||
    asText(input.publicUrl) ||
    asText(input.latestStaticUrl) ||
    asText(input.latestUrl) ||
    asText(domains[0])
  )
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return (
    Boolean(canonicalDomain && analyticsDomain && analyticsDomain !== canonicalDomain) ||
    websiteName.includes('railway.app') ||
    analyticsDomain.includes('railway.app')
  );
}

function deploymentSyncKeyFor(taskSessionId: string) {
  return `deployment_sync:${taskSessionId}`;
}

function pickTaskSessionDeploymentPanelSnapshot(metadataRaw: unknown): RailwayDeploymentPanelData | null {
  const record = pickRecord(metadataRaw);
  if (Object.keys(record).length === 0) {
    return null;
  }
  const domains = Array.isArray(record.domains) ? record.domains.map((item) => asText(item)).filter(Boolean) : [];
  const deployments = Array.isArray(record.deployments)
    ? record.deployments
        .map((item) => {
          const next = pickRecord(item);
          const id = asText(next.id);
          const status = asText(next.status);
          if (!id || !status) return null;
          return {
            id,
            status,
            createdAt: asText(next.createdAt) || undefined,
            serviceName: asText(next.serviceName) || undefined,
            commitMessage: asText(next.commitMessage) || undefined,
            commitAuthor: asText(next.commitAuthor) || undefined,
            url: asText(next.url) || undefined,
            staticUrl: asText(next.staticUrl) || undefined,
          };
        })
        .filter(Boolean)
    : [];
  const logs = Array.isArray(record.logs)
    ? record.logs
        .map((item) => {
          const next = pickRecord(item);
          const message = asText(next.message);
          if (!message) return null;
          return {
            timestamp: asText(next.timestamp) || undefined,
            message,
            severity: asText(next.severity) || undefined,
          };
        })
        .filter(Boolean)
    : [];
  const analyticsRecord = pickRecord(record.analytics);
  const analytics =
    Object.keys(analyticsRecord).length > 0
      ? {
          provider: 'umami' as const,
          configured: analyticsRecord.configured !== false,
          enabled: analyticsRecord.enabled === true,
          status: asText(analyticsRecord.status) as
            | 'bound'
            | 'tracking'
            | 'pending'
            | 'pending_domain'
            | 'unconfigured'
            | 'error',
          host: asText(analyticsRecord.host) || undefined,
          websiteId: asText(analyticsRecord.websiteId) || undefined,
          websiteName: asText(analyticsRecord.websiteName) || undefined,
          domain: asText(analyticsRecord.domain) || undefined,
          tag: asText(analyticsRecord.tag) || undefined,
          pageviews: Number.isFinite(Number(analyticsRecord.pageviews)) ? Number(analyticsRecord.pageviews) : undefined,
          visits: Number.isFinite(Number(analyticsRecord.visits)) ? Number(analyticsRecord.visits) : undefined,
          visitors: Number.isFinite(Number(analyticsRecord.visitors)) ? Number(analyticsRecord.visitors) : undefined,
          events: Number.isFinite(Number(analyticsRecord.events)) ? Number(analyticsRecord.events) : undefined,
          activeVisitors: Number.isFinite(Number(analyticsRecord.activeVisitors))
            ? Number(analyticsRecord.activeVisitors)
            : undefined,
          updatedAt: asText(analyticsRecord.updatedAt) || undefined,
          message: asText(analyticsRecord.message) || undefined,
          error: asText(analyticsRecord.error) || undefined,
        }
      : undefined;

  return {
    configured: record.configured !== false,
    canDeploy: record.canDeploy !== false,
    message: asText(record.message) || undefined,
    bindingState: asText(record.bindingState) as RailwayDeploymentBindingState,
    provisioningPhase: asText(record.provisioningPhase) as RailwayDeploymentProvisioningPhase,
    providerErrorCode: asText(record.providerErrorCode) as RailwayDeploymentProviderErrorCode,
    providerErrorMessage: asText(record.providerErrorMessage) || undefined,
    lastVerifiedAt: asText(record.lastVerifiedAt) || undefined,
    projectId: asText(record.projectId) || undefined,
    projectName: asText(record.projectName) || undefined,
    environmentId: asText(record.environmentId) || undefined,
    environmentName: asText(record.environmentName) || undefined,
    serviceId: asText(record.serviceId) || undefined,
    serviceName: asText(record.serviceName) || undefined,
    deploymentId: asText(record.deploymentId) || undefined,
    latestStatus: asText(record.latestStatus) || undefined,
    latestUrl: asText(record.latestUrl) || undefined,
    latestStaticUrl: asText(record.latestStaticUrl) || undefined,
    publicUrl: asText(record.publicUrl) || undefined,
    publicDomain: asText(record.publicDomain) || undefined,
    domainStatus: asText(record.domainStatus) || undefined,
    domainStatusMessage: asText(record.domainStatusMessage) || undefined,
    activeDeploymentPending: record.activeDeploymentPending === true,
    domains,
    deployments: deployments as RailwayDeploymentPanelData['deployments'],
    logs: logs as RailwayDeploymentPanelData['logs'],
    missing: Array.isArray(record.missing) ? record.missing.map((item) => asText(item)).filter(Boolean) : [],
    analytics,
    resourceBinding: pickTaskSessionDeploymentState({
      resourceBinding: pickRecord(record.resourceBinding),
    })?.resourceBinding,
  } satisfies RailwayDeploymentPanelData;
}

function hasStoredDeploymentSignal(metadataRaw: unknown): boolean {
  const metadata = pickRecord(metadataRaw);
  if (pickTaskSessionDeploymentPanelSnapshot(metadata.deploymentPanel)) {
    return true;
  }
  const state = pickTaskSessionDeploymentState(metadata.deploymentState);
  return Boolean(state?.bindingState && state.bindingState !== 'uninitialized');
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

async function findLatestDeploymentSignalEnvironmentByTaskSessionId(taskSessionId: string) {
  const environments = await sandboxExecutionEnvironmentDAO.listByTaskSessionId(taskSessionId, 20).catch(() => []);
  for (const env of environments) {
    if (hasStoredDeploymentSignal(env?.metadata)) {
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

  const taskSessionId = asText(input.session?.id);
  if (taskSessionId) {
    const binding = await taskSessionRunDAO.getSandboxBindingBySession(taskSessionId).catch(() => null);
    const bindingSandboxId = asText(binding?.sandboxId);
    if (bindingSandboxId) {
      const byBinding = await sandboxExecutionEnvironmentDAO.getBySessionId(bindingSandboxId);
      if (byBinding) {
        return {
          orchestratorSessionId: bindingSandboxId,
          environment: byBinding,
        };
      }
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

export function resolveDeploymentResourceProjectKey(input: {
  session?: Pick<FileSessionRecord, 'id' | 'projectId'> | null;
  taskSessionId?: string;
}) {
  return (
    asText(input.session?.projectId) ||
    asText(input.taskSessionId) ||
    asText(input.session?.id)
  );
}

function buildDeploymentResourceBinding(
  deploymentProjectKey: string,
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.getProjectAccount>>
): DeploymentResourceBindingData | undefined {
  if (!account) return undefined;
  const normalizedDeploymentProjectKey = asText(deploymentProjectKey);
  const projectKey = asText(account.projectKey) || 'default';
  return {
    projectKey,
    isolationMode:
      normalizedDeploymentProjectKey && projectKey === normalizedDeploymentProjectKey ? 'session' : 'default',
    projectModel: 'per_user',
    environmentModel: 'per_user_project',
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

function pickTaskSessionDeploymentState(metadataRaw: unknown): TaskSessionDeploymentState | null {
  const record = pickRecord(metadataRaw);
  if (Object.keys(record).length === 0) {
    return null;
  }

  const resourceBindingRaw = pickRecord(record.resourceBinding);
  const resourceBinding =
    Object.keys(resourceBindingRaw).length > 0
      ? ({
          projectKey: asText(resourceBindingRaw.projectKey) || 'default',
          isolationMode:
            asText(resourceBindingRaw.isolationMode) === 'session' ? 'session' : 'default',
          projectModel: 'per_user',
          environmentModel:
            asText(resourceBindingRaw.environmentModel) === 'per_user_project'
              ? 'per_user_project'
              : 'per_session',
          tokenKind: 'project',
          tokenScope: 'railway_project_environment',
          tokenManagedBy: 'oneceo_platform',
          tokenId: asText(resourceBindingRaw.tokenId) || undefined,
          tokenRotatedAt: asText(resourceBindingRaw.tokenRotatedAt) || undefined,
          repositoryOwner: asText(resourceBindingRaw.repositoryOwner) || undefined,
          repositoryName: asText(resourceBindingRaw.repositoryName) || undefined,
          repositoryFullName: asText(resourceBindingRaw.repositoryFullName) || undefined,
          repositoryUrl: asText(resourceBindingRaw.repositoryUrl) || undefined,
          repositoryBranch: asText(resourceBindingRaw.repositoryBranch) || undefined,
        } satisfies DeploymentResourceBindingData)
      : undefined;

  return {
    bindingState: asText(record.bindingState) as RailwayDeploymentBindingState,
    provisioningPhase: asText(record.provisioningPhase) as RailwayDeploymentProvisioningPhase,
    providerErrorCode: asText(record.providerErrorCode) as RailwayDeploymentProviderErrorCode,
    providerErrorMessage: asText(record.providerErrorMessage) || undefined,
    message: asText(record.message) || undefined,
    lastVerifiedAt: asText(record.lastVerifiedAt) || undefined,
    projectId: asText(record.projectId) || undefined,
    projectName: asText(record.projectName) || undefined,
    environmentId: asText(record.environmentId) || undefined,
    environmentName: asText(record.environmentName) || undefined,
    serviceId: asText(record.serviceId) || undefined,
    serviceName: asText(record.serviceName) || undefined,
    publicUrl: asText(record.publicUrl) || undefined,
    publicDomain: asText(record.publicDomain) || undefined,
    domainStatus: asText(record.domainStatus) || undefined,
    domainStatusMessage: asText(record.domainStatusMessage) || undefined,
    resourceBinding,
  };
}

async function persistTaskSessionDeploymentState(
  orchestratorSessionId: string,
  currentState: TaskSessionDeploymentState | null,
  patch: TaskSessionDeploymentState
) {
  const nextState = {
    ...(currentState || {}),
    ...patch,
    lastVerifiedAt:
      patch.lastVerifiedAt === undefined
        ? currentState?.lastVerifiedAt
        : patch.lastVerifiedAt,
  } satisfies TaskSessionDeploymentState;
  if (orchestratorSessionId) {
    await setSandboxMetadata(orchestratorSessionId, {
      deploymentState: nextState,
    });
  }
  return nextState;
}

function buildStoredSnapshotFromState(
  state: TaskSessionDeploymentState,
  panel: RailwayDeploymentPanelData | null,
  analytics?: RailwayDeploymentPanelData['analytics']
): RailwayDeploymentPanelData {
  const base = panel || buildStoredDeploymentStatePanel(state, analytics);
  const bindingState = state.bindingState || base.bindingState;
  const shouldKeepProvisioningPhase =
    bindingState === 'provisioning' || base.activeDeploymentPending === true;
  const shouldKeepProviderError = bindingState === 'repair_required' || bindingState === 'provider_error';
  return {
    ...base,
    bindingState,
    provisioningPhase: shouldKeepProvisioningPhase
      ? state.provisioningPhase || base.provisioningPhase
      : undefined,
    providerErrorCode: shouldKeepProviderError
      ? state.providerErrorCode || base.providerErrorCode
      : undefined,
    providerErrorMessage: shouldKeepProviderError
      ? state.providerErrorMessage || base.providerErrorMessage
      : undefined,
    lastVerifiedAt: state.lastVerifiedAt || base.lastVerifiedAt,
    projectId: state.projectId || base.projectId,
    projectName: state.projectName || base.projectName,
    environmentId: state.environmentId || base.environmentId,
    environmentName: state.environmentName || base.environmentName,
    serviceId: state.serviceId || base.serviceId,
    serviceName: state.serviceName || base.serviceName,
    publicUrl: state.publicUrl || base.publicUrl,
    publicDomain: state.publicDomain || base.publicDomain,
    domainStatus: state.domainStatus || base.domainStatus,
    domainStatusMessage: state.domainStatusMessage || base.domainStatusMessage,
    message: state.message || base.message,
    resourceBinding: state.resourceBinding || base.resourceBinding,
    analytics: analytics || base.analytics,
  };
}

async function persistTaskSessionDeploymentPanelSnapshot(
  orchestratorSessionId: string,
  panel: RailwayDeploymentPanelData
) {
  if (!orchestratorSessionId) return panel;
  await setSandboxMetadata(orchestratorSessionId, {
    deploymentPanel: panel,
  });
  return panel;
}

function buildStoredDeploymentStatePanel(
  state: TaskSessionDeploymentState,
  analytics?: RailwayDeploymentPanelData['analytics']
): RailwayDeploymentPanelData {
  const bindingState = state.bindingState || 'repair_required';
  const providerErrorMessage =
    state.providerErrorMessage ||
    state.message ||
    '当前部署状态异常，请重新发布或联系平台管理员检查。';
  return {
    configured: false,
    canDeploy: true,
    bindingState,
    provisioningPhase: state.provisioningPhase,
    providerErrorCode: state.providerErrorCode,
    providerErrorMessage,
    lastVerifiedAt: state.lastVerifiedAt,
    message: state.message || providerErrorMessage,
    projectId: state.projectId,
    projectName: state.projectName,
    environmentId: state.environmentId,
    environmentName: state.environmentName,
    serviceId: state.serviceId,
    serviceName: state.serviceName,
    latestUrl: state.publicUrl,
    latestStaticUrl: state.publicUrl,
    publicUrl: state.publicUrl,
    publicDomain: state.publicDomain,
    domainStatus: state.domainStatus,
    domainStatusMessage: state.domainStatusMessage,
    activeDeploymentPending: bindingState === 'provisioning',
    domains: state.publicUrl ? [state.publicUrl] : [],
    deployments: [],
    logs: [],
    missing: [],
    analytics,
    resourceBinding: state.resourceBinding,
  } satisfies RailwayDeploymentPanelData;
}

export function shouldRecycleRailwayServiceForFailedRedeploy(input: {
  state?: Pick<TaskSessionDeploymentState, 'bindingState' | 'providerErrorCode' | 'serviceId'> | null;
  panel?: RailwayDeploymentPanelData | null;
}) {
  const bindingState = asText(input.panel?.bindingState || input.state?.bindingState).toLowerCase();
  if (bindingState !== 'repair_required') {
    return false;
  }

  const providerErrorCode = asText(input.panel?.providerErrorCode || input.state?.providerErrorCode);
  return (
    providerErrorCode === 'railway_environment_not_found' ||
    providerErrorCode === 'railway_service_not_found'
  );
}

export function shouldCleanupFailedDeploymentResources(input: {
  currentPhase: RailwayDeploymentProvisioningPhase;
  providerErrorCode?: RailwayDeploymentProviderErrorCode;
  account?: { serviceId?: string; environmentId?: string } | null;
  previousAccount?: { serviceId?: string; environmentId?: string } | null;
  shouldRecycleFailedRedeploy?: boolean;
}) {
  if (!input.account?.serviceId) {
    return false;
  }

  const providerErrorCode = asText(input.providerErrorCode);
  if (
    input.currentPhase === 'public_reachability' &&
    providerErrorCode === 'deployment_provider_error'
  ) {
    return false;
  }

  return (
    input.shouldRecycleFailedRedeploy === true ||
    !input.previousAccount?.serviceId ||
    input.previousAccount.serviceId !== input.account.serviceId ||
    input.previousAccount.environmentId !== input.account.environmentId
  );
}

function resolveDeploymentAnalyticsDomain(input: {
  metadata: Record<string, unknown>;
  accountPublicUrl?: string;
  accountPublicDomain?: string;
  accountDomain?: string;
  panel?: RailwayDeploymentPanelData | null;
}) {
  const analytics = pickRecord(input.metadata.analytics);
  return (
    asText(input.panel?.latestStaticUrl) ||
    asText(input.panel?.latestUrl) ||
    asText(input.panel?.domains?.[0]) ||
    asText(input.accountPublicUrl) ||
    asText(input.accountPublicDomain) ||
    asText(analytics.domain) ||
    asText(input.accountDomain) ||
    ''
  );
}

function buildDeploymentAnalyticsRuntimeConfig(input: {
  environmentMetadata: unknown;
  analyticsBinding?: Awaited<ReturnType<typeof prepareTaskSessionAnalyticsBinding>> | null;
}) {
  const metadataAnalytics = pickRecord(pickRecord(input.environmentMetadata).analytics);
  const host =
    asText(input.analyticsBinding?.host) ||
    asText(metadataAnalytics.host);
  const websiteId =
    asText(input.analyticsBinding?.websiteId) ||
    asText(metadataAnalytics.websiteId);
  return {
    enabled: Boolean(host && websiteId),
    host,
    endpoint: host,
    websiteId,
    tag: asText(input.analyticsBinding?.tag) || asText(metadataAnalytics.tag) || 'production',
    publicDomain: asText(input.analyticsBinding?.domain) || asText(metadataAnalytics.domain),
  };
}

function extractPublishedAnalyticsConfig(html: string): {
  host?: string;
  websiteId?: string;
  tag?: string;
  publicDomain?: string;
} | null {
  const markerStart = html.indexOf('<!-- ONECEO_ANALYTICS:START -->');
  const markerEnd = html.indexOf('<!-- ONECEO_ANALYTICS:END -->', Math.max(0, markerStart));
  const source =
    markerStart >= 0 && markerEnd > markerStart
      ? html.slice(markerStart, markerEnd)
      : html.slice(0, 200_000);
  const frozenConfigMatch = source.match(/window\.__ONECEO_ANALYTICS__\s*=\s*Object\.freeze\((\{[\s\S]*?\})\);/);
  if (frozenConfigMatch?.[1]) {
    try {
      const parsed = JSON.parse(frozenConfigMatch[1]) as Record<string, unknown>;
      return {
        host: asText(parsed.host || parsed.endpoint) || undefined,
        websiteId: asText(parsed.websiteId) || undefined,
        tag: asText(parsed.tag) || undefined,
        publicDomain: asText(parsed.publicDomain) || undefined,
      };
    } catch {
      // Fall through to attribute/string based extraction.
    }
  }
  const websiteId =
    source.match(/["']websiteId["']\s*:\s*["']([^"']+)["']/)?.[1] ||
    source.match(/data-website-id=["']([^"']+)["']/)?.[1];
  if (!asText(websiteId)) {
    return null;
  }
  return {
    websiteId: asText(websiteId),
    host:
      asText(source.match(/["']host["']\s*:\s*["']([^"']+)["']/)?.[1]) ||
      asText(source.match(/data-host-url=["']([^"']+)["']/)?.[1]) ||
      undefined,
    tag:
      asText(source.match(/["']tag["']\s*:\s*["']([^"']+)["']/)?.[1]) ||
      asText(source.match(/data-tag=["']([^"']+)["']/)?.[1]) ||
      undefined,
    publicDomain: asText(source.match(/["']publicDomain["']\s*:\s*["']([^"']+)["']/)?.[1]) || undefined,
  };
}

async function readPublishedAnalyticsConfig(panel: RailwayDeploymentPanelData): Promise<{
  host?: string;
  websiteId?: string;
  tag?: string;
  publicDomain?: string;
} | null> {
  const publicUrl =
    asText(panel.latestStaticUrl) ||
    asText(panel.latestUrl) ||
    asText(panel.domains[0]);
  if (!publicUrl) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(publicUrl, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
        'user-agent': 'OneCEO-Deployment-Analytics-Reconcile/1.0',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const text = (await response.text()).slice(0, 2_000_000);
    return extractPublishedAnalyticsConfig(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function reconcilePublishedAnalyticsMetadata(input: {
  orchestratorSessionId: string;
  metadata: Record<string, unknown>;
  panel: RailwayDeploymentPanelData;
}): Promise<Record<string, unknown>> {
  const published = await readPublishedAnalyticsConfig(input.panel);
  const publishedWebsiteId = asText(published?.websiteId);
  if (!publishedWebsiteId) {
    return input.metadata;
  }
  const currentAnalytics = pickRecord(input.metadata.analytics);
  const canonicalDomain = asText(input.panel.publicDomain) ||
    asText(input.panel.latestStaticUrl || input.panel.latestUrl || input.panel.domains[0])
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
  const publishedDomain = asText(published?.publicDomain)
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const shouldKeepCurrentMetadata =
    asText(currentAnalytics.websiteId) === publishedWebsiteId &&
    (!canonicalDomain ||
      asText(currentAnalytics.domain) === canonicalDomain ||
      publishedDomain === canonicalDomain);
  if (shouldKeepCurrentMetadata) {
    return input.metadata;
  }
  const nextAnalytics = {
    ...currentAnalytics,
    provider: 'umami',
    status: 'bound',
    host: asText(published?.host) || asText(currentAnalytics.host),
    websiteId: publishedWebsiteId,
    tag: asText(published?.tag) || asText(currentAnalytics.tag) || 'production',
    domain:
      canonicalDomain ||
      publishedDomain ||
      asText(currentAnalytics.domain) ||
      asText(input.panel.latestStaticUrl || input.panel.latestUrl || input.panel.domains[0])
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, ''),
    updatedAt: new Date().toISOString(),
    lastError: undefined,
  };
  await setSandboxMetadata(input.orchestratorSessionId, {
    analytics: nextAnalytics,
  });
  return {
    ...input.metadata,
    analytics: nextAnalytics,
  };
}

async function prepareSessionAnalyticsBindingSafely(input: {
  sessionId: string;
  orchestratorSessionId: string;
  environmentMetadata: unknown;
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureUserAccount>>;
  panel?: RailwayDeploymentPanelData | null;
}) {
  try {
    return await prepareTaskSessionAnalyticsBinding({
      sessionId: input.sessionId,
      orchestratorSessionId: input.orchestratorSessionId,
      environmentMetadata: input.environmentMetadata,
      account: input.account,
      domain: resolveDeploymentAnalyticsDomain({
        metadata: pickRecord(input.environmentMetadata),
        accountPublicUrl: input.account.publicUrl,
        accountPublicDomain: input.account.publicDomain,
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
    return null;
  }
}

async function finalizeSessionAnalyticsBinding(input: {
  sessionId: string;
  orchestratorSessionId: string;
  environmentMetadata: unknown;
  account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureUserAccount>>;
  panel: RailwayDeploymentPanelData;
}) {
  const latestEnvironment = input.orchestratorSessionId
    ? await sandboxExecutionEnvironmentDAO.getBySessionId(input.orchestratorSessionId).catch(() => null)
    : null;
  const latestMetadata = latestEnvironment?.metadata ?? input.environmentMetadata;
  const latestAnalytics = pickRecord(pickRecord(latestMetadata).analytics);
  const panelAnalytics = pickRecord(input.panel.analytics);
  const stableMetadata =
    asText(latestAnalytics.websiteId) || !asText(panelAnalytics.websiteId)
      ? latestMetadata
      : {
          ...pickRecord(latestMetadata),
          analytics: panelAnalytics,
        };
  await prepareSessionAnalyticsBindingSafely({
    sessionId: input.sessionId,
    orchestratorSessionId: input.orchestratorSessionId,
    environmentMetadata: stableMetadata,
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

function pickTaskSessionDeploymentSyncPayload(payloadRaw: unknown): TaskSessionDeploymentSyncPayload {
  const payload = pickRecord(payloadRaw);
  return {
    selectedDeploymentId: asText(payload.selectedDeploymentId) || undefined,
    reason: asText(payload.reason) || undefined,
    requestedAt: asText(payload.requestedAt) || undefined,
  };
}

function shouldFollowupTaskSessionDeploymentSync(panel: RailwayDeploymentPanelData) {
  return (
    panel.activeDeploymentPending ||
    panel.bindingState === 'provisioning' ||
    (panel.analytics?.status === 'pending_domain' &&
      Boolean(panel.latestStaticUrl || panel.latestUrl || panel.domains[0]))
  );
}

export async function enqueueTaskSessionDeploymentSync(input: {
  taskSessionId: string;
  orchestratorSessionId?: string;
  selectedDeploymentId?: string;
  delayMs?: number;
  reason?: string;
}) {
  const taskSessionId = asText(input.taskSessionId);
  if (!taskSessionId) return;
  const orchestratorSessionId = asText(input.orchestratorSessionId);
  if (!orchestratorSessionId) return;
  const existing = await taskSessionDeploymentSyncJobDAO.getBySyncKey(deploymentSyncKeyFor(taskSessionId));
  const existingPayload = pickTaskSessionDeploymentSyncPayload(existing?.payloadJson);
  const delayMs = Math.max(0, Number(input.delayMs || 0));
  await taskSessionDeploymentSyncJobDAO.upsertPending({
    taskSessionId,
    orchestratorSessionId: orchestratorSessionId || existing?.orchestratorSessionId || '',
    syncKey: deploymentSyncKeyFor(taskSessionId),
    jobType: 'deployment_panel_sync',
    status: 'pending',
    payloadJson: {
      selectedDeploymentId: asText(input.selectedDeploymentId) || existingPayload.selectedDeploymentId || null,
      reason: asText(input.reason) || existingPayload.reason || null,
      requestedAt: new Date().toISOString(),
    },
    nextRetryAt: delayMs > 0 ? new Date(Date.now() + delayMs) : null,
  });
}

async function recoverTaskSessionDeploymentSyncBacklog() {
  const limit = Math.max(50, Math.min(Number(process.env.TASK_SESSION_DEPLOYMENT_SYNC_LIMIT || 200), 1000));
  const environments = await sandboxExecutionEnvironmentDAO.listByStatus('ready', limit).catch(() => []);
  for (const environment of environments) {
    const metadata = pickRecord(environment.metadata);
    const taskSessionId = asText(metadata.taskSessionId);
    if (!taskSessionId) continue;
    const state = pickTaskSessionDeploymentState(metadata.deploymentState);
    const panel = pickTaskSessionDeploymentPanelSnapshot(metadata.deploymentPanel);
    const shouldSync =
      (state?.bindingState === 'provisioning') ||
      (state?.bindingState === 'repair_required') ||
      (!panel && (Boolean(state?.projectId) || Boolean(state?.serviceId)));
    if (!shouldSync) continue;
    const activeJobs = await taskSessionDeploymentSyncJobDAO.listActiveByTaskSession(taskSessionId).catch(() => []);
    if (activeJobs.length > 0) continue;
    await enqueueTaskSessionDeploymentSync({
      taskSessionId,
      orchestratorSessionId: environment.sessionId,
      delayMs: 0,
      reason: 'backlog_recovery',
    });
  }
}

async function waitForTaskSessionPublicReachabilityAndRefresh(input: {
  panel: RailwayDeploymentPanelData;
  healthPath?: string;
  userId: string;
  session: FileSessionRecord | null;
  orchestratorSessionId: string;
}) {
  const publicUrl =
    asText(input.panel.latestStaticUrl) ||
    asText(input.panel.latestUrl) ||
    asText(input.panel.domains[0]);
  const latestStatus = asText(input.panel.latestStatus).toUpperCase();
  const domainStatus = asText(input.panel.domainStatus).toLowerCase();
  const publicDomainStillActivating =
    domainStatus === 'pending_dns' || domainStatus === 'pending_certificate';
  const shouldProbe =
    Boolean(publicUrl) &&
    !publicDomainStillActivating &&
    (input.panel.activeDeploymentPending === true ||
      asText(input.panel.bindingState) === 'ready' ||
      terminalSuccessDeploymentStatuses.has(latestStatus));
  if (!shouldProbe) {
    return input.panel;
  }
  try {
    await waitForRailwayDeploymentPublicReachability({
      baseUrl: publicUrl,
      healthPath: input.healthPath,
    });
    return await refreshTaskSessionDeploymentSnapshot({
      userId: input.userId,
      session: input.session,
      selectedDeploymentId: input.panel.deploymentId,
      resolvedOrchestratorSessionId: input.orchestratorSessionId,
    });
  } catch (error) {
    const refreshed = await refreshTaskSessionDeploymentSnapshot({
      userId: input.userId,
      session: input.session,
      selectedDeploymentId: input.panel.deploymentId,
      resolvedOrchestratorSessionId: input.orchestratorSessionId,
    }).catch(() => input.panel);
    const refreshedUrl =
      asText(refreshed.latestStaticUrl) ||
      asText(refreshed.latestUrl) ||
      asText(refreshed.domains[0]);
    const refreshedStatus = asText(refreshed.latestStatus).toUpperCase();
    const isStillPending =
      refreshed.activeDeploymentPending === true || asText(refreshed.bindingState) === 'provisioning';
    if (isStillPending || !refreshedUrl) {
      return refreshed;
    }
    if (
      asText(refreshed.bindingState) === 'ready' ||
      terminalSuccessDeploymentStatuses.has(refreshedStatus)
    ) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`部署平台已返回成功状态，但公网访问验证失败。${message}`);
    }
    return refreshed;
  }
}

function buildTaskSessionPublicReachabilityFailurePanel(
  panel: RailwayDeploymentPanelData,
  message: string
): RailwayDeploymentPanelData {
  return {
    ...panel,
    bindingState: 'provider_error',
    provisioningPhase: 'public_reachability',
    providerErrorCode: 'deployment_public_unreachable',
    providerErrorMessage: message,
    message,
    lastVerifiedAt: new Date().toISOString(),
    activeDeploymentPending: false,
  };
}

function promoteTaskSessionSuccessfulLiveDeployment(
  panel: RailwayDeploymentPanelData
): RailwayDeploymentPanelData {
  const successfulDeployment = panel.deployments.find((item) =>
    terminalSuccessDeploymentStatuses.has(asText(item.status).toUpperCase())
  );
  if (!successfulDeployment) {
    return panel;
  }
  return {
    ...panel,
    deploymentId: successfulDeployment.id,
    latestStatus: successfulDeployment.status,
    bindingState: 'ready',
    provisioningPhase: undefined,
    providerErrorCode: undefined,
    providerErrorMessage: undefined,
    message: undefined,
    lastVerifiedAt: new Date().toISOString(),
    activeDeploymentPending: false,
  };
}

export async function validateTaskSessionDeploymentPublicReadiness(input: {
  panel: RailwayDeploymentPanelData;
  healthPath?: string;
  probe?: typeof waitForRailwayDeploymentPublicReachability;
}): Promise<RailwayDeploymentPanelData> {
  const probe =
    input.probe ||
    ((probeInput, probeOptions) => waitForRailwayDeploymentPublicReachability(probeInput, probeOptions));
  const publicUrl =
    asText(input.panel.latestStaticUrl) ||
    asText(input.panel.latestUrl) ||
    asText(input.panel.domains[0]);
  const latestStatus = asText(input.panel.latestStatus).toUpperCase();
  const domainStatus = asText(input.panel.domainStatus).toLowerCase();
  const publicDomainStillActivating =
    domainStatus === 'pending_dns' || domainStatus === 'pending_certificate';
  const shouldValidateTerminalSuccess =
    Boolean(publicUrl) &&
    !publicDomainStillActivating &&
    (asText(input.panel.bindingState) === 'ready' ||
      terminalSuccessDeploymentStatuses.has(latestStatus));
  const shouldPromoteSuccessfulLiveDeployment =
    Boolean(publicUrl) &&
    (input.panel.activeDeploymentPending === true ||
      asText(input.panel.bindingState) === 'provisioning') &&
    input.panel.deployments.some((item) =>
      terminalSuccessDeploymentStatuses.has(asText(item.status).toUpperCase())
    );
  if (!shouldValidateTerminalSuccess && !shouldPromoteSuccessfulLiveDeployment) {
    return input.panel;
  }

  try {
    await probe(
      {
        baseUrl: publicUrl,
        healthPath: input.healthPath,
      },
      {
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
      }
    );
    if (shouldPromoteSuccessfulLiveDeployment) {
      return promoteTaskSessionSuccessfulLiveDeployment(input.panel);
    }
    return input.panel;
  } catch (error) {
    if (shouldPromoteSuccessfulLiveDeployment) {
      return input.panel;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return buildTaskSessionPublicReachabilityFailurePanel(
      input.panel,
      `部署平台已返回成功状态，但公网访问验证失败。${reason}`
    );
  }
}

async function runTaskSessionDeploymentSyncJobOnce() {
  if (deploymentSyncRunning) return;
  deploymentSyncRunning = true;
  try {
    await recoverTaskSessionDeploymentSyncBacklog();
    const jobs = await taskSessionDeploymentSyncJobDAO.listRunnable(10);
    for (const job of jobs) {
      if (deploymentSyncRunningSessions.has(job.taskSessionId)) {
        continue;
      }
      deploymentSyncRunningSessions.add(job.taskSessionId);
      try {
        const attemptCount = Number(job.attemptCount || 0) + 1;
        await taskSessionDeploymentSyncJobDAO.markRunning(job.id, attemptCount);
        const payload = pickTaskSessionDeploymentSyncPayload(job.payloadJson);
        const dbSession = await taskCreationSessionDAO.getSession(job.taskSessionId);
        const userId = asText(dbSession?.userId);
        if (!userId) {
          await taskSessionDeploymentSyncJobDAO.markCompleted(job.id);
          continue;
        }
        const memorySession =
          (await taskCreationFileMemoryStore.getSession(job.taskSessionId)) ||
          ({
            id: job.taskSessionId,
            runtime: job.orchestratorSessionId
              ? { orchestratorSessionId: job.orchestratorSessionId }
              : undefined,
          } as FileSessionRecord);
        const panel = await refreshTaskSessionDeploymentSnapshot({
          userId,
          session: memorySession,
          selectedDeploymentId: payload.selectedDeploymentId,
          resolvedOrchestratorSessionId: job.orchestratorSessionId,
        });
        if (shouldFollowupTaskSessionDeploymentSync(panel)) {
          await enqueueTaskSessionDeploymentSync({
            taskSessionId: job.taskSessionId,
            orchestratorSessionId: job.orchestratorSessionId,
            selectedDeploymentId: panel.deploymentId || payload.selectedDeploymentId,
            delayMs: 10_000,
            reason: 'followup_sync',
          });
        } else {
          await taskSessionDeploymentSyncJobDAO.markCompleted(job.id);
        }
      } catch (error) {
        console.warn('[TASK_SESSION_DEPLOYMENT_SYNC_FAILED]', {
          taskSessionId: job.taskSessionId,
          orchestratorSessionId: job.orchestratorSessionId,
          error,
        });
        const message = error instanceof Error ? error.message : String(error);
        await taskSessionDeploymentSyncJobDAO.markFailed(
          job.id,
          Number(job.attemptCount || 0) + 1,
          message
        );
      } finally {
        deploymentSyncRunningSessions.delete(job.taskSessionId);
      }
    }
  } finally {
    deploymentSyncRunning = false;
  }
}

export function startTaskSessionDeploymentSyncJob() {
  if (deploymentSyncTimer) return;
  const intervalMs = Math.max(5_000, Number(process.env.TASK_SESSION_DEPLOYMENT_SYNC_INTERVAL_MS || 10_000));
  deploymentSyncTimer = setInterval(() => {
    void runTaskSessionDeploymentSyncJobOnce().catch((error) => {
      console.error('[TASK_SESSION_DEPLOYMENT_SYNC_JOB_FAILED]', error);
    });
  }, intervalMs);
  if (typeof (deploymentSyncTimer as any).unref === 'function') {
    (deploymentSyncTimer as any).unref();
  }
  void runTaskSessionDeploymentSyncJobOnce().catch((error) => {
    console.error('[TASK_SESSION_DEPLOYMENT_SYNC_JOB_BOOTSTRAP_FAILED]', error);
  });
}

export function stopTaskSessionDeploymentSyncJob() {
  if (!deploymentSyncTimer) return;
  clearInterval(deploymentSyncTimer);
  deploymentSyncTimer = null;
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
  const classified = classifyRailwayDeploymentError(message);
  return classified.code === 'deployment_provider_error' ? message : classified.userMessage;
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
    publicUrl: account.publicUrl,
    publicDomain: account.publicDomain,
    domainStatus: account.domainStatus,
    domainStatusMessage: account.domainStatusMessage,
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

async function resolveLiveTaskSessionDeploymentPanel(input: {
  userId: string;
  session: FileSessionRecord | null;
  selectedDeploymentId?: string;
  resolvedEnvironment?: TaskSessionDeploymentEnvironment;
  resolvedOrchestratorSessionId?: string | null;
}): Promise<RailwayDeploymentPanelData> {
  const projectKey = resolveDeploymentResourceProjectKey({
    session: input.session,
  });
  const { environment } = await resolveTaskSessionEnvironment({
    session: input.session,
    orchestratorSessionId: input.resolvedOrchestratorSessionId,
    environment: input.resolvedEnvironment,
  });
  const metadata = pickRecord(environment?.metadata);
  const savedState = pickTaskSessionDeploymentState(metadata.deploymentState);
  let account = await platformDeploymentAccountService.getProjectAccount(input.userId, projectKey);
  if (
    account?.serviceId &&
    (!asText(account.publicUrl) ||
      !asText(account.domainStatus) ||
      asText(account.domainStatus) === 'failed' ||
      asText(account.domainStatus) === 'repair_required' ||
      asText(account.domainStatus) === 'pending_dns' ||
      asText(account.domainStatus) === 'pending_certificate')
  ) {
    account = await platformDeploymentAccountService.ensureProjectAccount(input.userId, projectKey);
  }
  if (!account) {
    const analytics = await buildTaskSessionAnalyticsPanel(metadata);
    if (savedState?.bindingState && savedState.bindingState !== 'uninitialized') {
      return buildStoredDeploymentStatePanel(savedState, analytics);
    }
    return {
      configured: false,
      canDeploy: true,
      bindingState: 'uninitialized',
      provisioningPhase: 'resource_provisioning',
      message: '首次部署时将自动准备托管仓库与部署资源，并发布当前工作区内容。',
      providerErrorMessage: undefined,
      lastVerifiedAt: savedState?.lastVerifiedAt,
      activeDeploymentPending: false,
      domains: [],
      deployments: [],
      logs: [],
      missing: [],
      analytics,
      resourceBinding: savedState?.resourceBinding,
    } satisfies RailwayDeploymentPanelData;
  }

  const panel = await getRailwayDeploymentPanel(metadata, {
    platformDeployment: buildPlatformDeployment(account),
    deploymentId: input.selectedDeploymentId,
  });
  const analytics = await buildTaskSessionAnalyticsPanel(metadata);
  const bindingState = panel.bindingState || savedState?.bindingState || 'ready';
  const shouldKeepProvisioningPhase =
    bindingState === 'provisioning' || panel.activeDeploymentPending === true;
  const shouldKeepProviderError = bindingState === 'repair_required' || bindingState === 'provider_error';
  return {
    ...panel,
    bindingState,
    provisioningPhase: shouldKeepProvisioningPhase
      ? panel.provisioningPhase || savedState?.provisioningPhase
      : undefined,
    providerErrorCode: shouldKeepProviderError
      ? panel.providerErrorCode || savedState?.providerErrorCode
      : undefined,
    providerErrorMessage: shouldKeepProviderError
      ? panel.providerErrorMessage || savedState?.providerErrorMessage
      : undefined,
    lastVerifiedAt: panel.lastVerifiedAt || savedState?.lastVerifiedAt,
    analytics,
    resourceBinding: buildDeploymentResourceBinding(projectKey, account),
  } satisfies RailwayDeploymentPanelData;
}

function selectDeploymentFromSnapshot(
  snapshot: RailwayDeploymentPanelData,
  selectedDeploymentId?: string
): RailwayDeploymentPanelData {
  const targetId = asText(selectedDeploymentId);
  if (!targetId || targetId === asText(snapshot.deploymentId)) {
    return snapshot;
  }
  const matched = snapshot.deployments.find((item) => asText(item.id) === targetId);
  if (!matched) {
    return snapshot;
  }
  return {
    ...snapshot,
    deploymentId: matched.id,
    latestStatus: matched.status,
    latestUrl: matched.url || snapshot.latestUrl,
    latestStaticUrl: matched.staticUrl || snapshot.latestStaticUrl,
  };
}

export async function buildTaskSessionDeploymentResponse(input: {
  userId: string;
  session: FileSessionRecord | null;
  selectedDeploymentId?: string;
  resolvedEnvironment?: TaskSessionDeploymentEnvironment;
  resolvedOrchestratorSessionId?: string | null;
}): Promise<RailwayDeploymentPanelData> {
  const resolved = await resolveTaskSessionEnvironment({
    session: input.session,
    orchestratorSessionId: input.resolvedOrchestratorSessionId,
    environment: input.resolvedEnvironment,
  });
  let environment = resolved.environment;
  const taskSessionId = asText(input.session?.id);
  if (!hasStoredDeploymentSignal(environment?.metadata) && taskSessionId) {
    const latestDeploymentEnvironment = await findLatestDeploymentSignalEnvironmentByTaskSessionId(taskSessionId);
    if (latestDeploymentEnvironment) {
      environment = latestDeploymentEnvironment;
    }
  }
  const metadata = pickRecord(environment?.metadata);
  const savedState = pickTaskSessionDeploymentState(metadata.deploymentState);
  const savedPanel = pickTaskSessionDeploymentPanelSnapshot(metadata.deploymentPanel);
  const shouldRefreshLiveSnapshot =
    Boolean(input.resolvedOrchestratorSessionId) &&
    (
      (!savedPanel && savedState?.bindingState && savedState.bindingState !== 'uninitialized') ||
      savedPanel?.activeDeploymentPending === true ||
      savedPanel?.bindingState === 'provisioning' ||
      savedPanel?.bindingState === 'provider_error' ||
      isLiveDeploymentDomainRefreshStatus(savedPanel?.domainStatus) ||
      hasStaleActiveDeploymentDomainMessage(savedPanel || {}) ||
      hasStaleDeploymentAnalyticsMetadata(savedPanel || {}) ||
      savedState?.bindingState === 'provisioning' ||
      savedState?.bindingState === 'provider_error' ||
      isLiveDeploymentDomainRefreshStatus(savedState?.domainStatus) ||
      hasStaleActiveDeploymentDomainMessage(savedState || {}) ||
      savedState?.bindingState === 'repair_required'
    );
  if (shouldRefreshLiveSnapshot) {
    try {
      const livePanel = await refreshTaskSessionDeploymentSnapshot({
        userId: input.userId,
        session: input.session,
        selectedDeploymentId: input.selectedDeploymentId,
        resolvedEnvironment: environment,
        resolvedOrchestratorSessionId: input.resolvedOrchestratorSessionId,
      });
      return selectDeploymentFromSnapshot(livePanel, input.selectedDeploymentId);
    } catch (error) {
      console.warn('[TASK_SESSION_DEPLOYMENT_RESPONSE_LIVE_REFRESH_FAILED]', {
        sessionId: asText(input.session?.id),
        orchestratorSessionId: input.resolvedOrchestratorSessionId,
        error,
      });
    }
  }
  if (savedPanel) {
    return selectDeploymentFromSnapshot(
      buildStoredSnapshotFromState(savedState || {}, savedPanel, savedPanel.analytics),
      input.selectedDeploymentId
    );
  }
  if (savedState?.bindingState && savedState.bindingState !== 'uninitialized') {
    const analytics = await buildTaskSessionAnalyticsPanel(metadata);
    return buildStoredDeploymentStatePanel(savedState, analytics);
  }
  const account = await platformDeploymentAccountService.getProjectAccount(
    input.userId,
    resolveDeploymentResourceProjectKey({ session: input.session })
  );
  const resourceBinding = buildDeploymentResourceBinding(
    resolveDeploymentResourceProjectKey({ session: input.session }),
    account
  );
  const analytics = await buildTaskSessionAnalyticsPanel(metadata);
  return {
    configured: Boolean(account),
    canDeploy: true,
    bindingState: 'uninitialized',
    provisioningPhase: 'resource_provisioning',
    message: account ? '后台正在同步部署状态，请稍后查看。' : '首次部署时将自动准备托管仓库与部署资源，并发布当前工作区内容。',
    providerErrorMessage: undefined,
    lastVerifiedAt: savedState?.lastVerifiedAt,
    activeDeploymentPending: false,
    domains: [],
    deployments: [],
    logs: [],
    missing: [],
    analytics,
    resourceBinding: savedState?.resourceBinding || resourceBinding,
  } satisfies RailwayDeploymentPanelData;
}

function buildDeploymentStatePatchFromPanel(
  panel: RailwayDeploymentPanelData,
  resourceBinding?: DeploymentResourceBindingData
): TaskSessionDeploymentState {
  const bindingState = panel.bindingState || (panel.activeDeploymentPending ? 'provisioning' : 'ready');
  const shouldKeepProvisioningPhase =
    bindingState === 'provisioning' || panel.activeDeploymentPending === true;
  const shouldKeepProviderError = bindingState === 'repair_required' || bindingState === 'provider_error';
  return {
    bindingState,
    provisioningPhase: shouldKeepProvisioningPhase ? panel.provisioningPhase : undefined,
    providerErrorCode: shouldKeepProviderError ? panel.providerErrorCode : undefined,
    providerErrorMessage: shouldKeepProviderError ? panel.providerErrorMessage : undefined,
    message: panel.message,
    lastVerifiedAt: panel.lastVerifiedAt || new Date().toISOString(),
    projectId: panel.projectId,
    projectName: panel.projectName,
    environmentId: panel.environmentId,
    environmentName: panel.environmentName,
    serviceId: panel.serviceId,
    serviceName: panel.serviceName,
    publicUrl: panel.publicUrl,
    publicDomain: panel.publicDomain,
    domainStatus: panel.domainStatus,
    domainStatusMessage: panel.domainStatusMessage,
    resourceBinding: resourceBinding || panel.resourceBinding,
  };
}

export async function refreshTaskSessionDeploymentSnapshot(input: {
  userId: string;
  session: FileSessionRecord | null;
  selectedDeploymentId?: string;
  resolvedEnvironment?: TaskSessionDeploymentEnvironment;
  resolvedOrchestratorSessionId?: string | null;
}): Promise<RailwayDeploymentPanelData> {
  const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment({
    session: input.session,
    orchestratorSessionId: input.resolvedOrchestratorSessionId,
    environment: input.resolvedEnvironment,
  });
  if (!orchestratorSessionId) {
    throw new Error('未找到可同步的部署执行环境');
  }
  const metadata = pickRecord(environment?.metadata);
  const panel = await resolveLiveTaskSessionDeploymentPanel({
    ...input,
    resolvedEnvironment: environment,
    resolvedOrchestratorSessionId: orchestratorSessionId,
  });
  const resourceBinding = panel.resourceBinding;
  const hasPublicUrl = Boolean(asText(panel.latestStaticUrl) || asText(panel.latestUrl) || panel.domains[0]);
  const account = hasPublicUrl
    ? await platformDeploymentAccountService.getProjectAccount(
        input.userId,
        resolveDeploymentResourceProjectKey({ session: input.session })
      )
    : null;
  if (hasPublicUrl && orchestratorSessionId && account) {
    await finalizeSessionAnalyticsBinding({
      sessionId: asText(input.session?.id),
      orchestratorSessionId,
      environmentMetadata: metadata,
      account,
      panel,
    });
  }
  const refreshedEnvironment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
  const refreshedMetadata = pickRecord(refreshedEnvironment?.metadata);
  const refreshedAnalytics = await buildTaskSessionAnalyticsPanel(refreshedMetadata);
  const baseline = pickRecord(refreshedMetadata.deploymentTemplateBaseline || metadata.deploymentTemplateBaseline);
  let nextPanel: RailwayDeploymentPanelData = {
    ...panel,
    analytics: refreshedAnalytics,
    resourceBinding: resourceBinding || panel.resourceBinding,
  };
  nextPanel = await validateTaskSessionDeploymentPublicReadiness({
    panel: nextPanel,
    healthPath: asText(baseline.healthcheckPath) || undefined,
  });
  const reconciledMetadata = await reconcilePublishedAnalyticsMetadata({
    orchestratorSessionId,
    metadata: refreshedMetadata,
    panel: nextPanel,
  });
  if (reconciledMetadata !== refreshedMetadata) {
    nextPanel = {
      ...nextPanel,
      analytics: await buildTaskSessionAnalyticsPanel(reconciledMetadata),
    };
  }
  await persistTaskSessionDeploymentState(
    orchestratorSessionId,
    pickTaskSessionDeploymentState(reconciledMetadata.deploymentState || metadata.deploymentState),
    buildDeploymentStatePatchFromPanel(nextPanel, resourceBinding || undefined)
  );
  await persistTaskSessionDeploymentPanelSnapshot(orchestratorSessionId, nextPanel);
  return nextPanel;
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
  const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment({
    session: input.session,
    orchestratorSessionId: input.resolvedOrchestratorSessionId,
    environment: input.resolvedEnvironment,
  });
  const environmentMetadata = pickRecord(environment?.metadata);
  let savedState = pickTaskSessionDeploymentState(environmentMetadata.deploymentState);
  const savedPanel = pickTaskSessionDeploymentPanelSnapshot(environmentMetadata.deploymentPanel);
  let currentPhase: RailwayDeploymentProvisioningPhase = 'resource_provisioning';
  let account: Awaited<ReturnType<typeof platformDeploymentAccountService.ensureProjectAccount>> | null = null;
  const deploymentProjectKey = resolveDeploymentResourceProjectKey({
    session: input.session,
    taskSessionId: input.taskSessionId,
  });
  const previousAccount = await platformDeploymentAccountService
    .getProjectAccount(input.userId, deploymentProjectKey)
    .catch(() => null);
  const userProject = await platformDeploymentAccountService.getUserProject(input.userId).catch(() => null);
  const shouldRecycleFailedRedeploy =
    input.action === 'redeploy' &&
    shouldRecycleRailwayServiceForFailedRedeploy({
      state: savedState,
      panel: savedPanel,
    });

  savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
    bindingState: 'provisioning',
    provisioningPhase: currentPhase,
    providerErrorCode: undefined,
    providerErrorMessage: undefined,
    message: shouldRecycleFailedRedeploy
      ? '检测到上次部署失败，平台正在回收旧的 Railway 服务并重新准备部署资源。'
      : '平台正在准备 Railway 部署资源。',
    projectId: userProject?.projectId,
    projectName: userProject?.projectName,
    lastVerifiedAt: new Date().toISOString(),
    resourceBinding: savedState?.resourceBinding,
  });

  try {
    account = shouldRecycleFailedRedeploy
      ? await platformDeploymentAccountService.recycleProjectService(input.userId, deploymentProjectKey)
      : await platformDeploymentAccountService.ensureProjectAccount(input.userId, deploymentProjectKey);
    const resourceBinding = buildDeploymentResourceBinding(deploymentProjectKey, account);
    savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
      bindingState: 'provisioning',
      provisioningPhase: 'workspace_publish',
      providerErrorCode: undefined,
      providerErrorMessage: undefined,
      message: 'Railway 部署资源已准备完成，正在发布工作区。',
      projectId: account.projectId,
      projectName: account.projectName,
      environmentId: account.environmentId,
      environmentName: account.environmentName,
      serviceId: account.serviceId,
      serviceName: account.serviceName,
      resourceBinding,
      lastVerifiedAt: new Date().toISOString(),
    });

    const platformDeployment = buildPlatformDeployment(account);
    const deploymentMetadata = {
      ...environmentMetadata,
      platformDeployment,
    };

    if (input.action === 'deploy' || shouldRecycleFailedRedeploy) {
      const workspaceRoot =
        asText(environmentMetadata.opencodeWorkspaceRoot) ||
        asText(input.workspacePath) ||
        resolveOpencodeWorkspacePath(input.taskSessionId);
      if (!orchestratorSessionId || !workspaceRoot) {
        throw new Error('未找到可部署的工作区，请先生成项目文件');
      }

      const deploymentRequestedAt = Date.now();
      const analyticsBinding = await prepareSessionAnalyticsBindingSafely({
        sessionId: input.taskSessionId,
        orchestratorSessionId,
        environmentMetadata,
        account,
      });
      const publishReport = await uploadTaskSessionWorkspaceToRailway({
        orchestratorSessionId,
        workspaceRoot,
        railway: {
          token: account.accessToken,
          projectId: account.projectId,
          environmentId: account.environmentId,
          serviceId: account.serviceId,
          message: `deploy ${input.taskSessionId} ${new Date().toISOString()}`,
        },
        sessionId: input.taskSessionId,
        analyticsConfig: buildDeploymentAnalyticsRuntimeConfig({
          environmentMetadata,
          analyticsBinding,
        }),
      });
      await setSandboxMetadata(orchestratorSessionId, {
        deploymentTemplateBaseline: publishReport.baseline,
      });

      currentPhase = 'source_sync';
      savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
        bindingState: 'provisioning',
        provisioningPhase: currentPhase,
        message: '工作区已直传 Railway，正在确认部署版本。',
        lastVerifiedAt: new Date().toISOString(),
      });

      currentPhase = 'deployment_trigger';
      savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
        bindingState: 'provisioning',
        provisioningPhase: currentPhase,
        message: 'Railway 已收到源码上传，正在等待部署版本生成。',
        lastVerifiedAt: new Date().toISOString(),
      });
      const actionResult = publishReport.deploymentId
        ? {
            action: 'deploy' as const,
            deploymentId: publishReport.deploymentId,
          }
        : await ensureDeploymentStartedAfterSourceSync({
            waitForSourceSync: () =>
              waitForRailwayDeploymentAfterSourceSync(deploymentMetadata, {
                since: deploymentRequestedAt,
                timeoutMs: 120_000,
                pollIntervalMs: 4_000,
              }),
            triggerDeploy: () => triggerRailwayDeploy(deploymentMetadata),
          });
      await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);

      currentPhase = 'public_reachability';
      savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
        bindingState: 'provisioning',
        provisioningPhase: currentPhase,
        message: 'Railway 已返回部署版本，后台正在同步公网可达性与部署状态。',
        lastVerifiedAt: new Date().toISOString(),
      });
      let panel = await refreshTaskSessionDeploymentSnapshot({
        userId: input.userId,
        session: input.session,
        selectedDeploymentId: actionResult.deploymentId,
        resolvedOrchestratorSessionId: orchestratorSessionId,
      });
      panel = await waitForTaskSessionPublicReachabilityAndRefresh({
        panel,
        healthPath: publishReport.baseline.healthcheckPath,
        userId: input.userId,
        session: input.session,
        orchestratorSessionId,
      });
      await enqueueTaskSessionDeploymentSync({
        taskSessionId: input.taskSessionId,
        orchestratorSessionId,
        selectedDeploymentId: actionResult.deploymentId,
        delayMs: panel.activeDeploymentPending ? 8_000 : 4_000,
        reason: shouldRecycleFailedRedeploy ? 'failed_redeploy_followup' : 'deploy_followup',
      });
      return {
        panel,
        actionResult,
        publishReport,
        baseline: publishReport.baseline,
      };
    }

    const currentPanel = await resolveLiveTaskSessionDeploymentPanel({
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
        : asText(input.deploymentId) ||
          asText(currentPanel.deploymentId) ||
          asText(currentPanel.deployments[0]?.id);
    if (!targetDeploymentId) {
      throw new Error(
        input.action === 'rollback'
          ? '没有可回滚的历史部署版本'
          : '当前没有可重新部署的历史版本'
      );
    }

    currentPhase = 'deployment_trigger';
    savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
      bindingState: 'provisioning',
      provisioningPhase: currentPhase,
      message:
        input.action === 'rollback'
          ? '正在回滚到指定历史部署版本。'
          : '正在重新触发 Railway 部署。',
      lastVerifiedAt: new Date().toISOString(),
    });
    const actionResult =
      input.action === 'rollback'
        ? await triggerRailwayRollback(deploymentMetadata, targetDeploymentId)
        : await triggerRailwayRedeploy(deploymentMetadata, targetDeploymentId);
    await persistRailwayDeploymentSelection(orchestratorSessionId, environment?.metadata, actionResult);

    currentPhase = 'public_reachability';
    savedState = await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
      bindingState: 'provisioning',
      provisioningPhase: currentPhase,
      message: 'Railway 已接收操作，后台正在同步公网可达性与部署状态。',
      lastVerifiedAt: new Date().toISOString(),
    });
    let panel = await refreshTaskSessionDeploymentSnapshot({
      userId: input.userId,
      session: input.session,
      selectedDeploymentId: actionResult.deploymentId,
      resolvedOrchestratorSessionId: orchestratorSessionId,
    });
    panel = await waitForTaskSessionPublicReachabilityAndRefresh({
      panel,
      healthPath: '/api/system/health',
      userId: input.userId,
      session: input.session,
      orchestratorSessionId,
    });
    await enqueueTaskSessionDeploymentSync({
      taskSessionId: input.taskSessionId,
      orchestratorSessionId,
      selectedDeploymentId: actionResult.deploymentId,
      delayMs: panel.activeDeploymentPending ? 8_000 : 4_000,
      reason: input.action === 'rollback' ? 'rollback_followup' : 'redeploy_followup',
    });
    return {
      panel,
      actionResult,
      targetDeploymentId,
    };
  } catch (error) {
    const message = getTaskSessionDeploymentErrorMessage(error);
    const classified = classifyRailwayDeploymentError(message);
    const shouldCleanupFailedResources = shouldCleanupFailedDeploymentResources({
      currentPhase,
      providerErrorCode: classified.code,
      account,
      previousAccount,
      shouldRecycleFailedRedeploy,
    });
    await persistTaskSessionDeploymentState(orchestratorSessionId, savedState, {
      bindingState: classified.bindingState,
      provisioningPhase: currentPhase,
      providerErrorCode: classified.code,
      providerErrorMessage: classified.userMessage,
      message: classified.userMessage,
      projectId: account?.projectId || userProject?.projectId || savedState?.projectId,
      projectName: account?.projectName || userProject?.projectName || savedState?.projectName,
      environmentId: account?.environmentId || savedState?.environmentId,
      environmentName: account?.environmentName || savedState?.environmentName,
      serviceId: account?.serviceId || savedState?.serviceId,
      serviceName: account?.serviceName || savedState?.serviceName,
      resourceBinding:
        buildDeploymentResourceBinding(deploymentProjectKey, account) || savedState?.resourceBinding,
      lastVerifiedAt: new Date().toISOString(),
    });
    if (shouldCleanupFailedResources) {
      await platformDeploymentAccountService
        .cleanupFailedProjectResources(input.userId, deploymentProjectKey)
        .catch((cleanupError) => {
          console.warn('[FAILED_DEPLOYMENT_RESOURCE_CLEANUP_FAILED]', {
            taskSessionId: input.taskSessionId,
            userId: input.userId,
            error: cleanupError,
          });
        });
    }
    throw error;
  }
}
