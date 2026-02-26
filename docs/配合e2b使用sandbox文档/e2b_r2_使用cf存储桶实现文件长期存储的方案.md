# E2B Sandbox + Cloudflare R2 永久文件持久化方案

> **作者：Manus AI** | **日期：2026年2月**

---

## 一、背景与问题分析

E2B Sandbox 的原生持久化功能（`betaPause` / `connect`）目前处于 Public Beta 阶段，存在以下核心限制：

| 限制项 | 具体说明 |
|--------|----------|
| **连续运行上限** | Pro 用户最长 24 小时，Base 用户最长 1 小时 |
| **功能状态** | Beta 阶段，存在已知 Bug（多次 pause/resume 后文件变更可能丢失，见 [Issue #884](https://github.com/e2b-dev/E2B/issues/884)） |
| **终态不可逆** | 一旦 `kill()` 或超时自动关闭，沙盒进入 Killed 状态，所有数据**永久销毁**，无法恢复 |

因此，对于需要**永久保存用户文件**的场景，必须引入外部存储。本方案以 **Cloudflare R2** 作为永久存储后端，设计了一套完整的混合持久化架构。

---

## 二、方案架构

### 2.1 核心策略：混合持久化（Hybrid Persistence）

本方案采用"**热存储 + 冷存储**"的分层策略：

- **热存储（E2B betaPause）**：用户短期离开（例如 24 小时内），使用 E2B 原生暂停功能。恢复速度约 1 秒，用户体验最佳。
- **冷存储（Cloudflare R2）**：用户长期离开或沙盒被终止，将工作目录归档到 R2。R2 存储成本极低（$0.015/GB/月），且永久保存。

### 2.2 沙盒状态机

```
                    ┌─────────────────────────────────────────────────────┐
                    │                                                     │
          Sandbox.create()                                                │
                    │                                                     │
                    ▼                                                     │
              ┌──────────┐                                               │
              │ Running  │ ◄── Sandbox.connect() ──────────────────────┐ │
              └──────────┘                                             │ │
                 │     │                                               │ │
          betaPause()  kill() / timeout                                │ │
                 │     │                                               │ │
                 ▼     ▼                                               │ │
           ┌────────┐ ┌────────┐                                       │ │
           │ Paused │ │ Killed │──── Webhook 触发 ────► 归档到 R2 ─────┘ │
           └────────┘ └────────┘                                         │
                │                                                         │
         Sandbox.connect()                                               │
                └─────────────────────────────────────────────────────────┘
```

### 2.3 完整工作流

```
用户请求访问沙盒
        │
        ▼
  查询数据库中用户的沙盒状态
        │
   ┌────┴────────────────────────────┐
   │                                 │
   ▼                                 ▼
状态: Paused                  状态: Archived / 无记录
   │                                 │
   ▼                                 ▼
Sandbox.connect(id)          Sandbox.create() + 从 R2 还原文件
   │                                 │
   └──────────────┬──────────────────┘
                  │
                  ▼
          用户使用沙盒（Running）
                  │
          用户离开 / 超时
                  │
                  ▼
        autoPause=true 自动暂停
                  │
                  ▼
          状态: Paused（最长 24h）
                  │
          24h 后自动 kill
                  │
                  ▼
        E2B Webhook 触发归档器
                  │
                  ▼
        文件打包 → 上传到 R2
                  │
                  ▼
          状态: Archived（永久）
```

---

## 三、前置准备

### 3.1 Cloudflare R2 配置

**第一步：创建 R2 存储桶**

在 Cloudflare Dashboard → R2 Object Storage → 创建存储桶，命名为 `e2b-user-archives`。

**第二步：创建 API Token**

1. 进入 R2 概览页面，点击 **Manage R2 API Tokens**
2. 点击 **Create Account API token**
3. 权限选择 **Object Read & Write**，可选择限定到特定存储桶
4. 创建后，**立即保存**以下信息（之后无法再查看 Secret Key）：
   - `Access Key ID`：例如 `a1b2c3d4e5f6...`
   - `Secret Access Key`：例如 `xyz789...`
5. 在 R2 概览页右侧找到您的 `Account ID`

**R2 端点 URL 格式：**
```
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

### 3.2 E2B 自定义模板

需要创建一个安装了 `s3fs`（S3 兼容的 FUSE 挂载工具）的自定义模板，用于在沙盒内直接读写 R2 存储桶。

**`e2b.Dockerfile`**（放在项目根目录）：
```dockerfile
FROM ubuntu:22.04

# 安装 s3fs 和必要工具
RUN apt-get update && apt-get install -y \
    s3fs \
    rsync \
    tar \
    && rm -rf /var/lib/apt/lists/*

# 创建工作目录
RUN mkdir -p /home/user/workspace /home/user/r2mount
```

**构建并发布模板：**
```bash
# 安装 E2B CLI
npm install -g @e2b/cli

# 登录
e2b auth login

# 构建模板（在包含 e2b.Dockerfile 的目录下执行）
e2b template build -f e2b.Dockerfile --name e2b-r2-archiver

# 记下输出的模板 ID，例如：
# Template ID: abc123xyz
```

---

## 四、核心代码实现

以下提供 **JavaScript/TypeScript** 和 **Python** 两个版本的完整实现。

### 4.1 JavaScript/TypeScript 实现

#### 4.1.1 环境配置

```bash
npm install e2b @aws-sdk/client-s3 @aws-sdk/lib-storage
```

**`.env` 文件：**
```env
E2B_API_KEY=your_e2b_api_key
E2B_WEBHOOK_SECRET=your_random_webhook_secret
E2B_ARCHIVER_TEMPLATE_ID=abc123xyz

R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=e2b-user-archives
```

#### 4.1.2 R2 工具模块

```typescript
// r2-client.ts
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

/**
 * 上传文件到 R2
 * @param key - R2 中的对象键，例如 "users/user123/workspace.tar.gz"
 * @param body - 文件内容（Buffer 或 Readable Stream）
 */
export async function uploadToR2(key: string, body: Buffer | Readable): Promise<void> {
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: body,
    },
  });
  await upload.done();
  console.log(`[R2] Uploaded: ${key}`);
}

