import { sandboxExecutionEnvironmentDAO } from '../db/dao';

const lastTouch = new Map<string, number>();
const MIN_TOUCH_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.SANDBOX_ACTIVITY_MIN_INTERVAL_MS || 30000)
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

export async function touchSandbox(sessionId: string, reason: string): Promise<void> {
  if (!sessionId) return;
  if (!shouldTouch(sessionId)) return;
  const now = new Date().toISOString();
  await updateMetadata(sessionId, {
    lastActiveAt: now,
    lastActiveReason: reason,
  });
}

export async function markSandboxDirty(sessionId: string, reason: string): Promise<void> {
  if (!sessionId) return;
  const now = new Date().toISOString();
  await updateMetadata(sessionId, {
    lastActiveAt: now,
    lastActiveReason: reason,
    pendingArchiveUpdate: true,
  });
}

export async function setSandboxMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void> {
  if (!sessionId) return;
  await updateMetadata(sessionId, patch);
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
