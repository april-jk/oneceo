import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`${key} 未配置`);
  }
  return value.trim();
}

function resolveEndpoint(): string {
  const explicit = (process.env.R2_ENDPOINT || '').trim();
  if (explicit) return explicit;
  const accountId = requireEnv('R2_ACCOUNT_ID');
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function buildClient(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: resolveEndpoint(),
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

let cachedClient: S3Client | null = null;
const bucketName = () => requireEnv('R2_BUCKET_NAME');

function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = buildClient();
  return cachedClient;
}

export async function uploadToR2(key: string, body: Buffer | Readable): Promise<void> {
  const upload = new Upload({
    client: getR2Client(),
    params: {
      Bucket: bucketName(),
      Key: key,
      Body: body,
    },
  });
  await upload.done();
}

export async function downloadFromR2(key: string): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: key,
    })
  );

  const body = response.Body as Readable;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: expiresInSeconds });
}

export async function existsInR2(key: string): Promise<boolean> {
  try {
    await getR2Client().send(
      new HeadObjectCommand({
        Bucket: bucketName(),
        Key: key,
      })
    );
    return true;
  } catch (error: any) {
    const code = String(error?.name || error?.Code || error?.code || '').toLowerCase();
    if (code.includes('notfound') || code.includes('404')) {
      return false;
    }
    if (error?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}
