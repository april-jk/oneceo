import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import {
  __resetSandboxArchiveServiceDepsForTest,
  __setSandboxArchiveServiceDepsForTest,
  archiveSandboxWorkspace,
  restoreWorkspaceIfArchived,
} from '../src/services/sandbox-archive-service';

type EnvRecord = {
  sessionId: string;
  metadata: Record<string, unknown>;
};

const envMap = new Map<string, EnvRecord>();
const r2Map = new Map<string, Buffer>();
const uploadLog: Array<{ key: string; size: number }> = [];
const commandLog: Array<{ sessionId: string; command: string }> = [];
const writeLog: Array<{ sessionId: string; path: string; size: number }> = [];
let archivePayload = Buffer.from('archive-payload-v1', 'utf8');

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

beforeEach(() => {
  process.env.E2B_ARCHIVE_ENABLED = 'true';
  process.env.R2_BUCKET_NAME = 'unit-test-bucket';
  process.env.R2_ACCOUNT_ID = 'unit-test-account';
  process.env.R2_ACCESS_KEY_ID = 'unit-test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'unit-test-secret';

  envMap.clear();
  r2Map.clear();
  uploadLog.length = 0;
  commandLog.length = 0;
  writeLog.length = 0;
  archivePayload = Buffer.from('archive-payload-v1', 'utf8');
  __resetSandboxArchiveServiceDepsForTest();

  __setSandboxArchiveServiceDepsForTest({
    sandboxExecutionEnvironmentDAO: {
      getBySessionId: async (sessionId: string) => envMap.get(sessionId) || null,
    } as any,
    e2bConnector: {
      runCommand: async (sessionId: string, command: string) => {
        commandLog.push({ sessionId, command });
        return { stdout: '', output: '', exitCode: 0 };
      },
      readFile: async () => archivePayload,
      writeFile: async (sessionId: string, path: string, data: Uint8Array | Buffer) => {
        const size = data instanceof Buffer ? data.length : data.byteLength;
        writeLog.push({ sessionId, path, size });
      },
    } as any,
    existsInR2: async (key: string) => r2Map.has(key),
    uploadToR2: async (key: string, value: Uint8Array | Buffer) => {
      const buffer = value instanceof Buffer ? value : Buffer.from(value);
      r2Map.set(key, buffer);
      uploadLog.push({ key, size: buffer.length });
    },
    downloadFromR2: async (key: string) => {
      const value = r2Map.get(key);
      if (!value) throw new Error(`missing key: ${key}`);
      return value;
    },
    resolveOpencodeWorkspacePath: (taskSessionId: string) => `/workspace/${taskSessionId}`,
    resolveOpencodeStatePath: (taskSessionId: string) => `/state/${taskSessionId}`,
    clearSandboxDirty: async (sessionId: string, patch?: Record<string, unknown>) => {
      const env = envMap.get(sessionId);
      if (!env) return;
      env.metadata = {
        ...env.metadata,
        pendingArchiveUpdate: false,
        archiveDirty: false,
        ...(patch || {}),
      };
      envMap.set(sessionId, env);
    },
    setSandboxMetadata: async (sessionId: string, patch: Record<string, unknown>) => {
      const env = envMap.get(sessionId);
      if (!env) return null;
      env.metadata = {
        ...env.metadata,
        ...patch,
      };
      envMap.set(sessionId, env);
      return env as any;
    },
    taskCreationFileMemoryStore: {
      findSessionByOrchestratorSessionId: async () => null,
    } as any,
  });
});

afterEach(() => {
  __resetSandboxArchiveServiceDepsForTest();
});

test('archives and uploads when workspace content changed', async () => {
  const sandboxId = 'sandbox-archive-service-1';
  envMap.set(sandboxId, {
    sessionId: sandboxId,
    metadata: {
      taskSessionId: 'task-archive-1',
      opencodeWorkspaceRoot: '/workspace/task-archive-1',
      pendingArchiveUpdate: true,
    },
  });

  const result = await archiveSandboxWorkspace(sandboxId, 'idle_timeout');
  assert.equal(result.uploaded, true);
  assert.equal(result.taskSessionId, 'task-archive-1');
  assert.equal(result.stateRoot, '/state/task-archive-1');

  assert.ok(uploadLog.some((item) => item.key === 'sessions/task-archive-1/workspace.tar.gz'));
  assert.ok(uploadLog.some((item) => item.key.startsWith('sessions/task-archive-1/snapshots/')));
  assert.ok(uploadLog.some((item) => item.key === 'sessions/task-archive-1/metadata.json'));
  assert.ok(
    commandLog.some(
      (item) =>
        item.command.includes('ln -s') &&
        item.command.includes('workspace state') &&
        item.command.includes('tar -chzf')
    )
  );

  const env = envMap.get(sandboxId)?.metadata || {};
  assert.equal(env.archiveStatus, 'archived');
  assert.equal(env.pendingArchiveUpdate, false);
  assert.equal(env.r2ArchiveSha256, sha256(archivePayload));
  assert.equal(env.opencodeStateRoot, '/state/task-archive-1');
});

