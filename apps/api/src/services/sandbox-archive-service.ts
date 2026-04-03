import * as crypto from 'crypto';
import { e2bConnector } from '../connectors/e2b-connector';
import { downloadFromR2, existsInR2, listR2Keys, uploadToR2 } from './r2-client';
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
  codexArchiveHome?: string;
  codexDotCodexPath?: string;
  codexArchivedExecutorSessionId?: string;
  codexArchiveVerifiedAt?: string;
  codexArchiveVerifiedRollout?: string;
};

type ArchiveManifest = {
  version: number;
  sandboxId: string;
  taskSessionId?: string;
  archivedAt: string;
  workspaceRoot: string;
  stateRoot?: string;
  codexArchiveHome?: string;
  codexDotCodexPath?: string;
  codexArchivedExecutorSessionId?: string;
  codexArchiveVerifiedAt?: string;
  codexArchiveVerifiedRollout?: string;
  archiveKey: string;
  snapshotKey: string;
  sha256: string;
  sizeBytes: number;
  reason: string;
};

export type SandboxArchiveHistoryEntry = {
  snapshotKey: string;
  archiveKey?: string | null;
  metadataKey?: string | null;
  archivedAt: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  reason?: string | null;
  status?: string | null;
  isCurrent: boolean;
};

type SandboxArchiveServiceDeps = {
  e2bConnector: typeof e2bConnector;
  downloadFromR2: typeof downloadFromR2;
  existsInR2: typeof existsInR2;
  listR2Keys: typeof listR2Keys;
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
  listR2Keys,
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

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = asText(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
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

function buildSnapshotPrefix(taskSessionId: string | null, sandboxId: string): string {
  if (taskSessionId) {
    return `sessions/${taskSessionId}/snapshots/`;
  }
  return `sandboxes/${sandboxId}/snapshots/`;
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

async function ensureCodexStateReady(
  sandboxId: string,
  input: {
    codexDotCodexPath: string;
    executorSessionId?: string;
    reason: string;
  }
): Promise<{ verified: boolean; matchedFile?: string; latestFile?: string }> {
  const executorSessionId = asText(input.executorSessionId);
  if (!executorSessionId) {
    return { verified: false };
  }

  const attempts = Math.max(3, Number(process.env.CODEX_ARCHIVE_READY_ATTEMPTS || 8));
  const delayMs = Math.max(500, Number(process.env.CODEX_ARCHIVE_READY_DELAY_MS || 1500));
  let latestFile = '';
  const extractCommandOutput = (value: unknown): string => {
    if (value && typeof value === 'object') {
      const result = (value as any).result;
      const output = asText(result?.stdout || result?.output || (value as any).stdout || (value as any).output);
      if (output) return output;
    }
    return '';
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const command = `
set -euo pipefail
state_dir=${shellEscape(`${input.codexDotCodexPath.replace(/\/+$/, '')}/sessions`)}
target=${shellEscape(executorSessionId)}
sync || true
if [ ! -d "$state_dir" ]; then
  exit 0
fi
match="$(find "$state_dir" -type f -name "*$target*.jsonl" -print -quit 2>/dev/null || true)"
if [ -n "$match" ]; then
  printf 'FOUND:%s' "$match"
  exit 0
fi
latest="$(find "$state_dir" -type f -name '*.jsonl' -print | sort | tail -n 1 || true)"
if [ -n "$latest" ]; then
  printf 'LATEST:%s' "$latest"
fi
`;
    let output = '';
    try {
      const result: any = await sandboxArchiveServiceDeps.e2bConnector.runCommand(sandboxId, command, {
        timeoutMs: 20_000,
      });
      output = asText(result?.stdout || result?.output);
    } catch (error) {
      output = extractCommandOutput(error);
      if (!output) {
        throw error;
      }
    }
    if (output.startsWith('FOUND:')) {
      return { verified: true, matchedFile: output.slice('FOUND:'.length) };
    }
    if (output.startsWith('LATEST:')) {
      latestFile = output.slice('LATEST:'.length);
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { verified: false, latestFile: latestFile || undefined };
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

function inferArchivedAtFromSnapshotKey(snapshotKey: string): string | null {
  const matched = snapshotKey.match(/\/snapshots\/(\d{14})/);
  if (!matched) return null;
  const stamp = matched[1];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}.000Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
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
  codexArchiveHome: string;
  codexDotCodexPath: string;
  taskSessionId: string | null;
  existingMetadata: Record<string, unknown>;
}> {
  const env = await sandboxArchiveServiceDeps.sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata);
  const fromMeta = asText((metadata as any).opencodeWorkspaceRoot);
  const stateFromMeta = asText((metadata as any).opencodeStateRoot);
  const codexArchiveHomeFromMeta = asText((metadata as any).codexArchiveHome);
  const codexDotCodexPathFromMeta = asText((metadata as any).codexDotCodexPath);

  if (fromMeta) {
    const normalizedStateRoot = normalizePath(
      stateFromMeta ||
        (taskSessionId
          ? sandboxArchiveServiceDeps.resolveOpencodeStatePath(taskSessionId)
          : resolveLegacyOpencodeStatePath(fromMeta) || fromMeta)
    );
    return {
      workspaceRoot: normalizePath(fromMeta),
      stateRoot: normalizedStateRoot,
      codexArchiveHome: normalizePath(codexArchiveHomeFromMeta || `${normalizedStateRoot}/codex-home`),
      codexDotCodexPath: normalizePath(codexDotCodexPathFromMeta || `${normalizedStateRoot}/codex-home/.codex`),
      taskSessionId,
      existingMetadata: metadata,
    };
  }

  if (taskSessionId) {
    const stateRoot = sandboxArchiveServiceDeps.resolveOpencodeStatePath(taskSessionId);
    return {
      workspaceRoot: sandboxArchiveServiceDeps.resolveOpencodeWorkspacePath(taskSessionId),
      stateRoot,
      codexArchiveHome: normalizePath(`${stateRoot}/codex-home`),
      codexDotCodexPath: normalizePath(`${stateRoot}/codex-home/.codex`),
      taskSessionId,
      existingMetadata: metadata,
    };
  }

  const fallback = WORKSPACE_ROOT_DEFAULT;
  const stateRoot = normalizePath(resolveLegacyOpencodeStatePath(fallback) || fallback);
  return {
    workspaceRoot: normalizePath(fallback),
    stateRoot,
    codexArchiveHome: normalizePath(`${stateRoot}/codex-home`),
    codexDotCodexPath: normalizePath(`${stateRoot}/codex-home/.codex`),
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

  const { workspaceRoot, stateRoot, codexArchiveHome, codexDotCodexPath, taskSessionId, existingMetadata } =
    await resolveWorkspaceRoot(sandboxId);
  if (!taskSessionId && workspaceRoot === normalizePath(WORKSPACE_ROOT_DEFAULT)) {
    throw new Error('无法确定归档目录：缺少 taskSessionId 与 workspaceRoot');
  }

  const archiveKey = buildArchiveKey(taskSessionId, sandboxId);
  const metadataKey = buildMetadataKey(taskSessionId, sandboxId);
  const archivedAt = new Date().toISOString();
  const snapshotKey = buildSnapshotKey(taskSessionId, sandboxId, archivedAt);
  const sandboxExecutor = asText((existingMetadata as any).sandboxExecutor || (existingMetadata as any).executor).toLowerCase();
  const codexExecutorSessionId =
    asText((existingMetadata as any).codexActiveExecutorSessionId) ||
    asText((existingMetadata as any).lastExecutorSessionId);
  const requiresCodexStateVerification =
    sandboxExecutor === 'codex' &&
    Boolean(codexExecutorSessionId) &&
    (asBoolean((existingMetadata as any).codexStateSyncRequired) ||
      reason === 'codex_turn_completed' ||
      options?.forceUpload === true);
  let codexArchiveVerifiedAt: string | undefined;
  let codexArchiveVerifiedRollout: string | undefined;

  await sandboxArchiveServiceDeps.setSandboxMetadata(sandboxId, {
    archiveStatus: 'in_progress',
    archiveReason: reason,
    lastArchiveAttemptAt: archivedAt,
  });

  if (requiresCodexStateVerification) {
    const verification = await ensureCodexStateReady(sandboxId, {
      codexDotCodexPath,
      executorSessionId: codexExecutorSessionId,
      reason,
    });
    if (!verification.verified) {
      const archiveError = [
        'Codex 状态未同步完成，已拒绝生成归档。',
        `executorSessionId=${codexExecutorSessionId}`,
        verification.latestFile ? `latest=${verification.latestFile}` : 'latest=missing',
      ].join(' ');
      await sandboxArchiveServiceDeps.setSandboxMetadata(sandboxId, {
        archiveStatus: 'failed',
        archiveReason: reason,
        archiveError,
        codexArchiveReady: false,
        codexArchiveVerificationReason: reason,
        codexArchiveVerificationFailedAt: new Date().toISOString(),
        codexArchivedExecutorSessionId: codexExecutorSessionId,
        codexArchiveVerifiedRollout: verification.latestFile || undefined,
      });
      throw new Error(archiveError);
    }
    codexArchiveVerifiedAt = new Date().toISOString();
    codexArchiveVerifiedRollout = verification.matchedFile || verification.latestFile;
    await sandboxArchiveServiceDeps.setSandboxMetadata(sandboxId, {
      codexArchiveReady: true,
      codexArchiveVerificationReason: reason,
      codexArchiveVerifiedAt,
      codexArchiveVerifiedRollout,
      codexArchivedExecutorSessionId: codexExecutorSessionId,
    });
  }

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
    codexArchiveHome,
    codexDotCodexPath,
    codexArchivedExecutorSessionId: codexExecutorSessionId || undefined,
    codexArchiveVerifiedAt,
    codexArchiveVerifiedRollout,
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
    codexArchiveHome,
    codexDotCodexPath,
    codexArchiveReady: requiresCodexStateVerification ? true : undefined,
    codexArchiveVerifiedAt,
    codexArchiveVerifiedRollout,
    codexArchivedExecutorSessionId: codexExecutorSessionId || undefined,
    codexStateSyncRequired: requiresCodexStateVerification ? false : undefined,
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
    codexArchiveHome,
    codexDotCodexPath,
    codexArchivedExecutorSessionId: codexExecutorSessionId || undefined,
    codexArchiveVerifiedAt,
    codexArchiveVerifiedRollout,
  };
}

export async function restoreWorkspaceIfArchived(sandboxId: string): Promise<boolean> {
  if (!isArchiveEnabled() || !isArchiveStorageConfigured()) {
    return false;
  }

  const { workspaceRoot, stateRoot, codexArchiveHome, codexDotCodexPath, taskSessionId } =
    await resolveWorkspaceRoot(sandboxId);
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
    codexArchiveHome,
    codexDotCodexPath,
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

export async function listSandboxArchiveHistory(sandboxId: string): Promise<SandboxArchiveHistoryEntry[]> {
  const env = await sandboxArchiveServiceDeps.sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata) || (await resolveTaskSessionIdBySandbox(sandboxId));
  const metadataKey = asText((metadata as any).r2ArchiveMetadataKey) || buildMetadataKey(taskSessionId, sandboxId);

  let manifest: Partial<ArchiveManifest> = {};
  if (metadataKey && await sandboxArchiveServiceDeps.existsInR2(metadataKey)) {
    try {
      manifest = parseManifest(await sandboxArchiveServiceDeps.downloadFromR2(metadataKey));
    } catch (error) {
      console.warn('[SANDBOX_ARCHIVE] read history metadata failed', metadataKey, error);
    }
  }

  const snapshotPrefix = buildSnapshotPrefix(taskSessionId, sandboxId);
  const snapshotKeys = await sandboxArchiveServiceDeps.listR2Keys(snapshotPrefix, 200).catch(() => []);
  const rows = snapshotKeys
    .filter((key) => key.endsWith('.tar.gz'))
    .map<SandboxArchiveHistoryEntry>((key) => ({
      snapshotKey: key,
      archiveKey: manifest.snapshotKey === key ? manifest.archiveKey || null : null,
      metadataKey: manifest.snapshotKey === key ? metadataKey || null : null,
      archivedAt: manifest.snapshotKey === key ? manifest.archivedAt || null : inferArchivedAtFromSnapshotKey(key),
      sizeBytes: manifest.snapshotKey === key ? manifest.sizeBytes || null : null,
      sha256: manifest.snapshotKey === key ? manifest.sha256 || null : null,
      reason: manifest.snapshotKey === key ? manifest.reason || null : null,
      status: manifest.snapshotKey === key ? asText((metadata as any).archiveStatus) || 'archived' : 'archived',
      isCurrent: manifest.snapshotKey === key,
    }))
    .sort((a, b) => Date.parse(b.archivedAt || '1970-01-01') - Date.parse(a.archivedAt || '1970-01-01'));

  if (manifest.snapshotKey && !rows.some((item) => item.snapshotKey === manifest.snapshotKey)) {
    rows.unshift({
      snapshotKey: manifest.snapshotKey,
      archiveKey: manifest.archiveKey || null,
      metadataKey: metadataKey || null,
      archivedAt: manifest.archivedAt || null,
      sizeBytes: manifest.sizeBytes || null,
      sha256: manifest.sha256 || null,
      reason: manifest.reason || null,
      status: asText((metadata as any).archiveStatus) || 'archived',
      isCurrent: true,
    });
  }

  return rows;
}
