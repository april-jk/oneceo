import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sessionId = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sessionId) {
  throw new Error('missing session id');
}

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  console.log('[probe] session', sessionId);
  const ip = await kvmConnector.getSandboxIp(sessionId).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log('[probe] sandbox ip', JSON.stringify(ip, null, 2));

  const vm = await kvmConnector.getSessionVm(sessionId).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log('[probe] session vm', JSON.stringify(vm, null, 2));

  const relayState = await kvmConnector.getRelayTcpState(sessionId).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log('[probe] relay state', JSON.stringify(relayState, null, 2));

  const relayTicket = await kvmConnector.createRelayTcpTicket(sessionId, {
    target_port: Number(process.env.OSAC_PORT || 18080),
    target_host: 'vm',
    connect_timeout_ms: 5000,
    idle_timeout_ms: 60000,
    ticket_ttl_ms: 30000,
    single_use: true,
  }).catch((error: any) => ({ error: String(error?.message || error) }));
  console.log('[probe] relay ticket', JSON.stringify(relayTicket, null, 2));
})();
