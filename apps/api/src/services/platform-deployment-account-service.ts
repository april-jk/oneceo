import { createHash } from 'node:crypto';

import { userConnectorAccountDAO } from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import { requestRailwayGraphql, type RailwayAuthKind } from './railway-graphql-client';

const INTERNAL_DEPLOYMENT_CONNECTOR_KEY = 'railway_internal';
const INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY = 'railway_internal_project';
const DEFAULT_DEPLOYMENT_PROJECT_KEY = 'default';

type DeploymentSecret = {
  accessToken: string;
  tokenKind?: 'project';
  tokenId?: string;
  tokenRotatedAt?: string;
};

type DeploymentConfig = {
  provider: 'platform_managed';
  supplier: 'railway';
  projectKey?: string;
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  serviceDomain?: string;
  tokenId?: string;
  tokenRotatedAt?: string;
  createdAt?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  githubRepoFullName?: string;
  githubRepoUrl?: string;
  githubDefaultBranch?: string;
  databaseServiceId?: string;
  databaseServiceName?: string;
  databaseVolumeId?: string;
  databaseVolumeName?: string;
};

type DeploymentAccountRow = {
  userId: string;
  connectorKey?: string;
  configJson: unknown;
  secretCiphertext: string | null;
  updatedAt?: Date | null;
};

type UserRailwayProjectConfig = {
  provider: 'platform_managed';
  supplier: 'railway';
  projectId: string;
  projectName?: string;
  workspaceId?: string;
  createdAt?: string;
};

export type UserRailwayProject = {
  userId: string;
  projectId: string;
  projectName?: string;
  workspaceId?: string;
  createdAt?: string;
};

export type UserPlatformDeploymentAccount = {
  userId: string;
  projectKey: string;
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  serviceDomain?: string;
  accessToken: string;
  tokenKind: 'project';
  tokenId?: string;
  tokenRotatedAt?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  githubRepoFullName?: string;
  githubRepoUrl?: string;
  githubDefaultBranch?: string;
  databaseServiceId?: string;
  databaseServiceName?: string;
  databaseVolumeId?: string;
  databaseVolumeName?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requireEnv(name: string): string {
  const value = asText(process.env[name]);
  if (!value) {
    throw new Error(`${name} 未配置，平台部署不可用`);
  }
  return value;
}

function isRailwayProjectNotFoundError(message: string) {
  return asText(message).toLowerCase().includes('project not found');
}

function isRailwayServiceCreationLimitError(message: string) {
  const normalized = asText(message).toLowerCase();
  return (
    normalized.includes('service creation limit') ||
    normalized.includes('25 services per day') ||
    normalized.includes('daily service creation limit')
  );
}

function sanitizeNameSegment(value: string, maxLength: number) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength) || 'item'
  );
}

function sanitizeUserTokenSegment(userId: string) {
  return sanitizeNameSegment(userId, 32) || 'user';
}

function normalizeProjectKey(projectKey: string | undefined | null): string {
  const normalized = asText(projectKey) || DEFAULT_DEPLOYMENT_PROJECT_KEY;
  return sanitizeNameSegment(normalized, 48) || DEFAULT_DEPLOYMENT_PROJECT_KEY;
}

function buildInternalDeploymentConnectorKey(projectKey?: string) {
  const normalized = normalizeProjectKey(projectKey);
  return normalized === DEFAULT_DEPLOYMENT_PROJECT_KEY
    ? INTERNAL_DEPLOYMENT_CONNECTOR_KEY
    : `${INTERNAL_DEPLOYMENT_CONNECTOR_KEY}:${normalized}`;
}

function buildUserProjectName(userId: string) {
  const prefix = sanitizeNameSegment(
    asText(process.env.RAILWAY_DEPLOYMENT_PROJECT_PREFIX) || 'oneceo',
    18
  );
  const userSegment = sanitizeNameSegment(userId, 12);
  const userHash = createHash('sha1').update(userId).digest('hex').slice(0, 8);
  return `${prefix}-${userSegment}-${userHash}`.slice(0, 32);
}

function buildEnvironmentName(projectKey = DEFAULT_DEPLOYMENT_PROJECT_KEY) {
  const prefix = sanitizeNameSegment(
    asText(process.env.RAILWAY_DEPLOYMENT_ENVIRONMENT_PREFIX) || 'app',
    12
  );
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  const projectSegment = sanitizeNameSegment(normalizedProjectKey, 12);
  const projectHash = createHash('sha1').update(normalizedProjectKey).digest('hex').slice(0, 6);
  return `${prefix}-${projectSegment}-${projectHash}`.slice(0, 32);
}

function buildServiceName(projectKey = DEFAULT_DEPLOYMENT_PROJECT_KEY) {
  const prefix = sanitizeNameSegment(
    asText(process.env.RAILWAY_DEPLOYMENT_SERVICE_NAME) || 'app',
    12
  );
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  if (normalizedProjectKey === DEFAULT_DEPLOYMENT_PROJECT_KEY) {
    return prefix;
  }
  const projectSegment = sanitizeNameSegment(normalizedProjectKey, 12);
  const projectHash = createHash('sha1').update(normalizedProjectKey).digest('hex').slice(0, 6);
  return `${prefix}-${projectSegment}-${projectHash}`.slice(0, 32);
}

function buildDatabaseServiceName(projectKey = DEFAULT_DEPLOYMENT_PROJECT_KEY) {
  const prefix = sanitizeNameSegment(
    asText(process.env.RAILWAY_DATABASE_SERVICE_NAME) || 'postgres',
    12
  );
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  if (normalizedProjectKey === DEFAULT_DEPLOYMENT_PROJECT_KEY) {
    return prefix;
  }
  const projectSegment = sanitizeNameSegment(normalizedProjectKey, 12);
  const projectHash = createHash('sha1').update(normalizedProjectKey).digest('hex').slice(0, 6);
  return `${prefix}-${projectSegment}-${projectHash}`.slice(0, 32);
}

