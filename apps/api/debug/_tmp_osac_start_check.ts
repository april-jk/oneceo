import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const { kvmConnector } = await import('../src/connectors/kvm-connector');

const sessionId = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';
const token = process.env.OSAC_AUTH_TOKEN || 'manual_fix_session_35ff';
const osacPort = Number(process.env.OSAC_PORT || 18080);
const remoteDir = '/opt/.altus/opencode';
const osacPath = `${remoteDir}/osac`;
const opencodePath = `${remoteDir}/opencode`;

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

const cmd = `set +e
mkdir -p '${remoteDir}' '${remoteDir}/log' '${remoteDir}/tmp'
pkill -f '${osacPath}' >/dev/null 2>&1 || true
nohup env ${envParts.join(' ')} ${osacPath} >> '${remoteDir}/log/osac.log' 2>&1 < /dev/null &
sleep 1
echo '==ps=='
pgrep -a osac || true
echo '==ss=='
ss -ltnp | grep ${osacPort} || true
echo '==tail=='
tail -n 6 '${remoteDir}/log/osac.log' || true
`;

(async () => {
  const start = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', cmd],
    capture_output: true,
    timeout_seconds: 25,
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
})();
