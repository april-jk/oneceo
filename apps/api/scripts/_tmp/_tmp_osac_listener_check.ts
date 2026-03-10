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

function pickOutput(payload: AnyMap): string {
  return (
    payload?.data?.result?.stdout ||
    payload?.data?.result?.output ||
    payload?.data?.result ||
    payload?.data?.stdout ||
    payload?.data?.output ||
    ''
  );
}

async function main() {
  const sessionId = String(process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();
  if (!sessionId) throw new Error('OSAC_FIXED_SANDBOX_SESSION_ID missing');

  const envResult = await execAndWait(sessionId, "grep -E 'OSAC_LISTEN_ADDR|OSAC_AUTH_TOKEN' /etc/environment || true");
  const envOut = String(pickOutput(envResult) || '').trim();

  const ssResult = await execAndWait(
    sessionId,
    "ss -ltnp | grep -E ':18080' || netstat -ltnp | grep -E ':18080' || true"
  );
  const ssOut = String(pickOutput(ssResult) || '').trim();

  const ipResult = await execAndWait(sessionId, "hostname -I | awk '{print $1}'");
  const ipAddr = String(pickOutput(ipResult) || '').trim();

  const curlLocal = await execAndWait(sessionId, "curl -sS -m 5 http://127.0.0.1:18080/healthz || true");
  const curlLocalOut = String(pickOutput(curlLocal) || '').trim();

  const curlIp = ipAddr
    ? await execAndWait(sessionId, `curl -sS -m 5 http://${ipAddr}:18080/healthz || true`)
    : null;
  const curlIpOut = curlIp ? String(pickOutput(curlIp) || '').trim() : '';

  const psResult = await execAndWait(sessionId, "ps -ef | grep -v grep | grep -E 'osac' || true");
  const psOut = String(pickOutput(psResult) || '').trim();

  const logResult = await execAndWait(sessionId, "tail -n 60 /opt/.altus/opencode/log/osac.log || true");
  const logOut = String(pickOutput(logResult) || '').trim();

  console.log('[env]', envOut);
  console.log('[listen]', ssOut || '(empty)');
  console.log('[ip]', ipAddr || '(empty)');
  console.log('[curl-local]', curlLocalOut || '(empty)');
  console.log('[curl-ip]', curlIpOut || '(empty)');
  console.log('[ps]', psOut || '(empty)');
  console.log('[osac-log]', logOut || '(empty)');
  console.log('[raw-ss]', JSON.stringify(ssResult, null, 2));
  console.log('[raw-ip]', JSON.stringify(ipResult, null, 2));
  console.log('[raw-curl-local]', JSON.stringify(curlLocal, null, 2));
  if (curlIp) console.log('[raw-curl-ip]', JSON.stringify(curlIp, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
