import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: resolve(currentDir, '../../.env'),
  override: true,
});

import { userConnectorAccountDAO } from '../src/db/dao';
import { requestRailwayGraphql } from '../src/services/railway-graphql-client';
import { deleteManagedDeploymentRepository } from '../src/services/platform-managed-github-repo-service';
import { umamiAnalyticsService } from '../src/services/umami-analytics-service';

const INTERNAL_DEPLOYMENT_CONNECTOR_KEY = 'railway_internal';
const INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY = 'railway_internal_project';

type DeploymentAccountRecord = {
  connectorKey: string;
  projectKey: string;
  projectId: string;
  projectName?: string;
  environmentId: string;
  environmentName?: string;
  serviceId: string;
  serviceName?: string;
  serviceDomain?: string;
  githubRepoFullName?: string;
  databaseServiceId?: string;
  tokenId?: string;
};

type OperationResult = {
  name: string;
  status: 'deleted' | 'skipped' | 'missing' | 'failed';
  detail?: string;
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

function normalizeDomain(value: string): string {
  const trimmed = asText(value);
  if (!trimmed) return '';
  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function toDeploymentAccountRecord(row: any): DeploymentAccountRecord | null {
  const config = pickRecord(row?.configJson);
  const projectId = asText(config.projectId);
  const environmentId = asText(config.environmentId);
  const serviceId = asText(config.serviceId);
  if (!projectId || !environmentId || !serviceId) {
    return null;
  }

  return {
    connectorKey: asText(row?.connectorKey),
    projectKey: asText(config.projectKey) || 'default',
    projectId,
    projectName: asText(config.projectName) || undefined,
    environmentId,
    environmentName: asText(config.environmentName) || undefined,
    serviceId,
    serviceName: asText(config.serviceName) || undefined,
    serviceDomain: asText(config.serviceDomain) || undefined,
    githubRepoFullName: asText(config.githubRepoFullName) || undefined,
    databaseServiceId: asText(config.databaseServiceId) || undefined,
    tokenId: asText(config.tokenId) || undefined,
  };
}

async function railwayAdminRequest<T>(query: string, variables?: Record<string, unknown>) {
  const token = asText(process.env.RAILWAY_ADMIN_TOKEN);
  if (!token) {
    throw new Error('RAILWAY_ADMIN_TOKEN 未配置');
  }

  return requestRailwayGraphql<T>(
    {
      token,
      kind: 'bearer',
    },
    query,
    variables
  );
}

async function listServiceDomainIds(input: {
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  const response = await railwayAdminRequest<{
    domains?: {
      serviceDomains?: Array<{
        id?: string;
        domain?: string;
      }>;
    } | null;
  }>(
    `
      query CleanupServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          serviceDomains {
            id
            domain
          }
        }
      }
    `,
    input
  );

  return (response.domains?.serviceDomains || [])
    .map((entry) => ({
      id: asText(entry.id),
      domain: asText(entry.domain),
    }))
    .filter((entry) => entry.id);
}

async function getServiceVariables(input: {
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  const response = await railwayAdminRequest<{
    variables?: Record<string, unknown> | null;
  }>(
    `
      query CleanupServiceVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }
    `,
    input
  );

  return pickRecord(response.variables);
}

async function deleteRailwayServiceDomain(id: string) {
  await railwayAdminRequest(
    `
      mutation CleanupServiceDomain($id: String!) {
        serviceDomainDelete(id: $id)
      }
    `,
    { id }
  );
}

async function deleteRailwayProjectToken(id: string) {
  await railwayAdminRequest(
    `
      mutation CleanupProjectToken($id: String!) {
        projectTokenDelete(id: $id)
      }
    `,
    { id }
  );
}

async function deleteRailwayService(id: string, environmentId: string) {
  await railwayAdminRequest(
    `
      mutation CleanupRailwayService($id: String!, $environmentId: String) {
        serviceDelete(id: $id, environmentId: $environmentId)
      }
    `,
    {
      id,
      environmentId,
    }
  );
}

async function deleteRailwayEnvironment(id: string) {
  await railwayAdminRequest(
    `
      mutation CleanupRailwayEnvironment($id: String!) {
        environmentDelete(id: $id)
      }
    `,
    { id }
  );
}

async function deleteRailwayProject(id: string) {
  await railwayAdminRequest(
    `
      mutation CleanupRailwayProject($id: String!) {
        projectDelete(id: $id)
      }
    `,
    { id }
  );
}

async function cleanupAccountResources(
  userId: string,
  account: DeploymentAccountRecord,
  options: {
    dryRun: boolean;
    skipGithub: boolean;
    websiteByDomain: Map<string, { id: string; name?: string }>;
  }
) {
  const operations: OperationResult[] = [];
  let canDeleteDbRow = true;

  const addResult = (result: OperationResult) => {
    operations.push(result);
    if (result.status === 'failed') {
      canDeleteDbRow = false;
    }
  };

  const domain = normalizeDomain(account.serviceDomain || '');
  let websiteId = '';
  try {
    const variables = await getServiceVariables({
      projectId: account.projectId,
      environmentId: account.environmentId,
      serviceId: account.serviceId,
    });
    websiteId = asText(variables.VITE_ANALYTICS_WEBSITE_ID);
  } catch (error: any) {
    addResult({
      name: 'railway.variablesRead',
      status: 'failed',
      detail: asText(error?.message),
    });
  }

  if (!websiteId && domain) {
    websiteId = asText(options.websiteByDomain.get(domain)?.id);
  }

  try {
    const serviceDomains = options.dryRun
      ? []
      : await listServiceDomainIds({
          projectId: account.projectId,
          environmentId: account.environmentId,
          serviceId: account.serviceId,
        });
    if (!serviceDomains.length) {
      addResult({
        name: 'railway.serviceDomains',
        status: 'missing',
      });
    } else {
      for (const domain of serviceDomains) {
        if (options.dryRun) {
          addResult({
            name: 'railway.serviceDomainDelete',
            status: 'skipped',
            detail: domain.domain || domain.id,
          });
          continue;
        }
        try {
          await deleteRailwayServiceDomain(domain.id);
          addResult({
            name: 'railway.serviceDomainDelete',
            status: 'deleted',
            detail: domain.domain || domain.id,
          });
        } catch (error: any) {
          addResult({
            name: 'railway.serviceDomainDelete',
            status: 'failed',
            detail: asText(error?.message) || domain.id,
          });
        }
      }
    }
  } catch (error: any) {
    addResult({
      name: 'railway.serviceDomainList',
      status: 'failed',
      detail: asText(error?.message),
    });
  }

  if (account.tokenId) {
    if (options.dryRun) {
      addResult({
        name: 'railway.projectTokenDelete',
        status: 'skipped',
        detail: account.tokenId,
      });
    } else {
      try {
        await deleteRailwayProjectToken(account.tokenId);
        addResult({
          name: 'railway.projectTokenDelete',
          status: 'deleted',
          detail: account.tokenId,
        });
      } catch (error: any) {
        addResult({
          name: 'railway.projectTokenDelete',
          status: 'failed',
          detail: asText(error?.message) || account.tokenId,
        });
      }
    }
  }

  const serviceIds = [account.serviceId, account.databaseServiceId].filter(Boolean) as string[];
  for (const serviceId of serviceIds) {
    if (options.dryRun) {
      addResult({
        name: 'railway.serviceDelete',
        status: 'skipped',
        detail: serviceId,
      });
      continue;
    }
    try {
      await deleteRailwayService(serviceId, account.environmentId);
      addResult({
        name: 'railway.serviceDelete',
        status: 'deleted',
        detail: serviceId,
      });
    } catch (error: any) {
      addResult({
        name: 'railway.serviceDelete',
        status: 'failed',
        detail: asText(error?.message) || serviceId,
      });
    }
  }

  if (options.dryRun) {
    addResult({
      name: 'railway.environmentDelete',
      status: 'skipped',
      detail: account.environmentId,
    });
  } else {
    try {
      await deleteRailwayEnvironment(account.environmentId);
      addResult({
        name: 'railway.environmentDelete',
        status: 'deleted',
        detail: account.environmentId,
      });
    } catch (error: any) {
      addResult({
        name: 'railway.environmentDelete',
        status: 'failed',
        detail: asText(error?.message) || account.environmentId,
      });
    }
  }

  if (account.githubRepoFullName) {
    if (options.skipGithub) {
      addResult({
        name: 'github.repoDelete',
        status: 'skipped',
        detail: 'skipGithub enabled',
      });
    } else if (options.dryRun) {
      addResult({
        name: 'github.repoDelete',
        status: 'skipped',
        detail: account.githubRepoFullName,
      });
    } else {
      try {
        const deleted = await deleteManagedDeploymentRepository(account.githubRepoFullName);
        addResult({
          name: 'github.repoDelete',
          status: deleted ? 'deleted' : 'missing',
          detail: account.githubRepoFullName,
        });
      } catch (error: any) {
        addResult({
          name: 'github.repoDelete',
          status: 'failed',
          detail: asText(error?.message) || account.githubRepoFullName,
        });
      }
    }
  }

  if (domain || websiteId) {
    if (!websiteId) {
      addResult({
        name: 'umami.websiteDelete',
        status: 'missing',
        detail: domain || 'websiteId unavailable',
      });
    } else if (options.dryRun) {
      addResult({
        name: 'umami.websiteDelete',
        status: 'skipped',
        detail: websiteId,
      });
    } else {
      try {
        const deleted = await umamiAnalyticsService.deleteWebsite(websiteId);
        addResult({
          name: 'umami.websiteDelete',
          status: deleted ? 'deleted' : 'missing',
          detail: websiteId,
        });
      } catch (error: any) {
        addResult({
          name: 'umami.websiteDelete',
          status: 'failed',
          detail: asText(error?.message) || websiteId,
        });
      }
    }
  }

  if (canDeleteDbRow) {
    if (options.dryRun) {
      addResult({
        name: 'db.accountDelete',
        status: 'skipped',
        detail: account.connectorKey,
      });
    } else {
      await userConnectorAccountDAO.deleteByUserAndConnectorKey(userId, account.connectorKey);
      addResult({
        name: 'db.accountDelete',
        status: 'deleted',
        detail: account.connectorKey,
      });
    }
  } else {
    addResult({
      name: 'db.accountDelete',
      status: 'skipped',
      detail: 'external cleanup failed',
    });
  }

  return {
    projectKey: account.projectKey,
    projectId: account.projectId,
    environmentId: account.environmentId,
    serviceId: account.serviceId,
    repository: account.githubRepoFullName,
    domain: account.serviceDomain,
    operations,
    canDeleteDbRow,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      user: { type: 'string' },
      prefix: { type: 'string', default: 'smoke-' },
      deleteUserProject: { type: 'boolean', default: false },
      dryRun: { type: 'boolean', default: false },
      skipGithub: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const userId = asText(values.user) || 'oneceo-deployment-smoke-user';
  const prefix = asText(values.prefix) || 'smoke-';
  const dryRun = Boolean(values.dryRun);
  const deleteUserProject = Boolean(values.deleteUserProject);
  const skipGithub = Boolean(values.skipGithub);

  const rows = await userConnectorAccountDAO.listByUserId(userId);
  const deploymentRows = rows
    .filter((row: any) => {
      const connectorKey = asText(row.connectorKey);
      return (
        connectorKey === INTERNAL_DEPLOYMENT_CONNECTOR_KEY ||
        connectorKey.startsWith(`${INTERNAL_DEPLOYMENT_CONNECTOR_KEY}:`)
      );
    })
    .map(toDeploymentAccountRecord)
    .filter((item): item is DeploymentAccountRecord => Boolean(item))
    .filter((item) => item.projectKey.startsWith(prefix));

  const projectRow = rows.find(
    (row: any) => asText(row.connectorKey) === INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY
  );
  const projectConfig = pickRecord(projectRow?.configJson);
  const projectId = asText(projectConfig.projectId);

  const websites = await umamiAnalyticsService.listWebsites().catch(() => []);
  const websiteByDomain = new Map(
    websites
      .map((item) => [normalizeDomain(item.domain || ''), { id: item.id, name: item.name }] as const)
      .filter(([domain, item]) => domain && item.id)
  );

  const results = [];
  for (const account of deploymentRows) {
    results.push(
      await cleanupAccountResources(userId, account, {
        dryRun,
        skipGithub,
        websiteByDomain,
      })
    );
  }

  let projectCleanup: OperationResult | null = null;
  const remainingRows = dryRun ? deploymentRows : (await userConnectorAccountDAO.listByUserId(userId))
    .filter((row: any) => {
      const connectorKey = asText(row.connectorKey);
      return (
        connectorKey === INTERNAL_DEPLOYMENT_CONNECTOR_KEY ||
        connectorKey.startsWith(`${INTERNAL_DEPLOYMENT_CONNECTOR_KEY}:`)
      );
    });

  if (deleteUserProject) {
    if (!projectId) {
      projectCleanup = {
        name: 'railway.projectDelete',
        status: 'missing',
      };
    } else if (remainingRows.length > 0) {
      projectCleanup = {
        name: 'railway.projectDelete',
        status: 'skipped',
        detail: '仍有部署账号记录，未执行 projectDelete',
      };
    } else if (dryRun) {
      projectCleanup = {
        name: 'railway.projectDelete',
        status: 'skipped',
        detail: projectId,
      };
    } else {
      await deleteRailwayProject(projectId);
      await userConnectorAccountDAO.deleteByUserAndConnectorKey(
        userId,
        INTERNAL_DEPLOYMENT_PROJECT_CONNECTOR_KEY
      );
      projectCleanup = {
        name: 'railway.projectDelete',
        status: 'deleted',
        detail: projectId,
      };
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        skipGithub,
        userId,
        prefix,
        matchedAccounts: deploymentRows.length,
        results,
        projectCleanup,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
