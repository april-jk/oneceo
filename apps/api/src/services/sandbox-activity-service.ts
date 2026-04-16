import { sandboxExecutionEnvironmentDAO } from '../db/dao';

const lastTouch = new Map<string, number>();
const lastDirtyMark = new Map<string, number>();
const dirtySessions = new Set<string>();
const MIN_TOUCH_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.SANDBOX_ACTIVITY_MIN_INTERVAL_MS || 30000)
);
const MIN_DIRTY_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.SANDBOX_DIRTY_MARK_MIN_INTERVAL_MS || 15000)
);

function shouldTouch(sessionId: string): boolean {
  const now = Date.now();
  const prev = lastTouch.get(sessionId) || 0;
  if (now - prev < MIN_TOUCH_INTERVAL_MS) {
    return false;
  }
  lastTouch.set(sessionId, now);
  return true;
}

function shouldMarkDirty(sessionId: string): boolean {
  const now = Date.now();
  const prev = lastDirtyMark.get(sessionId) || 0;
  if (now - prev < MIN_DIRTY_INTERVAL_MS) {
    return false;
  }
  lastDirtyMark.set(sessionId, now);
  return true;
}

function mergeMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(existing || {}),
    ...patch,
  };
}

async function updateMetadata(sessionId: string, patch: Record<string, unknown>) {
  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
  if (!env) return null;
  const next = mergeMetadata((env.metadata || {}) as Record<string, unknown>, patch);
  return sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, next);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function flattenErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: any = error;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const message = typeof current?.message === 'string' ? current.message.trim() : '';
    if (message) {
      messages.push(message);
    }
    current = current?.cause;
  }
  return messages;
}

function flattenErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: any = error;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const code = asText(current?.code);
    if (code) {
      codes.push(code.toUpperCase());
    }
    const errno = asText(current?.errno);
    if (errno) {
      codes.push(errno.toUpperCase());
    }
    current = current?.cause;
  }
  return codes;
}

function isTransientDatabaseError(error: unknown): boolean {
  const messages = flattenErrorMessages(error).join(' | ').toLowerCase();
  const codes = new Set(flattenErrorCodes(error));

  if (
    codes.has('ECONNRESET') ||
    codes.has('ECONNREFUSED') ||
    codes.has('ETIMEDOUT') ||
    codes.has('EPIPE') ||
    codes.has('57P01') ||
    codes.has('57P02') ||
    codes.has('57P03') ||
    codes.has('53300') ||
    codes.has('08000') ||
    codes.has('08001') ||
    codes.has('08003') ||
    codes.has('08004') ||
    codes.has('08006') ||
    codes.has('08P01')
  ) {
    return true;
  }

  if (!messages) return false;
  return (
    messages.includes('drizzlequeryerror') ||
    messages.includes('connection terminated due to connection timeout') ||
    messages.includes('connection terminated unexpectedly') ||
    messages.includes('timeout exceeded when trying to connect') ||
    messages.includes('terminating connection due to administrator command') ||
    messages.includes('too many clients already') ||
    messages.includes('remaining connection slots are reserved') ||
    messages.includes('read econnreset') ||
    messages.includes('connect econnrefused') ||
    messages.includes('socket hang up') ||
    messages.includes('connection timeout') ||
    messages.includes('failed to connect')
  );
}

function logSandboxActivityError(
  operation: string,
  sessionId: string,
  error: unknown
): void {
  if (isTransientDatabaseError(error)) {
    console.warn(`[SANDBOX_ACTIVITY] ${operation} skipped due to transient db error`, sessionId, error);
    return;
  }
  console.error(`[SANDBOX_ACTIVITY] ${operation} skipped due to unexpected error`, sessionId, error);
}

function toPositiveMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export async function touchSandbox(
  sessionId: string,
  reason: string,
  options?: { force?: boolean; extra?: Record<string, unknown> }
): Promise<void> {
  if (!sessionId) return;
  if (!options?.force && !shouldTouch(sessionId)) return;
  const now = new Date().toISOString();
  try {
    await updateMetadata(sessionId, {
      lastActiveAt: now,
      lastActiveReason: reason,
      ...(options?.extra || {}),
    });
  } catch (error) {
    logSandboxActivityError('touch', sessionId, error);
  }
}

export async function setSandboxMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void> {
  if (!sessionId) return;
  try {
    await updateMetadata(sessionId, patch);
  } catch (error) {
    logSandboxActivityError('metadata update', sessionId, error);
  }
}

export async function markSandboxDirty(sessionId: string, reason: string): Promise<void> {
  if (!sessionId) return;
  const now = new Date().toISOString();
  try {
    if (dirtySessions.has(sessionId)) {
      await updateMetadata(sessionId, {
        lastActiveAt: now,
        lastActiveReason: reason,
      });
      return;
    }
    if (!shouldMarkDirty(sessionId)) {
      await updateMetadata(sessionId, {
        lastActiveAt: now,
        lastActiveReason: reason,
      });
      return;
    }
    const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    if (!env) return;

    const metadata = (env.metadata || {}) as Record<string, unknown>;
    const alreadyDirty = extractPendingArchiveUpdate(metadata);
    if (alreadyDirty) {
      dirtySessions.add(sessionId);
      await updateMetadata(sessionId, {
        lastActiveAt: now,
        lastActiveReason: reason,
      });
      return;
    }

    const currentStatus = asText((metadata as any).archiveStatus).toLowerCase();
    const pendingSince = asText((metadata as any).archivePendingSince) || now;
    const patch: Record<string, unknown> = {
      lastActiveAt: now,
      lastActiveReason: reason,
      pendingArchiveUpdate: true,
      archiveDirty: true,
      archivePendingSince: pendingSince,
      lastDirtyAt: now,
      lastDirtyReason: reason,
      lastDirtyBy: 'sandbox_activity',
    };
    if (currentStatus !== 'in_progress') {
      patch.archiveStatus = 'pending_update';
    }
    const next = mergeMetadata(metadata, patch);
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, next);
    dirtySessions.add(sessionId);
  } catch (error) {
    logSandboxActivityError('dirty mark', sessionId, error);
  }
}

export async function clearSandboxDirty(
  sessionId: string,
  patch?: Record<string, unknown>
): Promise<void> {
  if (!sessionId) return;
  dirtySessions.delete(sessionId);
  const now = new Date().toISOString();
  try {
    await updateMetadata(sessionId, {
      pendingArchiveUpdate: false,
      archiveDirty: false,
      archivePendingSince: null,
      lastDirtyFlushedAt: now,
      ...(patch || {}),
    });
  } catch (error) {
    logSandboxActivityError('clear dirty', sessionId, error);
  }
}

export function extractLastActiveAt(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata && (metadata as any).lastActiveAt;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function extractTaskSessionId(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata && (metadata as any).taskSessionId;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function extractPendingArchiveUpdate(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  const candidates = [
    (metadata as any).pendingArchiveUpdate,
    (metadata as any).archiveDirty,
  ];
  return candidates.some((value) => value === true || String(value).trim().toLowerCase() === 'true');
}

export function extractInactivityTimeoutMs(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata) return null;
  const e2b = asObject((metadata as any).e2b);
  return (
    toPositiveMs(e2b.timeoutMs) ||
    toPositiveMs((metadata as any).timeoutMs) ||
    toPositiveMs((metadata as any).sandboxTimeoutMs)
  );
}
