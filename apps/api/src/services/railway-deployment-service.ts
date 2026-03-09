const RAILWAY_GRAPHQL_ENDPOINT =
  process.env.RAILWAY_GRAPHQL_ENDPOINT || 'https://backboard.railway.app/graphql/v2';

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
};

export type RailwayDeploymentActionResult = {
  deploymentId?: string;
  action: 'deploy' | 'redeploy' | 'rollback';
};

type RailwayBinding = {
  token: string;
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

function buildMissingMessage(missing: string[]) {
  if (missing.length === 0) return '';
  return `Railway 部署未配置完整，缺少：${missing.join('、')}。请在 sandbox metadata.railway 或服务端环境变量中补齐。`;
}

function resolveBinding(metadata: Record<string, unknown>): {
  binding: RailwayBinding | null;
  missing: string[];
} {
  const railway = pickRecord(metadata.railway);
  const token = firstText(
    railway.projectToken,
    railway.token,
    railway.apiToken,
    metadata.railwayProjectToken,
    metadata.railwayToken,
    process.env.RAILWAY_PROJECT_TOKEN,
    process.env.RAILWAY_API_TOKEN,
    process.env.RAILWAY_ADMIN_TOKEN
  );
  const projectId = firstText(
    railway.projectId,
    metadata.railwayProjectId,
    process.env.RAILWAY_PROJECT_ID
  );
  const environmentId = firstText(
    railway.environmentId,
    metadata.railwayEnvironmentId,
    process.env.RAILWAY_ENVIRONMENT_ID
  );
  const serviceId = firstText(
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
      projectId,
      environmentId,
      serviceId,
      projectName: firstText(railway.projectName, metadata.railwayProjectName),
      environmentName: firstText(railway.environmentName, metadata.railwayEnvironmentName),
      serviceName: firstText(railway.serviceName, metadata.railwayServiceName, process.env.RAILWAY_SERVICE_NAME),
      lastDeploymentId: firstText(railway.lastDeploymentId, metadata.railwayLastDeploymentId),
    },
    missing: serviceId ? [] : ['serviceId'],
  };
}

async function executeRailwayGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: variables || {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Railway request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = firstText(payload.errors[0]?.message) || 'Railway GraphQL 请求失败';
    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error('Railway 响应为空');
  }

  return payload.data;
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
          meta?: {
            commitMessage?: string;
            commitAuthor?: string;
          } | null;
          service?: {
            name?: string;
          } | null;
        };
      }>;
    } | null;
  }>(
    binding.token,
    `
      query RailwayDeployments($input: DeploymentListInput, $first: Int) {
        deployments(input: $input, first: $first) {
          edges {
            node {
              id
              status
              createdAt
              meta {
                ... on GithubMeta {
                  commitMessage
                  commitAuthor
                }
              }
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

async function loadDeploymentDetail(token: string, deploymentId: string) {
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

async function loadDeploymentLogs(token: string, deploymentId: string, limit: number) {
  return executeRailwayGraphql<{
    deploymentLogs?: Array<{
      timestamp?: string;
      message?: string;
      severity?: string;
    }>;
  }>(
    token,
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
  options?: { deploymentId?: string; logLimit?: number }
): Promise<RailwayDeploymentPanelData> {
  const metadata = pickRecord(metadataRaw);
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
    deploymentsResult.deployments?.edges?.map((edge) => ({
      id: edge?.node?.id,
      status: edge?.node?.status,
      createdAt: edge?.node?.createdAt,
      serviceName: edge?.node?.service?.name,
      commitMessage: edge?.node?.meta?.commitMessage,
      commitAuthor: edge?.node?.meta?.commitAuthor,
    })) || [],
    resolvedServiceName
  );

  const selectedDeploymentId =
    firstText(options?.deploymentId, binding.lastDeploymentId) ||
    deployments[0]?.id ||
    '';
  const selectedDeployment = selectedDeploymentId
    ? deployments.find((item) => item.id === selectedDeploymentId) || null
    : null;

  let detail: Awaited<ReturnType<typeof loadDeploymentDetail>>['deployment'] | null = null;
  let logs: RailwayDeploymentLogEntry[] = [];

  if (selectedDeploymentId) {
    const [detailResult, logsResult] = await Promise.all([
      loadDeploymentDetail(binding.token, selectedDeploymentId),
      loadDeploymentLogs(binding.token, selectedDeploymentId, Math.max(20, options?.logLimit || 80)),
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
  const latestUrl = firstText(detail?.url);
  const latestStaticUrl = firstText(detail?.staticUrl);
  const canDeploy = Boolean(binding.serviceId);
  const missingForDeploy = canDeploy ? [] : ['serviceId'];
  const domains = [
    ...(domainsResult.domains?.serviceDomains || []),
    ...(domainsResult.domains?.customDomains || []),
  ]
    .map((entry) => asText(entry.domain))
    .filter(Boolean);

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
    latestStaticUrl: latestStaticUrl || undefined,
    activeDeploymentPending: DEPLOYMENT_TRANSIENT_STATUSES.has(activeStatus),
    domains,
    deployments: deployments.map((item) =>
      item.id === selectedDeploymentId
        ? {
            ...item,
            status: activeStatus || item.status,
            createdAt: toIso(detail?.createdAt) || item.createdAt,
            url: latestUrl || undefined,
            staticUrl: latestStaticUrl || undefined,
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
    throw new Error(buildMissingMessage(resolved.missing) || 'Railway 部署未配置');
  }
  if (!resolved.binding.serviceId) {
    throw new Error(buildMissingMessage(['serviceId']));
  }
  return {
    binding: resolved.binding,
    missing: [],
  };
}

export async function triggerRailwayDeploy(
  metadataRaw: Record<string, unknown>
): Promise<RailwayDeploymentActionResult> {
  const { binding } = requireBindingForAction(metadataRaw);
  const result = await executeRailwayGraphql<{ serviceInstanceDeployV2?: string | null }>(
    binding.token,
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
