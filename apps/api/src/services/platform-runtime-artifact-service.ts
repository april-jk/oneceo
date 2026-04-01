import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ensureDatabaseConnection } from '../config/database';
import { platformRuntimeArtifactDAO } from '../db/dao';

type ArtifactReleaseStatus = 'uploaded' | 'validated' | 'published' | 'archived';

type OsacReleaseInput = {
  version: string;
  fileBase64: string;
  releaseNotes?: string;
  sourceCommit?: string;
  uploadedBy?: string;
  channel?: string;
};

type OsacPublishedSpec = {
  releaseId: string;
  version: string;
  bucket: string;
  objectKey: string;
  manifestKey: string;
  sha256: string;
  sizeBytes: number;
  presignedUrl: string;
  expiresInSeconds: number;
  channel: string;
};

const OSAC_ARTIFACT_TYPE = 'osac';
const OSAC_PLATFORM = 'linux';
const OSAC_ARCH = 'amd64';
const DEFAULT_CHANNEL = 'stable';
const DEFAULT_PRESIGN_TTL_SECONDS = 120;
const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireEnv(keys: string[]): string {
  for (const key of keys) {
    const value = asText(process.env[key]);
    if (value) return value;
  }
  throw new Error(`${keys[0]} 未配置`);
}

function resolveBucket() {
  return requireEnv(['OSAC_R2_BUCKET', 'R2_BUCKET_NAME']);
}

