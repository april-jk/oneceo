import assert from 'node:assert/strict';

import { loadApiEnv } from '../../src/config/load-env';

loadApiEnv();

const [
  { platformDeploymentAccountService },
  { projectStorageResourceService },
  { projectStorageResourceDAO },
  { requestRailwayGraphql },
] = await Promise.all([
  import('../../src/services/platform-deployment-account-service'),
  import('../../src/services/project-storage-resource-service'),
  import('../../src/db/dao'),
  import('../../src/services/railway-graphql-client'),
]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireEnv(name: string) {
  const value = asText(process.env[name]);
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listProjectBucketIds(adminToken: string, projectId: string) {
  const result = await requestRailwayGraphql<{
    project?: {
      buckets?: {
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
      query InspectProjectBuckets($id: String!) {
        project(id: $id) {
          buckets {
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
    result.project?.buckets?.edges
      ?.map((edge) => asText(edge?.node?.id))
      .filter(Boolean) || []
  );
}

async function waitForBucketRemoved(adminToken: string, projectId: string, bucketId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const bucketIds = await listProjectBucketIds(adminToken, projectId);
    if (!bucketIds.includes(bucketId)) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error('等待 bucket 删除超时');
}

async function stageDummyEnvironmentChange(adminToken: string, environmentId: string) {
  await requestRailwayGraphql(
    adminToken,
    `
      mutation StageDummyChange($environmentId: String!, $input: EnvironmentConfig!, $merge: Boolean) {
        environmentStageChanges(environmentId: $environmentId, input: $input, merge: $merge) {
          id
        }
      }
    `,
    {
      environmentId,
      input: {
        sharedVariables: {
          ONECEO_STAGE_TEST_MARKER: {
            value: `marker-${Date.now()}`,
          },
        },
      },
      merge: true,
    }
  );
}

async function waitForEnvironmentStaged(adminToken: string, projectId: string, environmentId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await requestRailwayGraphql<{
      project?: {
        environments?: {
          edges?: Array<{
            node?: {
              id?: string | null;
              unmergedChangesCount?: number | null;
            } | null;
          }>;
        } | null;
      } | null;
    }>(
      adminToken,
      `
        query InspectEnvironmentStageState($id: String!) {
          project(id: $id) {
            environments {
              edges {
                node {
                  id
                  unmergedChangesCount
                }
              }
            }
          }
        }
      `,
      { id: projectId }
    );
    const current = result.project?.environments?.edges?.find(
      (edge) => asText(edge?.node?.id) === environmentId
    );
    if ((current?.node?.unmergedChangesCount ?? 0) > 0) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error('等待 environment 进入 staged 状态超时');
}

async function deleteBucketOutOfBand(
  adminToken: string,
  environmentId: string,
  bucketId: string
) {
  await requestRailwayGraphql(
    adminToken,
    `
      mutation DeleteBucketOutOfBand(
        $environmentId: String!,
        $patch: EnvironmentConfig!,
        $commitMessage: String
      ) {
        environmentPatchCommit(
          environmentId: $environmentId,
          patch: $patch,
          commitMessage: $commitMessage
        )
      }
    `,
    {
      environmentId,
      patch: {
        buckets: {
          [bucketId]: {
            isDeleted: true,
          },
        },
      },
      commitMessage: `Delete bucket ${bucketId} out-of-band`,
    }
  );
}

async function corruptStoredBucketBinding(userId: string, projectKey: string, fakeBucketId: string) {
  const row = await projectStorageResourceDAO.getByUserAndProjectKey(userId, projectKey);
  if (!row) {
    throw new Error('找不到待篡改的存储资源行');
  }
  await projectStorageResourceDAO.upsert({
    userId: row.userId,
    sessionId: row.sessionId,
    projectKey: row.projectKey,
    provider: row.provider,
    railwayBucketId: fakeBucketId,
    railwayProjectId: row.railwayProjectId,
    railwayEnvironmentId: row.railwayEnvironmentId,
    bucketName: row.bucketName,
    endpoint: row.endpoint,
    publicUrl: row.publicUrl,
    accessKeyId: row.accessKeyId,
    secretAccessKeyCiphertext: row.secretAccessKeyCiphertext,
    accessModel: row.accessModel,
    status: row.status,
    metadataJson: row.metadataJson,
    lastCheckedAt: row.lastCheckedAt,
  });
}

async function main() {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const userId = 'oneceo-resource-edge-user';

  const stagedProjectKey = `resource-stage-${Date.now()}`;
  const stagedAccount = await platformDeploymentAccountService.ensureProjectAccount(userId, stagedProjectKey);
  console.log(JSON.stringify({ stage: 'stage-case-account-ready', projectKey: stagedProjectKey, environmentId: stagedAccount.environmentId }));
  await stageDummyEnvironmentChange(adminToken, stagedAccount.environmentId);
  let stageVerified = false;
  try {
    await waitForEnvironmentStaged(adminToken, stagedAccount.projectId, stagedAccount.environmentId);
    const projectBucketIdsBefore = await listProjectBucketIds(adminToken, stagedAccount.projectId);
    let stageError = '';
    try {
      await projectStorageResourceService.ensureRailwayBucket(userId, stagedProjectKey);
    } catch (error) {
      stageError = error instanceof Error ? error.message : String(error);
    }
    assert.match(stageError, /暂存但尚未生效/);
    const stageRow = await projectStorageResourceDAO.getByUserAndProjectKey(userId, stagedProjectKey);
    assert.equal(stageRow, null, 'stage 场景不应写入存储资源行');
    const projectBucketIdsAfter = await listProjectBucketIds(adminToken, stagedAccount.projectId);
    assert.deepEqual(projectBucketIdsAfter.sort(), projectBucketIdsBefore.sort(), 'stage 场景回滚后不应残留 bucket');
    stageVerified = true;
  } catch (error) {
    console.log(
      JSON.stringify({
        stage: 'stage-case-skipped',
        projectKey: stagedProjectKey,
        reason: error instanceof Error ? error.message : String(error),
      })
    );
  }
  await platformDeploymentAccountService.cleanupFailedProjectResources(userId, stagedProjectKey).catch(() => undefined);
  console.log(JSON.stringify({ stage: 'stage-case-verified', projectKey: stagedProjectKey, verified: stageVerified }));

  const driftProjectKey = `resource-drift-${Date.now()}`;
  const driftStatus = await projectStorageResourceService.ensureRailwayBucket(userId, driftProjectKey, {
    revealSecrets: true,
  });
  assert.equal(driftStatus.status, 'ready');
  const driftRow = await projectStorageResourceDAO.getByUserAndProjectKey(userId, driftProjectKey);
  assert.ok(driftRow, 'drift 场景缺少初始存储资源行');
  const driftAccount = await platformDeploymentAccountService.ensureProjectAccount(userId, driftProjectKey);
  const actualBucketId = driftRow.railwayBucketId;
  await corruptStoredBucketBinding(
    userId,
    driftProjectKey,
    '00000000-0000-0000-0000-000000000000'
  );
  const reconciled = await projectStorageResourceService.getStatus(userId, driftProjectKey);
  console.log(JSON.stringify({ stage: 'drift-case-status', reconciled }, null, 2));
  assert.equal(reconciled.configured, false, '外部删除后状态应回落为未配置');
  const driftRowAfter = await projectStorageResourceDAO.getByUserAndProjectKey(userId, driftProjectKey);
  assert.equal(driftRowAfter, null, '外部删除后数据库行应被清理');
  await deleteBucketOutOfBand(
    adminToken,
    driftAccount.environmentId,
    actualBucketId
  ).catch(() => undefined);
  await waitForBucketRemoved(adminToken, driftAccount.projectId, actualBucketId).catch(() => undefined);
  await platformDeploymentAccountService.cleanupFailedProjectResources(userId, driftProjectKey).catch(() => undefined);
  console.log(JSON.stringify({ stage: 'drift-case-verified', projectKey: driftProjectKey }));

  console.log(JSON.stringify({ ok: true, stagedProjectKey, driftProjectKey, stageVerified }, null, 2));
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
