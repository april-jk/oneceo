import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) throw new Error('missing session id');

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const token = process.env.OSAC_AUTH_TOKEN || process.env.OSAC_PSK || 'manual_fix_session_35ff';
  const cmd = `cd /opt/.altus/opencode; OSAC_AUTH_TOKEN=${token} OSAC_LOG_DIR=/opt/.altus/opencode/log OSAC_LOG_TO_STDOUT=false OSAC_LISTEN_ADDR=:18080 nohup ./osac > /opt/.altus/opencode/log/osac.stdout.log 2>&1 &`;
  const res = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', cmd],
    capture_output: true,
    timeout_seconds: 5,
  }).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log(JSON.stringify(res, null, 2));
})();
