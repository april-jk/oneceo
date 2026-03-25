import { e2bConfig } from '../config/e2b-config';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { e2bConnector } from '../connectors/e2b-connector';
import { archiveSandboxWorkspace, isArchiveStorageConfigured } from './sandbox-archive-service';
import {
  extractInactivityTimeoutMs,
  extractLastActiveAt,
  extractPendingArchiveUpdate,
  setSandboxMetadata,
} from './sandbox-activity-service';

let jobTimer: NodeJS.Timeout | null = null;
let jobRunning = false;
let lastDbFailureAt = 0;

const DB_FAILURE_BACKOFF_MS = 60_000;
// E2B official docs mention the auto-pause timeout default is 10 minutes when autoPause is enabled.
const E2B_DOC_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type SandboxArchiveJobDeps = {
  sandboxExecutionEnvironmentDAO: typeof sandboxExecutionEnvironmentDAO;
  archiveSandboxWorkspace: typeof archiveSandboxWorkspace;
  isArchiveStorageConfigured: typeof isArchiveStorageConfigured;
  e2bConnector: typeof e2bConnector;
  setSandboxMetadata: typeof setSandboxMetadata;
};

const defaultSandboxArchiveJobDeps: SandboxArchiveJobDeps = {
  sandboxExecutionEnvironmentDAO,
  archiveSandboxWorkspace,
  isArchiveStorageConfigured,
  e2bConnector,
  setSandboxMetadata,
};

let sandboxArchiveJobDeps: SandboxArchiveJobDeps = { ...defaultSandboxArchiveJobDeps };

export function __setSandboxArchiveJobDepsForTest(overrides: Partial<SandboxArchiveJobDeps>): void {
  sandboxArchiveJobDeps = {
    ...sandboxArchiveJobDeps,
    ...overrides,
  };
}

export function __resetSandboxArchiveJobDepsForTest(): void {
  sandboxArchiveJobDeps = { ...defaultSandboxArchiveJobDeps };
}

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

function getIntervalMs(): number {
  return Math.max(60_000, toPositiveInt(process.env.E2B_ARCHIVE_JOB_INTERVAL_MS, 600_000));
}

function getScanLimit(): number {
  return Math.max(50, toPositiveInt(process.env.E2B_ARCHIVE_SCAN_LIMIT, 500));
}

function getPreTimeoutBufferMs(): number {
  return Math.max(20_000, toPositiveInt(process.env.E2B_ARCHIVE_PRE_TIMEOUT_BUFFER_MS, 120_000));
}

function getPendingNoticeIntervalMs(): number {
  return Math.max(60_000, toPositiveInt(process.env.E2B_ARCHIVE_PENDING_NOTICE_MS, 300_000));
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function isMissingArchiveContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('无法确定归档目录：缺少 taskSessionId 与 workspaceRoot');
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

function resolveInactivityTimeoutMs(metadata: Record<string, unknown>): number {
  const fromMetadata = extractInactivityTimeoutMs(metadata);
  if (fromMetadata && fromMetadata > 0) {
    return fromMetadata;
  }
  const fromEnv = toPositiveInt(process.env.E2B_TIMEOUT_MS, e2bConfig.timeoutMs || E2B_DOC_DEFAULT_TIMEOUT_MS);
  if (fromEnv > 0) {
    return fromEnv;
  }
  return E2B_DOC_DEFAULT_TIMEOUT_MS;
}

function resolveArchiveTriggerAt(
  lastActiveTs: number,
  inactivityTimeoutMs: number,
  preTimeoutBufferMs: number
): number {
  const timeoutMs = Math.max(60_000, inactivityTimeoutMs);
  const bufferCap = Math.max(10_000, Math.floor(timeoutMs / 2));
  const bufferMs = Math.min(Math.max(10_000, preTimeoutBufferMs), bufferCap);
  return lastActiveTs + timeoutMs - bufferMs;
}

function shouldRefreshPendingNotice(
  now: number,
  metadata: Record<string, unknown>,
  pendingNoticeIntervalMs: number
): boolean {
  const lastNoticeAt = parseTimestamp(asText((metadata as any).archivePendingNoticeAt));
  if (!lastNoticeAt) return true;
  return now - lastNoticeAt >= pendingNoticeIntervalMs;
}

async function markMissingAndClose(sessionId: string, vmName: string | null) {
  console.info('[SANDBOX_ARCHIVE_JOB] sandbox not found, mark closed', sessionId);
  await sandboxArchiveJobDeps.sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'closed', vmName);
  await sandboxArchiveJobDeps.setSandboxMetadata(sessionId, {
    archiveStatus: 'missing',
    archiveError: 'sandbox_not_found',
  });
}