test('skips archive upload when hash unchanged and archive already exists', async () => {
  const sandboxId = 'sandbox-archive-service-2';
  const existingHash = sha256(archivePayload);
  r2Map.set('sessions/task-archive-2/workspace.tar.gz', Buffer.from('existing', 'utf8'));

  envMap.set(sandboxId, {
    sessionId: sandboxId,
    metadata: {
      taskSessionId: 'task-archive-2',
      opencodeWorkspaceRoot: '/workspace/task-archive-2',
      r2ArchiveSha256: existingHash,
      r2ArchiveSnapshotKey: 'sessions/task-archive-2/snapshots/old-snapshot.tar.gz',
      pendingArchiveUpdate: true,
    },
  });

  const result = await archiveSandboxWorkspace(sandboxId, 'idle_timeout');
  assert.equal(result.uploaded, false);
  assert.equal(result.snapshotKey, 'sessions/task-archive-2/snapshots/old-snapshot.tar.gz');

  const nonMetadataUploads = uploadLog.filter((item) => !item.key.endsWith('/metadata.json'));
  assert.equal(nonMetadataUploads.length, 0);

  const env = envMap.get(sandboxId)?.metadata || {};
  assert.equal(env.archiveStatus, 'up_to_date');
  assert.equal(env.pendingArchiveUpdate, false);
});

test('restores workspace from archived object and executes restore command', async () => {
  const sandboxId = 'sandbox-archive-service-3';
  envMap.set(sandboxId, {
    sessionId: sandboxId,
    metadata: {
      taskSessionId: 'task-archive-3',
      opencodeWorkspaceRoot: '/workspace/task-archive-3',
    },
  });

  const metadataKey = 'sessions/task-archive-3/metadata.json';
  const archiveKey = 'sessions/task-archive-3/workspace.tar.gz';
  r2Map.set(
    metadataKey,
    Buffer.from(
      JSON.stringify({
        version: 3,
        sandboxId,
        taskSessionId: 'task-archive-3',
        workspaceRoot: '/workspace/task-archive-3',
        stateRoot: '/state/task-archive-3',
        archiveKey,
      }),
      'utf8'
    )
  );
  r2Map.set(archiveKey, Buffer.from('restored-archive-content', 'utf8'));

  const restored = await restoreWorkspaceIfArchived(sandboxId);
  assert.equal(restored, true);
  assert.equal(writeLog.length, 1);
  assert.ok(commandLog.some((item) => item.command.includes('find') && item.command.includes('-exec rm -rf')));
  assert.ok(commandLog.some((item) => item.command.includes('tar -xzf')));
  assert.ok(commandLog.some((item) => item.command.includes('/state/task-archive-3')));

  const env = envMap.get(sandboxId)?.metadata || {};
  assert.equal(env.restoreStatus, 'restored');
  assert.equal(env.r2RestoreSourceKey, archiveKey);
  assert.equal(env.opencodeStateRoot, '/state/task-archive-3');
});

test('restores legacy v2 archive and migrates workspace .opencode into state root', async () => {
  const sandboxId = 'sandbox-archive-service-4';
  envMap.set(sandboxId, {
    sessionId: sandboxId,
    metadata: {
      taskSessionId: 'task-archive-4',
      opencodeWorkspaceRoot: '/workspace/task-archive-4',
    },
  });

  const metadataKey = 'sessions/task-archive-4/metadata.json';
  const archiveKey = 'sessions/task-archive-4/workspace.tar.gz';
  r2Map.set(
    metadataKey,
    Buffer.from(
      JSON.stringify({
        version: 2,
        sandboxId,
        taskSessionId: 'task-archive-4',
        archiveKey,
      }),
      'utf8'
    )
  );
  r2Map.set(archiveKey, Buffer.from('legacy-archive-content', 'utf8'));

  const restored = await restoreWorkspaceIfArchived(sandboxId);
  assert.equal(restored, true);
  assert.ok(
    commandLog.some(
      (item) =>
        item.command.includes('/workspace/task-archive-4/.opencode') &&
        item.command.includes('/state/task-archive-4')
    )
  );
});
