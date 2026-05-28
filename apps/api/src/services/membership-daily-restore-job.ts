import { membershipService } from './membership-service';

let jobTimer: NodeJS.Timeout | null = null;
let jobRunning = false;

function isEnabled() {
  const raw = String(process.env.MEMBERSHIP_DAILY_RESTORE_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function getIntervalMs() {
  return 24 * 60 * 60 * 1000;
}

function nowDateKey() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

let lastRunDate = '';

async function runOnce() {
  if (jobRunning) return;
  jobRunning = true;
  try {
    const today = nowDateKey();
    if (lastRunDate === today) return;
    const result = await membershipService.runDailyAutoRestore(new Date());
    lastRunDate = result.restoreDate;
    console.info('[MEMBERSHIP_DAILY_RESTORE] done', JSON.stringify(result));
  } catch (error) {
    console.error('[MEMBERSHIP_DAILY_RESTORE] failed', error);
  } finally {
    jobRunning = false;
  }
}

export function startMembershipDailyRestoreJob() {
  if (!isEnabled()) {
    console.info('[MEMBERSHIP_DAILY_RESTORE] disabled by env');
    return;
  }
  if (jobTimer) return;
  void runOnce();
  jobTimer = setInterval(() => {
    void runOnce();
  }, getIntervalMs());
  if (typeof (jobTimer as any).unref === 'function') {
    (jobTimer as any).unref();
  }
  console.info('[MEMBERSHIP_DAILY_RESTORE] started');
}

export function stopMembershipDailyRestoreJob() {
  if (!jobTimer) return;
  clearInterval(jobTimer);
  jobTimer = null;
  console.info('[MEMBERSHIP_DAILY_RESTORE] stopped');
}
