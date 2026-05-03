import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createHash, createHmac } from 'node:crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { projectStorageResourceDAO } from '../db/dao';
import type { ProjectStorageResource } from '../db/schema';
import {
  platformDeploymentAccountService,
  type UserPlatformDeploymentAccount,
} from './platform-deployment-account-service';
import { connectorSecretService } from './connector-secret-service';
import { requestRailwayGraphql } from './railway-graphql-client';

type RailwayBucketCreateResponse = {
  bucketCreate?: {
    id?: string;
    name?: string;
    projectId?: string;
  };
};

type RailwayBucketCredentials = {
  accessKeyId?: string;
  bucketName?: string;
  endpoint?: string;
  region?: string;
  secretAccessKey?: string;
  urlStyle?: string;
};

type RailwayBucketCredentialsQueryResponse = {
  bucketS3Credentials?: RailwayBucketCredentials[];
};

type RailwayBucketCredentialsResetResponse = {
  bucketCredentialsReset?: RailwayBucketCredentials;
};

type RailwayEnvironmentPatchCommitResponse = {
  environmentPatchCommit?: string | null;
};

type RailwayEnvironmentStageChangesResponse = {
  environmentStageChanges?: string | null;
};

type RailwayEnvironmentInfoResponse = {
  project?: {
    environments?: {
      edges?: Array<{
        node?: {
          id?: string;
          unmergedChangesCount?: number | null;
        };
      }>;
    };
  };
};

type RailwayBucketInstanceDetailsResponse = {
  bucketInstanceDetails?: {
    sizeBytes?: number | null;
    objectCount?: number | null;
  } | null;
};

type RailwayEnvironmentBucketPatch = {
  buckets: Record<
    string,
    {
      region?: string;
      isCreated?: boolean;
      isDeleted?: boolean;
    }
  >;
};

type RailwayBucketPatchMode = 'commit' | 'stage';

type LiveBucketVerificationResult =
  | {
      kind: 'ready';
      credentials: RailwayBucketCredentials;
    }
  | {
      kind: 'missing';
    }
  | {
      kind: 'error';
      message: string;
    };

export type ProjectStorageResourceStatus = {
  configured: boolean;
  provider: 'railway_bucket';
  status: 'not_configured' | 'ready' | 'error';
  projectKey: string;
  bucket?: {
    id: string;
    name: string;
    endpoint: string;
    publicUrl?: string;
    accessKeyId: string;
    secretAccessKey?: string;
  };
  applicationVariables?: {
    wired: boolean;
    keys: string[];
  };
  files?: Array<{
    key: string;
    sizeBytes?: number;
    lastModifiedAt?: string;
  }>;
  accessModel?: string;
  lastCheckedAt?: string;
};

export type ProjectStorageDirectUploadTarget = {
  key: string;
  method: 'POST';
  url: string;
  fields: Record<string, string>;
  expiresInSeconds: number;
};

export const TASK_CREATION_STORAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

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

function normalizeProjectKey(projectKey: string) {
  const key = asText(projectKey);
  if (!key) {
    throw new Error('projectKey 不能为空');
  }
  return key;
}

function buildBucketName(userId: string, projectKey: string) {
  const digest = createHash('sha1').update(`${userId}:${projectKey}`).digest('hex').slice(0, 12);
  return `oneceo-${digest}`;
}

function toStatus(
  row: ProjectStorageResource | null,
  projectKey: string,
  secretAccessKey?: string | null,
  files?: ProjectStorageResourceStatus['files']
): ProjectStorageResourceStatus {
  if (!row) {
    return {
      configured: false,
      provider: 'railway_bucket',
      status: 'not_configured',
      projectKey,
    };
  }
  const metadata: Record<string, unknown> =
    row.metadataJson && typeof row.metadataJson === 'object'
      ? (row.metadataJson as Record<string, unknown>)
      : {};
  return {
    configured: true,
    provider: 'railway_bucket',
    status: row.status === 'error' ? 'error' : 'ready',
    projectKey: row.projectKey,
    bucket: {
      id: row.railwayBucketId,
      name: row.bucketName,
      endpoint: row.endpoint,
      publicUrl: row.publicUrl || undefined,
      accessKeyId: row.accessKeyId,
      secretAccessKey: secretAccessKey || undefined,
    },
    applicationVariables: {
      wired: true,
      keys: [
        'ONECEO_STORAGE_ENABLED',
        'ONECEO_STORAGE_PROVIDER',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'S3_ENDPOINT',
        'S3_BUCKET_NAME',
        ...(row.publicUrl ? ['S3_PUBLIC_URL'] : []),
      ],
    },
    files,
    accessModel: row.accessModel,
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
  };
}

