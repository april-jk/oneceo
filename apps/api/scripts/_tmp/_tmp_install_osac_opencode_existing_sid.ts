import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

const sid = (process.argv[2] || '').trim();
const osacBinaryArg = (process.argv[3] || '').trim();
const opencodeBinaryArg = (process.argv[4] || '').trim();
const tokenArg = (process.argv[5] || '').trim();

if (!sid) {
  throw new Error(
    'Usage: pnpm exec tsx scripts/_tmp_install_osac_opencode_existing_sid.ts <sessionId> [osacBinaryPath] [opencodeBinaryPath] [osacToken]'
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveBinaryPath(inputPath: string, fallbackRelativePath: string): string {
  const candidate = inputPath || fallbackRelativePath;
  const resolved = path.isAbsolute(candidate)
    ? candidate
    : path.resolve(process.cwd(), candidate);
  if (!fs.existsSync(resolved)) {
    throw new Error(`binary not found: ${resolved}`);
  }
  return resolved;
}

function getJobId(payload: any): string | null {
  return (
    payload?.data?.jobId ||
    payload?.data?.job_id ||
    payload?.jobId ||
    payload?.job_id ||
    null
  );
}

async function waitJob(kvmConnector: any, payload: any, timeoutSec = 240): Promise<any> {
  const jobId = getJobId(payload);
  if (!jobId) return payload;
  for (let i = 0; i < timeoutSec; i++) {
    const job: any = await kvmConnector.getJob(String(jobId));
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`wait job timeout: ${jobId}`);
}

function extractStdout(payload: any): string {
  const data = payload?.data?.result || payload?.data || payload || {};
  return String(data.stdout || data.output || '');
}

async function main() {
  const osacBinaryPath = resolveBinaryPath(
    osacBinaryArg,
    '../../others/osac-linux/osac-linux-amd64_v1.1.2.fix10p5_debug'
  );
  const opencodeBinaryPath = resolveBinaryPath(
    opencodeBinaryArg,
    '../../others/opencode/opencode'
  );

  const osacFilename = path.basename(osacBinaryPath);
  const opencodeFilename = path.basename(opencodeBinaryPath);
  const token = tokenArg || `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const moveOpencodeCommand =
    opencodeFilename === 'opencode'
      ? 'true'
      : `mv -f /opt/.altus/opencode/${shellQuote(opencodeFilename)} /opt/.altus/opencode/opencode`;
  const moveOsacCommand =
    osacFilename === 'osac'
      ? 'true'
      : `mv -f /opt/.altus/opencode/${shellQuote(osacFilename)} /opt/.altus/opencode/osac`;

  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { ensureDatabaseConnection } = await import('../src/config/database');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');

  await ensureDatabaseConnection({ retries: 1, delayMs: 100 });

  const vmInfo: any = await kvmConnector.getSessionVm(sid);
  const vmName = String(vmInfo?.data?.vm?.name || vmInfo?.data?.vmName || '');
  if (!vmName) {
    throw new Error(`vm name not found for session ${sid}`);
  }

  const existing = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const nextMetadata: Record<string, unknown> = {
    ...(existing?.metadata || {}),
    owner: 'codex-manual',
    purpose: 'manual-osac-opencode-install',
    osacConnectionMode: 'kvm-tcp-relay',
    osacEndpoint: 'ws://127.0.0.1:18080/ws',
    osacAuthToken: token,
    osacToken: token,
    osacPort: 18080,
    osacHostPort: null,
  };

  if (!existing) {
    await sandboxExecutionEnvironmentDAO.createEnvironment({
      sessionId: sid,
      orchestratorSessionId: sid,
      vmName,
      baseImage: process.env.KVM_SANDBOX_BASE_IMAGE || 'unknown',
      incrementalStorageDir: '/var/lib/libvirt/images/sandboxes',
      incrementalFileName: `${vmName}.qcow2`,
      incrementalFilePath: `/var/lib/libvirt/images/sandboxes/${sid}/${vmName}.qcow2`,
      status: 'ready',
      securityProfile: {},
      networkPolicy: {},
      metadata: nextMetadata,
    } as any);
  } else {
    await sandboxExecutionEnvironmentDAO.updateMetadata(sid, nextMetadata);
  }

  const osacBuf = fs.readFileSync(osacBinaryPath);
  const opencodeBuf = fs.readFileSync(opencodeBinaryPath);

  const uploadOpencode = await kvmConnector.uploadSessionFile(sid, {
    filename: opencodeFilename,
    buffer: opencodeBuf,
    targetPath: '/opt/.altus/opencode/',
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  await waitJob(kvmConnector, uploadOpencode, 300);

  const uploadOsac = await kvmConnector.uploadSessionFile(sid, {
    filename: osacFilename,
    buffer: osacBuf,
    targetPath: '/opt/.altus/opencode/',
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  await waitJob(kvmConnector, uploadOsac, 300);

  const startCommand = [
    'set -e',
    'mkdir -p /opt/.altus/opencode/log /opt/.altus/opencode/tmp',
    moveOpencodeCommand,
    moveOsacCommand,
    'chmod +x /opt/.altus/opencode/opencode /opt/.altus/opencode/osac',
    "pkill -f '/opt/.altus/opencode/osac' || true",
    'rm -f /opt/.altus/opencode/osac.lock',
    [
      'nohup env',
      `OSAC_AUTH_TOKEN=${shellQuote(token)}`,
      "OSAC_LISTEN_ADDR=':18080'",
      "OSAC_OPENCODE_PATH='/opt/.altus/opencode/opencode'",
      "OSAC_LOG_DIR='/opt/.altus/opencode/log'",
      "OSAC_UPDATE_TMP='/opt/.altus/opencode/tmp'",
      "OPENCODE_BIN='/opt/.altus/opencode/opencode'",
      "OPENCODE_PATH='/opt/.altus/opencode/opencode'",
      "OSAC_LLM_PROXY_ENABLE='true'",
      "OSAC_LLM_PROXY_PORT='18111'",
      "OSAC_LLM_PROXY_TIMEOUT_MS='90000'",
      "/opt/.altus/opencode/osac >> /opt/.altus/opencode/log/osac.log 2>&1 < /dev/null &",
    ].join(' '),
    'sleep 1',
    "if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E ':18080|:18111' || true; else netstat -ltnp | grep -E ':18080|:18111' || true; fi",
    'tail -n 60 /opt/.altus/opencode/log/osac.log || true',
  ].join(' && ');

  const startExec = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', startCommand],
    capture_output: true,
    timeout_seconds: 120,
  });
  const startDone = await waitJob(kvmConnector, startExec, 180);

  const finalMeta = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  console.log(
    JSON.stringify(
      {
        sessionId: sid,
        vmName,
        osacBinaryPath,
        opencodeBinaryPath,
        tokenSeeded: !!finalMeta?.metadata?.osacAuthToken,
        tokenFingerprint: String(token).slice(0, 6),
        startOutput: extractStdout(startDone).slice(0, 3000),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
