import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const { kvmConnector } = await import('../src/connectors/kvm-connector');
const sessionId = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';
const token = process.env.OSAC_AUTH_TOKEN || 'manual_fix_session_35ff';
const osacPort = Number(process.env.OSAC_PORT || 18080);
const remoteDir = '/opt/.altus/opencode';
const osacPath = `${remoteDir}/osac`;
const opencodePath = `${remoteDir}/opencode`;

const envs = [
  `OSAC_AUTH_TOKEN=${token}`,
  `OSAC_LISTEN_ADDR=:${osacPort}`,
  `OSAC_OPENCODE_PATH=${opencodePath}`,
  `OSAC_LOG_DIR=${remoteDir}/log`,
  `OSAC_UPDATE_TMP=${remoteDir}/tmp`,
  `OPENCODE_BIN=${opencodePath}`,
  `OPENCODE_PATH=${opencodePath}`,
  `OSAC_LLM_PROXY_ENABLE=false`,
];

const envArgs = envs.map((e) => `--setenv=${e}`).join(' ');

const cmd = `set -e
mkdir -p '${remoteDir}' '${remoteDir}/log' '${remoteDir}/tmp'
# stop existing service if any
systemctl stop osac.service >/dev/null 2>&1 || true
systemctl reset-failed osac.service >/dev/null 2>&1 || true
# start transient unit
systemd-run --unit=osac --property=Restart=always --property=RestartSec=2 ${envArgs} ${osacPath}
# show status
after=0
for i in 1 2 3; do
  systemctl is-active osac.service && after=1 && break || true
  sleep 1
 done
systemctl is-active osac.service || true
ss -ltnp | grep ${osacPort} || true
`;

const start = await kvmConnector.execSession(sessionId, {
  path: '/bin/bash',
  args: ['-lc', cmd],
  capture_output: true,
  timeout_seconds: 40,
});
let data: any = start.data || {};
if (data.jobId) {
  for (let i = 0; i < 10; i += 1) {
    const job = await kvmConnector.getJob(data.jobId);
    const jobData: any = job.data || {};
    if (jobData.status && jobData.status !== 'running') {
      data = jobData;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log(JSON.stringify(data, null, 2));
