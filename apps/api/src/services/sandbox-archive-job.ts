import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { archiveSandboxWorkspace } from './sandbox-archive-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { extractLastActiveAt, setSandboxMetadata } from './sandbox-activity-service';

let jobTimer: NodeJS.Timeout | null = null;
let jobRunning = false;
let lastDbFailureAt = 0;

const DB_FAILURE_BACKOFF_MS = 60_000;

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isEnabled(): boolean {
  const raw = String(process.env.E2B_ARCHIVE_JOB_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function getIdleMinutes(): number {
  return toPositiveInt(process.env.E2B_ARCHIVE_IDLE_MINUTES, 40);
}

function getIntervalMs(): number {
  return Math.max(60_000, toPositiveInt(process.env.E2B_ARCHIVE_JOB_INTERVAL_MS, 600_000));
}

function getScanLimit(): number {
  return Math.max(50, toPositiveInt(process.env.E2B_ARCHIVE_SCAN_LIMIT, 500));
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function isSandboxNotFound(error: unknown): boolean {
  if (!error) return false;
  const texts: string[] = [];
  const pushText = (value: unknown) => {
    if (!value) return;
    const text = String(value);
    if (text) texts.push(text);
  };
  if (error instanceof Error) {
    pushText(error.message);
    pushText(error.name);
    pushText((error as any).cause);
  }
  pushText(error);
  const serialized = (() => {
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  })();
  pushText(serialized);
  const normalized = texts.join(' | ').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('sandbox was not found') || normalized.includes('sandbox not found')) {
    return true;
  }
  if (normalized.includes('paused sandbox') && normalized.includes('not found')) {
    return true;
  }
  if (normalized.includes('the sandbox was not found')) {
    return true;
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return true;
  }
  return false;
}

function isDbConnectionError(error: unknown): boolean {
  if (!error) return false;
  const texts: string[] = [];
  const pushText = (value: unknown) => {
    if (!value) return;
    const text = String(value);
    if (text) texts.push(text);
  };
  if (error instanceof Error) {
    pushText(error.name);
    pushText(error.message);
    pushText((error as any).cause);
  }
  pushText(error);
  const normalized = texts.join(' | ').toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('connection terminated') ||
    normalized.includes('connection timeout') ||
    normalized.includes('timeout') ||
    normalized.includes('econnreset') ||
    normalized.includes('terminating connection')
  );
}

async function runOnce(): Promise<void> {
  if (jobRunning) return;
  jobRunning = true;

  try {
    if (Date.now() - lastDbFailureAt < DB_FAILURE_BACKOFF_MS) {
      return;
    }
    const idleMinutes = getIdleMinutes();
    const idleMs = idleMinutes * 60 * 1000;
    const limit = getScanLimit();
    let environments = [];
    try {
      environments = await sandboxExecutionEnvironmentDAO.listByStatus('ready', limit);
    } catch (error) {
      if (isDbConnectionError(error)) {
        lastDbFailureAt = Date.now();
      }
      console.warn('[SANDBOX_ARCHIVE_JOB] listByStatus failed', error);
      return;
    }

    for (const env of environments) {
      const metadata = (env.metadata || {}) as Record<string, unknown>;
      if (String(metadata.sandboxProvider || '').toLowerCase() !== 'e2b') {
        continue;
      }
      const archiveStatus = String((metadata as any).archiveStatus || '').toLowerCase();
      if (archiveStatus === 'in_progress') {
        continue;
      }
      const lastActiveAt = extractLastActiveAt(metadata) || env.updatedAt?.toISOString() || env.createdAt?.toISOString();
      const lastActiveTs = parseTimestamp(lastActiveAt);
      if (!lastActiveTs) {
        continue;
      }
      const lastArchivedAtRaw = typeof (metadata as any).lastArchivedAt === 'string' ? (metadata as any).lastArchivedAt : null;
      const lastArchivedTs = parseTimestamp(lastArchivedAtRaw || undefined);
      if (lastArchivedTs && lastArchivedTs >= lastActiveTs) {
        continue;
      }

      if (Date.now() - lastActiveTs < idleMs) {
        continue;
      }

      try {
        try {
          await setSandboxMetadata(env.sessionId, {
            archiveStatus: 'in_progress',
            archiveReason: 'idle_timeout',
          });
        } catch (error) {
          if (isDbConnectionError(error)) {
            lastDbFailureAt = Date.now();
            console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed (db)', env.sessionId, error);
            return;
          }
          console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed', env.sessionId, error);
        }

        await archiveSandboxWorkspace(env.sessionId, 'idle_timeout');

        await e2bConnector.pauseSandbox(env.sessionId);

        try {
          await setSandboxMetadata(env.sessionId, {
            archiveStatus: 'archived',
            pauseReason: 'idle_timeout',
            pausedAt: new Date().toISOString(),
          });
        } catch (error) {
          if (isDbConnectionError(error)) {
            lastDbFailureAt = Date.now();
            console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed (db)', env.sessionId, error);
            return;
          }
          console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed', env.sessionId, error);
        }
      } catch (error) {
        if (isDbConnectionError(error)) {
          lastDbFailureAt = Date.now();
          console.warn('[SANDBOX_ARCHIVE_JOB] db error', env.sessionId, error);
          return;
        }
        const notFound = isSandboxNotFound(error);
        if (notFound) {
          console.info('[SANDBOX_ARCHIVE_JOB] sandbox not found, mark closed', env.sessionId);
          try {
            await sandboxExecutionEnvironmentDAO.updateStatus(env.sessionId, 'closed', env.vmName ?? null);
          } catch (metaError) {
            if (isDbConnectionError(metaError)) {
              lastDbFailureAt = Date.now();
              console.warn('[SANDBOX_ARCHIVE_JOB] updateStatus failed (db)', env.sessionId, metaError);
              return;
            }
            console.warn('[SANDBOX_ARCHIVE_JOB] updateStatus failed', env.sessionId, metaError);
          }
          try {
            await setSandboxMetadata(env.sessionId, {
              archiveStatus: 'missing',
              archiveError: 'sandbox_not_found',
            });
          } catch (metaError) {
            if (isDbConnectionError(metaError)) {
              lastDbFailureAt = Date.now();
              console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed (db)', env.sessionId, metaError);
              return;
            }
            console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed', env.sessionId, metaError);
          }
          continue;
        }
        console.warn('[SANDBOX_ARCHIVE_JOB] archive failed', env.sessionId, error);
        try {
          await setSandboxMetadata(env.sessionId, {
            archiveStatus: 'failed',
            archiveError: error instanceof Error ? error.message : String(error),
          });
        } catch (metaError) {
          if (isDbConnectionError(metaError)) {
            lastDbFailureAt = Date.now();
            console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed (db)', env.sessionId, metaError);
            return;
          }
          console.warn('[SANDBOX_ARCHIVE_JOB] set metadata failed', env.sessionId, metaError);
        }
      }
    }
  } finally {
    jobRunning = false;
  }
}

export function startSandboxArchiveJob(): void {
  if (!isEnabled()) return;
  if (jobTimer) return;
  const intervalMs = getIntervalMs();
  jobTimer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  if (typeof (jobTimer as any).unref === 'function') {
    (jobTimer as any).unref();
  }
  void runOnce();
}

export function stopSandboxArchiveJob(): void {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
  }
}
