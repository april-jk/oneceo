import { createHash } from 'node:crypto';

import { userConnectorAccountDAO } from '../db/dao';
import { connectorSecretService } from './connector-secret-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import {
  ensureManagedDeploymentRepository,
  type ManagedDeploymentRepository,
} from './platform-managed-github-repo-service';
import { requestRailwayGraphql } from './railway-graphql-client';

const INTERNAL_DEPLOYMENT_CONNECTOR_KEY = 'railway_internal';

type DeploymentSecret = {
  accessToken: string;
  tokenId?: string;
};

type DeploymentConfig = {
  provider: 'platform_managed';
  supplier: 'railway';
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  tokenId?: string;
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
  configJson: unknown;
  secretCiphertext: string | null;
};

export type UserPlatformDeploymentAccount = {
  userId: string;
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  accessToken: string;
  tokenId?: string;
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

function buildProjectName(userId: string) {
  const prefix = sanitizeNameSegment(
    asText(process.env.RAILWAY_DEPLOYMENT_PROJECT_PREFIX) || 'oneceo',
    14
  );
  const userSegment = sanitizeNameSegment(userId, 12);
  const hash = createHash('sha1').update(userId).digest('hex').slice(0, 8);
  return `${prefix}-${userSegment}-${hash}`.slice(0, 32);
}

function buildServiceName() {
  return asText(process.env.RAILWAY_DEPLOYMENT_SERVICE_NAME) || 'app';
}

function buildDatabaseServiceName() {
  return asText(process.env.RAILWAY_DATABASE_SERVICE_NAME) || 'Postgres';
}

function toDeploymentConfig(value: unknown): DeploymentConfig {
  const record = pickRecord(value);
  return {
    provider: 'platform_managed',
    supplier: 'railway',
    projectId: asText(record.projectId),
    projectName: asText(record.projectName) || undefined,
    environmentId: asText(record.environmentId),
    environmentName: asText(record.environmentName) || undefined,
    serviceId: asText(record.serviceId),
    serviceName: asText(record.serviceName) || undefined,
    tokenId: asText(record.tokenId) || undefined,
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

async function executeRailwayGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  try {
    return await requestRailwayGraphql<T>(token, query, variables);
  } catch (error: any) {
    throw new Error(asText(error?.message) || '平台部署 GraphQL 请求失败');
  }
}

async function createProject(adminToken: string, userId: string) {
  const workspaceId = requireEnv('RAILWAY_WORKSPACE_ID');
  const projectName = buildProjectName(userId);
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
      query FindPlatformProject($workspaceId: String!) {
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
      mutation CreatePlatformProject($input: ProjectCreateInput!) {
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
        description: `OneCEO managed deployment project for ${userId}`,
        isPublic: false,
        prDeploys: false,
      },
    }
  );

  const projectId = asText(result.projectCreate?.id);
  if (!projectId) {
    throw new Error('创建用户部署项目失败');
  }
  return {
    projectId,
    projectName: asText(result.projectCreate?.name) || projectName,
  };
}

async function getDefaultEnvironment(adminToken: string, projectId: string) {
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
      query GetProjectEnvironments($projectId: String!) {
        project(id: $projectId) {
          environments(first: 1) {
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
    { projectId }
  );

  const edge = result.project?.environments?.edges?.[0];
  const environmentId = asText(edge?.node?.id);
  if (!environmentId) {
    throw new Error('创建项目后未获取到默认环境');
  }
  return {
    environmentId,
    environmentName: asText(edge?.node?.name) || 'production',
  };
}

async function createService(
  adminToken: string,
  projectId: string,
  repoFullName: string,
  branch: string
) {
  const serviceName = buildServiceName();
  const repositoryRef = repoFullName.startsWith('github:') ? repoFullName : `github:${repoFullName}`;
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
        source: {
          repo: repositoryRef,
        },
        branch,
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

async function connectServiceSource(
  adminToken: string,
  serviceId: string,
  repoFullName: string,
  branch: string
) {
  const repositoryRef = repoFullName.startsWith('github:') ? repoFullName.slice('github:'.length) : repoFullName;
  const result = await executeRailwayGraphql<{
    serviceConnect?: {
      id?: string;
      name?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation ConnectPlatformServiceSource($id: String!, $input: ServiceConnectInput!) {
        serviceConnect(id: $id, input: $input) {
          id
          name
        }
      }
    `,
    {
      id: serviceId,
      input: {
        repo: repositoryRef,
        branch,
      },
    }
  );

  const connectedServiceId = asText(result.serviceConnect?.id);
  if (!connectedServiceId) {
    throw new Error('刷新部署服务源码绑定失败');
  }
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

async function ensureDeploymentTrigger(
  adminToken: string,
  projectId: string,
  environmentId: string,
  serviceId: string,
  repoFullName: string,
  branch: string
) {
  const existing = await executeRailwayGraphql<{
    deploymentTriggers?: {
      edges?: Array<{
        node?: {
          id?: string;
          repository?: string;
          branch?: string;
          provider?: string;
        };
      }>;
    } | null;
  }>(
    adminToken,
    `
      query FindDeploymentTrigger(
        $projectId: String!,
        $serviceId: String!,
        $environmentId: String!
      ) {
        deploymentTriggers(
          projectId: $projectId,
          serviceId: $serviceId,
          environmentId: $environmentId
        ) {
          edges {
            node {
              id
              repository
              branch
              provider
            }
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

  const matchedTrigger = existing.deploymentTriggers?.edges
    ?.map((edge) => ({
      id: asText(edge?.node?.id),
      repository: asText(edge?.node?.repository),
      branch: asText(edge?.node?.branch),
      provider: asText(edge?.node?.provider).toLowerCase(),
    }))
    .find(
      (item) =>
        item.id &&
        item.repository === repoFullName &&
        item.branch === branch &&
        item.provider === 'github'
    );

  if (matchedTrigger?.id) {
    return matchedTrigger.id;
  }

  const created = await executeRailwayGraphql<{
    deploymentTriggerCreate?: {
      id?: string;
    } | null;
  }>(
    adminToken,
    `
      mutation CreateDeploymentTrigger($input: DeploymentTriggerCreateInput!) {
        deploymentTriggerCreate(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        provider: 'github',
        repository: repoFullName,
        branch,
        checkSuites: false,
        rootDirectory: '',
      },
    }
  );

  return asText(created.deploymentTriggerCreate?.id) || undefined;
}

async function ensureServiceDomain(
  adminToken: string,
  projectId: string,
  environmentId: string,
  serviceId: string
) {
  const targetPort = Number.parseInt(asText(process.env.RAILWAY_DEPLOYMENT_TARGET_PORT) || '3000', 10);
  const domains = await executeRailwayGraphql<{
    domains?: {
      serviceDomains?: Array<{
        id?: string;
        domain?: string;
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
    }))
    .find((entry) => entry.id && entry.domain);

  if (existingDomain?.id) {
    return existingDomain.domain;
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
        targetPort: Number.isFinite(targetPort) ? targetPort : 3000,
      },
    }
  );

  return asText(created.serviceDomainCreate?.domain) || undefined;
}

async function createProjectToken(
  adminToken: string,
  userId: string,
  projectId: string,
  environmentId: string
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
        name: `token-${sanitizeUserTokenSegment(userId)}`,
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

function buildConfigFromState(input: {
  current?: DeploymentConfig;
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  repo: ManagedDeploymentRepository;
  tokenId?: string;
  createdAt?: string;
  databaseServiceId?: string;
  databaseServiceName?: string;
  databaseVolumeId?: string;
  databaseVolumeName?: string;
}): DeploymentConfig {
  return {
    provider: 'platform_managed',
    supplier: 'railway',
    projectId: input.projectId,
    projectName: input.projectName,
    environmentId: input.environmentId,
    environmentName: input.environmentName,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    tokenId: input.tokenId || input.current?.tokenId,
    createdAt: input.current?.createdAt || input.createdAt || new Date().toISOString(),
    githubRepoOwner: input.repo.owner,
    githubRepoName: input.repo.name,
    githubRepoFullName: input.repo.fullName,
    githubRepoUrl: input.repo.htmlUrl,
    githubDefaultBranch: input.repo.defaultBranch,
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
    projectId: config.projectId,
    projectName: config.projectName,
    environmentId: config.environmentId,
    environmentName: config.environmentName,
    serviceId: config.serviceId,
    serviceName: config.serviceName,
    accessToken,
    tokenId: asText(secret?.tokenId || config.tokenId) || undefined,
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

function hasManagedRepository(config: DeploymentConfig) {
  return Boolean(config.githubRepoOwner && config.githubRepoName && config.githubRepoFullName);
}

export class PlatformDeploymentAccountService {
  private inflight = new Map<string, Promise<UserPlatformDeploymentAccount>>();

  private async getAccountRow(userId: string): Promise<DeploymentAccountRow | null> {
    await connectorStorageBootstrap.ensureReady();
    const row = await userConnectorAccountDAO.getByUserAndConnectorKey(userId, INTERNAL_DEPLOYMENT_CONNECTOR_KEY);
    return (row as DeploymentAccountRow | null) || null;
  }

  private async persistAccountRow(
    userId: string,
    config: DeploymentConfig,
    secretCiphertext: string | null,
    displayName = '平台部署'
  ) {
    await userConnectorAccountDAO.upsert({
      userId,
      connectorKey: INTERNAL_DEPLOYMENT_CONNECTOR_KEY,
      authMode: 'token',
      authStatus: secretCiphertext ? 'authorized' : 'needs_auth',
      displayName,
      configJson: config,
      secretCiphertext,
      lastAuthAt: secretCiphertext ? new Date() : null,
      lastError: null,
    });
  }

  async getUserAccount(userId: string): Promise<UserPlatformDeploymentAccount | null> {
    const row = await this.getAccountRow(userId);
    return toAccount(row);
  }

  async ensureUserAccount(userId: string): Promise<UserPlatformDeploymentAccount> {
    const normalizedUserId = asText(userId);
    if (!normalizedUserId) {
      throw new Error('缺少用户信息，无法准备部署资源');
    }

    const existingRow = await this.getAccountRow(normalizedUserId);
    const existingAccount = toAccount(existingRow);
    if (existingAccount?.githubRepoFullName) {
      return existingAccount;
    }

    const current = this.inflight.get(normalizedUserId);
    if (current) return current;

    const pending = (existingRow
      ? this.repairExistingAccount(normalizedUserId, existingRow)
      : this.provisionForUser(normalizedUserId)
    ).finally(() => {
      this.inflight.delete(normalizedUserId);
    });
    this.inflight.set(normalizedUserId, pending);
    return pending;
  }

  async ensureDatabaseResources(userId: string): Promise<UserPlatformDeploymentAccount> {
    const account = await this.ensureUserAccount(userId);
    if (account.databaseServiceId) {
      return account;
    }

    const row = await this.getAccountRow(userId);
    if (!row) {
      throw new Error('平台部署账号不存在');
    }

    const config = toDeploymentConfig(row.configJson);
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const existingDatabaseService = await getProjectService(
      adminToken,
      account.projectId,
      config.databaseServiceName || buildDatabaseServiceName()
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
        databaseServiceId: database.serviceId,
        databaseServiceName: database.serviceName,
        databaseVolumeId: asText(variables.RAILWAY_VOLUME_ID) || undefined,
        databaseVolumeName: asText(variables.RAILWAY_VOLUME_NAME) || undefined,
      }),
      row.secretCiphertext
    );

    const updatedAccount = await this.getUserAccount(userId);
    if (!updatedAccount?.databaseServiceId) {
      throw new Error('平台数据库资源写入失败');
    }
    return updatedAccount;
  }

  private async repairExistingAccount(
    userId: string,
    row: DeploymentAccountRow
  ): Promise<UserPlatformDeploymentAccount> {
    const config = toDeploymentConfig(row.configJson);
    if (!config.projectId || !config.environmentId) {
      return this.provisionForUser(userId);
    }

    const repo = await ensureManagedDeploymentRepository(userId);
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const service = await createService(
      adminToken,
      config.projectId,
      repo.fullName,
      repo.defaultBranch
    );
    await connectServiceSource(adminToken, service.serviceId, repo.fullName, repo.defaultBranch);
    await configureServiceInstance(adminToken, config.environmentId, service.serviceId);
    await ensureDeploymentTrigger(
      adminToken,
      config.projectId,
      config.environmentId,
      service.serviceId,
      repo.fullName,
      repo.defaultBranch
    );
    await ensureServiceDomain(adminToken, config.projectId, config.environmentId, service.serviceId);

    let secretCiphertext = row.secretCiphertext;
    let tokenId = config.tokenId;
    if (!secretCiphertext) {
      const projectToken = await createProjectToken(adminToken, userId, config.projectId, config.environmentId);
      tokenId = projectToken.tokenId;
      secretCiphertext = connectorSecretService.encrypt({
        accessToken: projectToken.token,
        tokenId: projectToken.tokenId,
      } satisfies DeploymentSecret);
    }

    await this.persistAccountRow(
      userId,
      buildConfigFromState({
        current: config,
        projectId: config.projectId,
        projectName: config.projectName,
        environmentId: config.environmentId,
        environmentName: config.environmentName,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        repo,
        tokenId,
      }),
      secretCiphertext
    );

    const account = await this.getUserAccount(userId);
    if (!account) {
      throw new Error('平台部署账号修复失败');
    }
    return account;
  }

  private async provisionForUser(userId: string): Promise<UserPlatformDeploymentAccount> {
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const repo = await ensureManagedDeploymentRepository(userId);
    const project = await createProject(adminToken, userId);
    const environment = await getDefaultEnvironment(adminToken, project.projectId);
    const service = await createService(
      adminToken,
      project.projectId,
      repo.fullName,
      repo.defaultBranch
    );
    await connectServiceSource(adminToken, service.serviceId, repo.fullName, repo.defaultBranch);
    await configureServiceInstance(adminToken, environment.environmentId, service.serviceId);
    await ensureDeploymentTrigger(
      adminToken,
      project.projectId,
      environment.environmentId,
      service.serviceId,
      repo.fullName,
      repo.defaultBranch
    );
    await ensureServiceDomain(adminToken, project.projectId, environment.environmentId, service.serviceId);
    const projectToken = await createProjectToken(
      adminToken,
      userId,
      project.projectId,
      environment.environmentId
    );

    await this.persistAccountRow(
      userId,
      buildConfigFromState({
        projectId: project.projectId,
        projectName: project.projectName,
        environmentId: environment.environmentId,
        environmentName: environment.environmentName,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        repo,
        tokenId: projectToken.tokenId,
        createdAt: new Date().toISOString(),
      }),
      connectorSecretService.encrypt({
        accessToken: projectToken.token,
        tokenId: projectToken.tokenId,
      } satisfies DeploymentSecret)
    );

    const account = await this.getUserAccount(userId);
    if (!account) {
      throw new Error('平台部署账号持久化失败');
    }
    return account;
  }
}

export const platformDeploymentAccountService = new PlatformDeploymentAccountService();
