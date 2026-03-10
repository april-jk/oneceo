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
