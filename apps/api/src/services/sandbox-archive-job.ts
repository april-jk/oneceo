import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { archiveSandboxWorkspace } from './sandbox-archive-service';
import { e2bConnector } from '../connectors/e2b-connector';
import { extractLastActiveAt, setSandboxMetadata } from './sandbox-activity-service';

let jobTimer: NodeJS.Timeout | null = null;
let jobRunning = false;

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
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('sandbox was not found') || normalized.includes('sandbox not found');
}

async function runOnce(): Promise<void> {
  if (jobRunning) return;
  jobRunning = true;

  try {
    const idleMinutes = getIdleMinutes();
    const idleMs = idleMinutes * 60 * 1000;
    const limit = getScanLimit();
    const environments = await sandboxExecutionEnvironmentDAO.listByStatus('ready', limit);

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
        await setSandboxMetadata(env.sessionId, {
          archiveStatus: 'in_progress',
          archiveReason: 'idle_timeout',
        });

        await archiveSandboxWorkspace(env.sessionId, 'idle_timeout');

        await e2bConnector.pauseSandbox(env.sessionId);

        await setSandboxMetadata(env.sessionId, {
          archiveStatus: 'archived',
          pauseReason: 'idle_timeout',
          pausedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn('[SANDBOX_ARCHIVE_JOB] archive failed', env.sessionId, error);
        if (isSandboxNotFound(error)) {
          await sandboxExecutionEnvironmentDAO.updateStatus(env.sessionId, 'closed', env.vmName ?? null);
        }
        await setSandboxMetadata(env.sessionId, {
          archiveStatus: 'failed',
          archiveError: error instanceof Error ? error.message : String(error),
        });
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
