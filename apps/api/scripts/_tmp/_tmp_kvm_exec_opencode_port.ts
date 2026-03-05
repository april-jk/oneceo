import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) throw new Error('missing session id');

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const res = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', 'ss -lntp | grep 4096 || true'],
    capture_output: true,
    timeout_seconds: 5,
  }).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log(JSON.stringify(res, null, 2));
})();