/**
 * 从 R2 下载文件
 * @param key - R2 中的对象键
 * @returns 文件内容的 Buffer
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const response = await r2Client.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as Readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * 检查 R2 中是否存在指定键的对象
 */
export async function existsInR2(key: string): Promise<boolean> {
  try {
    const result = await r2Client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: key,
      MaxKeys: 1,
    }));
    return (result.Contents?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
```

#### 4.1.3 沙盒管理器（核心逻辑）

```typescript
// sandbox-manager.ts
import { Sandbox } from 'e2b';
import { uploadToR2, downloadFromR2, existsInR2 } from './r2-client';

const ARCHIVER_TEMPLATE = process.env.E2B_ARCHIVER_TEMPLATE_ID!;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!;

// 用户工作目录路径（沙盒内）
const WORKSPACE_PATH = '/home/user/workspace';

/**
 * 为用户获取或创建沙盒
 * 自动处理暂停恢复、从 R2 还原等逻辑
 */
export async function getOrCreateSandbox(
  userId: string,
  db: any // 您的数据库客户端
): Promise<Sandbox> {
  const record = await db.getUserSandbox(userId);

  // 情况1：沙盒处于暂停状态，直接恢复
  if (record?.state === 'Paused' && record?.sandboxId) {
    console.log(`[Manager] Resuming paused sandbox ${record.sandboxId} for user ${userId}`);
    try {
      const sandbox = await Sandbox.connect(record.sandboxId, {
        timeoutMs: 24 * 60 * 60 * 1000, // 恢复后重置为 24h 超时
      });
      await db.updateUserSandbox(userId, sandbox.sandboxId, 'Running');
      return sandbox;
    } catch (e) {
      console.warn(`[Manager] Failed to resume sandbox, will create new one: ${e}`);
    }
  }

  // 情况2：创建新沙盒（全新用户或沙盒已被归档/终止）
  console.log(`[Manager] Creating new sandbox for user ${userId}`);
  const sandbox = await Sandbox.betaCreate({
    autoPause: true,
    timeoutMs: 24 * 60 * 60 * 1000, // 24小时无活动后自动暂停
    metadata: { userId }, // 关键：在 metadata 中存储 userId，供 Webhook 使用
  });

  // 初始化工作目录
  await sandbox.files.makeDir(WORKSPACE_PATH);

  // 情况2a：如果 R2 中有归档文件，则还原
  const archiveKey = `users/${userId}/workspace.tar.gz`;
  if (await existsInR2(archiveKey)) {
    console.log(`[Manager] Restoring files from R2 for user ${userId}`);
    await restoreFromR2(sandbox, userId);
  }

  await db.saveUserSandbox(userId, sandbox.sandboxId, 'Running');
  return sandbox;
}

/**
 * 将指定沙盒的工作目录归档到 R2
 * 通过启动一个临时归档沙盒来执行此操作
 */
export async function archiveSandboxToR2(
  sandboxId: string,
  userId: string
): Promise<void> {
  console.log(`[Archiver] Starting archive for sandbox ${sandboxId}, user ${userId}`);
  let archiverSandbox: Sandbox | null = null;

  try {
    // 注意：被 kill 的沙盒无法直接访问，需要在 kill 之前先做归档
    // 此函数应在 kill 之前被调用，或通过其他方式（如文件系统快照）实现
    // 以下展示的是通过 E2B 文件 API 直接读取文件并上传的方式

    // 如果沙盒还在运行，直接连接它
    const targetSandbox = await Sandbox.connect(sandboxId);

    // 在目标沙盒中打包工作目录
    await targetSandbox.commands.run(
      `tar -czf /tmp/workspace_backup.tar.gz -C ${WORKSPACE_PATH} .`
    );

    // 读取打包文件
    const archiveData = await targetSandbox.files.read('/tmp/workspace_backup.tar.gz', {
      format: 'bytes',
    });

    // 上传到 R2
    const archiveKey = `users/${userId}/workspace.tar.gz`;
    await uploadToR2(archiveKey, Buffer.from(archiveData));

    // 同时保存一份元数据
    const metadata = {
      userId,
      sandboxId,
      archivedAt: new Date().toISOString(),
      workspacePath: WORKSPACE_PATH,
    };
    await uploadToR2(
      `users/${userId}/metadata.json`,
      Buffer.from(JSON.stringify(metadata, null, 2))
    );

    console.log(`[Archiver] Successfully archived user ${userId}'s workspace to R2`);

  } catch (error) {
    console.error(`[Archiver] Archive failed for user ${userId}:`, error);
    throw error;
  } finally {
    if (archiverSandbox) {
      await archiverSandbox.kill();
    }
  }
}

/**
 * 从 R2 还原文件到沙盒
 */
async function restoreFromR2(sandbox: Sandbox, userId: string): Promise<void> {
  const archiveKey = `users/${userId}/workspace.tar.gz`;

  // 从 R2 下载归档文件
  const archiveBuffer = await downloadFromR2(archiveKey);

  // 将归档文件写入沙盒
  await sandbox.files.write('/tmp/workspace_restore.tar.gz', archiveBuffer);

  // 在沙盒中解压
  await sandbox.commands.run(
    `tar -xzf /tmp/workspace_restore.tar.gz -C ${WORKSPACE_PATH} && rm /tmp/workspace_restore.tar.gz`
  );

  console.log(`[Archiver] Restored files for user ${userId} from R2`);
}
```

#### 4.1.4 Webhook 处理器

```typescript
// webhook-handler.ts
import express from 'express';
import crypto from 'crypto';
import { archiveSandboxToR2 } from './sandbox-manager';

const app = express();

// 使用 raw body 中间件以便验证签名
app.use('/webhooks/e2b', express.raw({ type: 'application/json' }));

/**
 * 验证 E2B Webhook 签名
 */
function verifyE2BSignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = crypto
    .createHash('sha256')
    .update(secret + rawBody)
    .digest('base64')
    .replace(/=+$/, '');
  return expected === signature;
}

