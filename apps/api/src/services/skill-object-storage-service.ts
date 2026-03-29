import { createHash } from 'node:crypto';
import { downloadFromR2, uploadToR2 } from './r2-client';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeSegment(value: string, fallback: string) {
  const normalized = asText(value)
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function bucketName() {
  const value = asText(process.env.R2_BUCKET_NAME);
  if (!value) {
    throw new Error('R2_BUCKET_NAME 未配置');
  }
  return value;
}

export class SkillObjectStorageService {
  buildObjectKey(input: {
    skillSlug: string;
    revisionHint: string;
    resourcePath: string;
    content: string;
  }) {
    const digest = createHash('sha256').update(input.content).digest('hex').slice(0, 16);
    const slug = sanitizeSegment(input.skillSlug, 'skill');
    const revisionHint = sanitizeSegment(input.revisionHint, 'import');
    const resourcePath = sanitizeSegment(input.resourcePath, 'resource.txt');
    return `skills/platform/${slug}/${revisionHint}/${digest}/${resourcePath}`;
  }

  buildStoragePath(objectKey: string) {
    return `r2://${bucketName()}/${objectKey}`;
  }

  async uploadTextResource(input: {
    skillSlug: string;
    revisionHint: string;
    resourcePath: string;
    content: string;
    mimeType?: string;
  }) {
    const objectKey = this.buildObjectKey({
      skillSlug: input.skillSlug,
      revisionHint: input.revisionHint,
      resourcePath: input.resourcePath,
      content: input.content,
    });
    await uploadToR2(objectKey, Buffer.from(input.content, 'utf8'));
    return {
      objectKey,
      storagePath: this.buildStoragePath(objectKey),
      storageLocatorJson: {
        provider: 'r2',
        bucket: bucketName(),
        objectKey,
        mimeType: asText(input.mimeType) || 'text/plain',
      },
    };
  }

  async downloadTextResource(objectKey: string) {
    const raw = await downloadFromR2(objectKey);
    return raw.toString('utf8');
  }
}

export const skillObjectStorageService = new SkillObjectStorageService();