async function runOnce(): Promise<void> {
  if (jobRunning) return;
  jobRunning = true;

  try {
    if (!sandboxArchiveJobDeps.isArchiveStorageConfigured()) {
      return;
    }
    if (Date.now() - lastDbFailureAt < DB_FAILURE_BACKOFF_MS) {
      return;
    }

    const limit = getScanLimit();
    const preTimeoutBufferMs = getPreTimeoutBufferMs();
    const pendingNoticeIntervalMs = getPendingNoticeIntervalMs();

    let environments = [];
    try {
      environments = await sandboxArchiveJobDeps.sandboxExecutionEnvironmentDAO.listByStatus('ready', limit);
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
      if (archiveStatus === 'in_progress' || archiveStatus === 'skipped_missing_context') {
        continue;
      }

      const now = Date.now();
      const lastActiveAt = extractLastActiveAt(metadata) || env.updatedAt?.toISOString() || env.createdAt?.toISOString();
      const lastActiveTs = parseTimestamp(lastActiveAt);
      if (!lastActiveTs) {
        continue;
      }

      const inactivityTimeoutMs = resolveInactivityTimeoutMs(metadata);
      const timeoutAtTs = lastActiveTs + inactivityTimeoutMs;
      const archiveTriggerAtTs = resolveArchiveTriggerAt(lastActiveTs, inactivityTimeoutMs, preTimeoutBufferMs);
      const pendingArchiveUpdate = extractPendingArchiveUpdate(metadata);
      const lastArchivedTs = parseTimestamp(asText((metadata as any).lastArchivedAt));
      const hasArchivedBefore = Boolean(lastArchivedTs || asText((metadata as any).r2ArchiveKey));

      if (now < archiveTriggerAtTs) {
        if (pendingArchiveUpdate && shouldRefreshPendingNotice(now, metadata, pendingNoticeIntervalMs)) {
          try {
            await sandboxArchiveJobDeps.setSandboxMetadata(env.sessionId, {
              archiveStatus: 'pending_update',
              archiveReason: 'waiting_timeout',
              pendingArchiveUpdate: true,
              archivePendingNoticeAt: new Date(now).toISOString(),
              archiveTimeoutAt: new Date(timeoutAtTs).toISOString(),
              archiveSyncEligibleAt: new Date(archiveTriggerAtTs).toISOString(),
            });
          } catch (error) {
            if (isDbConnectionError(error)) {
              lastDbFailureAt = Date.now();
              console.warn('[SANDBOX_ARCHIVE_JOB] pending notice update failed (db)', env.sessionId, error);
              return;
            }
            console.warn('[SANDBOX_ARCHIVE_JOB] pending notice update failed', env.sessionId, error);
          }
        }
        continue;
      }

      let archivedThisRound = false;
      if (pendingArchiveUpdate || !hasArchivedBefore) {
        try {
          await sandboxArchiveJobDeps.archiveSandboxWorkspace(env.sessionId, 'idle_timeout');
          archivedThisRound = true;
        } catch (error) {
          if (isDbConnectionError(error)) {
            lastDbFailureAt = Date.now();
            console.warn('[SANDBOX_ARCHIVE_JOB] db error', env.sessionId, error);
            return;
          }
          if (isMissingArchiveContextError(error)) {
            console.warn('[SANDBOX_ARCHIVE_JOB] idle archive skipped due to missing context', env.sessionId);
            try {
              await sandboxArchiveJobDeps.setSandboxMetadata(env.sessionId, {
                archiveStatus: 'skipped_missing_context',
                archiveReason: 'idle_timeout',
                archiveError: error instanceof Error ? error.message : String(error),
              });
            } catch (metaError) {
              if (isDbConnectionError(metaError)) {
                lastDbFailureAt = Date.now();
                console.warn('[SANDBOX_ARCHIVE_JOB] set skip metadata failed (db)', env.sessionId, metaError);
                return;
              }
              console.warn('[SANDBOX_ARCHIVE_JOB] set skip metadata failed', env.sessionId, metaError);
            }
            continue;
          }
          if (isSandboxNotFound(error)) {
            try {
              await markMissingAndClose(env.sessionId, env.vmName ?? null);
            } catch (metaError) {
              if (isDbConnectionError(metaError)) {
                lastDbFailureAt = Date.now();
                console.warn('[SANDBOX_ARCHIVE_JOB] mark missing failed (db)', env.sessionId, metaError);
                return;
              }
              console.warn('[SANDBOX_ARCHIVE_JOB] mark missing failed', env.sessionId, metaError);
            }
            continue;
          }
          console.warn('[SANDBOX_ARCHIVE_JOB] idle archive failed, skip pause', env.sessionId, error);
          try {
            await sandboxArchiveJobDeps.setSandboxMetadata(env.sessionId, {
              archiveStatus: 'failed',
              archiveReason: 'idle_timeout',
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
          continue;
        }
      } else {
        try {
          await sandboxArchiveJobDeps.setSandboxMetadata(env.sessionId, {
            archiveStatus: 'up_to_date',
            archiveReason: 'idle_timeout',
            archiveSkippedAt: new Date(now).toISOString(),
            archiveSkipReason: 'no_pending_update',
            archiveTimeoutAt: new Date(timeoutAtTs).toISOString(),
          });
        } catch (error) {
          if (isDbConnectionError(error)) {
            lastDbFailureAt = Date.now();
            console.warn('[SANDBOX_ARCHIVE_JOB] set skip metadata failed (db)', env.sessionId, error);
            return;
          }
          console.warn('[SANDBOX_ARCHIVE_JOB] set skip metadata failed', env.sessionId, error);
        }
      }

      try {
        await sandboxArchiveJobDeps.e2bConnector.pauseSandbox(env.sessionId);
        await sandboxArchiveJobDeps.setSandboxMetadata(env.sessionId, {
          pauseReason: 'idle_timeout',
          pausedAt: new Date().toISOString(),
          ...(archivedThisRound ? { archivePausedAfterSync: true } : {}),
        });
      } catch (error) {
        if (isDbConnectionError(error)) {
          lastDbFailureAt = Date.now();
          console.warn('[SANDBOX_ARCHIVE_JOB] db error while pause', env.sessionId, error);
          return;
        }
        if (isSandboxNotFound(error)) {
          try {
            await markMissingAndClose(env.sessionId, env.vmName ?? null);
          } catch (metaError) {
            if (isDbConnectionError(metaError)) {
              lastDbFailureAt = Date.now();
              console.warn('[SANDBOX_ARCHIVE_JOB] mark missing failed (db)', env.sessionId, metaError);
              return;
            }
            console.warn('[SANDBOX_ARCHIVE_JOB] mark missing failed', env.sessionId, metaError);
          }
          continue;
        }
        console.warn('[SANDBOX_ARCHIVE_JOB] pause failed', env.sessionId, error);
        try {
          await sandboxArchiveJobDeps.setSandboxMetadata(env.sessionId, {
            archiveStatus: 'failed',
            archiveReason: 'idle_timeout',
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

export async function runSandboxArchiveJobOnceForTest(): Promise<void> {
  await runOnce();
}

export function stopSandboxArchiveJob(): void {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
  }
}
