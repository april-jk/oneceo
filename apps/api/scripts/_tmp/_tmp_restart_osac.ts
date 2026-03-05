import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

const { kvmConnector } = await import('../src/connectors/kvm-connector');

const sessionId = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';
const token = process.env.OSAC_AUTH_TOKEN || 'manual_fix_session_35ff';
const osacPort = Number(process.env.OSAC_PORT || 18080);
const remoteDir = '/opt/.altus/opencode';
const osacPath = `${remoteDir}/osac`;
const opencodePath = `${remoteDir}/opencode`;
const localOsac = path.resolve(process.cwd(), process.env.OSAC_BINARY_PATH || '../../others/osac-linux/osac-linux-amd64_v1.1.2.fix17');
const localOpencode = path.resolve(process.cwd(), process.env.OPENCODE_BINARY_PATH || '../../others/opencode/opencode');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(jobId: string) {
  for (let i = 0; i < 30; i += 1) {
    const job = await kvmConnector.getJob(jobId);
    const jobData: any = job.data || {};
    if (jobData.status && jobData.status !== 'running') {
      return jobData;
    }
    await sleep(1000);
  }
  return null;
}

(async () => {
  if (!fs.existsSync(localOsac)) {
    throw new Error(`missing local osac: ${localOsac}`);
  }
  if (!fs.existsSync(localOpencode)) {
    throw new Error(`missing local opencode: ${localOpencode}`);
  }

  const osacUpload = await kvmConnector.uploadSessionFile(sessionId, {
    filename: 'osac',
    buffer: fs.readFileSync(localOsac),
    targetPath: `${remoteDir}/`,
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  if (osacUpload?.data?.jobId) {
    await waitJob(osacUpload.data.jobId);
  }

  const opencodeUpload = await kvmConnector.uploadSessionFile(sessionId, {
    filename: 'opencode',
    buffer: fs.readFileSync(localOpencode),
    targetPath: `${remoteDir}/`,
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  if (opencodeUpload?.data?.jobId) {
    await waitJob(opencodeUpload.data.jobId);
  }

  const envParts = [
    `OSAC_AUTH_TOKEN='${token}'`,
    `OSAC_LISTEN_ADDR=':${osacPort}'`,
    `OSAC_OPENCODE_PATH='${opencodePath}'`,
    `OSAC_LOG_DIR='${remoteDir}/log'`,
    `OSAC_UPDATE_TMP='${remoteDir}/tmp'`,
    `OPENCODE_BIN='${opencodePath}'`,
    `OPENCODE_PATH='${opencodePath}'`,
    `OSAC_LLM_PROXY_ENABLE='false'`,
  ];
  const cmd = `
set -e
mkdir -p '${remoteDir}' '${remoteDir}/log' '${remoteDir}/tmp'
if pgrep -f '${osacPath}' >/dev/null 2>&1; then pkill -f '${osacPath}' || true; fi
nohup env ${envParts.join(' ')} ${osacPath} >> '${remoteDir}/log/osac.log' 2>&1 < /dev/null &
`;

  const start = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', cmd],
    capture_output: true,
    timeout_seconds: 30,
  });
  if (start?.data?.jobId) {
    await waitJob(start.data.jobId);
  }

  await sleep(2000);

  const probe = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', `pgrep -a osac || true; ss -ltnp | grep ${osacPort} || true; tail -n 5 ${remoteDir}/log/osac.log || true`],
    capture_output: true,
    timeout_seconds: 20,
  });
  const jobData = probe?.data?.jobId ? await waitJob(probe.data.jobId) : probe.data;
  console.log(JSON.stringify(jobData || probe, null, 2));
})();
