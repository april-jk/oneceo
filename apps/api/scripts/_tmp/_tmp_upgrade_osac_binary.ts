import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
const binaryPath = process.argv[3];
if (!sid || !binaryPath) {
  throw new Error('Usage: pnpm exec tsx scripts/_tmp_upgrade_osac_binary.ts <sessionId> <binaryPath>');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, result: any, timeoutSec = 180): Promise<any> {
  const jobId =
    result?.data?.jobId ||
    result?.data?.job_id ||
    result?.jobId ||
    result?.job_id;
  if (!jobId) return result;
  for (let i = 0; i < timeoutSec; i++) {
    const job = await kvmConnector.getJob(String(jobId));
    const status = (job as any)?.data?.status;
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`wait job timeout: ${jobId}`);
}

function extractOutput(payload: any): string {
  const p = payload?.data?.result || payload?.data || payload || {};
  return String(p.stdout || p.output || '');
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const envRow = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md = (envRow?.metadata || {}) as Record<string, unknown>;
  const token = String(md.osacAuthToken || '');
  if (!token) {
    throw new Error('missing osacAuthToken in metadata');
  }

  const resolvedPath = path.isAbsolute(binaryPath) ? binaryPath : path.resolve(process.cwd(), binaryPath);
  const filename = path.basename(resolvedPath);
  const buf = fs.readFileSync(resolvedPath);

  const upload = await kvmConnector.uploadSessionFile(sid, {
    filename,
    buffer: buf,
    targetPath: '/opt/.altus/opencode/',
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  await waitJob(kvmConnector, upload, 180);

  const restartCmd = `set -e;
mkdir -p /opt/.altus/opencode/log /opt/.altus/opencode/tmp;
pkill -f '/opt/.altus/opencode/osac' || true;
mv -f /opt/.altus/opencode/${filename} /opt/.altus/opencode/osac;
chmod +x /opt/.altus/opencode/osac;
setsid env \
OSAC_AUTH_TOKEN='${token}' \
OSAC_LISTEN_ADDR=':18080' \
OSAC_OPENCODE_PATH='/opt/.altus/opencode/opencode' \
OSAC_LOG_DIR='/opt/.altus/opencode/log' \
OSAC_UPDATE_TMP='/opt/.altus/opencode/tmp' \
OPENCODE_BIN='/opt/.altus/opencode/opencode' \
OPENCODE_PATH='/opt/.altus/opencode/opencode' \
/opt/.altus/opencode/osac >> /opt/.altus/opencode/log/osac.log 2>&1 < /dev/null &
sleep 1;
if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E ':18080|:18111' || true; else netstat -ltnp | grep -E ':18080|:18111' || true; fi;
tail -n 20 /opt/.altus/opencode/log/osac.log || true`;

  const exec = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', restartCmd],
    capture_output: true,
    timeout_seconds: 90,
  });
  const done = await waitJob(kvmConnector, exec, 120);

  console.log('restartOutput=', extractOutput(done).replace(/\s+/g, ' ').trim().slice(0, 2000));
}

main().catch((error) => {
  console.error('upgrade failed:', error);
  process.exit(1);
});
