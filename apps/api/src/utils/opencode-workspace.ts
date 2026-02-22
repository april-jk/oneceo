function sanitizeSegment(input: string): string {
  const normalized = input.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!normalized) {
    return 'session_unknown';
  }
  return normalized;
}

export function resolveOpencodeWorkspacePath(taskSessionId: string): string {
  const root = (process.env.OPENCODE_TASK_WORKSPACE_ROOT || '/opt/.altus/opencode/workspaces')
    .trim()
    .replace(/[\\/]+$/, '');
  const safeSession = sanitizeSegment(taskSessionId);
  return `${root}/${safeSession}`;
}