function toDeploymentConfig(value: unknown): DeploymentConfig {
  const record = pickRecord(value);
  return {
    provider: 'platform_managed',
    supplier: 'railway',
    projectKey: normalizeProjectKey(asText(record.projectKey) || DEFAULT_DEPLOYMENT_PROJECT_KEY),
    projectId: asText(record.projectId),
    projectName: asText(record.projectName) || undefined,
    environmentId: asText(record.environmentId),
    environmentName: asText(record.environmentName) || undefined,
    serviceId: asText(record.serviceId),
    serviceName: asText(record.serviceName) || undefined,
    serviceDomain: asText(record.serviceDomain) || undefined,
    tokenId: asText(record.tokenId) || undefined,
    tokenRotatedAt: asText(record.tokenRotatedAt) || undefined,
    createdAt: asText(record.createdAt) || undefined,
    githubRepoOwner: asText(record.githubRepoOwner) || undefined,
    githubRepoName: asText(record.githubRepoName) || undefined,
    githubRepoFullName: asText(record.githubRepoFullName) || undefined,
    githubRepoUrl: asText(record.githubRepoUrl) || undefined,
    githubDefaultBranch: asText(record.githubDefaultBranch) || undefined,
    databaseServiceId: asText(record.databaseServiceId) || undefined,
    databaseServiceName: asText(record.databaseServiceName) || undefined,
    databaseVolumeId: asText(record.databaseVolumeId) || undefined,
    databaseVolumeName: asText(record.databaseVolumeName) || undefined,
  };
}

function toUserRailwayProjectConfig(value: unknown): UserRailwayProjectConfig {
  const record = pickRecord(value);
  return {
    provider: 'platform_managed',
    supplier: 'railway',
    projectId: asText(record.projectId),
    projectName: asText(record.projectName) || undefined,
    workspaceId: asText(record.workspaceId) || undefined,
    createdAt: asText(record.createdAt) || undefined,
  };
}

async function executeRailwayGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
  options?: { authKind?: RailwayAuthKind }
): Promise<T> {
  try {
    return await requestRailwayGraphql<T>(
      {
        token,
        kind: options?.authKind || 'bearer',
      },
      query,
      variables
    );
  } catch (error: any) {
    const message = asText(error?.message) || '平台部署 GraphQL 请求失败';
    if (message.includes('User does not have access to the repo')) {
      throw new Error(
        [
          'Railway 当前无权访问目标 GitHub 仓库。',
          '请先在 Railway 账号中完成 GitHub 绑定，并到 `General Settings -> Account Integrations -> GitHub -> Edit Scope` 授予仓库访问范围；',
          '如果仓库位于 `oneceo-deploy-env` 组织下，还需要在 GitHub 为 Railway 安装其 GitHub App：`https://github.com/apps/railway-app/installations/new`。',
        ].join('')
      );
    }
    throw new Error(message);
  }
}

async function createUserRailwayProject(adminToken: string, userId: string) {
  const workspaceId = requireEnv('RAILWAY_WORKSPACE_ID');
  const projectName = buildUserProjectName(userId);
  const existing = await executeRailwayGraphql<{
    projects?: {
      edges?: Array<{
        node?: {
          id?: string;
          name?: string;
        };
      }>;
    } | null;
  }>(
    adminToken,
    `
      query FindUserPlatformProject($workspaceId: String!) {
        projects(workspaceId: $workspaceId) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `,
    {
      workspaceId,
    }
  );

  const existingProject = existing.projects?.edges
    ?.map((edge) => ({
      id: asText(edge?.node?.id),
      name: asText(edge?.node?.name),
    }))
    .find((item) => item.id && item.name === projectName);

  if (existingProject?.id) {
    return {
      projectId: existingProject.id,
      projectName: existingProject.name,
      workspaceId,
    };
  }

  const result = await executeRailwayGraphql<{
    projectCreate?: {
      id?: string;
      name?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation CreateUserPlatformProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: {
        name: projectName,
        workspaceId,
        description: `OneCEO managed deployment project for user ${userId}`,
        isPublic: false,
        prDeploys: false,
      },
    }
  );

  const projectId = asText(result.projectCreate?.id);
  if (!projectId) {
    throw new Error('创建用户固定部署项目失败');
  }
  return {
    projectId,
    projectName: asText(result.projectCreate?.name) || projectName,
    workspaceId,
  };
}

async function getProjectById(adminToken: string, projectId: string) {
  const result = await executeRailwayGraphql<{
    project?: {
      id?: string;
      name?: string;
    } | null;
  }>(
    adminToken,
    `
      query GetPlatformProjectById($id: String!) {
        project(id: $id) {
          id
          name
        }
      }
    `,
    {
      id: projectId,
    }
  );

  return {
    id: asText(result.project?.id),
    name: asText(result.project?.name),
  };
}

