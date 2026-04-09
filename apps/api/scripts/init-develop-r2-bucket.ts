import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import process from 'node:process';

type BucketInitOptions = {
  bucketName: string;
  locationHint: string;
};

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), 'apps/.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const file of candidates) {
    loadDotenv({ path: file, override: false });
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() || '';
}

function assertDevelopOnlyExecution(bucketName: string) {
  const markers: Array<[string, string]> = [
    ['ONECEO_DEPLOY_ENV', optionalEnv('ONECEO_DEPLOY_ENV')],
    ['ONECEO_RUNTIME_ENV', optionalEnv('ONECEO_RUNTIME_ENV')],
    ['RAILWAY_ENVIRONMENT_NAME', optionalEnv('RAILWAY_ENVIRONMENT_NAME')],
    ['RAILWAY_ENVIRONMENT', optionalEnv('RAILWAY_ENVIRONMENT')],
  ];

  const normalized = markers
    .map(([key, value]) => [key, value.toLowerCase()] as [string, string])
    .filter(([, value]) => value.length > 0);

  const developDetected = normalized.some(([, value]) => value === 'develop');
  if (!developDetected) {
    const markerText =
      normalized.length > 0
        ? normalized.map(([key, value]) => `${key}=${value}`).join(', ')
        : '无环境标识';
    throw new Error(
      `[develop-only] 当前环境不是 develop，拒绝执行初始化。检测到: ${markerText}。请仅在 develop 环境设置标识后运行。`
    );
  }

  if (!bucketName.toLowerCase().includes('develop')) {
    throw new Error(
      `[develop-only] 目标 bucket 必须包含 develop 关键字。当前 bucket=${bucketName}`
    );
  }
}

async function ensureBucket(client: S3Client, options: BucketInitOptions) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: options.bucketName }));
    console.log(`[r2-init] bucket 已存在: ${options.bucketName}`);
    return;
  } catch {
    // continue create
  }

  console.log(`[r2-init] 开始创建 bucket: ${options.bucketName} (location=${options.locationHint})`);
  await client.send(
    new CreateBucketCommand({
      Bucket: options.bucketName,
      CreateBucketConfiguration: {
        LocationConstraint: options.locationHint as any,
      },
    })
  );
  console.log(`[r2-init] bucket 创建成功: ${options.bucketName}`);
}

async function putKeepFile(client: S3Client, bucketName: string, objectKey: string) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: '',
      ContentType: 'text/plain; charset=utf-8',
    })
  );
  console.log(`[r2-init] 初始化: s3://${bucketName}/${objectKey}`);
}

async function main() {
  loadEnv();

  const accountId = optionalEnv('R2_ACCOUNT_ID') || requiredEnv('OSAC_R2_ACCOUNT_ID');
  const endpoint = optionalEnv('R2_ENDPOINT') || `https://${accountId}.r2.cloudflarestorage.com`;
  const accessKeyId =
    optionalEnv('R2_ACCESS_KEY_ID') ||
    optionalEnv('OSAC_R2_WRITE_ACCESS_KEY_ID') ||
    requiredEnv('OSAC_R2_ACCESS_KEY_ID');
  const secretAccessKey =
    optionalEnv('R2_SECRET_ACCESS_KEY') ||
    optionalEnv('OSAC_R2_WRITE_SECRET_ACCESS_KEY') ||
    requiredEnv('OSAC_R2_SECRET_ACCESS_KEY');

  const bucketName = process.argv[2]?.trim() || 'oneceo-sandbox-storage-develop-sg';
  const locationHint = process.argv[3]?.trim() || 'APAC';
  assertDevelopOnlyExecution(bucketName);

  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  await ensureBucket(client, { bucketName, locationHint });

  const keepKeys = [
    'develop/.keep',
    'develop/sessions/.keep',
    'develop/workspace-archives/.keep',
    'develop/runtime-artifacts/osac/linux/amd64/.keep',
    'develop/artifacts/deliverables/.keep',
    'develop/artifacts/managed-images/.keep',
    'develop/logs/.keep',
  ];

  for (const key of keepKeys) {
    await putKeepFile(client, bucketName, key);
  }

  console.log('[r2-init] 完成。建议 develop 环境使用以下变量:');
  console.log(`R2_BUCKET_NAME=${bucketName}`);
  console.log(`OSAC_R2_BUCKET=${bucketName}`);
}

main().catch((error) => {
  console.error('[r2-init] 失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
