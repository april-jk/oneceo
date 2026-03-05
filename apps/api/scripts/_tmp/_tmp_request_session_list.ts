import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  throw new Error('usage: pnpm exec tsx scripts/_tmp_request_session_list.ts <sessionId>');
}

async function main() {
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');
  const ok = await osacConnectionManager.ensurePersistent(sid);
  console.log('ensurePersistent=', ok);
  const reply = await osacConnectionManager.request(
    sid,
    { type: 'GET_SESSION_LIST', payload: { maxCount: 1, format: 'json' } },
    (msg: any) => msg.type === 'SESSION_LIST_RESPONSE',
    { connectAcquireTimeoutMs: 30_000 }
  );
  console.log('replyType=', reply?.type || null);
  console.log('reply=', JSON.stringify(reply, null, 2));
  await osacConnectionManager.close(sid);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