function buildStorageVariables(row: Pick<ProjectStorageResource, 'bucketName' | 'endpoint' | 'publicUrl' | 'accessKeyId'>, secretAccessKey: string) {
  const variables: Record<string, string> = {
    ONECEO_STORAGE_ENABLED: 'true',
    ONECEO_STORAGE_PROVIDER: 'railway_bucket',
    S3_ACCESS_KEY_ID: row.accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
    S3_ENDPOINT: row.endpoint,
    S3_BUCKET_NAME: row.bucketName,
  };
  if (row.publicUrl) {
    variables.S3_PUBLIC_URL = row.publicUrl;
  }
  return variables;
}

function buildBucketClient(
  row: Pick<ProjectStorageResource, 'endpoint' | 'accessKeyId' | 'metadataJson'>,
  secretAccessKey: string
) {
  const metadata: Record<string, unknown> =
    row.metadataJson && typeof row.metadataJson === 'object'
      ? (row.metadataJson as Record<string, unknown>)
      : {};
  const region =
    typeof metadata.region === 'string' && metadata.region.trim()
      ? metadata.region.trim()
      : 'auto';
  const urlStyle =
    typeof metadata.urlStyle === 'string' ? metadata.urlStyle.trim().toLowerCase() : '';

  return new S3Client({
    region,
    endpoint: row.endpoint,
    forcePathStyle: urlStyle === 'path',
    credentials: {
      accessKeyId: row.accessKeyId,
      secretAccessKey,
    },
  });
}

function buildDirectUploadActionUrl(
  row: Pick<ProjectStorageResource, 'bucketName' | 'endpoint' | 'metadataJson'>
) {
  const endpoint = new URL(row.endpoint);
  const metadata: Record<string, unknown> =
    row.metadataJson && typeof row.metadataJson === 'object'
      ? (row.metadataJson as Record<string, unknown>)
      : {};
  const urlStyle =
    typeof metadata.urlStyle === 'string' ? metadata.urlStyle.trim().toLowerCase() : '';
  if (urlStyle === 'path') {
    endpoint.pathname = `/${row.bucketName}`;
    return endpoint.toString();
  }
  endpoint.hostname = `${row.bucketName}.${endpoint.hostname}`;
  endpoint.pathname = '/';
  return endpoint.toString();
}

function getAwsV4SigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const kDate = createHmac('sha256', Buffer.from(`AWS4${secretAccessKey}`, 'utf8'))
    .update(dateStamp)
    .digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/g, (match) => match.toLowerCase());
}

async function listBucketObjects(
  row: Pick<ProjectStorageResource, 'bucketName' | 'endpoint' | 'accessKeyId' | 'metadataJson'>,
  secretAccessKey: string
) {
  const client = buildBucketClient(row, secretAccessKey);
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: row.bucketName,
      MaxKeys: 200,
    })
  );
  return (response.Contents || [])
    .filter((item) => Boolean(item.Key))
    .map((item) => ({
      key: item.Key as string,
      sizeBytes: typeof item.Size === 'number' ? item.Size : undefined,
      lastModifiedAt: item.LastModified?.toISOString(),
    }))
    .sort((left, right) => {
      const leftTime = left.lastModifiedAt ? new Date(left.lastModifiedAt).getTime() : 0;
      const rightTime = right.lastModifiedAt ? new Date(right.lastModifiedAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

async function deleteBucketObject(
  row: Pick<ProjectStorageResource, 'bucketName' | 'endpoint' | 'accessKeyId' | 'metadataJson'>,
  secretAccessKey: string,
  key: string
) {
  const client = buildBucketClient(row, secretAccessKey);
  await client.send(
    new DeleteObjectCommand({
      Bucket: row.bucketName,
      Key: key,
    })
  );
}

function isBucketInstancePendingError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('bucketinstance not found') ||
    message.includes('bucket instance not found') ||
    message.includes('operation is already in progress')
  );
}

function isRailwayOperationInProgressError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('operation is already in progress');
}