async function getProjectEnvironmentByName(
  adminToken: string,
  projectId: string,
  environmentName: string
) {
  const result = await executeRailwayGraphql<{
    project?: {
      environments?: {
        edges?: Array<{
          node?: {
            id?: string;
            name?: string;
          };
        }>;
      };
    } | null;
  }>(
    adminToken,
    `
      query FindProjectEnvironmentByName($projectId: String!) {
        project(id: $projectId) {
          environments {
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
    {
      projectId,
    }
  );

  return (
    result.project?.environments?.edges
      ?.map((edge) => ({
        id: asText(edge?.node?.id),
        name: asText(edge?.node?.name),
      }))
      .find((item) => item.id && item.name === environmentName) || null
  );
}

async function ensureProjectEnvironment(
  adminToken: string,
  projectId: string,
  projectKey: string
) {
  const environmentName = buildEnvironmentName(projectKey);
  const existing = await getProjectEnvironmentByName(adminToken, projectId, environmentName);
  if (existing?.id) {
    return {
      environmentId: existing.id,
      environmentName: existing.name || environmentName,
    };
  }

  const result = await executeRailwayGraphql<{
    environmentCreate?: {
      id?: string;
      name?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation CreateProjectEnvironment($input: EnvironmentCreateInput!) {
        environmentCreate(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: {
        projectId,
        name: environmentName,
      },
    }
  );

  const environmentId = asText(result.environmentCreate?.id);
  if (!environmentId) {
    throw new Error('创建项目环境失败');
  }
  return {
    environmentId,
    environmentName: asText(result.environmentCreate?.name) || environmentName,
  };
}

async function createService(
  adminToken: string,
  projectId: string,
  projectKey = DEFAULT_DEPLOYMENT_PROJECT_KEY
) {
  const serviceName = buildServiceName(projectKey);
  const existing = await executeRailwayGraphql<{
    project?: {
      services?: {
        edges?: Array<{
          node?: {
            id?: string;
            name?: string;
          };
        }>;
      };
    } | null;
  }>(
    adminToken,
    `
      query FindPlatformService($projectId: String!) {
        project(id: $projectId) {
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
    {
      projectId,
    }
  );

  const existingService = existing.project?.services?.edges
    ?.map((edge) => ({
      id: asText(edge?.node?.id),
      name: asText(edge?.node?.name),
    }))
    .find((item) => item.id && item.name === serviceName);

  if (existingService?.id) {
    return {
      serviceId: existingService.id,
      serviceName: existingService.name,
    };
  }

  const result = await executeRailwayGraphql<{
    serviceCreate?: {
      id?: string;
      name?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation CreatePlatformService($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }
    `,
    {
      input: {
        name: serviceName,
        projectId,
      },
    }
  );

  const serviceId = asText(result.serviceCreate?.id);
  if (!serviceId) {
    throw new Error('创建用户部署服务失败');
  }
  return {
    serviceId,
    serviceName: asText(result.serviceCreate?.name) || serviceName,
  };
}

async function configureServiceInstance(
  adminToken: string,
  environmentId: string,
  serviceId: string
) {
  const buildCommand = asText(process.env.RAILWAY_DEPLOYMENT_BUILD_COMMAND);
  const startCommand = asText(process.env.RAILWAY_DEPLOYMENT_START_COMMAND);
  const rootDirectory = asText(process.env.RAILWAY_DEPLOYMENT_ROOT_DIRECTORY);
  const healthcheckPath = asText(process.env.RAILWAY_DEPLOYMENT_HEALTHCHECK_PATH);
  const builder = asText(process.env.RAILWAY_DEPLOYMENT_BUILDER) || 'NIXPACKS';

  await executeRailwayGraphql(
    adminToken,
    `
      mutation ConfigurePlatformService(
        $serviceId: String!,
        $environmentId: String!,
        $input: ServiceInstanceUpdateInput!
      ) {
        serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
      }
    `,
    {
      serviceId,
      environmentId,
      input: {
        builder,
        buildCommand: buildCommand || undefined,
        startCommand: startCommand || undefined,
        rootDirectory: rootDirectory || undefined,
        healthcheckPath: healthcheckPath || undefined,
      },
    }
  );
}

async function ensureServiceDomain(
  adminToken: string,
  projectId: string,
  environmentId: string,
  serviceId: string
) {
  const targetPort = Number.parseInt(asText(process.env.RAILWAY_DEPLOYMENT_TARGET_PORT) || '8080', 10);
  const domains = await executeRailwayGraphql<{
    domains?: {
      serviceDomains?: Array<{
        id?: string;
        domain?: string;
        targetPort?: number;
      }>;
    } | null;
  }>(
    adminToken,
    `
      query FindServiceDomains($projectId: String!, $serviceId: String!, $environmentId: String!) {
        domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          serviceDomains {
            id
            domain
            targetPort
          }
        }
      }
    `,
    {
      projectId,
      serviceId,
      environmentId,
    }
  );

  const existingDomain = domains.domains?.serviceDomains
    ?.map((entry) => ({
      id: asText(entry.id),
      domain: asText(entry.domain),
      targetPort:
        typeof entry.targetPort === 'number' && Number.isFinite(entry.targetPort)
          ? entry.targetPort
          : undefined,
    }))
    .find((entry) => entry.id && entry.domain);

  if (existingDomain?.id) {
    if (existingDomain.targetPort === targetPort) {
      return existingDomain.domain;
    }

    const updated = await executeRailwayGraphql<{
      serviceDomainUpdate?: {
        id?: string;
        domain?: string;
      } | null;
    }>(
      adminToken,
      `
        mutation UpdateServiceDomain($input: ServiceDomainUpdateInput!) {
          serviceDomainUpdate(input: $input) {
            id
            domain
          }
        }
      `,
      {
        input: {
          serviceDomainId: existingDomain.id,
          serviceId,
          environmentId,
          domain: existingDomain.domain,
          targetPort: Number.isFinite(targetPort) ? targetPort : 8080,
        },
      }
    );

    return asText(updated.serviceDomainUpdate?.domain) || existingDomain.domain;
  }

  const created = await executeRailwayGraphql<{
    serviceDomainCreate?: {
      id?: string;
      domain?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation CreateServiceDomain($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          id
          domain
        }
      }
    `,
    {
      input: {
        serviceId,
        environmentId,
        targetPort: Number.isFinite(targetPort) ? targetPort : 8080,
      },
    }
  );

  return asText(created.serviceDomainCreate?.domain) || undefined;
}

async function createProjectToken(
  adminToken: string,
  userId: string,
  projectId: string,
  environmentId: string,
  projectKey = DEFAULT_DEPLOYMENT_PROJECT_KEY
) {
  const result = await executeRailwayGraphql<{
    projectTokenCreate?: string | null;
  }>(
    adminToken,
    `
      mutation CreatePlatformProjectToken($input: ProjectTokenCreateInput!) {
        projectTokenCreate(input: $input)
      }
    `,
    {
      input: {
        name: `token-${sanitizeUserTokenSegment(userId)}-${normalizeProjectKey(projectKey).slice(0, 12)}`,
        projectId,
        environmentId,
      },
    }
  );

  const token = asText(result.projectTokenCreate);
  if (!token) {
    throw new Error('创建用户部署访问凭证失败');
  }
  return {
    token,
    tokenId: undefined,
  };
}

async function getProjectService(adminToken: string, projectId: string, serviceName: string) {
  const result = await executeRailwayGraphql<{
    project?: {
      services?: {
        edges?: Array<{
          node?: {
            id?: string;
            name?: string;
          };
        }>;
      };
    } | null;
  }>(
    adminToken,
    `
      query FindProjectServiceByName($projectId: String!) {
        project(id: $projectId) {
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
    {
      projectId,
    }
  );

  return (
    result.project?.services?.edges
      ?.map((edge) => ({
        id: asText(edge?.node?.id),
        name: asText(edge?.node?.name),
      }))
      .find((item) => item.id && item.name === serviceName) || null
  );
}

async function getPostgresTemplate(adminToken: string) {
  const result = await executeRailwayGraphql<{
    template?: {
      id?: string;
      serializedConfig?: unknown;
    } | null;
  }>(
    adminToken,
    `
      query GetPostgresTemplate {
        template(code: "postgres") {
          id
          serializedConfig
        }
      }
    `
  );

  const templateId = asText(result.template?.id);
  if (!templateId || !result.template?.serializedConfig) {
    throw new Error('获取 Railway Postgres 模板失败');
  }
  return {
    templateId,
    serializedConfig: result.template.serializedConfig,
  };
}

async function deployPostgresTemplate(
  adminToken: string,
  projectId: string,
  environmentId: string
) {
  const template = await getPostgresTemplate(adminToken);
  await executeRailwayGraphql<{
    templateDeployV2?: {
      workflowId?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation DeployPostgresTemplate($input: TemplateDeployV2Input!) {
        templateDeployV2(input: $input) {
          workflowId
        }
      }
    `,
    {
      input: {
        templateId: template.templateId,
        projectId,
        environmentId,
        serializedConfig: template.serializedConfig,
      },
    }
  );
}

async function getServiceVariables(
  token: string,
  projectId: string,
  environmentId: string,
  serviceId: string
) {
  const result = await executeRailwayGraphql<{
    variables?: Record<string, unknown> | null;
  }>(
    token,
    `
      query GetServiceVariables(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!
      ) {
        variables(
          projectId: $projectId,
          environmentId: $environmentId,
          serviceId: $serviceId
        )
      }
    `,
    {
      projectId,
      environmentId,
      serviceId,
    }
  );

  return pickRecord(result.variables);
}

async function waitForDatabaseService(
  adminToken: string,
  projectId: string,
  environmentId: string
) {
  const databaseServiceName = buildDatabaseServiceName();
  const deadline = Date.now() + 120_000;
  let lastServiceId = '';

  while (Date.now() < deadline) {
    const service = await getProjectService(adminToken, projectId, databaseServiceName);
    if (service?.id) {
      lastServiceId = service.id;
      const variables = await getServiceVariables(adminToken, projectId, environmentId, service.id);
      const publicUrl = asText(variables.DATABASE_PUBLIC_URL);
      if (publicUrl) {
        return {
          serviceId: service.id,
          serviceName: service.name || databaseServiceName,
          variables,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }

  if (lastServiceId) {
    const variables = await getServiceVariables(adminToken, projectId, environmentId, lastServiceId);
    return {
      serviceId: lastServiceId,
      serviceName: databaseServiceName,
      variables,
    };
  }

  throw new Error('等待 PostgreSQL 服务准备超时');
}

async function wireApplicationDatabaseVariables(
  adminToken: string,
  projectId: string,
  environmentId: string,
  applicationServiceId: string,
  databaseServiceName: string
) {
  const reference = (name: string) => `\${{${databaseServiceName}.${name}}}`;
  await executeRailwayGraphql(
    adminToken,
    `
      mutation AttachDatabaseVariables($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `,
    {
      input: {
        projectId,
        environmentId,
        serviceId: applicationServiceId,
        skipDeploys: true,
        replace: false,
        variables: {
          DATABASE_URL: reference('DATABASE_URL'),
          DATABASE_PUBLIC_URL: reference('DATABASE_PUBLIC_URL'),
          PGHOST: reference('PGHOST'),
          PGPORT: reference('PGPORT'),
          PGUSER: reference('PGUSER'),
          PGPASSWORD: reference('PGPASSWORD'),
          PGDATABASE: reference('PGDATABASE'),
        },
      },
    }
  );
}

async function upsertServiceVariables(
  adminToken: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  variables: Record<string, string>,
  options?: {
    replace?: boolean;
    skipDeploys?: boolean;
  }
) {
  const entries = Object.entries(variables).filter(([, value]) => asText(value));
  if (entries.length === 0) {
    return;
  }

  await executeRailwayGraphql(
    adminToken,
    `
      mutation UpsertPlatformServiceVariables($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        skipDeploys: options?.skipDeploys ?? true,
        replace: options?.replace ?? false,
        variables: Object.fromEntries(entries),
      },
    }
  );
}

function buildConfigFromState(input: {
  current?: DeploymentConfig;
  projectKey?: string;
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  serviceDomain?: string;
  repo?: {
    owner?: string;
    name?: string;
    fullName?: string;
    htmlUrl?: string;
    defaultBranch?: string;
  } | null;
  tokenId?: string;
  tokenRotatedAt?: string;
  createdAt?: string;
  databaseServiceId?: string;
  databaseServiceName?: string;
  databaseVolumeId?: string;
  databaseVolumeName?: string;
}): DeploymentConfig {
  return {
    provider: 'platform_managed',
    supplier: 'railway',
    projectKey: normalizeProjectKey(input.projectKey || input.current?.projectKey),
    projectId: input.projectId,
    projectName: input.projectName,
    environmentId: input.environmentId,
    environmentName: input.environmentName,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    serviceDomain: input.serviceDomain || input.current?.serviceDomain,
    tokenId: input.tokenId || input.current?.tokenId,
    tokenRotatedAt: input.tokenRotatedAt || input.current?.tokenRotatedAt,
    createdAt: input.current?.createdAt || input.createdAt || new Date().toISOString(),
    githubRepoOwner: asText(input.repo?.owner) || input.current?.githubRepoOwner,
    githubRepoName: asText(input.repo?.name) || input.current?.githubRepoName,
    githubRepoFullName: asText(input.repo?.fullName) || input.current?.githubRepoFullName,
    githubRepoUrl: asText(input.repo?.htmlUrl) || input.current?.githubRepoUrl,
    githubDefaultBranch:
      asText(input.repo?.defaultBranch) || input.current?.githubDefaultBranch || 'main',
    databaseServiceId: input.databaseServiceId || input.current?.databaseServiceId,
    databaseServiceName: input.databaseServiceName || input.current?.databaseServiceName,
    databaseVolumeId: input.databaseVolumeId || input.current?.databaseVolumeId,
    databaseVolumeName: input.databaseVolumeName || input.current?.databaseVolumeName,
  };
}

function toAccount(row: DeploymentAccountRow | null): UserPlatformDeploymentAccount | null {
  if (!row) return null;
  const config = toDeploymentConfig(row.configJson);
  const secret = row.secretCiphertext
    ? connectorSecretService.decryptJson<DeploymentSecret>(row.secretCiphertext)
    : null;
  const accessToken = asText(secret?.accessToken);
  if (!accessToken || !config.projectId || !config.environmentId || !config.serviceId) {
    return null;
  }
  return {
    userId: row.userId,
    projectKey: config.projectKey || DEFAULT_DEPLOYMENT_PROJECT_KEY,
    projectId: config.projectId,
    projectName: config.projectName,
    environmentId: config.environmentId,
    environmentName: config.environmentName,
    serviceId: config.serviceId,
    serviceName: config.serviceName,
    serviceDomain: config.serviceDomain,
    accessToken,
    tokenKind: 'project',
    tokenId: asText(secret?.tokenId || config.tokenId) || undefined,
    tokenRotatedAt: asText(secret?.tokenRotatedAt || config.tokenRotatedAt) || undefined,
    githubRepoOwner: config.githubRepoOwner,
    githubRepoName: config.githubRepoName,
    githubRepoFullName: config.githubRepoFullName,
    githubRepoUrl: config.githubRepoUrl,
    githubDefaultBranch: config.githubDefaultBranch,
    databaseServiceId: config.databaseServiceId,
    databaseServiceName: config.databaseServiceName,
    databaseVolumeId: config.databaseVolumeId,
    databaseVolumeName: config.databaseVolumeName,
  };
}

function toUserRailwayProject(row: DeploymentAccountRow | null): UserRailwayProject | null {
  if (!row) return null;
  const config = toUserRailwayProjectConfig(row.configJson);
  if (!config.projectId) {
    return null;
  }
  return {
    userId: row.userId,
    projectId: config.projectId,
    projectName: config.projectName,
    workspaceId: config.workspaceId,
    createdAt: config.createdAt,
  };
}

export class PlatformDeploymentAccountService {
  private inflight = new Map<string, Promise<UserPlatformDeploymentAccount>>();

  private buildInflightKey(userId: string, projectKey?: string) {
    return `${asText(userId)}:${normalizeProjectKey(projectKey)}`;
  }

  private async getAccountRow(
    userId: string,
    projectKey = DEFAULT_DEPLOYMENT_PROJECT_KEY,
    options?: { allowLegacyFallback?: boolean }
  ): Promise<DeploymentAccountRow | null> {
    await connectorStorageBootstrap.ensureReady();
    const connectorKey = buildInternalDeploymentConnectorKey(projectKey);
    const row = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, connectorKey);
    if (row) {
      return row as DeploymentAccountRow;
    }
    if (options?.allowLegacyFallback && normalizeProjectKey(projectKey) !== DEFAULT_DEPLOYMENT_PROJECT_KEY) {
      const legacyRow = await userConnectorAccountDAO.getByUserAndConnectorKey(
        userId,
        INTERNAL_DEPLOYMENT_CONNECTOR_KEY
      );
      return (legacyRow as DeploymentAccountRow | null) || null;
    }
    return null;
  }

  private async getUserProjectRow(userId: string): Promise<DeploymentAccountRow | null> {
    await connectorStorageBootstrap.ensureReady();
    const row = await userConnectorAccountDAO.getByUserAndConnectorKey(
      userId,
      INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY
    );
    return (row as DeploymentAccountRow | null) || null;
  }

  private async persistAccountRow(
    userId: string,
    config: DeploymentConfig,
    secretCiphertext: string | null,
    displayName = '平台部署'
  ) {
    const normalizedProjectKey = normalizeProjectKey(config.projectKey);
    await userConnectorAccountDAO.upsert({
      userId,
      connectorKey: buildInternalDeploymentConnectorKey(normalizedProjectKey),
      authMode: 'token',
      authStatus: secretCiphertext ? 'authorized' : 'needs_auth',
      displayName:
        normalizedProjectKey === DEFAULT_DEPLOYMENT_PROJECT_KEY
          ? displayName
          : `${displayName} (${normalizedProjectKey})`,
      configJson: config,
      secretCiphertext,
      lastAuthAt: secretCiphertext ? new Date() : null,
      lastError: null,
    });
  }

  private async persistUserProjectRow(userId: string, config: UserRailwayProjectConfig) {
    await userConnectorAccountDAO.upsert({
      userId,
      connectorKey: INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY,
      authMode: 'token',
      authStatus: 'authorized',
      displayName: '平台部署项目',
      configJson: config,
      secretCiphertext: null,
      lastAuthAt: new Date(),
      lastError: null,
    });
  }

  private async listReusableAccountRows(
    userId: string,
    options?: {
      excludeProjectKey?: string;
      projectId?: string;
    }
  ): Promise<DeploymentAccountRow[]> {
    await connectorStorageBootstrap.ensureReady();
    const rows = (await userConnectorAccountDAO.listByUserId(userId)) as DeploymentAccountRow[];
    const excludedKey = buildInternalDeploymentConnectorKey(options?.excludeProjectKey);
    return rows
      .filter((row) => {
        const connectorKey = asText(row.connectorKey);
        if (!connectorKey || connectorKey === INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY) {
          return false;
        }
        if (
          connectorKey !== INTERNAL_DEPLOYMENT_CONNECTOR_KEY &&
          !connectorKey.startsWith(`${INTERNAL_DEPLOYMENT_CONNECTOR_KEY}:`)
        ) {
          return false;
        }
        if (excludedKey && connectorKey === excludedKey) {
          return false;
        }
        const config = toDeploymentConfig(row.configJson);
        if (!config.serviceId || !config.environmentId || !config.projectId) {
          return false;
        }
        if (options?.projectId && config.projectId !== options.projectId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const leftTime = left.updatedAt instanceof Date ? left.updatedAt.getTime() : 0;
        const rightTime = right.updatedAt instanceof Date ? right.updatedAt.getTime() : 0;
        return rightTime - leftTime;
      });
  }

  private async reuseExistingServiceSlot(input: {
    userId: string;
    projectKey: string;
    projectId: string;
    projectName?: string;
    displayName?: string;
  }): Promise<UserPlatformDeploymentAccount> {
    const candidates = await this.listReusableAccountRows(input.userId, {
      excludeProjectKey: input.projectKey,
      projectId: input.projectId,
    });
    if (candidates.length === 0) {
      throw new Error('Railway 已达到每日服务创建配额，且当前账号没有可复用的既有部署服务。');
    }

    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    let lastError: unknown = null;

    for (const candidate of candidates) {
      const config = toDeploymentConfig(candidate.configJson);
      if (!config.serviceId || !config.environmentId || !config.projectId) {
        continue;
      }

      try {
        const reusedEnvironmentId = config.environmentId;
        const reusedEnvironmentName = config.environmentName || undefined;

        await configureServiceInstance(adminToken, reusedEnvironmentId, config.serviceId);
        const serviceDomain = await ensureServiceDomain(
          adminToken,
          config.projectId,
          reusedEnvironmentId,
          config.serviceId
        );
        const tokenRotatedAt = new Date().toISOString();
        const projectToken = await createProjectToken(
          adminToken,
          input.userId,
          config.projectId,
          reusedEnvironmentId,
          input.projectKey
        );

        await this.persistAccountRow(
          input.userId,
          buildConfigFromState({
            projectKey: input.projectKey,
            projectId: config.projectId,
            projectName: input.projectName || config.projectName,
            environmentId: reusedEnvironmentId,
            environmentName: reusedEnvironmentName,
            serviceId: config.serviceId,
            serviceName: config.serviceName,
            serviceDomain,
            tokenId: projectToken.tokenId,
            tokenRotatedAt,
            createdAt: new Date().toISOString(),
            databaseServiceId: config.databaseServiceId,
            databaseServiceName: config.databaseServiceName,
            databaseVolumeId: config.databaseVolumeId,
            databaseVolumeName: config.databaseVolumeName,
          }),
          connectorSecretService.encrypt({
            accessToken: projectToken.token,
            tokenKind: 'project',
            tokenId: projectToken.tokenId,
            tokenRotatedAt,
          } satisfies DeploymentSecret),
          input.displayName
        );

        const account = await this.getProjectAccount(input.userId, input.projectKey);
        if (account) {
          return account;
        }
      } catch (error: any) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('Railway 已达到每日服务创建配额，且复用既有部署服务失败。');
  }

  async getUserAccount(userId: string): Promise<UserPlatformDeploymentAccount | null> {
    const row = await this.getAccountRow(userId, DEFAULT_DEPLOYMENT_PROJECT_KEY);
    return toAccount(row);
  }

  async getUserProject(userId: string): Promise<UserRailwayProject | null> {
    const row = await this.getUserProjectRow(userId);
    if (row) {
      return toUserRailwayProject(row);
    }

    const legacyDefaultRow = await this.getAccountRow(userId, DEFAULT_DEPLOYMENT_PROJECT_KEY);
    const legacyDefaultAccount = toAccount(legacyDefaultRow);
    if (!legacyDefaultAccount?.projectId) {
      return null;
    }

    const config: UserRailwayProjectConfig = {
      provider: 'platform_managed',
      supplier: 'railway',
      projectId: legacyDefaultAccount.projectId,
      projectName: legacyDefaultAccount.projectName,
      workspaceId: requireEnv('RAILWAY_WORKSPACE_ID'),
      createdAt: new Date().toISOString(),
    };
    await this.persistUserProjectRow(userId, config);
    return {
      userId,
      projectId: config.projectId,
      projectName: config.projectName,
      workspaceId: config.workspaceId,
      createdAt: config.createdAt,
    };
  }

  async getProjectAccount(
    userId: string,
    projectKey: string = DEFAULT_DEPLOYMENT_PROJECT_KEY
  ): Promise<UserPlatformDeploymentAccount | null> {
    const row = await this.getAccountRow(userId, projectKey);
    return toAccount(row);
  }

  async ensureUserAccount(userId: string): Promise<UserPlatformDeploymentAccount> {
    return this.ensureProjectAccount(userId, DEFAULT_DEPLOYMENT_PROJECT_KEY);
  }

  async ensureUserProject(userId: string): Promise<UserRailwayProject> {
    const normalizedUserId = asText(userId);
    if (!normalizedUserId) {
      throw new Error('缺少用户信息，无法准备用户部署项目');
    }

    const existing = await this.getUserProject(normalizedUserId);
    if (existing?.projectId) {
      const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
      try {
        const remoteProject = await getProjectById(adminToken, existing.projectId);
        if (remoteProject.id) {
          if (
            remoteProject.name &&
            remoteProject.name !== existing.projectName
          ) {
            await this.persistUserProjectRow(normalizedUserId, {
              provider: 'platform_managed',
              supplier: 'railway',
              projectId: remoteProject.id,
              projectName: remoteProject.name,
              workspaceId: existing.workspaceId || requireEnv('RAILWAY_WORKSPACE_ID'),
              createdAt: existing.createdAt || new Date().toISOString(),
            });
            return {
              ...existing,
              projectName: remoteProject.name,
            };
          }
          return existing;
        }
      } catch (error: any) {
        if (!isRailwayProjectNotFoundError(error?.message || '')) {
          throw error;
        }
      }
    }

    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const project = await createUserRailwayProject(adminToken, normalizedUserId);
    const config: UserRailwayProjectConfig = {
      provider: 'platform_managed',
      supplier: 'railway',
      projectId: project.projectId,
      projectName: project.projectName,
      workspaceId: project.workspaceId,
      createdAt: new Date().toISOString(),
    };
    await this.persistUserProjectRow(normalizedUserId, config);
    return {
      userId: normalizedUserId,
      projectId: config.projectId,
      projectName: config.projectName,
      workspaceId: config.workspaceId,
      createdAt: config.createdAt,
    };
  }

  async ensureProjectAccount(
    userId: string,
    projectKey: string = DEFAULT_DEPLOYMENT_PROJECT_KEY
  ): Promise<UserPlatformDeploymentAccount> {
    const normalizedUserId = asText(userId);
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    if (!normalizedUserId) {
      throw new Error('缺少用户信息，无法准备部署资源');
    }

    const userProject = await this.ensureUserProject(normalizedUserId);
    const existingRow = await this.getAccountRow(normalizedUserId, normalizedProjectKey);
    const existingAccount = toAccount(existingRow);
    if (
      existingAccount?.serviceId &&
      existingAccount.serviceDomain &&
      existingAccount.projectKey === normalizedProjectKey &&
      existingAccount.projectId === userProject.projectId
    ) {
      const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
      await ensureServiceDomain(
        adminToken,
        existingAccount.projectId,
        existingAccount.environmentId,
        existingAccount.serviceId
      );
      return existingAccount;
    }

    const inflightKey = this.buildInflightKey(normalizedUserId, normalizedProjectKey);
    const current = this.inflight.get(inflightKey);
    if (current) return current;

    const pending = (existingRow
      ? this.repairExistingAccount(normalizedUserId, existingRow, normalizedProjectKey)
      : this.provisionForUser(normalizedUserId, normalizedProjectKey)
    ).finally(() => {
      this.inflight.delete(inflightKey);
    });
    this.inflight.set(inflightKey, pending);
    return pending;
  }

  async ensureDatabaseResources(userId: string): Promise<UserPlatformDeploymentAccount> {
    return this.ensureProjectDatabaseResources(userId, DEFAULT_DEPLOYMENT_PROJECT_KEY);
  }

  async ensureProjectDatabaseResources(
    userId: string,
    projectKey: string = DEFAULT_DEPLOYMENT_PROJECT_KEY
  ): Promise<UserPlatformDeploymentAccount> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const account = await this.ensureProjectAccount(userId, normalizedProjectKey);
    if (account.databaseServiceId) {
      return account;
    }

    const row = await this.getAccountRow(userId, normalizedProjectKey);
    if (!row) {
      throw new Error('平台部署账号不存在');
    }

    const config = toDeploymentConfig(row.configJson);
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const existingDatabaseService = await getProjectService(
      adminToken,
      account.projectId,
      config.databaseServiceName || buildDatabaseServiceName(normalizedProjectKey)
    );
    if (!existingDatabaseService?.id) {
      await deployPostgresTemplate(adminToken, account.projectId, account.environmentId);
    }

    const database = await waitForDatabaseService(adminToken, account.projectId, account.environmentId);
    const variables = database.variables;
    await wireApplicationDatabaseVariables(
      adminToken,
      account.projectId,
      account.environmentId,
      account.serviceId,
      database.serviceName
    );

    await this.persistAccountRow(
      userId,
      buildConfigFromState({
        current: config,
        projectKey: normalizedProjectKey,
        projectId: account.projectId,
        projectName: account.projectName,
        environmentId: account.environmentId,
        environmentName: account.environmentName,
        serviceId: account.serviceId,
        serviceName: account.serviceName,
        repo: {
          owner: account.githubRepoOwner || '',
          name: account.githubRepoName || '',
          fullName: account.githubRepoFullName || '',
          htmlUrl: account.githubRepoUrl || '',
          defaultBranch: account.githubDefaultBranch || 'main',
        },
        tokenId: account.tokenId,
        tokenRotatedAt: account.tokenRotatedAt,
        databaseServiceId: database.serviceId,
        databaseServiceName: database.serviceName,
        databaseVolumeId: asText(variables.RAILWAY_VOLUME_ID) || undefined,
        databaseVolumeName: asText(variables.RAILWAY_VOLUME_NAME) || undefined,
      }),
      row.secretCiphertext
    );

    const updatedAccount = await this.getProjectAccount(userId, normalizedProjectKey);
    if (!updatedAccount?.databaseServiceId) {
      throw new Error('平台数据库资源写入失败');
    }
    return updatedAccount;
  }

  async upsertApplicationVariables(
    account: Pick<UserPlatformDeploymentAccount, 'projectId' | 'environmentId' | 'serviceId'>,
    variables: Record<string, string>,
    options?: {
      replace?: boolean;
      skipDeploys?: boolean;
    }
  ): Promise<void> {
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    await upsertServiceVariables(
      adminToken,
      account.projectId,
      account.environmentId,
      account.serviceId,
      variables,
      options
    );
  }

  async rotateProjectToken(
    userId: string,
    projectKey: string = DEFAULT_DEPLOYMENT_PROJECT_KEY
  ): Promise<UserPlatformDeploymentAccount> {
    const normalizedUserId = asText(userId);
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    if (!normalizedUserId) {
      throw new Error('缺少用户信息，无法轮换部署凭证');
    }

    const row = await this.getAccountRow(normalizedUserId, normalizedProjectKey);
    if (!row) {
      throw new Error('平台部署账号不存在，无法轮换凭证');
    }

    const config = toDeploymentConfig(row.configJson);
    if (!config.projectId || !config.environmentId || !config.serviceId) {
      throw new Error('平台部署资源不完整，无法轮换凭证');
    }

    const currentAccount = await this.ensureProjectAccount(normalizedUserId, normalizedProjectKey);
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const rotatedAt = new Date().toISOString();
    const nextToken = await createProjectToken(
      adminToken,
      normalizedUserId,
      config.projectId,
      config.environmentId,
      normalizedProjectKey
    );

    await this.persistAccountRow(
      normalizedUserId,
      buildConfigFromState({
        current: config,
        projectKey: normalizedProjectKey,
        projectId: config.projectId,
        projectName: config.projectName,
        environmentId: config.environmentId,
        environmentName: config.environmentName,
        serviceId: config.serviceId,
        serviceName: config.serviceName,
        serviceDomain: config.serviceDomain,
        repo: {
          owner: currentAccount.githubRepoOwner || '',
          name: currentAccount.githubRepoName || '',
          fullName: currentAccount.githubRepoFullName || '',
          htmlUrl: currentAccount.githubRepoUrl || '',
          defaultBranch: currentAccount.githubDefaultBranch || 'main',
        },
        tokenId: nextToken.tokenId,
        tokenRotatedAt: rotatedAt,
        databaseServiceId: config.databaseServiceId,
        databaseServiceName: config.databaseServiceName,
        databaseVolumeId: config.databaseVolumeId,
        databaseVolumeName: config.databaseVolumeName,
      }),
      connectorSecretService.encrypt({
        accessToken: nextToken.token,
        tokenKind: 'project',
        tokenId: nextToken.tokenId,
        tokenRotatedAt: rotatedAt,
      } satisfies DeploymentSecret)
    );

    const updatedAccount = await this.getProjectAccount(normalizedUserId, normalizedProjectKey);
    if (!updatedAccount) {
      throw new Error('轮换部署凭证后读取账号失败');
    }
    return updatedAccount;
  }

  private async repairExistingAccount(
    userId: string,
    row: DeploymentAccountRow,
    projectKey: string = DEFAULT_DEPLOYMENT_PROJECT_KEY
  ): Promise<UserPlatformDeploymentAccount> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const config = toDeploymentConfig(row.configJson);
    const userProject = await this.ensureUserProject(userId);
    if (!config.projectId || !config.environmentId || config.projectId !== userProject.projectId) {
      return this.provisionForUser(userId, normalizedProjectKey);
    }

    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    let environment = await ensureProjectEnvironment(
      adminToken,
      config.projectId,
      normalizedProjectKey
    );
    let service;
    try {
      service = await createService(
        adminToken,
        config.projectId,
        normalizedProjectKey
      );
    } catch (error: any) {
      if (isRailwayServiceCreationLimitError(error?.message || '')) {
        return this.reuseExistingServiceSlot({
          userId,
          projectKey: normalizedProjectKey,
          projectId: config.projectId,
          projectName: config.projectName,
        });
      }
      throw error;
    }
    await configureServiceInstance(adminToken, environment.environmentId, service.serviceId);
    const serviceDomain = await ensureServiceDomain(
      adminToken,
      config.projectId,
      environment.environmentId,
      service.serviceId
    );

    let secretCiphertext = row.secretCiphertext;
    let tokenId = config.tokenId;
    let tokenRotatedAt = config.tokenRotatedAt;
    if (!secretCiphertext) {
      tokenRotatedAt = new Date().toISOString();
      const projectToken = await createProjectToken(
        adminToken,
        userId,
        config.projectId,
        environment.environmentId,
        normalizedProjectKey
      );
      tokenId = projectToken.tokenId;
      secretCiphertext = connectorSecretService.encrypt({
        accessToken: projectToken.token,
        tokenKind: 'project',
        tokenId: projectToken.tokenId,
        tokenRotatedAt,
      } satisfies DeploymentSecret);
    }

    await this.persistAccountRow(
      userId,
      buildConfigFromState({
        current: config,
        projectKey: normalizedProjectKey,
        projectId: config.projectId,
        projectName: config.projectName,
        environmentId: environment.environmentId,
        environmentName: environment.environmentName,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        serviceDomain,
        tokenId,
        tokenRotatedAt,
      }),
      secretCiphertext
    );

    const account = await this.getProjectAccount(userId, normalizedProjectKey);
    if (!account) {
      throw new Error('平台部署账号修复失败');
    }
    return account;
  }

  private async provisionForUser(
    userId: string,
    projectKey: string = DEFAULT_DEPLOYMENT_PROJECT_KEY
  ): Promise<UserPlatformDeploymentAccount> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const userProject = await this.ensureUserProject(userId);
    let environment = await ensureProjectEnvironment(
      adminToken,
      userProject.projectId,
      normalizedProjectKey
    );
    let service;
    try {
      service = await createService(
        adminToken,
        userProject.projectId,
        normalizedProjectKey
      );
    } catch (error: any) {
      if (isRailwayServiceCreationLimitError(error?.message || '')) {
        return this.reuseExistingServiceSlot({
          userId,
          projectKey: normalizedProjectKey,
          projectId: userProject.projectId,
          projectName: userProject.projectName,
        });
      }
      throw error;
    }
    await configureServiceInstance(adminToken, environment.environmentId, service.serviceId);
    const serviceDomain = await ensureServiceDomain(
      adminToken,
      userProject.projectId,
      environment.environmentId,
      service.serviceId
    );
    const projectToken = await createProjectToken(
      adminToken,
      userId,
      userProject.projectId,
      environment.environmentId,
      normalizedProjectKey
    );
    const tokenRotatedAt = new Date().toISOString();

    await this.persistAccountRow(
      userId,
      buildConfigFromState({
        projectKey: normalizedProjectKey,
        projectId: userProject.projectId,
        projectName: userProject.projectName,
        environmentId: environment.environmentId,
        environmentName: environment.environmentName,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        serviceDomain,
        tokenId: projectToken.tokenId,
        tokenRotatedAt,
        createdAt: new Date().toISOString(),
      }),
      connectorSecretService.encrypt({
        accessToken: projectToken.token,
        tokenKind: 'project',
        tokenId: projectToken.tokenId,
        tokenRotatedAt,
      } satisfies DeploymentSecret)
    );

    const account = await this.getProjectAccount(userId, normalizedProjectKey);
    if (!account) {
      throw new Error('平台部署账号持久化失败');
    }
    return account;
  }
}

export const platformDeploymentAccountService = new PlatformDeploymentAccountService();
