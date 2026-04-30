import assert from 'node:assert/strict';

import { loadApiEnv } from '../../src/config/load-env';

loadApiEnv();

const [
  { platformDeploymentAccountService },
  { projectStorageResourceService },
  { projectStorageResourceDAO },
  { railwayDatabaseService },
  { requestRailwayGraphql },
] = await Promise.all([
  import('../../src/services/platform-deployment-account-service'),
  import('../../src/services/project-storage-resource-service'),
  import('../../src/db/dao'),
  import('../../src/services/railway-database-service'),
  import('../../src/services/railway-graphql-client'),
]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string) {
  const value = asText(process.env[name]);
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

async function getServiceVariables(input: {
  token: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
}) {
  const result = await requestRailwayGraphql<{
    variables?: Record<string, unknown> | null;
  }>(
    {
      token: input.token,
      kind: 'project',
    },
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
      projectId: input.projectId,
      environmentId: input.environmentId,
      serviceId: input.serviceId,
    }
  );

  return (result.variables || {}) as Record<string, unknown>;
}

async function waitForInjectedVariables(
  input: {
    token: string;
    projectId: string;
    environmentId: string;
    serviceId: string;
  },
  expectedKeys: string[],
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  let latest: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    latest = await getServiceVariables(input);
    const missing = expectedKeys.filter((key) => !asText(latest[key]));
    if (missing.length === 0) {
      return latest;
    }
    await sleep(3_000);
  }
  throw new Error(`应用变量注入超时，缺少: ${expectedKeys.filter((key) => !asText(latest[key])).join(', ')}`);
}

async function getEnvironmentServiceIds(adminToken: string, environmentId: string) {
  const result = await requestRailwayGraphql<{
    environment?: {
      serviceInstances?: {
        edges?: Array<{
          node?: {
            serviceId?: string | null;
          } | null;
        }>;
      } | null;
    } | null;
  }>(
    adminToken,
    `
      query InspectEnvironment($id: String!) {
        environment(id: $id) {
          serviceInstances {
            edges {
              node {
                serviceId
              }
            }
          }
        }
      }
    `,
    { id: environmentId }
  );

  return (
    result.environment?.serviceInstances?.edges
      ?.map((edge) => asText(edge?.node?.serviceId))
      .filter(Boolean) || []
  );
}

