import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || process.env.OSAC_FIXED_SANDBOX_SESSION_ID;
if (!sid) {
  throw new Error('sid required');
}

const workspace = process.argv[3] || `/opt/.altus/opencode/workspaces/${Date.now()}_ensure_probe`;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  osacConnectionManager.registerMessageHandler((sessionId: string, message: any) => {
    if (sessionId !== sid) return;
    if (String(message?.type || '').startsWith('OPENCODE_') || message?.type === 'ERROR') {
      console.log('[msg]', message.type, JSON.stringify(message.payload || {}));
    }
  });

  const ok = await osacConnectionManager.ensurePersistent(sid);
  console.log('ensurePersistent=', ok);

  const requestId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await osacConnectionManager.send(sid, {
    type: 'OPENCODE_SERVER_ENSURE',
    requestId,
    payload: {
      requestId,
      workspacePath: workspace,
      host: process.env.OPENCODE_SERVER_HOST || undefined,
      port: process.env.OPENCODE_SERVER_PORT ? Number(process.env.OPENCODE_SERVER_PORT) : undefined,
    },
  });

  console.log('sent ensure', requestId);
  await sleep(12000);

  const recent = osacConnectionManager.listMessages(sid, 50);
  console.log('recentTypes=', recent.map((m: any) => m.type).join(','));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
