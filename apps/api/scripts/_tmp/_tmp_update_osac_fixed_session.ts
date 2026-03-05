import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { kvmConnector } from '../src/connectors/kvm-connector';

type AnyMap = Record<string, any>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing env: ${name}`);
  }
  return value.trim();
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getJobId(payload: AnyMap): string | null {
  return firstNonEmpty(payload?.data?.jobId, payload?.data?.job_id, payload?.jobId, payload?.job_id);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(jobId: string, timeoutMs = 240000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job: AnyMap = await kvmConnector.getJob(jobId);
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`wait job timeout: ${jobId}`);
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

async function uploadAndWait(sessionId: string, localFile: string, remoteFile: string): Promise<any> {
  const submit: AnyMap = await kvmConnector.uploadSessionFile(sessionId, {
    filename: path.basename(localFile),
    buffer: fs.readFileSync(localFile),
    targetPath: remoteFile,
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  const jobId = getJobId(submit);
  if (!jobId) return submit;
  return waitJob(jobId, 300000);
}

async function waitOsacHealth(sessionId: string, attempts = 30): Promise<void> {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    const done = await execAndWait(
      sessionId,
      "curl -sS -m 5 http://127.0.0.1:18080/healthz || curl -sS -m 5 http://127.0.0.1:18080/status",
      15
    );
    const exitcode = Number(done?.data?.result?.exitcode ?? done?.data?.result?.exitCode ?? -1);
    const stdout = String(done?.data?.result?.stdout || done?.data?.result?.output || '').trim();
    const stderr = String(done?.data?.result?.stderr || '').trim();
    last = stdout || stderr;
    if (exitcode === 0 && stdout) return;
    await sleep(1500);
  }
  throw new Error(`osac health check failed: ${last}`);
}

async function main() {
  const sessionId = requireEnv('OSAC_FIXED_SANDBOX_SESSION_ID');
  const localOsacPath = path.resolve(
    process.cwd(),
    requireEnv('OSAC_BINARY_PATH')
  );

  const remoteDir = '/opt/.altus/opencode';
  const remoteOsac = `${remoteDir}/osac`;
  const remoteUpload = `${remoteDir}/${path.basename(localOsacPath)}`;

  console.log('[osac-update] upload', localOsacPath, '->', remoteOsac);
  const uploadResult = await uploadAndWait(sessionId, localOsacPath, remoteUpload);
  console.log('[osac-update] upload-result', JSON.stringify(uploadResult, null, 2));
  const uploadStatus = String(uploadResult?.data?.status || '').toLowerCase();
  if (uploadStatus && uploadStatus !== 'completed' && uploadStatus !== 'success') {
    throw new Error(`upload failed: status=${uploadStatus}`);
  }

  const restartCommand = [
    "set -e",
    "if pgrep -f '[o]pt/.altus/opencode/osac' >/dev/null 2>&1; then pkill -f '[o]pt/.altus/opencode/osac'; sleep 1; fi",
    `mv -f '${remoteUpload}' '${remoteOsac}'`,
    "chmod +x /opt/.altus/opencode/osac",
    "mkdir -p /opt/.altus/opencode/log /opt/.altus/opencode/tmp",
    "set -a",
    ". /etc/environment",
    "set +a",
    "nohup env OSAC_OPENCODE_PATH='/opt/.altus/opencode/opencode' OPENCODE_BIN='/opt/.altus/opencode/opencode' OPENCODE_PATH='/opt/.altus/opencode/opencode' /opt/.altus/opencode/osac >> /opt/.altus/opencode/log/osac.log 2>&1 < /dev/null &",
  ].join("; ");

  console.log('[osac-update] restart osac');
  await execAndWait(sessionId, restartCommand, 60);

  console.log('[osac-update] wait health');
  await waitOsacHealth(sessionId, 30);

  console.log('[osac-update] done');
}

main().catch((error) => {
  console.error('[osac-update] failed', error);
  process.exit(1);
});
