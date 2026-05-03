import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { sanitizeAttachmentName } from './task-attachment-service';

const MANAGED_IMAGE_PREFIX = 'managed-images/';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`${key} 未配置`);
  }
  return value.trim();
}

function resolveManagedImageEndpoint(): string {
  const explicit = (process.env.R2_MANAGED_IMAGE_ENDPOINT || '').trim();
  if (explicit) return explicit;
  const accountId = requireEnv('R2_MANAGED_IMAGE_ACCOUNT_ID');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function managedImageBucketName(): string {
  return requireEnv('R2_MANAGED_IMAGE_BUCKET_NAME');
}

function buildManagedImageClient(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: resolveManagedImageEndpoint(),
    credentials: {
      accessKeyId: requireEnv('R2_MANAGED_IMAGE_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_MANAGED_IMAGE_SECRET_ACCESS_KEY'),
    },
  });
}

function sanitizePathSegment(input: string): string {
  return (input || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'segment';
}

let cachedManagedImageClient: S3Client | null = null;

function getManagedImageClient(): S3Client {
  if (cachedManagedImageClient) return cachedManagedImageClient;
  cachedManagedImageClient = buildManagedImageClient();
  return cachedManagedImageClient;
}

function getSignedUrlTtlSeconds(): number {
  const parsed = Number(process.env.R2_MANAGED_IMAGE_SIGNED_URL_TTL_SECONDS || 300);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.min(3600, Math.floor(parsed));
}

export function isManagedImageObjectKey(key: string): boolean {
  return key.startsWith(MANAGED_IMAGE_PREFIX) && !key.includes('..');
}

export class ManagedImageObjectService {
  buildObjectKey(input: {
    sessionId: string;
    messageKey: string;
    attachmentName: string;
  }): string {
    const sessionId = sanitizePathSegment(input.sessionId);
    const messageKey = sanitizePathSegment(input.messageKey);
    const safeName = sanitizeAttachmentName(input.attachmentName);
    return `${MANAGED_IMAGE_PREFIX}${sessionId}/${messageKey}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  }

  async uploadImage(input: {
    objectKey: string;
    body: Buffer;
    contentType: string;
    originalName: string;
  }): Promise<void> {
    if (!isManagedImageObjectKey(input.objectKey)) {
      throw new Error('图片对象 key 非法');
    }

    const upload = new Upload({
      client: getManagedImageClient(),
      params: {
        Bucket: managedImageBucketName(),
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentDisposition: `inline; filename="${sanitizeAttachmentName(input.originalName)}"`,
      },
    });
    await upload.done();
  }

  async getSignedDownloadUrl(objectKey: string): Promise<string> {
    if (!isManagedImageObjectKey(objectKey)) {
      throw new Error('拒绝为非图片对象生成签名 URL');
    }
    const command = new GetObjectCommand({
      Bucket: managedImageBucketName(),
      Key: objectKey,
    });
    return getSignedUrl(getManagedImageClient(), command, {
      expiresIn: getSignedUrlTtlSeconds(),
    });
  }

  async deleteImage(objectKey: string): Promise<void> {
    if (!isManagedImageObjectKey(objectKey)) {
      return;
    }
    await getManagedImageClient().send(
      new DeleteObjectCommand({
        Bucket: managedImageBucketName(),
        Key: objectKey,
      })
    );
  }
}

export const managedImageObjectService = new ManagedImageObjectService();