async function waitForBucketCredentials(account: UserPlatformDeploymentAccount, bucketId: string) {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const credentials = await requestRailwayGraphql<RailwayBucketCredentialsQueryResponse>(
        adminToken,
        `
          query BucketS3Credentials(
            $bucketId: String!,
            $projectId: String!,
            $environmentId: String!
          ) {
            bucketS3Credentials(
              bucketId: $bucketId,
              projectId: $projectId,
              environmentId: $environmentId
            ) {
              accessKeyId
              bucketName
              endpoint
              region
              secretAccessKey
              urlStyle
            }
          }
        `,
        {
          bucketId,
          projectId: account.projectId,
          environmentId: account.environmentId,
        }
      );
      const first = Array.isArray(credentials.bucketS3Credentials)
        ? credentials.bucketS3Credentials[0]
        : null;
      if (!first) {
        throw new Error('No S3-compatible credentials were returned for this bucket.');
      }
      return first;
    } catch (error) {
      lastError = error;
      if (!isBucketInstancePendingError(error) || attempt === 9) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Railway Bucket 凭证获取失败');
}

async function resetBucketCredentials(
  account: UserPlatformDeploymentAccount,
  bucketId: string
) {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const credentials = await requestRailwayGraphql<RailwayBucketCredentialsResetResponse>(
    adminToken,
    `
      mutation ResetBucketCredentials(
        $bucketId: String!,
        $projectId: String!,
        $environmentId: String!
      ) {
        bucketCredentialsReset(
          bucketId: $bucketId,
          projectId: $projectId,
          environmentId: $environmentId
        ) {
          accessKeyId
          bucketName
          endpoint
          region
          secretAccessKey
          urlStyle
        }
      }
    `,
    {
      bucketId,
      projectId: account.projectId,
      environmentId: account.environmentId,
    }
  );
  return credentials.bucketCredentialsReset ?? null;
}

async function deleteProjectLevelBucket(adminToken: string, bucketId: string) {
  await requestRailwayGraphql<{ bucketDelete?: boolean | null }>(
    adminToken,
    `
      mutation DeleteProjectLevelBucket($id: String!) {
        bucketDelete(id: $id)
      }
    `,
    {
      id: bucketId,
    }
  );
}

async function getEnvironmentBucketPatchMode(
  account: UserPlatformDeploymentAccount
): Promise<RailwayBucketPatchMode> {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const response = await requestRailwayGraphql<RailwayEnvironmentInfoResponse>(
    adminToken,
    `
      query ProjectEnvironmentBucketPatchMode($projectId: String!) {
        project(id: $projectId) {
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
    {
      projectId: account.projectId,
    }
  );
  const environmentEdge = response.project?.environments?.edges?.find(
    (candidate) => asText(candidate?.node?.id) === account.environmentId
  );
  return (environmentEdge?.node?.unmergedChangesCount ?? 0) > 0 ? 'stage' : 'commit';
}

async function applyEnvironmentBucketPatch(
  account: UserPlatformDeploymentAccount,
  patch: RailwayEnvironmentBucketPatch,
  commitMessage: string
): Promise<RailwayBucketPatchMode> {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const patchMode = await getEnvironmentBucketPatchMode(account);
  if (patchMode === 'stage') {
    await requestRailwayGraphql<RailwayEnvironmentStageChangesResponse>(
      adminToken,
      `
        mutation StageBucketEnvironmentChanges(
          $environmentId: String!,
          $input: EnvironmentConfig!,
          $merge: Boolean
        ) {
          environmentStageChanges(
            environmentId: $environmentId,
            input: $input,
            merge: $merge
          )
        }
      `,
      {
        environmentId: account.environmentId,
        input: patch,
        merge: true,
      }
    );
    return 'stage';
  }

  await requestRailwayGraphql<RailwayEnvironmentPatchCommitResponse>(
    adminToken,
    `
      mutation CommitBucketEnvironmentPatch(
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
      environmentId: account.environmentId,
      patch,
      commitMessage,
    }
  );
  return 'commit';
}

