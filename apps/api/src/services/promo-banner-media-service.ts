import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const PROMO_BANNER_MEDIA_PREFIX = 'promo-banners/';
const PROMO_BANNER_MAX_BYTES = 8 * 1024 * 1024;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`${key} 未配置`);
  }
  return value.trim();
}

function resolveEndpoint(): string {
  const explicit = (process.env.R2_MANAGED_IMAGE_ENDPOINT || '').trim();
  if (explicit) return explicit;
  const accountId = requireEnv('R2_MANAGED_IMAGE_ACCOUNT_ID');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function bucketName(): string {
  return requireEnv('R2_MANAGED_IMAGE_BUCKET_NAME');
}

function resolvePublicBaseUrl(): string {
  const explicit = (
    process.env.R2_PROMO_BANNER_PUBLIC_BASE_URL ||
    process.env.R2_MANAGED_IMAGE_PUBLIC_BASE_URL ||
    ''
  ).trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const endpointRaw = resolveEndpoint();
  const endpoint = new URL(endpointRaw);
  const host = endpoint.hostname.trim();
  const bucket = bucketName();
  if (host.endsWith('r2.cloudflarestorage.com')) {
    return `https://${bucket}.${host}`;
  }
  return `${endpoint.origin}/${bucket}`;
}

function sanitizeSegment(input: string): string {
  return (input || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file';
}

function extByMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

let cachedClient: S3Client | null = null;
function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: resolveEndpoint(),
    credentials: {
      accessKeyId: requireEnv('R2_MANAGED_IMAGE_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_MANAGED_IMAGE_SECRET_ACCESS_KEY'),
    },
  });
  return cachedClient;
}

export class PromoBannerMediaService {
  async uploadImage(input: {
    fileName: string;
    contentType: string;
    bytes: Buffer;
  }) {
    const contentType = (input.contentType || '').trim().toLowerCase();
    if (!allowedMimeTypes.has(contentType)) {
      throw new Error('仅支持 JPG/PNG/WEBP/GIF 图片');
    }
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
      throw new Error('上传内容为空');
    }
    if (input.bytes.length > PROMO_BANNER_MAX_BYTES) {
      throw new Error('图片大小不能超过 8MB');
    }
    const ext = extByMime(contentType);
    const base = sanitizeSegment(input.fileName).replace(/\.[A-Za-z0-9]+$/, '');
    const objectKey = `${PROMO_BANNER_MEDIA_PREFIX}${Date.now()}-${randomUUID().slice(0, 8)}-${base}.${ext}`;

    const upload = new Upload({
      client: getClient(),
      params: {
        Bucket: bucketName(),
        Key: objectKey,
        Body: input.bytes,
        ContentType: contentType,
        ContentDisposition: `inline; filename="${base}.${ext}"`,
      },
    });
    await upload.done();

    const publicUrl = `${resolvePublicBaseUrl()}/${objectKey}`;
    return { objectKey, publicUrl };
  }
}

export const promoBannerMediaService = new PromoBannerMediaService();
