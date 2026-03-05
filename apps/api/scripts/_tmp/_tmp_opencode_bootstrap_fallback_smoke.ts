import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || 'sess_35ff684915754d7c';
const workspace = process.argv[3] || `/opt/.altus/opencode/workspaces/${Date.now()}_bootstrap_smoke`;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');
  const { osacAgentService } = await import('../src/services/osac-agent-service');

  const events: any[] = [];
  osacConnectionManager.registerMessageHandler((sessionId: string, message: any) => {
    if (sessionId !== sid) return;
    if (String(message?.type || '').startsWith('OPENCODE_') || message?.type === 'ERROR') {
      events.push({
        at: Date.now(),
        type: message.type,
        eventType: message?.payload?.eventType || message?.payload?.event?.type || null,
      });
      console.log('[msg]', message.type, message?.payload?.eventType || message?.payload?.event?.type || '');
    }
  });

  const ok = await osacConnectionManager.ensurePersistent(sid);
  console.log('ensurePersistent=', ok);

  const ensured = await osacAgentService.ensureOpencodeServer(sid, { workspacePath: workspace });
  console.log('ensured=', JSON.stringify(ensured));

  const created = await osacAgentService.createOpencodeSession(sid, { workspacePath: workspace, title: 'bootstrap-smoke' });
  const opencodeSessionId = String((created as any).opencodeSessionId || '');
  console.log('created=', JSON.stringify(created));
  if (!opencodeSessionId) {
    throw new Error('missing opencodeSessionId');
  }

  const accepted = await osacAgentService.sendOpencodePrompt(sid, {
    opencodeSessionId,
    workspacePath: workspace,
    parts: [{ type: 'text', text: '请输出一句话：bootstrap fallback ok。不要执行危险命令。' }],
  });
  console.log('accepted=', JSON.stringify(accepted));

  console.log('waiting for events...');
  await sleep(20000);

  const recent = osacAgentService.listMessages(sid, 120)
    .filter((msg: any) => String(msg?.type || '').startsWith('OPENCODE_'));
  console.log('eventCount=', recent.length);
  console.log('recentTypes=', recent.map((item: any) => item.type).slice(-30).join(','));
  console.log('recentEventTypes=', recent
    .filter((item: any) => item.type === 'OPENCODE_EVENT')
    .map((item: any) => item?.payload?.eventType || item?.payload?.event?.type || '')
    .slice(-30)
    .join(','));

  await osacAgentService.closeConnection(sid);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