async function createRailwayBucket(account: UserPlatformDeploymentAccount, bucketName: string) {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const createMutation = `
    mutation($input: BucketCreateInput!) {
      bucketCreate(input: $input) {
        id
        name
        projectId
      }
    }
  `;
  const created = await requestRailwayGraphql<RailwayBucketCreateResponse>(adminToken, createMutation, {
    input: {
      projectId: account.projectId,
      name: bucketName,
    },
  });
  const bucketId = asText(created.bucketCreate?.id);
  if (!bucketId) {
    throw new Error('Railway Bucket 创建结果不完整');
  }
  try {
    const patchMode = await applyEnvironmentBucketPatch(
      account,
      {
        buckets: {
          [bucketId]: {
            region: 'sin',
            isCreated: true,
          },
        },
      },
      `Create bucket ${bucketName}`
    );
    if (patchMode === 'stage') {
      await deleteProjectLevelBucket(adminToken, bucketId).catch(() => undefined);
      throw new Error('Railway 环境存在未提交改动，Bucket 创建已暂存但尚未生效');
    }
    let credentials = await waitForBucketCredentials(account, bucketId);
    if (!asText(credentials?.secretAccessKey)) {
      credentials = (await resetBucketCredentials(account, bucketId)) ?? credentials;
    }
    return {
      bucket: created.bucketCreate,
      credentials,
    };
  } catch (error) {
    await deleteAttachedBucketReliably(account, bucketId).catch(async () => {
      await deleteProjectLevelBucket(adminToken, bucketId).catch(() => undefined);
    });
    throw error;
  }
}

async function deleteRailwayBucketFromEnvironment(
  account: UserPlatformDeploymentAccount,
  bucketId: string
) {
  const patchMode = await applyEnvironmentBucketPatch(
    account,
    {
      buckets: {
        [bucketId]: {
          isDeleted: true,
        },
      },
    },
    `Delete bucket ${bucketId}`
  );
  if (patchMode === 'stage') {
    throw new Error('Railway 环境存在未提交改动，Bucket 删除已暂存但尚未生效');
  }
}

async function waitForBucketRemoval(account: UserPlatformDeploymentAccount, bucketId: string) {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const details = await requestRailwayGraphql<RailwayBucketInstanceDetailsResponse>(
        adminToken,
        `
          query BucketInstanceDetails($bucketId: String!, $environmentId: String!) {
            bucketInstanceDetails(bucketId: $bucketId, environmentId: $environmentId) {
              sizeBytes
              objectCount
            }
          }
        `,
        {
          bucketId,
          environmentId: account.environmentId,
        }
      );
      if (!details.bucketInstanceDetails) {
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (isBucketInstancePendingError(error) || message.includes('not found')) {
        return;
      }
      if (attempt === 9) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
  }
}

