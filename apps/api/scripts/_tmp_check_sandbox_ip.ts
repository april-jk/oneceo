import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) throw new Error('missing sessionId');

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const session = await kvmConnector.getSession(sessionId).catch((err: any) => ({ error: String(err) }));
  const sandbox = await kvmConnector.getSandbox(sessionId).catch((err: any) => ({ error: String(err) }));
  const sandboxIp = await kvmConnector.getSandboxIp(sessionId).catch((err: any) => ({ error: String(err) }));
  const sessionVm = await kvmConnector.getSessionVm(sessionId).catch((err: any) => ({ error: String(err) }));
  const relayState = await kvmConnector.getRelayTcpState(sessionId).catch((err: any) => ({ error: String(err) }));

  console.log('[session]', JSON.stringify(session?.data ?? session, null, 2));
  console.log('[sandbox]', JSON.stringify(sandbox?.data ?? sandbox, null, 2));
  console.log('[sandboxIp]', JSON.stringify(sandboxIp?.data ?? sandboxIp, null, 2));
  console.log('[sessionVm]', JSON.stringify(sessionVm?.data ?? sessionVm, null, 2));
  console.log('[relayState]', JSON.stringify(relayState?.data ?? relayState, null, 2));
})();
