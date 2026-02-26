import { e2bConnector } from '../connectors/e2b-connector';
import { downloadFromR2, existsInR2, uploadToR2 } from './r2-client';
import { resolveOpencodeWorkspacePath } from '../utils/opencode-workspace';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import { setSandboxMetadata, extractTaskSessionId } from './sandbox-activity-service';

const WORKSPACE_ROOT_DEFAULT = '/opt/.altus/opencode/workspaces';

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '');
}

function buildArchiveKey(taskSessionId: string | null, sandboxId: string): string {
  if (taskSessionId) {
    return `sessions/${taskSessionId}/workspace.tar.gz`;
  }
  return `sandboxes/${sandboxId}/workspace.tar.gz`;
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

async function resolveWorkspaceRoot(sandboxId: string): Promise<{ workspaceRoot: string; taskSessionId: string | null }> {
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata);
  const fromMeta = typeof (metadata as any).opencodeWorkspaceRoot === 'string'
    ? String((metadata as any).opencodeWorkspaceRoot)
    : '';

  if (fromMeta.trim()) {
    return { workspaceRoot: normalizePath(fromMeta.trim()), taskSessionId };
  }

  if (taskSessionId) {
    return { workspaceRoot: resolveOpencodeWorkspacePath(taskSessionId), taskSessionId };
  }

  const fallback = WORKSPACE_ROOT_DEFAULT;
  return { workspaceRoot: normalizePath(fallback), taskSessionId };
}

export async function archiveSandboxWorkspace(sandboxId: string, reason: string): Promise<void> {
  const { workspaceRoot, taskSessionId } = await resolveWorkspaceRoot(sandboxId);
  if (!taskSessionId && workspaceRoot === normalizePath(WORKSPACE_ROOT_DEFAULT)) {
    throw new Error('无法确定归档目录：缺少 taskSessionId 与 workspaceRoot');
  }
  const archiveKey = buildArchiveKey(taskSessionId, sandboxId);
  const metadataKey = buildMetadataKey(taskSessionId, sandboxId);

  await setSandboxMetadata(sandboxId, {
    archiveStatus: 'in_progress',
    archiveReason: reason,
  });

  const tarPath = '/tmp/workspace_backup.tar.gz';
  const tarCommand = `tar -czf ${tarPath} -C ${shellEscape(workspaceRoot)} . 2>/dev/null || true`;
  await e2bConnector.runCommand(sandboxId, tarCommand, { timeoutMs: 120000 });

  const archiveBytes = await e2bConnector.readFile(sandboxId, tarPath);
  const archiveBuffer = Buffer.from(archiveBytes);
  await uploadToR2(archiveKey, archiveBuffer);

  const metadata = {
    sandboxId,
    taskSessionId: taskSessionId || undefined,
    archivedAt: new Date().toISOString(),
    workspaceRoot,
    archiveKey,
  };

  await uploadToR2(metadataKey, Buffer.from(JSON.stringify(metadata, null, 2)));

  await e2bConnector.runCommand(sandboxId, `rm -f ${tarPath}`, { timeoutMs: 30000 });

  await setSandboxMetadata(sandboxId, {
    archiveStatus: 'archived',
    archiveReason: reason,
    r2ArchiveKey: archiveKey,
    lastArchivedAt: metadata.archivedAt,
    archiveSizeBytes: archiveBuffer.length,
  });
}

export async function restoreWorkspaceIfArchived(sandboxId: string): Promise<boolean> {
  const { workspaceRoot, taskSessionId } = await resolveWorkspaceRoot(sandboxId);
  const archiveKey = buildArchiveKey(taskSessionId, sandboxId);

  if (!(await existsInR2(archiveKey))) {
    return false;
  }

  const archiveBytes = await downloadFromR2(archiveKey);
  const tarPath = '/tmp/workspace_restore.tar.gz';

  await e2bConnector.writeFile(sandboxId, tarPath, archiveBytes);
  await e2bConnector.runCommand(
    sandboxId,
    `mkdir -p ${shellEscape(workspaceRoot)} && tar -xzf ${tarPath} -C ${shellEscape(workspaceRoot)} && rm -f ${tarPath}`,
    { timeoutMs: 180000 }
  );

  await setSandboxMetadata(sandboxId, {
    restoreStatus: 'restored',
    restoreAt: new Date().toISOString(),
    r2ArchiveKey: archiveKey,
  });

  return true;
}

export async function resolveTaskSessionIdBySandbox(sandboxId: string): Promise<string | null> {
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sandboxId);
  const metadata = (env?.metadata || {}) as Record<string, unknown>;
  const taskSessionId = extractTaskSessionId(metadata);
  if (taskSessionId) return taskSessionId;
  const found = await taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(sandboxId);
  return found?.id || null;
}