async function waitForProjectBucketRemoval(
  account: UserPlatformDeploymentAccount,
  bucketId: string,
  timeoutMs = 30_000
) {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
        query InspectProjectBuckets($projectId: String!) {
          project(id: $projectId) {
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
      {
        projectId: account.projectId,
      }
    );
    const stillPresent = Boolean(
      result.project?.buckets?.edges?.some((edge) => asText(edge?.node?.id) === bucketId)
    );
    if (!stillPresent) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function projectHasBucket(
  account: UserPlatformDeploymentAccount,
  bucketId: string
) {
  const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
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
      query InspectProjectBuckets($projectId: String!) {
        project(id: $projectId) {
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
    {
      projectId: account.projectId,
    }
  );
  return Boolean(
    result.project?.buckets?.edges?.some((edge) => asText(edge?.node?.id) === bucketId)
  );
}

async function deleteAttachedBucketReliably(
  account: UserPlatformDeploymentAccount,
  bucketId: string
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await deleteRailwayBucketFromEnvironment(account, bucketId);
      await waitForBucketRemoval(account, bucketId);
      const removed = await waitForProjectBucketRemoval(account, bucketId);
      if (!removed) {
        throw new Error('Railway Bucket 删除后仍保留在项目中');
      }
      return;
    } catch (error) {
      lastError = error;
      if (!isRailwayOperationInProgressError(error) || attempt === 7) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Railway Bucket 删除失败');
}

async function verifyLiveBucket(
  account: UserPlatformDeploymentAccount,
  row: ProjectStorageResource
): Promise<LiveBucketVerificationResult> {
  try {
    const adminToken = requireEnv('RAILWAY_ADMIN_TOKEN');
    const details = await requestRailwayGraphql<RailwayBucketInstanceDetailsResponse>(
      adminToken,
      `
        query BucketInstanceDetails($bucketId: String!, $environmentId: String!) {
          bucketInstanceDetails(bucketId: $bucketId, environmentId: $environmentId) {
            sizeBytes
            objectCount
          }
        }
      `,
      {
        bucketId: row.railwayBucketId,
        environmentId: account.environmentId,
      }
    );
    if (!details.bucketInstanceDetails) {
      return { kind: 'missing' };
    }
    const credentials = await waitForBucketCredentials(account, row.railwayBucketId);
    const bucketName = asText(credentials.bucketName);
    const endpoint = asText(credentials.endpoint);
    const accessKeyId = asText(credentials.accessKeyId);
    if (!bucketName || !endpoint || !accessKeyId) {
      return {
        kind: 'error',
        message: 'Railway Bucket 实时凭证不完整',
      };
    }
    return {
      kind: 'ready',
      credentials,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const bucketStillExists = await projectHasBucket(account, row.railwayBucketId).catch(() => true);
    if (!bucketStillExists) {
      return { kind: 'missing' };
    }
    if (isBucketInstancePendingError(error) || message.toLowerCase().includes('not found')) {
      return { kind: 'missing' };
    }
    return {
      kind: 'error',
      message,
    };
  }
}

async function syncStoredBucketRow(
  row: ProjectStorageResource,
  credentials: RailwayBucketCredentials
) {
  const secretAccessKey = asText(credentials.secretAccessKey);
  const encryptedSecret =
    (secretAccessKey
      ? connectorSecretService.encrypt(secretAccessKey, 'deployment')
      : row.secretAccessKeyCiphertext) || row.secretAccessKeyCiphertext;
  return projectStorageResourceDAO.upsert({
    userId: row.userId,
    sessionId: row.sessionId,
    projectKey: row.projectKey,
    provider: row.provider,
    railwayBucketId: row.railwayBucketId,
    railwayProjectId: row.railwayProjectId,
    railwayEnvironmentId: row.railwayEnvironmentId,
    bucketName: asText(credentials.bucketName) || row.bucketName,
    endpoint: asText(credentials.endpoint) || row.endpoint,
    publicUrl: row.publicUrl,
    accessKeyId: asText(credentials.accessKeyId) || row.accessKeyId,
    secretAccessKeyCiphertext: encryptedSecret,
    accessModel: row.accessModel,
    status: 'ready',
    metadataJson: {
      ...(row.metadataJson && typeof row.metadataJson === 'object' ? row.metadataJson : {}),
      ...(asText(credentials.region) ? { region: asText(credentials.region) } : {}),
      ...(asText(credentials.urlStyle) ? { urlStyle: asText(credentials.urlStyle) } : {}),
    },
    lastCheckedAt: new Date(),
  });
}

async function markStoredBucketRowError(row: ProjectStorageResource, message: string) {
  return projectStorageResourceDAO.upsert({
    userId: row.userId,
    sessionId: row.sessionId,
    projectKey: row.projectKey,
    provider: row.provider,
    railwayBucketId: row.railwayBucketId,
    railwayProjectId: row.railwayProjectId,
    railwayEnvironmentId: row.railwayEnvironmentId,
    bucketName: row.bucketName,
    endpoint: row.endpoint,
    publicUrl: row.publicUrl,
    accessKeyId: row.accessKeyId,
    secretAccessKeyCiphertext: row.secretAccessKeyCiphertext,
    accessModel: row.accessModel,
    status: 'error',
    metadataJson: {
      ...(row.metadataJson && typeof row.metadataJson === 'object' ? row.metadataJson : {}),
      lastError: message,
    },
    lastCheckedAt: new Date(),
  });
}

export class ProjectStorageResourceService {
  async getStatus(
    userId: string,
    projectKey: string,
    options?: { revealSecrets?: boolean }
  ): Promise<ProjectStorageResourceStatus> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const row = await projectStorageResourceDAO.getByUserAndProjectKey(userId, normalizedProjectKey);
    if (!row) {
      return toStatus(null, normalizedProjectKey);
    }
    const account = await platformDeploymentAccountService.ensureProjectAccount(
      userId,
      normalizedProjectKey
    );
    const live = await verifyLiveBucket(account, row);
    if (live.kind === 'missing') {
      await projectStorageResourceDAO.deleteByUserAndProjectKey(userId, normalizedProjectKey);
      return toStatus(null, normalizedProjectKey);
    }
    if (live.kind === 'error') {
      const erroredRow = await markStoredBucketRowError(row, live.message);
      const secretAccessKey = options?.revealSecrets
        ? connectorSecretService.decryptToString(erroredRow.secretAccessKeyCiphertext, 'deployment')
        : null;
      return toStatus(erroredRow, normalizedProjectKey, secretAccessKey);
    }
    const syncedRow = await syncStoredBucketRow(row, live.credentials);
    const bucketSecretAccessKey =
      asText(live.credentials.secretAccessKey) ||
      connectorSecretService.decryptToString(syncedRow.secretAccessKeyCiphertext, 'deployment');
    const files = bucketSecretAccessKey ? await listBucketObjects(syncedRow, bucketSecretAccessKey) : [];
    const secretAccessKey = options?.revealSecrets ? bucketSecretAccessKey : null;
    return toStatus(syncedRow, normalizedProjectKey, secretAccessKey, files);
  }

  async ensureRailwayBucket(
    userId: string,
    projectKey: string,
    options?: { revealSecrets?: boolean }
  ): Promise<ProjectStorageResourceStatus> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const account = await platformDeploymentAccountService.ensureProjectAccount(
      userId,
      normalizedProjectKey
    );
    const existing = await projectStorageResourceDAO.getByUserAndProjectKey(
      userId,
      normalizedProjectKey
    );
    if (existing) {
      const live = await verifyLiveBucket(account, existing);
      if (live.kind === 'missing') {
        await projectStorageResourceDAO.deleteByUserAndProjectKey(userId, normalizedProjectKey);
      } else if (live.kind === 'error') {
        const erroredRow = await markStoredBucketRowError(existing, live.message);
        return toStatus(
          erroredRow,
          normalizedProjectKey,
          options?.revealSecrets
            ? connectorSecretService.decryptToString(erroredRow.secretAccessKeyCiphertext, 'deployment')
            : null
        );
      } else {
        const syncedRow = await syncStoredBucketRow(existing, live.credentials);
        const secretAccessKey =
          asText(live.credentials.secretAccessKey) ||
          connectorSecretService.decryptToString(syncedRow.secretAccessKeyCiphertext, 'deployment');
        if (!secretAccessKey) {
          throw new Error('Railway Bucket 密钥缺失');
        }
        const files = await listBucketObjects(syncedRow, secretAccessKey);
        await platformDeploymentAccountService.upsertApplicationVariables(
          account,
          buildStorageVariables(syncedRow, secretAccessKey),
          { skipDeploys: true }
        );
        return toStatus(
          syncedRow,
          normalizedProjectKey,
          options?.revealSecrets ? secretAccessKey : null,
          files
        );
      }
    }

    {
      const bucketName = buildBucketName(userId, normalizedProjectKey);
      const response = await createRailwayBucket(account, bucketName);
      const bucket = response.bucket;
      const credentials = response.credentials;
      const bucketId = asText(bucket?.id);
      const accessKeyId = asText(credentials?.accessKeyId);
      const secretAccessKey = asText(credentials?.secretAccessKey);
      const endpoint = asText(credentials?.endpoint);
      if (!bucketId || !accessKeyId || !secretAccessKey || !endpoint) {
        throw new Error('Railway Bucket 创建结果不完整');
      }
      const encryptedSecret = connectorSecretService.encrypt(secretAccessKey, 'deployment');
      if (!encryptedSecret) {
        throw new Error('Railway Bucket 密钥加密失败');
      }

      const row = await projectStorageResourceDAO.upsert({
        userId,
        sessionId: normalizedProjectKey,
        projectKey: normalizedProjectKey,
        provider: 'railway_bucket',
        railwayBucketId: bucketId,
        railwayProjectId: account.projectId,
        railwayEnvironmentId: account.environmentId,
        bucketName: asText(credentials?.bucketName) || asText(bucket?.name) || bucketName,
        endpoint,
        publicUrl: null,
        accessKeyId,
        secretAccessKeyCiphertext: encryptedSecret,
        accessModel: 'public_and_private',
        status: 'ready',
        metadataJson: {
          ...(asText(credentials?.region) ? { region: asText(credentials?.region) } : {}),
          ...(asText(credentials?.urlStyle) ? { urlStyle: asText(credentials?.urlStyle) } : {}),
          createdBy: 'oneceo_altus',
        },
        lastCheckedAt: new Date(),
      });

      await platformDeploymentAccountService.upsertApplicationVariables(
        account,
        buildStorageVariables(row, secretAccessKey),
        { skipDeploys: true }
      );

      return toStatus(
        row,
        normalizedProjectKey,
        options?.revealSecrets ? secretAccessKey : null,
        []
      );
    }
  }

  async deleteRailwayBucket(userId: string, projectKey: string) {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const existing = await projectStorageResourceDAO.getByUserAndProjectKey(
      userId,
      normalizedProjectKey
    );
    if (!existing) {
      return null;
    }

    const account = await platformDeploymentAccountService.ensureProjectAccount(
      userId,
      normalizedProjectKey
    );
    await deleteAttachedBucketReliably(account, existing.railwayBucketId);

    await projectStorageResourceDAO.deleteByUserAndProjectKey(userId, normalizedProjectKey);
    return existing;
  }

  async createDirectUploadTarget(
    userId: string,
    projectKey: string,
    input: {
      fileName: string;
      fileSize?: number | null;
      contentType?: string | null;
    }
  ): Promise<ProjectStorageDirectUploadTarget> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const row = await projectStorageResourceDAO.getByUserAndProjectKey(userId, normalizedProjectKey);
    if (!row) {
      throw new Error('存储桶尚未启用');
    }
    const account = await platformDeploymentAccountService.ensureProjectAccount(
      userId,
      normalizedProjectKey
    );
    const live = await verifyLiveBucket(account, row);
    if (live.kind === 'missing') {
      await projectStorageResourceDAO.deleteByUserAndProjectKey(userId, normalizedProjectKey);
      throw new Error('存储桶尚未启用');
    }
    if (live.kind === 'error') {
      await markStoredBucketRowError(row, live.message);
      throw new Error(live.message);
    }

    const syncedRow = await syncStoredBucketRow(row, live.credentials);
    const secretAccessKey =
      asText(live.credentials.secretAccessKey) ||
      connectorSecretService.decryptToString(syncedRow.secretAccessKeyCiphertext, 'deployment');
    if (!secretAccessKey) {
      throw new Error('Railway Bucket 密钥缺失');
    }

    const fileName = asText(input.fileName);
    if (!fileName) {
      throw new Error('缺少文件名');
    }
    const fileSize = typeof input.fileSize === 'number' && Number.isFinite(input.fileSize)
      ? Math.max(0, Math.floor(input.fileSize))
      : null;
    if (fileSize !== null && fileSize > TASK_CREATION_STORAGE_UPLOAD_MAX_BYTES) {
      throw new Error(`文件过大，最大仅支持 ${Math.floor(TASK_CREATION_STORAGE_UPLOAD_MAX_BYTES / (1024 * 1024))}MB`);
    }

    const contentType = asText(input.contentType) || 'application/octet-stream';
    const expiresInSeconds = 900;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const amzDate = expiresAt.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const metadata: Record<string, unknown> =
      syncedRow.metadataJson && typeof syncedRow.metadataJson === 'object'
        ? (syncedRow.metadataJson as Record<string, unknown>)
        : {};
    const region =
      typeof metadata.region === 'string' && metadata.region.trim()
        ? metadata.region.trim()
        : 'auto';
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const credential = `${syncedRow.accessKeyId}/${credentialScope}`;
    const targetUrl = buildDirectUploadActionUrl(syncedRow);
    const policy = Buffer.from(
      JSON.stringify({
        expiration: expiresAt.toISOString(),
        conditions: [
          { bucket: syncedRow.bucketName },
          ['eq', '$key', fileName],
          ['eq', '$Content-Type', contentType],
          ['content-length-range', 0, TASK_CREATION_STORAGE_UPLOAD_MAX_BYTES],
          { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
          { 'x-amz-credential': credential },
          { 'x-amz-date': amzDate },
          { success_action_status: '201' },
        ],
      })
    ).toString('base64');
    const signingKey = getAwsV4SigningKey(secretAccessKey, dateStamp, region, 's3');
    const signature = createHmac('sha256', signingKey).update(policy).digest('hex');

    return {
      key: fileName,
      method: 'POST',
      url: targetUrl,
      fields: {
        key: fileName,
        'Content-Type': contentType,
        Policy: policy,
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': credential,
        'X-Amz-Date': amzDate,
        'X-Amz-Signature': signature,
        success_action_status: '201',
      },
      expiresInSeconds,
    };
  }

  async createDirectDownloadUrl(userId: string, projectKey: string, key: string): Promise<string> {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const objectKey = asText(key);
    if (!objectKey) {
      throw new Error('缺少文件 key');
    }
    const row = await projectStorageResourceDAO.getByUserAndProjectKey(userId, normalizedProjectKey);
    if (!row) {
      throw new Error('存储桶尚未启用');
    }
    const account = await platformDeploymentAccountService.ensureProjectAccount(
      userId,
      normalizedProjectKey
    );
    const live = await verifyLiveBucket(account, row);
    if (live.kind === 'missing') {
      await projectStorageResourceDAO.deleteByUserAndProjectKey(userId, normalizedProjectKey);
      throw new Error('存储桶尚未启用');
    }
    if (live.kind === 'error') {
      await markStoredBucketRowError(row, live.message);
      throw new Error(live.message);
    }

    const syncedRow = await syncStoredBucketRow(row, live.credentials);
    const secretAccessKey =
      asText(live.credentials.secretAccessKey) ||
      connectorSecretService.decryptToString(syncedRow.secretAccessKeyCiphertext, 'deployment');
    if (!secretAccessKey) {
      throw new Error('Railway Bucket 密钥缺失');
    }

    const client = buildBucketClient(syncedRow, secretAccessKey);
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: syncedRow.bucketName,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeRFC5987ValueChars(objectKey)}`,
      }),
      { expiresIn: 900 }
    );
  }

  async deleteObject(
    userId: string,
    projectKey: string,
    key: string,
    options?: { revealSecrets?: boolean }
  ) {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const objectKey = asText(key);
    if (!objectKey) {
      throw new Error('缺少对象 key');
    }
    const row = await projectStorageResourceDAO.getByUserAndProjectKey(userId, normalizedProjectKey);
    if (!row) {
      throw new Error('存储桶尚未启用');
    }
    const account = await platformDeploymentAccountService.ensureProjectAccount(
      userId,
      normalizedProjectKey
    );
    const live = await verifyLiveBucket(account, row);
    if (live.kind === 'missing') {
      await projectStorageResourceDAO.deleteByUserAndProjectKey(userId, normalizedProjectKey);
      throw new Error('存储桶尚未启用');
    }
    if (live.kind === 'error') {
      await markStoredBucketRowError(row, live.message);
      throw new Error(live.message);
    }

    const syncedRow = await syncStoredBucketRow(row, live.credentials);
    const secretAccessKey =
      asText(live.credentials.secretAccessKey) ||
      connectorSecretService.decryptToString(syncedRow.secretAccessKeyCiphertext, 'deployment');
    if (!secretAccessKey) {
      throw new Error('Railway Bucket 密钥缺失');
    }

    await deleteBucketObject(syncedRow, secretAccessKey, objectKey);
    const files = await listBucketObjects(syncedRow, secretAccessKey);
    return toStatus(
      syncedRow,
      normalizedProjectKey,
      options?.revealSecrets ? secretAccessKey : null,
      files
    );
  }
}

export const projectStorageResourceService = new ProjectStorageResourceService();
