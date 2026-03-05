import 'dotenv/config';
import { kvmConnector } from '../src/connectors/kvm-connector';

async function main() {
  const sessionId = String(process.env.OSAC_FIXED_SANDBOX_SESSION_ID || '').trim();
  if (!sessionId) {
    throw new Error('OSAC_FIXED_SANDBOX_SESSION_ID missing');
  }
  const state = await kvmConnector.getRelayTcpState(sessionId);
  console.log(JSON.stringify(state, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