async function listProjectServices(adminToken: string, projectId: string) {
  const result = await requestRailwayGraphql<{
    project?: {
      services?: {
        edges?: Array<{
          node?: {
            id?: string | null;
            name?: string | null;
          } | null;
        }>;
      } | null;
    } | null;
  }>(
    adminToken,
    `
      query InspectProjectServices($projectId: String!) {
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
    { projectId }
  );

  return (
    result.project?.services?.edges?.map((edge) => ({
      id: asText(edge?.node?.id),
      name: asText(edge?.node?.name),
    })) || []
  ).filter((item) => item.id);
}

async function listProjectEnvironmentIds(adminToken: string, projectId: string) {
  const result = await requestRailwayGraphql<{
    project?: {
      environments?: {
        edges?: Array<{
          node?: {
            id?: string | null;
          } | null;
        }>;
      } | null;
    } | null;
  }>(
    adminToken,
    `
      query InspectProjectEnvironments($id: String!) {
        project(id: $id) {
          environments {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `,
    { id: projectId }
  );

  return (
    result.project?.environments?.edges
      ?.map((edge) => asText(edge?.node?.id))
      .filter(Boolean) || []
  );
}

async function listProjectBuckets(adminToken: string, projectId: string) {
  const result = await requestRailwayGraphql<{
    project?: {
      buckets?: {
        edges?: Array<{
          node?: {
            id?: string | null;
            name?: string | null;
          } | null;
        }>;
      } | null;
    } | null;
  }>(
    adminToken,
    `
      query InspectProjectBuckets($id: String!) {
        project(id: $id) {
          buckets {
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
    { id: projectId }
  );

  return (
    result.project?.buckets?.edges
      ?.map((edge) => ({
        id: asText(edge?.node?.id),
        name: asText(edge?.node?.name),
      }))
      .filter((bucket) => bucket.id) || []
  );
}

async function main() {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const userId = 'oneceo-resource-smoke-user';
  const projectKey = `resource-smoke-${Date.now()}`;
  let projectId = '';
  let environmentId = '';
  let appServiceId = '';
  let databaseServiceId = '';
  let bucketId = '';
  let primaryError: unknown = null;

  console.log(JSON.stringify({ stage: 'init', userId, projectKey, envSource: process.env.ONECEO_ENV_SOURCE || '' }));

  try {
    const account = await platformDeploymentAccountService.ensureProjectAccount(userId, projectKey);
    projectId = account.projectId;
    environmentId = account.environmentId;
    appServiceId = account.serviceId;
    console.log(
      JSON.stringify({
        stage: 'account-ready',
        projectId: account.projectId,
        environmentId: account.environmentId,
        serviceId: account.serviceId,
        repo: account.githubRepoFullName,
      })
    );

    const accountWithDatabase = await platformDeploymentAccountService.ensureProjectDatabaseResources(
      userId,
      projectKey
    );
    databaseServiceId = accountWithDatabase.databaseServiceId || '';
    assert.ok(databaseServiceId, '数据库服务未写入账号');
    assert.ok(accountWithDatabase.databaseServiceName, '数据库服务名未写入账号');
    console.log(
      JSON.stringify({
        stage: 'database-ready',
        databaseServiceId: accountWithDatabase.databaseServiceId,
        databaseServiceName: accountWithDatabase.databaseServiceName,
      })
    );

    const databaseSummary = await railwayDatabaseService.getSummary(accountWithDatabase);
    assert.equal(databaseSummary.configured, true);
    assert.equal(databaseSummary.provider, 'railway_postgres');
    assert.ok(databaseSummary.connection.connectionUrl, '数据库连接信息缺失');
    console.log(
      JSON.stringify({
        stage: 'database-summary-ready',
        tables: databaseSummary.tables.length,
        host: databaseSummary.connection.host,
        database: databaseSummary.connection.database,
      })
    );

    const schemaSummary = await railwayDatabaseService.getSchemaSummary(accountWithDatabase);
    assert.equal(schemaSummary.configured, true);
    assert.ok(Array.isArray(schemaSummary.tables), '数据库 schema 摘要缺失');
    console.log(
      JSON.stringify({
        stage: 'database-schema-ready',
        tableCount: schemaSummary.tables.length,
      })
    );

    const storageStatus = await projectStorageResourceService.ensureRailwayBucket(userId, projectKey, {
      revealSecrets: true,
    });
    assert.equal(storageStatus.configured, true);
    assert.equal(storageStatus.status, 'ready');
    assert.ok(storageStatus.bucket?.id, 'Bucket id 缺失');
    assert.ok(storageStatus.bucket?.accessKeyId, 'Bucket accessKeyId 缺失');
    assert.ok(storageStatus.bucket?.secretAccessKey, 'Bucket secretAccessKey 缺失');
    bucketId = storageStatus.bucket?.id || '';
    console.log(
      JSON.stringify({
        stage: 'storage-ready',
        bucketId: storageStatus.bucket?.id,
        bucketName: storageStatus.bucket?.name,
        endpoint: storageStatus.bucket?.endpoint,
      })
    );

    const injectedVariables = await waitForInjectedVariables(
      {
        token: accountWithDatabase.accessToken,
        projectId: accountWithDatabase.projectId,
        environmentId: accountWithDatabase.environmentId,
        serviceId: accountWithDatabase.serviceId,
      },
      [
        'DATABASE_URL',
        'DATABASE_PUBLIC_URL',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'S3_ENDPOINT',
        'S3_BUCKET_NAME',
      ]
    );
    console.log(
      JSON.stringify({
        stage: 'variables-ready',
        databaseUrlHost: asText(injectedVariables.DATABASE_URL).split('@')[1]?.split('/')[0] || '',
        bucketName: asText(injectedVariables.S3_BUCKET_NAME),
      })
    );

    assert.equal(asText(injectedVariables.ONECEO_STORAGE_ENABLED), 'true');
    assert.equal(asText(injectedVariables.ONECEO_STORAGE_PROVIDER), 'railway_bucket');
    assert.equal(asText(injectedVariables.S3_BUCKET_NAME), storageStatus.bucket?.name || '');

    const storedStorageRow = await projectStorageResourceDAO.getByUserAndProjectKey(userId, projectKey);
    assert.ok(storedStorageRow, '存储资源未落库');
    assert.equal(storedStorageRow?.railwayEnvironmentId, accountWithDatabase.environmentId);
    assert.equal(storedStorageRow?.railwayProjectId, accountWithDatabase.projectId);
    console.log(
      JSON.stringify({
        stage: 'storage-row-ready',
        rowBucketId: storedStorageRow?.railwayBucketId,
      })
    );

    const environmentServiceIds = await getEnvironmentServiceIds(adminToken, accountWithDatabase.environmentId);
    assert.ok(environmentServiceIds.includes(accountWithDatabase.serviceId), '应用服务未附着到环境');
    assert.ok(
      accountWithDatabase.databaseServiceId
        ? environmentServiceIds.includes(accountWithDatabase.databaseServiceId)
        : false,
      '数据库服务未附着到环境'
    );
    console.log(
      JSON.stringify({
        stage: 'environment-attached',
        serviceIds: environmentServiceIds,
      })
    );
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await platformDeploymentAccountService.cleanupFailedProjectResources(userId, projectKey);
      console.log(JSON.stringify({ stage: 'cleanup-requested', projectKey }));
    } catch (cleanupError) {
      if (!primaryError) {
        throw cleanupError;
      }
      console.error(
        JSON.stringify({
          stage: 'cleanup-failed-after-primary-error',
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      );
    }
  }

  if (primaryError) {
    throw primaryError;
  }

  const accountAfterCleanup = await platformDeploymentAccountService.getProjectAccount(userId, projectKey);
  assert.equal(accountAfterCleanup, null, '清理后部署账号仍存在');

  const storageRowAfterCleanup = await projectStorageResourceDAO.getByUserAndProjectKey(userId, projectKey);
  assert.equal(storageRowAfterCleanup, null, '清理后存储资源仍存在');

  if (projectId) {
    const remainingEnvironmentIds = await listProjectEnvironmentIds(adminToken, projectId);
    assert.equal(
      remainingEnvironmentIds.includes(environmentId),
      false,
      '清理后 Railway Environment 仍存在于 Railway Project'
    );

    const remainingProjectServices = await listProjectServices(adminToken, projectId);
    assert.equal(
      remainingProjectServices.some((service) => service.id === appServiceId),
      false,
      '清理后应用服务仍存在于 Railway Project'
    );
    assert.equal(
      remainingProjectServices.some((service) => service.id === databaseServiceId),
      false,
      '清理后数据库服务仍存在于 Railway Project'
    );

    const remainingProjectBuckets = await listProjectBuckets(adminToken, projectId);
    assert.equal(
      remainingProjectBuckets.some((bucket) => bucket.id === bucketId),
      false,
      '清理后存储桶仍存在于 Railway Project'
    );
  }

  console.log(
    JSON.stringify({
      stage: 'cleanup-verified',
      projectId,
      environmentId,
      appServiceId,
      databaseServiceId,
    })
  );
}

await main();