function resolveEndpoint() {
  const explicit = asText(process.env.OSAC_R2_ENDPOINT) || asText(process.env.R2_ENDPOINT);
  if (explicit) return explicit;
  const accountId = asText(process.env.OSAC_R2_ACCOUNT_ID) || asText(process.env.R2_ACCOUNT_ID);
  if (!accountId) {
    throw new Error('OSAC_R2_ACCOUNT_ID 未配置');
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function resolveReadCredentials() {
  return {
    accessKeyId: requireEnv([
      'OSAC_R2_READ_ACCESS_KEY_ID',
      'OSAC_R2_ACCESS_KEY_ID',
      'OSAC_R2_WRITE_ACCESS_KEY_ID',
      'R2_ACCESS_KEY_ID',
    ]),
    secretAccessKey: requireEnv([
      'OSAC_R2_READ_SECRET_ACCESS_KEY',
      'OSAC_R2_SECRET_ACCESS_KEY',
      'OSAC_R2_WRITE_SECRET_ACCESS_KEY',
      'R2_SECRET_ACCESS_KEY',
    ]),
  };
}

function resolveWriteCredentials() {
  return {
    accessKeyId: requireEnv([
      'OSAC_R2_WRITE_ACCESS_KEY_ID',
      'OSAC_R2_ACCESS_KEY_ID',
      'OSAC_R2_READ_ACCESS_KEY_ID',
      'R2_ACCESS_KEY_ID',
    ]),
    secretAccessKey: requireEnv([
      'OSAC_R2_WRITE_SECRET_ACCESS_KEY',
      'OSAC_R2_SECRET_ACCESS_KEY',
      'OSAC_R2_READ_SECRET_ACCESS_KEY',
      'R2_SECRET_ACCESS_KEY',
    ]),
  };
}

let cachedReadClient: S3Client | null = null;
let cachedWriteClient: S3Client | null = null;

function buildClient(credentials: { accessKeyId: string; secretAccessKey: string }) {
  return new S3Client({
    region: 'auto',
    endpoint: resolveEndpoint(),
    credentials,
  });
}

function getReadClient() {
  if (!cachedReadClient) {
    cachedReadClient = buildClient(resolveReadCredentials());
  }
  return cachedReadClient;
}

function getWriteClient() {
  if (!cachedWriteClient) {
    cachedWriteClient = buildClient(resolveWriteCredentials());
  }
  return cachedWriteClient;
}

function getDefaultChannel(channel?: string) {
  const normalized = asText(channel);
  return normalized || DEFAULT_CHANNEL;
}

function getPresignTtlSeconds() {
  const configured = Number(process.env.OSAC_R2_PRESIGN_TTL_SECONDS || DEFAULT_PRESIGN_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_PRESIGN_TTL_SECONDS;
  return Math.max(30, Math.min(600, Math.floor(configured)));
}

function normalizeVersion(version: string) {
  const normalized = asText(version);
  if (!VERSION_PATTERN.test(normalized)) {
    throw new Error('version 不合法，仅允许字母、数字、点、下划线和短横线');
  }
  return normalized;
}

function sha256Hex(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertLinuxAmd64Binary(buffer: Buffer, label: string) {
  if (buffer.length < 20) {
    throw new Error(`${label} 体积过小，不是有效二进制`);
  }
  const isElf =
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46;
  if (!isElf) {
    throw new Error(`${label} 不是 Linux ELF 可执行文件`);
  }
  const machine = buffer.readUInt16LE(18);
  if (machine !== 62) {
    throw new Error(`${label} 不是 linux/amd64 可执行文件`);
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Readable) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (body && typeof body === 'object' && 'transformToByteArray' in (body as any)) {
    const bytes = await (body as any).transformToByteArray();
    return Buffer.from(bytes);
  }
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new Error('无法读取 R2 对象内容');
}

function buildObjectKey(version: string) {
  return `${OSAC_ARTIFACT_TYPE}/${OSAC_PLATFORM}/${OSAC_ARCH}/${version}/osac`;
}

function buildManifestKey(version: string) {
  return `${OSAC_ARTIFACT_TYPE}/${OSAC_PLATFORM}/${OSAC_ARCH}/${version}/manifest.json`;
}

function buildLatestKey() {
  return `${OSAC_ARTIFACT_TYPE}/${OSAC_PLATFORM}/${OSAC_ARCH}/latest.json`;
}

function buildManifest(input: {
  version: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  sourceCommit?: string | null;
  uploadedBy?: string | null;
  channel: string;
}) {
  return {
    artifactType: OSAC_ARTIFACT_TYPE,
    platform: OSAC_PLATFORM,
    arch: OSAC_ARCH,
    version: input.version,
    objectKey: input.objectKey,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    sourceCommit: input.sourceCommit || null,
    uploadedBy: input.uploadedBy || null,
    channel: input.channel,
    builtAt: new Date().toISOString(),
  };
}

export class PlatformRuntimeArtifactService {
  async listOsacReleases(filters?: { status?: string; query?: string; channel?: string }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const items = await platformRuntimeArtifactDAO.listReleases({
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      channel: getDefaultChannel(filters?.channel),
      status: asText(filters?.status) || undefined,
      query: asText(filters?.query) || undefined,
    });
    const published = await platformRuntimeArtifactDAO.getPublishedRelease({
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      channel: getDefaultChannel(filters?.channel),
    });
    return {
      currentPublishedReleaseId: published?.release.id || null,
      currentPublishedVersion: published?.release.version || null,
      channel: getDefaultChannel(filters?.channel),
      items,
    };
  }

  async getOsacRelease(releaseId: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const release = await platformRuntimeArtifactDAO.getReleaseById(releaseId);
    if (!release) {
      throw new Error('OSAC release 不存在');
    }
    const published = await platformRuntimeArtifactDAO.getPublishedRelease({
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      channel: release.channel || DEFAULT_CHANNEL,
    });
    return {
      release,
      currentPublishedReleaseId: published?.release.id || null,
      currentPublishedVersion: published?.release.version || null,
    };
  }

  async uploadOsacRelease(input: OsacReleaseInput) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const version = normalizeVersion(input.version);
    const channel = getDefaultChannel(input.channel);
    const existing = await platformRuntimeArtifactDAO.getReleaseByVersion({
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      version,
    });
    if (existing) {
      throw new Error(`OSAC ${version} 已存在`);
    }

    const binary = Buffer.from(asText(input.fileBase64), 'base64');
    if (!binary.byteLength) {
      throw new Error('上传文件为空');
    }
    assertLinuxAmd64Binary(binary, 'OSAC 二进制');
    const sha256 = sha256Hex(binary);
    const objectKey = buildObjectKey(version);
    const manifestKey = buildManifestKey(version);
    const bucket = resolveBucket();
    const manifest = buildManifest({
      version,
      objectKey,
      sha256,
      sizeBytes: binary.byteLength,
      sourceCommit: asText(input.sourceCommit) || null,
      uploadedBy: asText(input.uploadedBy) || null,
      channel,
    });

    await getWriteClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: binary,
        ContentType: 'application/octet-stream',
      })
    );
    await getWriteClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json',
      })
    );

    return platformRuntimeArtifactDAO.createRelease({
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      version,
      channel,
      status: 'uploaded',
      bucket,
      objectKey,
      manifestKey,
      sha256,
      sizeBytes: binary.byteLength,
      releaseNotes: asText(input.releaseNotes),
      sourceCommit: asText(input.sourceCommit) || null,
      uploadedBy: asText(input.uploadedBy) || null,
      metadataJson: manifest,
    });
  }

  async validateOsacRelease(releaseId: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const release = await platformRuntimeArtifactDAO.getReleaseById(releaseId);
    if (!release) {
      throw new Error('OSAC release 不存在');
    }

    await getReadClient().send(
      new HeadObjectCommand({
        Bucket: release.bucket,
        Key: release.objectKey,
      })
    );
    await getReadClient().send(
      new HeadObjectCommand({
        Bucket: release.bucket,
        Key: release.manifestKey,
      })
    );
    const response = await getReadClient().send(
      new GetObjectCommand({
        Bucket: release.bucket,
        Key: release.objectKey,
      })
    );
    const binary = await bodyToBuffer(response.Body);
    assertLinuxAmd64Binary(binary, `OSAC ${release.version}`);
    const actualSha256 = sha256Hex(binary);
    if (actualSha256 !== release.sha256) {
      throw new Error(`sha256 校验失败: expected=${release.sha256} actual=${actualSha256}`);
    }

    const nextStatus: ArtifactReleaseStatus = release.status === 'published' ? 'published' : 'validated';
    return platformRuntimeArtifactDAO.updateRelease(releaseId, {
      status: nextStatus,
      metadataJson: {
        ...((release.metadataJson as Record<string, unknown> | null) || {}),
        lastValidatedAt: new Date().toISOString(),
        validatedSha256: actualSha256,
      },
    });
  }

  private async writeLatestPointer(input: {
    bucket: string;
    objectKey: string;
    manifestKey: string;
    version: string;
    sha256: string;
    channel: string;
    releaseId: string;
    publishedBy?: string | null;
  }) {
    const payload = {
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      version: input.version,
      channel: input.channel,
      objectKey: input.objectKey,
      manifestKey: input.manifestKey,
      sha256: input.sha256,
      releaseId: input.releaseId,
      publishedAt: new Date().toISOString(),
      publishedBy: input.publishedBy || null,
    };
    await getWriteClient().send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: buildLatestKey(),
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json',
      })
    );
  }

  async publishOsacRelease(releaseId: string, publishedBy?: string) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    let release = await platformRuntimeArtifactDAO.getReleaseById(releaseId);
    if (!release) {
      throw new Error('OSAC release 不存在');
    }
    if (release.status === 'uploaded') {
      release = await this.validateOsacRelease(releaseId);
    }
    if (!release || !['validated', 'published'].includes(release.status)) {
      throw new Error('只有 validated 或 published 版本才能发布');
    }

    const publishResult = await platformRuntimeArtifactDAO.publishRelease({
      releaseId,
      artifactType: OSAC_ARTIFACT_TYPE,
      platform: OSAC_PLATFORM,
      arch: OSAC_ARCH,
      channel: release.channel || DEFAULT_CHANNEL,
      updatedBy: asText(publishedBy) || null,
    });

    try {
      await this.writeLatestPointer({
        bucket: release.bucket,
        objectKey: release.objectKey,
        manifestKey: release.manifestKey,
        version: release.version,
        sha256: release.sha256,
        channel: release.channel || DEFAULT_CHANNEL,
        releaseId: release.id,
        publishedBy: asText(publishedBy) || null,
      });
    } catch (error) {
      await platformRuntimeArtifactDAO.restorePublication({
        releaseId,
        previousPublishedReleaseId: publishResult.previousPublishedReleaseId,
        artifactType: OSAC_ARTIFACT_TYPE,
        platform: OSAC_PLATFORM,
        arch: OSAC_ARCH,
        channel: release.channel || DEFAULT_CHANNEL,
        updatedBy: asText(publishedBy) || null,
      });
      throw error;
    }

    return this.getOsacRelease(releaseId);
  }

  async rollbackOsacRelease(releaseId: string, publishedBy?: string) {
    return this.publishOsacRelease(releaseId, publishedBy);
  }

  async getPublishedOsacDownloadSpec(input?: { channel?: string; version?: string }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });
    const channel = getDefaultChannel(input?.channel);
    let release =
      asText(input?.version)
        ? await platformRuntimeArtifactDAO.getReleaseByVersion({
            artifactType: OSAC_ARTIFACT_TYPE,
            platform: OSAC_PLATFORM,
            arch: OSAC_ARCH,
            version: normalizeVersion(input!.version!),
          })
        : null;
    if (!release) {
      const published = await platformRuntimeArtifactDAO.getPublishedRelease({
        artifactType: OSAC_ARTIFACT_TYPE,
        platform: OSAC_PLATFORM,
        arch: OSAC_ARCH,
        channel,
      });
      release = published?.release || null;
    }
    if (!release) {
      throw new Error('未找到已发布的 OSAC 版本');
    }
    const expiresInSeconds = getPresignTtlSeconds();
    const presignedUrl = await getSignedUrl(
      getReadClient(),
      new GetObjectCommand({
        Bucket: release.bucket,
        Key: release.objectKey,
      }),
      { expiresIn: expiresInSeconds }
    );
    return {
      releaseId: release.id,
      version: release.version,
      bucket: release.bucket,
      objectKey: release.objectKey,
      manifestKey: release.manifestKey,
      sha256: release.sha256,
      sizeBytes: Number(release.sizeBytes || 0),
      presignedUrl,
      expiresInSeconds,
      channel,
    } satisfies OsacPublishedSpec;
  }
}

export const platformRuntimeArtifactService = new PlatformRuntimeArtifactService();
