import * as crypto from 'crypto';
import { e2bConnector } from '../connectors/e2b-connector';
import { downloadFromR2, existsInR2, uploadToR2 } from './r2-client';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { clearSandboxDirty, setSandboxMetadata, extractTaskSessionId } from './sandbox-activity-service';

const WORKSPACE_ROOT_DEFAULT = '/opt/.altus/opencode/workspaces';

export type ArchiveWorkspaceOptions = {
  forceUpload?: boolean;
};

export type ArchiveWorkspaceResult = {
  uploaded: boolean;
  archiveKey: string;
  snapshotKey: string;
  metadataKey: string;
  archivedAt: string;
  sha256: string;
  sizeBytes: number;
  taskSessionId: string | null;
  workspaceRoot: string;
};

type ArchiveManifest = {
  version: number;
  sandboxId: string;
  taskSessionId?: string;
  archivedAt: string;
  workspaceRoot: string;
  archiveKey: string;
  snapshotKey: string;
  sha256: string;
  sizeBytes: number;
  reason: string;
};

type SandboxArchiveServiceDeps = {
  e2bConnector: typeof e2bConnector;
  downloadFromR2: typeof downloadFromR2;
  existsInR2: typeof existsInR2;
  uploadToR2: typeof uploadToR2;
  resolveOpencodeWorkspacePath: typeof resolveOpencodeWorkspacePath;
  sandboxExecutionEnvironmentDAO: typeof sandboxExecutionEnvironmentDAO;
  taskCreationFileMemoryStore: typeof taskCreationFileMemoryStore;
  clearSandboxDirty: typeof clearSandboxDirty;
  setSandboxMetadata: typeof setSandboxMetadata;
};

const defaultSandboxArchiveServiceDeps: SandboxArchiveServiceDeps = {
  e2bConnector,
  downloadFromR2,
  existsInR2,
  uploadToR2,
  resolveOpencodeWorkspacePath,
  sandboxExecutionEnvironmentDAO,
  taskCreationFileMemoryStore,
  clearSandboxDirty,
  setSandboxMetadata,
};

let sandboxArchiveServiceDeps: SandboxArchiveServiceDeps = { ...defaultSandboxArchiveServiceDeps };

export function __setSandboxArchiveServiceDepsForTest(overrides: Partial<SandboxArchiveServiceDeps>): void {
  sandboxArchiveServiceDeps = {
    ...sandboxArchiveServiceDeps,
    ...overrides,
  };
}

