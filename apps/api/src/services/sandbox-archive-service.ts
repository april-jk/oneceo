import * as crypto from 'crypto';
import { e2bConnector } from '../connectors/e2b-connector';
import { downloadFromR2, existsInR2, uploadToR2 } from './r2-client';
import {
  resolveLegacyOpencodeStatePath,
  resolveOpencodeStatePath,
  resolveOpencodeWorkspacePath,
} from '../utils/opencode-workspace';
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
  stateRoot: string;
};

type ArchiveManifest = {
  version: number;
  sandboxId: string;
  taskSessionId?: string;
  archivedAt: string;
  workspaceRoot: string;
  stateRoot?: string;
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
  resolveOpencodeStatePath: typeof resolveOpencodeStatePath;
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
  resolveOpencodeStatePath,
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
  stateRoot: string;
  taskSessionId: string | null;
  existingMetadata: Record<string, unknown>;
}> {
  const env = await sandboxArchiveServiceDeps.sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata);
  const fromMeta = asText((metadata as any).opencodeWorkspaceRoot);
  const stateFromMeta = asText((metadata as any).opencodeStateRoot);

  if (fromMeta) {
    return {
      workspaceRoot: normalizePath(fromMeta),
      stateRoot: normalizePath(
        stateFromMeta ||
          (taskSessionId
            ? sandboxArchiveServiceDeps.resolveOpencodeStatePath(taskSessionId)
            : resolveLegacyOpencodeStatePath(fromMeta) || fromMeta)
      ),
      taskSessionId,
      existingMetadata: metadata,
    };
  }

  if (taskSessionId) {
    return {
      workspaceRoot: sandboxArchiveServiceDeps.resolveOpencodeWorkspacePath(taskSessionId),
      stateRoot: sandboxArchiveServiceDeps.resolveOpencodeStatePath(taskSessionId),
      taskSessionId,
      existingMetadata: metadata,
    };
  }

  const fallback = WORKSPACE_ROOT_DEFAULT;
  return {
    workspaceRoot: normalizePath(fallback),
    stateRoot: normalizePath(resolveLegacyOpencodeStatePath(fallback) || fallback),
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

  const { workspaceRoot, stateRoot, taskSessionId, existingMetadata } = await resolveWorkspaceRoot(sandboxId);
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
  const bundleRoot = `/tmp/workspace_bundle_${Date.now()}`;
  const tarCommand = `
set -euo pipefail
mkdir -p ${shellEscape(workspaceRoot)} ${shellEscape(stateRoot)}
rm -rf ${shellEscape(bundleRoot)}
mkdir -p ${shellEscape(bundleRoot)}
ln -s ${shellEscape(workspaceRoot)} ${shellEscape(`${bundleRoot}/workspace`)}
ln -s ${shellEscape(stateRoot)} ${shellEscape(`${bundleRoot}/state`)}
tar -chzf ${tarPath} -C ${shellEscape(bundleRoot)} workspace state
rm -rf ${shellEscape(bundleRoot)}
`;
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
    version: 3,
    sandboxId,
    taskSessionId: taskSessionId || undefined,
    archivedAt,
    workspaceRoot,
    stateRoot,
    archiveKey,
    snapshotKey: storedSnapshotKey,
    sha256: hash,
    sizeBytes,
    reason,
  };
  await sandboxArchiveServiceDeps.uploadToR2(metadataKey, Buffer.from(JSON.stringify(manifest, null, 2)));

  await sandboxArchiveServiceDeps.e2bConnector.runCommand(
    sandboxId,
    `rm -f ${tarPath} && rm -rf ${shellEscape(bundleRoot)}`,
    { timeoutMs: 30000 }
  );

  await sandboxArchiveServiceDeps.clearSandboxDirty(sandboxId, {
    archiveStatus: unchanged ? 'up_to_date' : 'archived',
    archiveReason: reason,
    r2ArchiveKey: archiveKey,
    r2ArchiveSnapshotKey: storedSnapshotKey,
    r2ArchiveMetadataKey: metadataKey,
    r2ArchiveSha256: hash,
    lastArchivedAt: archivedAt,
    archiveSizeBytes: sizeBytes,
    opencodeWorkspaceRoot: workspaceRoot,
    opencodeStateRoot: stateRoot,
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
    stateRoot,
  };
}

export async function restoreWorkspaceIfArchived(sandboxId: string): Promise<boolean> {
  if (!isArchiveEnabled() || !isArchiveStorageConfigured()) {
    return false;
  }

  const { workspaceRoot, stateRoot, taskSessionId } = await resolveWorkspaceRoot(sandboxId);
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
  const restoreRoot = `/tmp/workspace_restore_${Date.now()}`;

  await sandboxArchiveServiceDeps.e2bConnector.writeFile(sandboxId, tarPath, archiveBytes);
  await sandboxArchiveServiceDeps.e2bConnector.runCommand(
    sandboxId,
    [
      `mkdir -p ${shellEscape(workspaceRoot)}`,
      `mkdir -p ${shellEscape(stateRoot)}`,
      `find ${shellEscape(workspaceRoot)} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
      `find ${shellEscape(stateRoot)} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
      `rm -rf ${shellEscape(restoreRoot)}`,
      `mkdir -p ${shellEscape(restoreRoot)}`,
      `tar -xzf ${tarPath} -C ${shellEscape(restoreRoot)}`,
      `if [[ -d ${shellEscape(`${restoreRoot}/workspace`)} ]]; then cp -a ${shellEscape(
        `${restoreRoot}/workspace/.`
      )} ${shellEscape(workspaceRoot)}/; else tar -xzf ${tarPath} -C ${shellEscape(workspaceRoot)}; fi`,
      `if [[ -d ${shellEscape(`${restoreRoot}/state`)} ]]; then cp -a ${shellEscape(
        `${restoreRoot}/state/.`
      )} ${shellEscape(stateRoot)}/; fi`,
      `if [[ -d ${shellEscape(resolveLegacyOpencodeStatePath(workspaceRoot) || '')} ]] && [[ -z "$(find ${shellEscape(
        stateRoot
      )} -mindepth 1 -print -quit 2>/dev/null)" ]]; then rm -rf ${shellEscape(
        stateRoot
      )} && mv ${shellEscape(resolveLegacyOpencodeStatePath(workspaceRoot) || '')} ${shellEscape(
        stateRoot
      )}; fi`,
      `rm -rf ${shellEscape(resolveLegacyOpencodeStatePath(workspaceRoot) || '')}`,
      `mkdir -p ${shellEscape(stateRoot)}`,
      `rm -f ${tarPath}`,
      `rm -rf ${shellEscape(restoreRoot)}`,
    ].join(' && '),
    { timeoutMs: 240000 }
  );

  await sandboxArchiveServiceDeps.setSandboxMetadata(sandboxId, {
    restoreStatus: 'restored',
    restoreAt: new Date().toISOString(),
    r2ArchiveKey: buildArchiveKey(taskSessionId, sandboxId),
    r2RestoreSourceKey: restoreKey,
    r2ArchiveMetadataKey: metadataKey,
    opencodeWorkspaceRoot: workspaceRoot,
    opencodeStateRoot: stateRoot,
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
