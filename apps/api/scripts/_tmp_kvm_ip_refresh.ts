import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) {
  throw new Error('missing session id');
}

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  console.log('[probe] session', sessionId);
  const ip = await kvmConnector.getSandboxIp(sessionId, { refresh: '1' }).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log('[probe] sandbox ip refresh=1', JSON.stringify(ip, null, 2));
})();
