import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  throw new Error('usage: pnpm exec tsx scripts/_tmp_sniff_osac_inbound.ts <sessionId>');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  const seen: Array<{ ts: string; type: string; requestId: string | null; payloadKeys: string[] }> = [];

  osacConnectionManager.registerMessageHandler(async (sessionId, message) => {
    if (sessionId !== sid) return;
    const payload = (message.payload || {}) as Record<string, unknown>;
    seen.push({
      ts: new Date().toISOString(),
      type: String(message.type || ''),
      requestId:
        typeof message.requestId === 'string'
          ? message.requestId
          : typeof payload.requestId === 'string'
            ? payload.requestId
            : null,
      payloadKeys: Object.keys(payload || {}),
    });
    console.log(
      JSON.stringify(
        {
          ts: new Date().toISOString(),
          type: message.type,
          requestId:
            typeof message.requestId === 'string'
              ? message.requestId
              : typeof payload.requestId === 'string'
                ? payload.requestId
                : null,
          payload,
        },
        null,
        2
      )
    );
  });

  const ok = await osacConnectionManager.ensurePersistent(sid);
  console.log('ensurePersistent=', ok);

  // Keep connection open for 25s to observe server-initiated probe/control traffic.
  await sleep(25_000);
  console.log('SUMMARY=', JSON.stringify({ count: seen.length, seen }, null, 2));
  await osacConnectionManager.close(sid);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