app.post('/webhooks/e2b', async (req, res) => {
  const rawBody = req.body.toString();
  const signature = req.headers['e2b-signature'] as string;
  const secret = process.env.E2B_WEBHOOK_SECRET!;

  // 1. 验证签名
  if (!verifyE2BSignature(secret, rawBody, signature)) {
    console.warn('[Webhook] Invalid signature, rejecting request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);
  console.log(`[Webhook] Received event: ${event.type} for sandbox: ${event.sandboxId}`);

  // 立即响应 E2B，避免超时
  res.status(200).json({ received: true });

  // 异步处理事件
  setImmediate(async () => {
    try {
      if (event.type === 'sandbox.lifecycle.killed') {
        const userId = event.eventData?.sandbox_metadata?.userId;
        if (!userId) {
          console.warn(`[Webhook] No userId in metadata for sandbox ${event.sandboxId}, skipping archive`);
          return;
        }

        // 注意：sandbox 已经被 kill，无法再连接
        // 归档应该在 kill 之前完成（见"主动归档"方案）
        // 这里更新数据库状态即可
        // await db.updateUserSandbox(userId, event.sandboxId, 'Killed');
        console.log(`[Webhook] Sandbox ${event.sandboxId} for user ${userId} was killed`);
      }

      if (event.type === 'sandbox.lifecycle.paused') {
        const userId = event.eventData?.sandbox_metadata?.userId;
        if (userId) {
          // await db.updateUserSandbox(userId, event.sandboxId, 'Paused');
          console.log(`[Webhook] Sandbox ${event.sandboxId} for user ${userId} was paused`);
        }
      }
    } catch (error) {
      console.error('[Webhook] Error processing event:', error);
    }
  });
});

app.listen(3000, () => {
  console.log('Webhook handler listening on port 3000');
});
```

#### 4.1.5 主动归档（推荐方案）

由于 E2B 的 Webhook 在 `killed` 事件触发时沙盒已经销毁，**无法再连接**，因此最可靠的归档方式是**主动归档**：在用户会话结束时（或定时），在沙盒被 kill 之前主动触发归档。

```typescript
// 推荐：在沙盒 pause 之前先归档到 R2
async function pauseAndArchiveSandbox(
  sandbox: Sandbox,
  userId: string,
  db: any
): Promise<void> {
  console.log(`[Manager] Pausing and archiving sandbox for user ${userId}`);

  try {
    // 1. 先归档到 R2（沙盒仍在运行中）
    await archiveSandboxToR2(sandbox.sandboxId, userId);

    // 2. 再暂停沙盒（短期内可快速恢复）
    await sandbox.betaPause();

    // 3. 更新数据库
    await db.updateUserSandbox(userId, sandbox.sandboxId, 'Paused');

    console.log(`[Manager] Sandbox paused and archived for user ${userId}`);
  } catch (error) {
    console.error(`[Manager] Failed to pause and archive:`, error);
    throw error;
  }
}

// 定时归档任务（例如每小时归档一次活跃沙盒）
async function scheduledArchiveJob(db: any): Promise<void> {
  const runningSandboxes = await db.getAllRunningSandboxes();

  for (const record of runningSandboxes) {
    try {
      await archiveSandboxToR2(record.sandboxId, record.userId);
      console.log(`[Scheduler] Archived sandbox for user ${record.userId}`);
    } catch (error) {
      console.error(`[Scheduler] Failed to archive for user ${record.userId}:`, error);
    }
  }
}
```

---

### 4.2 Python 实现

#### 4.2.1 环境配置

```bash
pip install e2b boto3 python-dotenv
```

**`.env` 文件**（同 JS 版本）

#### 4.2.2 完整 Python 实现

```python
# sandbox_manager.py
import os
import io
import json
import tarfile
import hashlib
import hmac
import base64
from datetime import datetime
from typing import Optional

import boto3
from botocore.config import Config
from e2b import Sandbox

# ── 配置 ──────────────────────────────────────────────────────────────────────

E2B_API_KEY = os.environ['E2B_API_KEY']
E2B_ARCHIVER_TEMPLATE_ID = os.environ['E2B_ARCHIVER_TEMPLATE_ID']

R2_ACCOUNT_ID = os.environ['R2_ACCOUNT_ID']
R2_ACCESS_KEY_ID = os.environ['R2_ACCESS_KEY_ID']
R2_SECRET_ACCESS_KEY = os.environ['R2_SECRET_ACCESS_KEY']
R2_BUCKET_NAME = os.environ['R2_BUCKET_NAME']
R2_ENDPOINT = f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com'

WORKSPACE_PATH = '/home/user/workspace'
SANDBOX_TIMEOUT = 24 * 60 * 60  # 24 小时（秒）

# ── R2 客户端 ─────────────────────────────────────────────────────────────────

def get_r2_client():
    """获取 Cloudflare R2 的 boto3 客户端（S3 兼容）"""
    return boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )

def upload_to_r2(key: str, data: bytes) -> None:
    """上传字节数据到 R2"""
    r2 = get_r2_client()
    r2.put_object(Bucket=R2_BUCKET_NAME, Key=key, Body=data)
    print(f'[R2] Uploaded: {key} ({len(data)} bytes)')

def download_from_r2(key: str) -> bytes:
    """从 R2 下载文件内容"""
    r2 = get_r2_client()
    response = r2.get_object(Bucket=R2_BUCKET_NAME, Key=key)
    return response['Body'].read()

def exists_in_r2(key: str) -> bool:
    """检查 R2 中是否存在指定键"""
    r2 = get_r2_client()
    try:
        result = r2.list_objects_v2(Bucket=R2_BUCKET_NAME, Prefix=key, MaxKeys=1)
        return len(result.get('Contents', [])) > 0
    except Exception:
        return False

# ── 归档与还原 ────────────────────────────────────────────────────────────────

def archive_sandbox_to_r2(sandbox: Sandbox, user_id: str) -> None:
    """
    将沙盒工作目录打包并归档到 R2。
    此函数应在沙盒仍处于 Running 状态时调用。
    """
    print(f'[Archiver] Archiving workspace for user {user_id}...')

    # 1. 在沙盒中打包工作目录
    sandbox.commands.run(
        f'tar -czf /tmp/workspace_backup.tar.gz -C {WORKSPACE_PATH} . 2>/dev/null || true'
    )

    # 2. 从沙盒读取打包文件
    archive_bytes = sandbox.files.read('/tmp/workspace_backup.tar.gz', format='bytes')

    # 3. 上传到 R2
    archive_key = f'users/{user_id}/workspace.tar.gz'
    upload_to_r2(archive_key, bytes(archive_bytes))

    # 4. 保存元数据
    metadata = {
        'user_id': user_id,
        'sandbox_id': sandbox.sandbox_id,
        'archived_at': datetime.utcnow().isoformat() + 'Z',
        'workspace_path': WORKSPACE_PATH,
    }
    upload_to_r2(
        f'users/{user_id}/metadata.json',
        json.dumps(metadata, indent=2).encode('utf-8')
    )

    print(f'[Archiver] Successfully archived user {user_id} workspace to R2')

def restore_from_r2(sandbox: Sandbox, user_id: str) -> None:
    """从 R2 还原文件到沙盒工作目录"""
    archive_key = f'users/{user_id}/workspace.tar.gz'
    print(f'[Archiver] Restoring workspace for user {user_id} from R2...')

    # 1. 从 R2 下载归档文件
    archive_bytes = download_from_r2(archive_key)

    # 2. 写入沙盒
    sandbox.files.write('/tmp/workspace_restore.tar.gz', archive_bytes)

    # 3. 在沙盒中解压
    sandbox.commands.run(
        f'tar -xzf /tmp/workspace_restore.tar.gz -C {WORKSPACE_PATH} '
        f'&& rm /tmp/workspace_restore.tar.gz'
    )

    print(f'[Archiver] Restored workspace for user {user_id}')

# ── 沙盒管理器 ────────────────────────────────────────────────────────────────

def get_or_create_sandbox(user_id: str, db) -> Sandbox:
    """
    为用户获取或创建沙盒，自动处理暂停恢复和 R2 还原。
    
    Args:
        user_id: 用户唯一标识
        db: 数据库客户端（需实现 get_user_sandbox / save_user_sandbox / update_user_sandbox）
    
    Returns:
        可用的 Sandbox 实例
    """
    record = db.get_user_sandbox(user_id)

    # 情况1：沙盒处于暂停状态，直接恢复
    if record and record.get('state') == 'Paused' and record.get('sandbox_id'):
        print(f'[Manager] Resuming paused sandbox {record["sandbox_id"]} for user {user_id}')
        try:
            sandbox = Sandbox.connect(
                record['sandbox_id'],
                timeout=SANDBOX_TIMEOUT,
            )
            db.update_user_sandbox(user_id, sandbox.sandbox_id, 'Running')
            return sandbox
        except Exception as e:
            print(f'[Manager] Failed to resume sandbox: {e}, creating new one')

    # 情况2：创建新沙盒
    print(f'[Manager] Creating new sandbox for user {user_id}')
    sandbox = Sandbox.beta_create(
        auto_pause=True,
        timeout=SANDBOX_TIMEOUT,
        metadata={'user_id': user_id},  # 关键：存储 user_id 供 Webhook 使用
    )

    # 初始化工作目录
    sandbox.files.make_dir(WORKSPACE_PATH)

    # 情况2a：如果 R2 中有归档文件，则还原
    archive_key = f'users/{user_id}/workspace.tar.gz'
    if exists_in_r2(archive_key):
        print(f'[Manager] Found archived files in R2 for user {user_id}, restoring...')
        restore_from_r2(sandbox, user_id)

    db.save_user_sandbox(user_id, sandbox.sandbox_id, 'Running')
    return sandbox


def pause_and_archive_sandbox(sandbox: Sandbox, user_id: str, db) -> None:
    """
    主动归档并暂停沙盒（推荐在用户会话结束时调用）。
    
    执行顺序：先归档到 R2（保证永久存储），再暂停（保证快速恢复）。
    """
    print(f'[Manager] Pausing and archiving sandbox for user {user_id}')

    # 1. 先归档到 R2
    archive_sandbox_to_r2(sandbox, user_id)

    # 2. 再暂停沙盒
    sandbox.beta_pause()

    # 3. 更新数据库
    db.update_user_sandbox(user_id, sandbox.sandbox_id, 'Paused')

    print(f'[Manager] Sandbox paused and archived for user {user_id}')


# ── Webhook 处理器（Flask 示例）──────────────────────────────────────────────

def create_webhook_handler(db):
    """创建 Flask Webhook 处理器"""
    from flask import Flask, request, jsonify

    app = Flask(__name__)

    def verify_e2b_signature(secret: str, raw_body: str, signature: str) -> bool:
        """验证 E2B Webhook 签名"""
        expected = base64.b64encode(
            hashlib.sha256((secret + raw_body).encode()).digest()
        ).decode().rstrip('=')
        return hmac.compare_digest(expected, signature)

    @app.route('/webhooks/e2b', methods=['POST'])
    def handle_e2b_webhook():
        raw_body = request.get_data(as_text=True)
        signature = request.headers.get('e2b-signature', '')
        secret = os.environ['E2B_WEBHOOK_SECRET']

        # 验证签名
        if not verify_e2b_signature(secret, raw_body, signature):
            return jsonify({'error': 'Invalid signature'}), 401

        event = request.get_json(force=True)
        event_type = event.get('type')
        sandbox_id = event.get('sandboxId')

        print(f'[Webhook] Received: {event_type} for sandbox: {sandbox_id}')

        if event_type == 'sandbox.lifecycle.paused':
            user_id = event.get('eventData', {}).get('sandbox_metadata', {}).get('user_id')
            if user_id:
                db.update_user_sandbox(user_id, sandbox_id, 'Paused')

        elif event_type == 'sandbox.lifecycle.killed':
            user_id = event.get('eventData', {}).get('sandbox_metadata', {}).get('user_id')
            if user_id:
                # 沙盒已销毁，只能更新状态
                # 文件归档应在 kill 之前通过 pause_and_archive_sandbox() 完成
                db.update_user_sandbox(user_id, sandbox_id, 'Killed')

        return jsonify({'received': True}), 200

    return app


# ── 注册 Webhook（初始化时执行一次）──────────────────────────────────────────

def register_e2b_webhook(webhook_url: str) -> None:
    """向 E2B 注册 Webhook"""
    import requests

    response = requests.post(
        'https://api.e2b.app/events/webhooks',
        headers={
            'X-API-Key': E2B_API_KEY,
            'Content-Type': 'application/json',
        },
        json={
            'name': 'Sandbox Lifecycle Archiver',
            'url': webhook_url,
            'enabled': True,
            'events': [
                'sandbox.lifecycle.paused',
                'sandbox.lifecycle.killed',
            ],
            'signatureSecret': os.environ['E2B_WEBHOOK_SECRET'],
        },
    )

    if response.status_code == 201:
        print('[Webhook] Registered successfully')
    else:
        print(f'[Webhook] Registration failed: {response.text}')
```

---

## 五、数据库 Schema 参考

```sql
-- 用户沙盒状态表
CREATE TABLE user_sandboxes (
    id              SERIAL PRIMARY KEY,
    user_id         VARCHAR(255) NOT NULL UNIQUE,
    sandbox_id      VARCHAR(255),
    state           VARCHAR(50) NOT NULL DEFAULT 'None',
    -- 状态: Running | Paused | Killed | Archived
    r2_archive_key  VARCHAR(500),
    -- R2 中的归档路径，例如 users/user123/workspace.tar.gz
    last_archived_at TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_sandboxes_user_id ON user_sandboxes(user_id);
CREATE INDEX idx_user_sandboxes_state ON user_sandboxes(state);
```

---

## 六、方案对比与选型建议

E2B 文档中提到了两种将存储桶接入沙盒的方式，各有优劣：

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| **s3fs FUSE 挂载**（本方案） | 将 R2 存储桶挂载为沙盒内的本地目录 | 对沙盒内代码透明，无需修改 | 性能较低，小文件操作延迟高 | 文件数量少、单文件较大 |
| **SDK 直接读写**（备选） | 在沙盒内使用 boto3/aws-sdk 直接调用 R2 API | 性能可控，灵活 | 需要在沙盒内安装 SDK 并管理凭证 | 需要精细控制上传/下载逻辑 |
| **tar 打包 + 整体上传**（本方案采用） | 将工作目录打包成单个 `.tar.gz` 再上传 | 大幅减少 API 调用次数，速度快 | 无法增量同步 | 工作目录文件数量多时强烈推荐 |

**本方案采用"tar 打包 + 整体上传"策略**，原因如下：
1. Cloudflare R2 按 A 类操作（写入）和 B 类操作（读取）收费，减少 API 调用次数可有效降低成本。
2. 单次 `tar` + `upload` 比逐文件上传快得多，尤其是工作目录包含大量小文件时。
3. 实现简单，不依赖 FUSE 内核模块（在某些环境下 FUSE 可能不可用）。

---

## 七、成本估算

以单个活跃用户为例（工作目录约 100MB）：

| 费用项 | 计算方式 | 月费用（估算） |
|--------|----------|----------------|
| **R2 存储费** | 0.1 GB × $0.015/GB/月 | ~$0.0015 |
| **R2 写入操作** | 每天归档 1 次 × 30 天 × $4.50/百万次 | ~$0.000135 |
| **R2 读取操作** | 每月恢复 5 次 × $0.36/百万次 | ~$0.0000018 |
| **E2B 归档沙盒** | 每次归档约 30 秒 × 30 次/月 × $0.000014/秒 | ~$0.0126 |
| **合计** | | **< $0.02/用户/月** |

R2 存储成本极低，主要成本来自 E2B 沙盒的运行时间。

---

## 八、重要注意事项

**关于 Webhook 与归档时机的关键问题：**

E2B 的 `sandbox.lifecycle.killed` Webhook 在沙盒**已经销毁后**才触发，此时沙盒的文件系统已不可访问。因此，**不能依赖 `killed` Webhook 来触发归档**。

正确的归档时机应该是：

1. **用户主动离开时**：在您的应用后端检测到用户会话结束，调用 `pause_and_archive_sandbox()`。
2. **定时任务**：每隔一段时间（如每小时）对所有 Running 状态的沙盒执行一次归档。
3. **沙盒 `paused` 事件触发时**：订阅 `sandbox.lifecycle.paused` Webhook，在沙盒暂停时（此时沙盒文件系统仍可访问，可通过 `Sandbox.connect()` 重新连接）触发归档。

---

## 九、参考资料

1. [E2B Docs: Connecting storage bucket to the sandbox](https://e2b.dev/docs/sandbox/connect-bucket)
2. [E2B Docs: Sandbox persistence (betaPause)](https://e2b.dev/docs/sandbox/persistence)
3. [E2B Docs: Sandbox lifecycle webhooks](https://e2b.dev/docs/sandbox/lifecycle-events-webhooks)
4. [Cloudflare Docs: R2 Authentication](https://developers.cloudflare.com/r2/api/tokens/)
5. [Cloudflare Docs: R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
6. [GitHub: E2B Issue #884 - Paused sandbox file persistence bug](https://github.com/e2b-dev/E2B/issues/884)
7. [AWS SDK for JavaScript v3: S3 Client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
8. [boto3 S3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html)

---

## 十、oneceo 落地实现说明（2026-02）

### 10.1 集成范围

- 后端服务位于 `oneceo/apps/api`。
- E2B Sandbox 通过 `e2b` SDK 管理，启用 `autoPause`。
- 归档与恢复由后端主动触发，归档对象存放在 Cloudflare R2。

### 10.2 归档策略

- **归档对象键**：`sessions/<taskSessionId>/workspace.tar.gz`
- **元数据对象键**：`sessions/<taskSessionId>/metadata.json`
- **触发规则**：沙盒超过 `E2B_ARCHIVE_IDLE_MINUTES`（默认 40 分钟）无活跃，后台任务自动归档并 pause。
- **恢复规则**：sandbox 创建后若 R2 中存在归档则自动还原。

### 10.3 关键环境变量

```
E2B_API_KEY=
E2B_TEMPLATE=opencode
E2B_TIMEOUT_MS=1800000
E2B_ALLOW_INTERNET=true
E2B_ALLOW_PUBLIC_TRAFFIC=true
OPENCODE_SERVER_PORT=4096
OPENCODE_SERVER_HOST=0.0.0.0
OPENCODE_TASK_WORKSPACE_ROOT=/opt/.altus/opencode/workspaces

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com

E2B_ARCHIVE_JOB_ENABLED=true
E2B_ARCHIVE_IDLE_MINUTES=40
E2B_ARCHIVE_JOB_INTERVAL_MS=600000
E2B_ARCHIVE_SCAN_LIMIT=500
SANDBOX_ACTIVITY_MIN_INTERVAL_MS=30000
```

### 10.4 主要代码入口

- R2 客户端：`apps/api/src/services/r2-client.ts`
- 归档逻辑：`apps/api/src/services/sandbox-archive-service.ts`
- 空闲归档任务：`apps/api/src/services/sandbox-archive-job.ts`
- 活跃度记录：`apps/api/src/services/sandbox-activity-service.ts`
- 启动归档任务：`apps/api/src/index.ts`

### 10.5 运维注意事项

- 归档任务依赖沙盒可恢复（autoPause），如 sandbox 已被 kill，则无法归档。
- R2 不回收历史归档对象，如需版本清理需新增策略。
- 建议在生产环境仅启用一个 API 实例运行归档任务。