export function __resetSandboxArchiveServiceDepsForTest(): void {
  sandboxArchiveServiceDeps = { ...defaultSandboxArchiveServiceDeps };
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildArchiveKey(taskSessionId: string | null, sandboxId: string): string {
  if (taskSessionId) {
    return `sessions/${taskSessionId}/workspace.tar.gz`;
  }
  return `sandboxes/${sandboxId}/workspace.tar.gz`;
}

function buildSnapshotKey(taskSessionId: string | null, sandboxId: string, archivedAt: string): string {
  const stamp = archivedAt.replace(/[^0-9]/g, '');
  if (taskSessionId) {
    return `sessions/${taskSessionId}/snapshots/${stamp}-${sandboxId}.tar.gz`;
  }
  return `sandboxes/${sandboxId}/snapshots/${stamp}.tar.gz`;
}

function buildMetadataKey(taskSessionId: string | null, sandboxId: string): string {
  if (taskSessionId) {
    return `sessions/${taskSessionId}/metadata.json`;
  }
  return `sandboxes/${sandboxId}/metadata.json`;
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseManifest(raw: Buffer): Partial<ArchiveManifest> {
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as Partial<ArchiveManifest>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function listRestoreCandidates(
  taskSessionId: string | null,
  sandboxId: string,
  manifest?: Partial<ArchiveManifest>
): string[] {
  const candidates: string[] = [];
  const add = (value: unknown) => {
    const key = asText(value);
    if (!key) return;
    if (!candidates.includes(key)) {
      candidates.push(key);
    }
  };

  add(buildArchiveKey(taskSessionId, sandboxId));
  add(manifest?.archiveKey);
  add((manifest as any)?.snapshotKey);
  add((manifest as any)?.latestSnapshotKey);
  add((manifest as any)?.latestArchiveKey);
  add(`sandboxes/${sandboxId}/workspace.tar.gz`);

  return candidates;
}

function isArchiveEnabled(): boolean {
  const raw = String(process.env.E2B_ARCHIVE_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

export function isArchiveStorageConfigured(): boolean {
  const required = ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  return required.every((key) => Boolean(process.env[key] && process.env[key]!.trim()));
}

async function resolveWorkspaceRoot(sandboxId: string): Promise<{
  workspaceRoot: string;
  taskSessionId: string | null;
  existingMetadata: Record<string, unknown>;
}> {
  const env = await sandboxArchiveServiceDeps.sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata);
  const fromMeta = asText((metadata as any).opencodeWorkspaceRoot);

  if (fromMeta) {
    return {
      workspaceRoot: normalizePath(fromMeta),
      taskSessionId,
      existingMetadata: metadata,
    };
  }

  if (taskSessionId) {
    return {
      workspaceRoot: sandboxArchiveServiceDeps.resolveOpencodeWorkspacePath(taskSessionId),
      taskSessionId,
      existingMetadata: metadata,
    };
  }

  const fallback = WORKSPACE_ROOT_DEFAULT;
  return {
    workspaceRoot: normalizePath(fallback),
    taskSessionId,
    existingMetadata: metadata,
  };
}

export async function archiveSandboxWorkspace(
  sandboxId: string,
  reason: string,
  options?: ArchiveWorkspaceOptions
): Promise<ArchiveWorkspaceResult> {
  if (!isArchiveEnabled()) {
    throw new Error('archive job disabled');
  }
  if (!isArchiveStorageConfigured()) {
    throw new Error('R2 archive storage not configured');
  }

  const { workspaceRoot, taskSessionId, existingMetadata } = await resolveWorkspaceRoot(sandboxId);
  if (!taskSessionId && workspaceRoot === normalizePath(WORKSPACE_ROOT_DEFAULT)) {
    throw new Error('无法确定归档目录：缺少 taskSessionId 与 workspaceRoot');
  }

  const archiveKey = buildArchiveKey(taskSessionId, sandboxId);
  const metadataKey = buildMetadataKey(taskSessionId, sandboxId);
  const archivedAt = new Date().toISOString();
  const snapshotKey = buildSnapshotKey(taskSessionId, sandboxId, archivedAt);

  await sandboxArchiveServiceDeps.setSandboxMetadata(sandboxId, {
    archiveStatus: 'in_progress',
    archiveReason: reason,
    lastArchiveAttemptAt: archivedAt,
  });

  const tarPath = `/tmp/workspace_backup_${Date.now()}.tar.gz`;
  const tarCommand = `mkdir -p ${shellEscape(workspaceRoot)} && tar -czf ${tarPath} -C ${shellEscape(workspaceRoot)} .`;
  await sandboxArchiveServiceDeps.e2bConnector.runCommand(sandboxId, tarCommand, { timeoutMs: 180000 });

  const archiveBytes = await sandboxArchiveServiceDeps.e2bConnector.readFile(sandboxId, tarPath);
  const archiveBuffer = Buffer.from(archiveBytes);
  const hash = sha256(archiveBuffer);
  const sizeBytes = archiveBuffer.length;
  const previousHash = asText((existingMetadata as any).r2ArchiveSha256);
  const previousSnapshotKey = asText((existingMetadata as any).r2ArchiveSnapshotKey);
  const forceUpload = options?.forceUpload === true;
  const archiveKeyExists = await sandboxArchiveServiceDeps.existsInR2(archiveKey);
  const unchanged = !forceUpload && previousHash && previousHash === hash && archiveKeyExists;
  const storedSnapshotKey = unchanged ? previousSnapshotKey || archiveKey : snapshotKey;

  if (!unchanged) {
    await sandboxArchiveServiceDeps.uploadToR2(archiveKey, archiveBuffer);
    await sandboxArchiveServiceDeps.uploadToR2(snapshotKey, archiveBuffer);
  }

  const manifest: ArchiveManifest = {
    version: 2,
    sandboxId,
    taskSessionId: taskSessionId || undefined,
    archivedAt,
    workspaceRoot,
    archiveKey,
    snapshotKey: storedSnapshotKey,
    sha256: hash,
    sizeBytes,
    reason,
  };
  await sandboxArchiveServiceDeps.uploadToR2(metadataKey, Buffer.from(JSON.stringify(manifest, null, 2)));

  await sandboxArchiveServiceDeps.e2bConnector.runCommand(sandboxId, `rm -f ${tarPath}`, { timeoutMs: 30000 });

  await sandboxArchiveServiceDeps.clearSandboxDirty(sandboxId, {
    archiveStatus: unchanged ? 'up_to_date' : 'archived',
    archiveReason: reason,
    r2ArchiveKey: archiveKey,
    r2ArchiveSnapshotKey: storedSnapshotKey,
    r2ArchiveMetadataKey: metadataKey,
    r2ArchiveSha256: hash,
    lastArchivedAt: archivedAt,
    archiveSizeBytes: sizeBytes,
  });

  return {
    uploaded: !unchanged,
    archiveKey,
    snapshotKey: storedSnapshotKey,
    metadataKey,
    archivedAt,
    sha256: hash,
    sizeBytes,
    taskSessionId,
    workspaceRoot,
  };
}

export async function restoreWorkspaceIfArchived(sandboxId: string): Promise<boolean> {
  if (!isArchiveEnabled() || !isArchiveStorageConfigured()) {
    return false;
  }

  const { workspaceRoot, taskSessionId } = await resolveWorkspaceRoot(sandboxId);
  const metadataKey = buildMetadataKey(taskSessionId, sandboxId);
  let manifest: Partial<ArchiveManifest> | undefined;

  if (await sandboxArchiveServiceDeps.existsInR2(metadataKey)) {
    try {
      manifest = parseManifest(await sandboxArchiveServiceDeps.downloadFromR2(metadataKey));
    } catch (error) {
      console.warn('[SANDBOX_ARCHIVE] read metadata failed', metadataKey, error);
    }
  }

  const candidates = listRestoreCandidates(taskSessionId, sandboxId, manifest);
  let restoreKey = '';
  for (const key of candidates) {
    if (await sandboxArchiveServiceDeps.existsInR2(key)) {
      restoreKey = key;
      break;
    }
  }
  if (!restoreKey) {
    return false;
  }

  const archiveBytes = await sandboxArchiveServiceDeps.downloadFromR2(restoreKey);
  const tarPath = '/tmp/workspace_restore.tar.gz';

  await sandboxArchiveServiceDeps.e2bConnector.writeFile(sandboxId, tarPath, archiveBytes);
  await sandboxArchiveServiceDeps.e2bConnector.runCommand(
    sandboxId,
    [
      `mkdir -p ${shellEscape(workspaceRoot)}`,
      `find ${shellEscape(workspaceRoot)} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
      `tar -xzf ${tarPath} -C ${shellEscape(workspaceRoot)}`,
      `rm -f ${tarPath}`,
    ].join(' && '),
    { timeoutMs: 240000 }
  );

  await sandboxArchiveServiceDeps.setSandboxMetadata(sandboxId, {
    restoreStatus: 'restored',
    restoreAt: new Date().toISOString(),
    r2ArchiveKey: buildArchiveKey(taskSessionId, sandboxId),
    r2RestoreSourceKey: restoreKey,
    r2ArchiveMetadataKey: metadataKey,
  });

  return true;
}

export async function resolveTaskSessionIdBySandbox(sandboxId: string): Promise<string | null> {
  const env = await sandboxArchiveServiceDeps.sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata);
  if (taskSessionId) return taskSessionId;
  const found = await sandboxArchiveServiceDeps.taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(
    sandboxId
  );
  return found?.id || null;
}
