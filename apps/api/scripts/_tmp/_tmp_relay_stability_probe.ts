import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  console.error('usage: pnpm exec tsx scripts/_tmp_relay_stability_probe.ts <sessionId> [seconds]');
  process.exit(1);
}
const seconds = Number(process.argv[3] || '120');

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  console.log(JSON.stringify({ sid, seconds, startedAt: new Date().toISOString() }));

  let handle: any = null;
  try {
    handle = await osacConnector.connectForSession(sid);
  } catch (error) {
    console.error('CONNECT_FAIL', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  let closed = false;
  handle.onClose(() => {
    closed = true;
    console.log(JSON.stringify({ event: 'osac_close', at: new Date().toISOString() }));
  });

  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    try {
      await handle.ping(4000);
      console.log(JSON.stringify({ event: 'ping_ok', at: new Date().toISOString() }));
    } catch (error) {
      console.log(JSON.stringify({ event: 'ping_fail', at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    }

    try {
      const st: any = await kvmConnector.getRelayTcpState(sid);
      const data = st?.data || {};
      console.log(
        JSON.stringify({
          event: 'relay_state',
          at: new Date().toISOString(),
          sessionActive: data.sessionActive,
          activeTotal: data.activeTotal,
          totalConnections: data.totalConnections,
          closeReasons: data.closeReasons,
        })
      );
    } catch (error) {
      console.log(JSON.stringify({ event: 'relay_state_fail', at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    }

    if (closed) {
      break;
    }

    await sleep(10000);
  }

  try {
    handle.close();
  } catch {}
  console.log(JSON.stringify({ event: 'done', at: new Date().toISOString() }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
