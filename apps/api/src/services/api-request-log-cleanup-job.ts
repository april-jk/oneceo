import { apiRequestLogDAO } from '../db/dao/api-request-log.dao';

let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupRunning = false;

function isEnabled(): boolean {
  const raw = String(process.env.ONECEO_API_REQUEST_LOG_CLEANUP_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function getIntervalMs(): number {
  const raw = Number(process.env.ONECEO_API_REQUEST_LOG_CLEANUP_INTERVAL_MS || 3600_000);
  return Number.isFinite(raw) && raw > 0 ? Math.max(60_000, raw) : 3600_000;
}

function getRetentionDays(): number {
  const raw = Number(process.env.ONECEO_API_REQUEST_LOG_RETENTION_DAYS || 30);
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, raw) : 30;
}

async function runOnce(): Promise<void> {
  if (cleanupRunning) return;
  cleanupRunning = true;

  try {
    const retentionDays = getRetentionDays();
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    console.log('[API_REQUEST_LOG_CLEANUP] Starting cleanup, retention days:', retentionDays, 'cutoff:', cutoffDate.toISOString());

    await apiRequestLogDAO.deleteOlderThan(cutoffDate);

    console.log('[API_REQUEST_LOG_CLEANUP] Cleanup completed');
  } catch (error) {
    console.error('[API_REQUEST_LOG_CLEANUP] Cleanup failed:', error instanceof Error ? error.message : String(error));
  } finally {
    cleanupRunning = false;
  }
}

export function startApiRequestLogCleanupJob(): void {
  if (!isEnabled()) {
    console.log('[API_REQUEST_LOG_CLEANUP] Cleanup job disabled');
    return;
  }
  if (cleanupTimer) return;

  const intervalMs = getIntervalMs();
  cleanupTimer = setInterval(() => {
    void runOnce();
  }, intervalMs);

  if (typeof (cleanupTimer as any).unref === 'function') {
    (cleanupTimer as any).unref();
  }

  console.log('[API_REQUEST_LOG_CLEANUP] Cleanup job started, interval:', intervalMs, 'ms');
  void runOnce();
}

export function stopApiRequestLogCleanupJob(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[API_REQUEST_LOG_CLEANUP] Cleanup job stopped');
  }
}
