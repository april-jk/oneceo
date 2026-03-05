import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  console.error('usage: pnpm exec tsx scripts/_tmp_kvm_relay_429_probe.ts <sessionId> [rounds]');
  process.exit(1);
}
const rounds = Number(process.argv[3] || '20');

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openOnce(wsUrl: string, subprotocol: string) {
  return new Promise<{ ok: boolean; status?: number; body?: string; reason?: string }>((resolve) => {
    const ws = new WebSocket(wsUrl, subprotocol || 'kvm.tcp.v1');
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch {}
      resolve({ ok: false, reason: 'timeout' });
    }, 5000);

    ws.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      resolve({ ok: true });
    });

    ws.on('unexpected-response', (_req, res) => {
      if (settled) return;
      let body = '';
      res.on('data', (chunk) => {
        body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, status: res.statusCode || 0, body });
      });
      res.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, status: res.statusCode || 0, body });
      });
      try { res.resume(); } catch {}
    });

    ws.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function main() {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  for (let i = 1; i <= rounds; i++) {
    const t: any = await kvmConnector.createRelayTcpTicket(sid, {
      target_port: 18080,
      target_host: 'vm',
      connect_timeout_ms: 5000,
      idle_timeout_ms: 180000,
      ticket_ttl_ms: 30000,
      single_use: true,
    });
    const wsUrl = String(t?.data?.wsUrl || '');
    const sub = String(t?.data?.subprotocol || 'kvm.tcp.v1');
    const r = await openOnce(wsUrl, sub);
    console.log(JSON.stringify({ i, ...r }));
    await sleep(150);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
