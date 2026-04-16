import { requestRailwayGraphql, type RailwayAuthKind } from './railway-graphql-client';

const DEPLOYMENT_TRANSIENT_STATUSES = new Set([
  'BUILDING',
  'DEPLOYING',
  'INITIALIZING',
  'QUEUED',
  'WAITING',
]);

export type RailwayDeploymentStatus =
  | 'BUILDING'
  | 'CRASHED'
  | 'DEPLOYING'
  | 'FAILED'
  | 'INITIALIZING'
  | 'QUEUED'
  | 'REMOVED'
  | 'SUCCESS'
  | 'WAITING'
  | string;

export type RailwayDeploymentLogEntry = {
  timestamp?: string;
  message: string;
  severity?: string;
};

export type RailwayDeploymentListItem = {
  id: string;
  status: RailwayDeploymentStatus;
  createdAt?: string;
  serviceName?: string;
  commitMessage?: string;
  commitAuthor?: string;
  url?: string;
  staticUrl?: string;
};

export type DeploymentAnalyticsPanelData = {
  provider: 'umami';
  configured: boolean;
  enabled: boolean;
  status: 'ready' | 'pending' | 'unconfigured' | 'error';
  host?: string;
  websiteId?: string;
  websiteName?: string;
  domain?: string;
  tag?: string;
  pageviews?: number;
  visits?: number;
  visitors?: number;
  events?: number;
  activeVisitors?: number;
  updatedAt?: string;
  message?: string;
  error?: string;
};

export type DeploymentResourceBindingData = {
  projectKey: string;
  isolationMode: 'session' | 'default';
  projectModel: 'per_user';
  environmentModel: 'per_session';
  tokenKind: 'project';
  tokenScope: 'railway_project_environment';
  tokenManagedBy: 'oneceo_platform';
  tokenId?: string;
  tokenRotatedAt?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryFullName?: string;
  repositoryUrl?: string;
  repositoryBranch?: string;
};

export type RailwayDeploymentPanelData = {
  configured: boolean;
  canDeploy: boolean;
  message?: string;
  projectId?: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  deploymentId?: string;
  latestStatus?: RailwayDeploymentStatus;
  latestUrl?: string;
  latestStaticUrl?: string;
  activeDeploymentPending: boolean;
  domains: string[];
  deployments: RailwayDeploymentListItem[];
  logs: RailwayDeploymentLogEntry[];
  missing: string[];
  analytics?: DeploymentAnalyticsPanelData;
  resourceBinding?: DeploymentResourceBindingData;
};

export type RailwayDeploymentActionResult = {
  deploymentId?: string;
  action: 'deploy' | 'redeploy' | 'rollback';
};

type RailwayBinding = {
  token: string;
  tokenKind: RailwayAuthKind;
  projectId: string;
  environmentId: string;
  serviceId: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  lastDeploymentId?: string;
};

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const normalized = asText(value);
    if (normalized) return normalized;
  }
  return '';
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const raw = asText(value);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return undefined;
}

function toPublicUrl(value: unknown): string | undefined {
  const raw = asText(value);
  if (!raw) return undefined;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return `https://${raw}`;
}

function buildMissingMessage(missing: string[]) {
  if (missing.length === 0) return '';
  return `部署尚未就绪，缺少：${missing.join('、')}。请联系平台管理员完成部署供应链配置。`;
}

