import 'dotenv/config';
import { kvmConnector } from '../src/connectors/kvm-connector';

type AnyMap = Record<string, any>;

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getJobId(payload: AnyMap): string | null {
  return firstNonEmpty(payload?.data?.jobId, payload?.data?.job_id, payload?.jobId, payload?.job_id);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(jobId: string, timeoutMs = 120000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job: AnyMap = await kvmConnector.getJob(jobId);
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') return job;
    await sleep(1000);
  }
  throw new Error(`job timeout: ${jobId}`);
}

async function execAndWait(sessionId: string, command: string, timeoutSeconds = 60): Promise<any> {
  const submit: AnyMap = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId = getJobId(submit);
  if (!jobId) return submit;
  return waitJob(jobId, Math.max(60000, timeoutSeconds * 2000));
}

async function main() {
  const sessionId = String(process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();
  if (!sessionId) throw new Error('OSAC_FIXED_SANDBOX_SESSION_ID missing');

  const cmd = [
    "set -x",
    "ls -l /opt/.altus/opencode/osac-linux-amd64_v1.1.2.fix11 || true",
    "mv -f /opt/.altus/opencode/osac-linux-amd64_v1.1.2.fix11 /opt/.altus/opencode/osac",
    "chmod +x /opt/.altus/opencode/osac",
    "pgrep -x osac >/dev/null 2>&1 && pkill -x osac || true",
    "mkdir -p /opt/.altus/opencode/log /opt/.altus/opencode/tmp",
    "set -a",
    ". /etc/environment",
    "set +a",
    "nohup env OSAC_OPENCODE_PATH='/opt/.altus/opencode/opencode' OPENCODE_BIN='/opt/.altus/opencode/opencode' OPENCODE_PATH='/opt/.altus/opencode/opencode' /opt/.altus/opencode/osac >> /opt/.altus/opencode/log/osac.log 2>&1 < /dev/null &",
    "sleep 1",
    "ps -ef | grep -v grep | grep -E 'osac' || true",
    "curl -sS -m 5 http://127.0.0.1:18080/healthz || true",
  ].join("\n");

  const res = await execAndWait(sessionId, cmd, 90);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
