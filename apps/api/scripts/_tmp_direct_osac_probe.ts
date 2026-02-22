import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

(async()=>{
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const handle = await osacConnector.connectForSession(sid);
  console.log('connected', handle.endpoint);

  handle.onClose(() => {
    console.log('[close] connection closed');
  });

  handle.onMessage((msg) => {
    console.log('[msg]', msg.type, JSON.stringify(msg.payload || {}));
  });

  try {
    await handle.ping(4000);
    console.log('ping ok');
  } catch (err) {
    console.log('ping failed', err instanceof Error ? err.message : String(err));
  }

  const listReq = `list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  handle.send({
    type: 'GET_SESSION_LIST',
    requestId: listReq,
    payload: { requestId: listReq, maxCount: 1, format: 'json' },
  });
  console.log('sent list', listReq);

  const requestId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  handle.send({
    type: 'OPENCODE_SERVER_ENSURE',
    requestId,
    payload: {
      requestId,
      host: process.env.OPENCODE_SERVER_HOST || undefined,
      port: process.env.OPENCODE_SERVER_PORT ? Number(process.env.OPENCODE_SERVER_PORT) : undefined,
      workspacePath: `/opt/.altus/opencode/workspaces/${Date.now()}_probe`,
    },
  });
  console.log('sent ensure', requestId);

  await sleep(15000);
  handle.close();
})();