function resolveBinding(metadata: Record<string, unknown>): {
  binding: RailwayBinding | null;
  missing: string[];
} {
  const platformDeployment = pickRecord(metadata.platformDeployment);
  const railway = pickRecord(metadata.railway);
  const projectToken = firstText(
    platformDeployment.projectToken,
    platformDeployment.token,
    platformDeployment.accessToken,
    railway.projectToken,
    railway.token,
    metadata.railwayProjectToken,
    process.env.RAILWAY_PROJECT_TOKEN
  );
  const bearerToken = firstText(
    platformDeployment.adminToken,
    railway.apiToken,
    metadata.railwayToken,
    process.env.RAILWAY_API_TOKEN,
    process.env.RAILWAY_ADMIN_TOKEN
  );
  const token = projectToken || bearerToken;
  const tokenKind: RailwayAuthKind = projectToken ? 'project' : 'bearer';
  const projectId = firstText(
    platformDeployment.projectId,
    railway.projectId,
    metadata.railwayProjectId,
    process.env.RAILWAY_PROJECT_ID
  );
  const environmentId = firstText(
    platformDeployment.environmentId,
    railway.environmentId,
    metadata.railwayEnvironmentId,
    process.env.RAILWAY_ENVIRONMENT_ID
  );
  const serviceId = firstText(
    platformDeployment.serviceId,
    railway.serviceId,
    metadata.railwayServiceId,
    process.env.RAILWAY_SERVICE_ID
  );

  const missing: string[] = [];
  if (!token) missing.push('token');
  if (!projectId) missing.push('projectId');
  if (!environmentId) missing.push('environmentId');

  if (missing.length > 0) {
    return { binding: null, missing };
  }

  return {
    binding: {
      token,
      tokenKind,
      projectId,
      environmentId,
      serviceId,
      projectName: firstText(platformDeployment.projectName, railway.projectName, metadata.railwayProjectName),
      environmentName: firstText(
        platformDeployment.environmentName,
        railway.environmentName,
        metadata.railwayEnvironmentName
      ),
      serviceName: firstText(
        platformDeployment.serviceName,
        railway.serviceName,
        metadata.railwayServiceName,
        process.env.RAILWAY_SERVICE_NAME
      ),
      lastDeploymentId: firstText(railway.lastDeploymentId, metadata.railwayLastDeploymentId),
    },
    missing: serviceId ? [] : ['serviceId'],
  };
}

async function executeRailwayGraphql<T>(
  token: string,
  tokenKind: RailwayAuthKind,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  try {
    return await requestRailwayGraphql<T>(
      {
        token,
        kind: tokenKind,
      },
      query,
      variables
    );
  } catch (error: any) {
    throw new Error(firstText(error?.message) || '部署服务请求失败');
  }
}

async function loadProjectSummary(binding: RailwayBinding) {
  return executeRailwayGraphql<{
    project?: {
      id?: string;
      name?: string;
      environments?: { edges?: Array<{ node?: { id?: string; name?: string } }> };
      services?: { edges?: Array<{ node?: { id?: string; name?: string } }> };
  } | null;
  }>(
    binding.token,
    binding.tokenKind,
    `
      query RailwayProjectSummary($id: String!) {
        project(id: $id) {
          id
          name
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `,
    { id: binding.projectId }
  );
}

async function loadDeployments(binding: RailwayBinding) {
  return executeRailwayGraphql<{
    deployments?: {
      edges?: Array<{
        node?: {
          id?: string;
          status?: string;
          createdAt?: string;
          service?: {
            name?: string;
          } | null;
        };
      }>;
    } | null;
  }>(
    binding.token,
    binding.tokenKind,
    `
      query RailwayDeployments($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) {
          edges {
            node {
              id
              status
              createdAt
              service {
                name
              }
            }
          }
        }
      }
    `,
    {
      input: {
        projectId: binding.projectId,
        environmentId: binding.environmentId,
      },
      first: 20,
    }
  );
}

async function loadDeploymentDetail(
  token: string,
  tokenKind: RailwayAuthKind,
  deploymentId: string
) {
  return executeRailwayGraphql<{
    deployment?: {
      id?: string;
      status?: string;
      createdAt?: string;
      url?: string;
      staticUrl?: string;
    } | null;
  }>(
    token,
    tokenKind,
    `
      query RailwayDeploymentDetail($deploymentId: String!) {
        deployment(id: $deploymentId) {
          id
          status
          createdAt
          url
          staticUrl
        }
      }
    `,
    { deploymentId }
  );
}

async function loadDeploymentLogs(
  token: string,
  tokenKind: RailwayAuthKind,
  deploymentId: string,
  limit: number
) {
  return executeRailwayGraphql<{
    deploymentLogs?: Array<{
      timestamp?: string;
      message?: string;
      severity?: string;
    }>;
  }>(
    token,
    tokenKind,
    `
      query RailwayDeploymentLogs($deploymentId: String!, $limit: Int) {
        deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
          timestamp
          message
          severity
        }
      }
    `,
    { deploymentId, limit }
  );
}

