function sanitizeSegment(input: string): string {
  const normalized = input.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!normalized) {
    return 'session_unknown';
  }
  return normalized;
}

function normalizeRoot(input: string, fallback: string): string {
  return (input || fallback).trim().replace(/[\\/]+$/, '');
}

function parentDir(input: string): string {
  const normalized = input.replace(/[\\/]+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return normalized;
  }
  return normalized.slice(0, index);
}

export function resolveOpencodeWorkspacePath(taskSessionId: string): string {
  const root = normalizeRoot(
    process.env.OPENCODE_TASK_WORKSPACE_ROOT || '',
    '/opt/.altus/opencode/workspaces'
  );
  const safeSession = sanitizeSegment(taskSessionId);
  return `${root}/${safeSession}`;
}

export function resolveOpencodeStatePath(taskSessionId: string): string {
  const explicit = (process.env.OPENCODE_TASK_STATE_ROOT || '').trim();
  const workspaceBase = normalizeRoot(
    process.env.OPENCODE_TASK_WORKSPACE_ROOT || '',
    '/opt/.altus/opencode/workspaces'
  );
  const root = explicit
    ? normalizeRoot(explicit, '/home/user/opencode/state')
    : `${parentDir(workspaceBase)}/state`;
  const safeSession = sanitizeSegment(taskSessionId);
  return `${root}/${safeSession}`;
}

export function resolveLegacyOpencodeStatePath(workspaceRoot?: string | null): string | null {
  const normalized = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  if (!normalized) {
    return null;
  }
  return `${normalized.replace(/\/+$/, '')}/.opencode`;
}

export function resolveCodexArchiveHomePath(taskSessionId: string): string {
  return `${resolveOpencodeStatePath(taskSessionId)}/codex-home`;
}

export function resolveCodexArchiveDotCodexPath(taskSessionId: string): string {
  return `${resolveCodexArchiveHomePath(taskSessionId)}/.codex`;
}
