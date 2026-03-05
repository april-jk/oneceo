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

async function execAndWait(sessionId: string, command: string, timeoutSeconds = 30): Promise<any> {
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

function printResult(label: string, payload: AnyMap) {
  const result = payload?.data?.result || payload?.data || {};
  console.log(`[${label}]`, JSON.stringify(result, null, 2));
}

async function main() {
  const sessionId = String(process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();
  if (!sessionId) throw new Error('OSAC_FIXED_SANDBOX_SESSION_ID missing');

  const cmds = [
    "ls -l /opt/.altus/opencode/osac || true",
    "file /opt/.altus/opencode/osac || true",
    "sha256sum /opt/.altus/opencode/osac || true",
    "ls -l /opt/.altus/opencode | grep -E 'fix11' || true",
    "sha256sum /opt/.altus/opencode/osac-linux-amd64_v1.1.2.fix11 || true",
  ];

  for (const cmd of cmds) {
    const res = await execAndWait(sessionId, cmd, 20);
    printResult(cmd, res);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