async function loadDomains(binding: RailwayBinding) {
  if (!binding.serviceId) return { domains: { serviceDomains: [], customDomains: [] } };
  return executeRailwayGraphql<{
    domains?: {
      serviceDomains?: Array<{ id?: string; domain?: string }>;
      customDomains?: Array<{ id?: string; domain?: string }>;
    } | null;
  }>(
    binding.token,
    binding.tokenKind,
    `
      query RailwayDomains($projectId: String!, $serviceId: String!, $environmentId: String!) {
        domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          serviceDomains {
            id
            domain
          }
          customDomains {
            id
            domain
          }
        }
      }
    `,
    {
      projectId: binding.projectId,
      serviceId: binding.serviceId,
      environmentId: binding.environmentId,
    }
  );
}

function normalizeDeploymentItems(
  items: Array<{
    id?: string;
    status?: string;
    createdAt?: string;
    serviceName?: string;
    commitMessage?: string;
    commitAuthor?: string;
  }>,
  serviceName?: string
): RailwayDeploymentListItem[] {
  const filtered = serviceName
    ? items.filter((item) => !item.serviceName || item.serviceName === serviceName)
    : items;

  return filtered
    .filter((item) => asText(item.id))
    .map((item) => ({
      id: asText(item.id),
      status: asText(item.status) || 'UNKNOWN',
      createdAt: toIso(item.createdAt),
      serviceName: asText(item.serviceName) || undefined,
      commitMessage: asText(item.commitMessage) || undefined,
      commitAuthor: asText(item.commitAuthor) || undefined,
    }))
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export async function getRailwayDeploymentPanel(
  metadataRaw: Record<string, unknown>,
  options?: {
    deploymentId?: string;
    logLimit?: number;
    platformDeployment?: Record<string, unknown>;
  }
): Promise<RailwayDeploymentPanelData> {
  const metadata = {
    ...pickRecord(metadataRaw),
    ...(options?.platformDeployment ? { platformDeployment: options.platformDeployment } : {}),
  };
  const { binding, missing } = resolveBinding(metadata);

  if (!binding) {
    return {
      configured: false,
      canDeploy: false,
      message: buildMissingMessage(missing),
      activeDeploymentPending: false,
      domains: [],
      deployments: [],
      logs: [],
      missing,
    };
  }

  const [projectResult, deploymentsResult, domainsResult] = await Promise.all([
    loadProjectSummary(binding),
    loadDeployments(binding),
    loadDomains(binding),
  ]);

  const services =
    projectResult.project?.services?.edges
      ?.map((edge) => ({
        id: asText(edge?.node?.id),
        name: asText(edge?.node?.name),
      }))
      .filter((item) => item.id || item.name) || [];
  const environments =
    projectResult.project?.environments?.edges
      ?.map((edge) => ({
        id: asText(edge?.node?.id),
        name: asText(edge?.node?.name),
      }))
      .filter((item) => item.id || item.name) || [];

  const resolvedServiceName =
    services.find((item) => item.id === binding.serviceId)?.name ||
    binding.serviceName;
  const resolvedEnvironmentName =
    environments.find((item) => item.id === binding.environmentId)?.name ||
    binding.environmentName;

  const deployments = normalizeDeploymentItems(
    deploymentsResult.deployments?.edges?.map((edge) => {
      const node: any = edge?.node || {};
      return {
        id: node.id,
        status: node.status,
        createdAt: node.createdAt,
        serviceName: node.service?.name,
        commitMessage: node.meta?.commitMessage,
        commitAuthor: node.meta?.commitAuthor,
      };
    }) || [],
    resolvedServiceName
  );

  const selectedDeploymentId =
    firstText(options?.deploymentId) ||
    deployments[0]?.id ||
    firstText(binding.lastDeploymentId) ||
    '';
  const selectedDeployment = selectedDeploymentId
    ? deployments.find((item) => item.id === selectedDeploymentId) || null
    : null;

  let detail: Awaited<ReturnType<typeof loadDeploymentDetail>>['deployment'] | null = null;
  let logs: RailwayDeploymentLogEntry[] = [];

  if (selectedDeploymentId) {
    const [detailResult, logsResult] = await Promise.all([
      loadDeploymentDetail(binding.token, binding.tokenKind, selectedDeploymentId),
      loadDeploymentLogs(
        binding.token,
        binding.tokenKind,
        selectedDeploymentId,
        Math.max(20, options?.logLimit || 80)
      ),
    ]);
    detail = detailResult.deployment || null;
    logs =
      logsResult.deploymentLogs?.map((entry) => ({
        timestamp: toIso(entry.timestamp),
        message: asText(entry.message),
        severity: asText(entry.severity) || undefined,
      })).filter((entry) => entry.message) || [];
  }

  const activeStatus = asText(detail?.status) || selectedDeployment?.status || '';
  const latestUrl = toPublicUrl(detail?.url);
  const latestStaticUrl = toPublicUrl(detail?.staticUrl);
  const canDeploy = Boolean(binding.serviceId);
  const missingForDeploy = canDeploy ? [] : ['serviceId'];
  const domains = [
    ...(domainsResult.domains?.serviceDomains || []),
    ...(domainsResult.domains?.customDomains || []),
  ]
    .map((entry) => toPublicUrl(entry.domain) || '')
    .filter(Boolean);
  const resolvedStaticUrl = latestStaticUrl || domains[0] || undefined;

  return {
    configured: true,
    canDeploy,
    message: canDeploy ? undefined : buildMissingMessage(missingForDeploy),
    projectId: binding.projectId,
    projectName: asText(projectResult.project?.name) || binding.projectName,
    environmentId: binding.environmentId,
    environmentName: resolvedEnvironmentName || undefined,
    serviceId: binding.serviceId || undefined,
    serviceName: resolvedServiceName || undefined,
    deploymentId: selectedDeploymentId || undefined,
    latestStatus: activeStatus || undefined,
    latestUrl: latestUrl || undefined,
    latestStaticUrl: resolvedStaticUrl,
    activeDeploymentPending: DEPLOYMENT_TRANSIENT_STATUSES.has(activeStatus),
    domains,
    deployments: deployments.map((item) =>
      item.id === selectedDeploymentId
        ? {
            ...item,
            status: activeStatus || item.status,
            createdAt: toIso(detail?.createdAt) || item.createdAt,
            url: latestUrl || undefined,
            staticUrl: resolvedStaticUrl,
          }
        : item
    ),
    logs,
    missing: missingForDeploy,
  };
}

function requireBindingForAction(
  metadataRaw: Record<string, unknown>
): { binding: RailwayBinding; missing: string[] } {
  const metadata = pickRecord(metadataRaw);
  const resolved = resolveBinding(metadata);
  if (!resolved.binding) {
    throw new Error(buildMissingMessage(resolved.missing) || '部署未配置');
  }
  if (!resolved.binding.serviceId) {
    throw new Error(buildMissingMessage(['serviceId']));
  }
  return {
    binding: resolved.binding,
    missing: [],
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPublicProbeUrls(baseUrl: string, healthPath?: string): string[] {
  const normalizedBase = toPublicUrl(baseUrl)?.replace(/\/+$/, '');
  if (!normalizedBase) {
    return [];
  }

  const candidates = [
    healthPath,
    '/api/system/health',
    '/health',
    '/',
  ]
    .map((path) => {
      const normalizedPath = asText(path);
      if (!normalizedPath || normalizedPath === '/') {
        return `${normalizedBase}/`;
      }
      return `${normalizedBase}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
    })
    .filter(Boolean);

  return [...new Set(candidates)];
}

async function probePublicUrl(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
    });
    return response.status;
  } catch {
    return 0;
  }
}

export async function waitForRailwayDeploymentPublicReachability(
  input: {
    baseUrl?: string;
    healthPath?: string;
  },
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<{ url: string; status: number }> {
  const probeUrls = buildPublicProbeUrls(asText(input.baseUrl), input.healthPath);
  if (probeUrls.length === 0) {
    throw new Error('部署已完成，但未返回公网访问地址');
  }

  const timeoutMs = Math.max(5_000, options?.timeoutMs || 90_000);
  const pollIntervalMs = Math.max(1_000, options?.pollIntervalMs || 5_000);
  const deadline = Date.now() + timeoutMs;
  let lastStatuses: Array<{ url: string; status: number }> = [];

  while (Date.now() < deadline) {
    lastStatuses = [];
    for (const url of probeUrls) {
      const status = await probePublicUrl(url);
      lastStatuses.push({ url, status });
      if (status >= 200 && status < 400) {
        return { url, status };
      }
    }
    await sleep(pollIntervalMs);
  }

  const summary = lastStatuses
    .map((item) => `${item.url} -> ${item.status || 'unreachable'}`)
    .join(', ');
  throw new Error(`部署已完成，但公网地址尚未就绪: ${summary || 'no probe results'}`);
}

export async function waitForRailwayDeploymentAfterSourceSync(
  metadataRaw: Record<string, unknown>,
  options?: {
    since?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<RailwayDeploymentActionResult> {
  const { binding } = requireBindingForAction(metadataRaw);
  const since = Number.isFinite(options?.since) ? Number(options?.since) : Date.now();
  const timeoutMs = Math.max(5_000, options?.timeoutMs || 90_000);
  const pollIntervalMs = Math.max(1_000, options?.pollIntervalMs || 4_000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const deploymentsResult = await loadDeployments(binding);
    const deployments = normalizeDeploymentItems(
      deploymentsResult.deployments?.edges?.map((edge) => ({
        id: edge?.node?.id,
        status: edge?.node?.status,
        createdAt: edge?.node?.createdAt,
        serviceName: edge?.node?.service?.name,
      })) || [],
      binding.serviceName
    );

    const matchedDeployment = deployments.find((item) => {
      const createdAt = item.createdAt ? Date.parse(item.createdAt) : NaN;
      if (!Number.isFinite(createdAt)) return false;
      return createdAt >= since - 15_000;
    });

    if (matchedDeployment?.id) {
      return {
        action: 'deploy',
        deploymentId: matchedDeployment.id,
      };
    }

    await sleep(pollIntervalMs);
  }

  return {
    action: 'deploy',
  };
}

export async function triggerRailwayDeploy(
  metadataRaw: Record<string, unknown>
): Promise<RailwayDeploymentActionResult> {
  const { binding } = requireBindingForAction(metadataRaw);
  const result = await executeRailwayGraphql<{ serviceInstanceDeployV2?: string | null }>(
    binding.token,
    binding.tokenKind,
    `
      mutation RailwayDeployService($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }
    `,
    {
      serviceId: binding.serviceId,
      environmentId: binding.environmentId,
    }
  );

  return {
    action: 'deploy',
    deploymentId: asText(result.serviceInstanceDeployV2) || undefined,
  };
}

export async function triggerRailwayRedeploy(
  metadataRaw: Record<string, unknown>,
  deploymentId: string
): Promise<RailwayDeploymentActionResult> {
  const { binding } = requireBindingForAction(metadataRaw);
  const targetId = asText(deploymentId);
  if (!targetId) {
    throw new Error('缺少 deploymentId');
  }
  const result = await executeRailwayGraphql<{ deploymentRedeploy?: string | null }>(
    binding.token,
    binding.tokenKind,
    `
      mutation RailwayRedeploy($id: String!) {
        deploymentRedeploy(id: $id)
      }
    `,
    { id: targetId }
  );

  return {
    action: 'redeploy',
    deploymentId: asText(result.deploymentRedeploy) || targetId,
  };
}

export async function triggerRailwayRollback(
  metadataRaw: Record<string, unknown>,
  deploymentId: string
): Promise<RailwayDeploymentActionResult> {
  const { binding } = requireBindingForAction(metadataRaw);
  const targetId = asText(deploymentId);
  if (!targetId) {
    throw new Error('缺少 deploymentId');
  }
  const result = await executeRailwayGraphql<{ deploymentRollback?: string | null }>(
    binding.token,
    binding.tokenKind,
    `
      mutation RailwayRollback($id: String!) {
        deploymentRollback(id: $id)
      }
    `,
    { id: targetId }
  );

  return {
    action: 'rollback',
    deploymentId: asText(result.deploymentRollback) || targetId,
  };
}
