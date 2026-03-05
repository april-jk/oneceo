import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
const port = Number(process.argv[3] || '22');
if (!sid) {
  console.error('usage: pnpm exec tsx scripts/_tmp_relay_port_probe.ts <sid> <port>');
  process.exit(1);
}

async function readOnce(wsUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('timeout'));
    }, 8000);

    ws.on('message', (data) => {
      clearTimeout(timer);
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as any).toString('utf8');
      ws.close();
      resolve(text);
    });

    ws.on('open', () => {
      // no-op: wait server banner for protocols like ssh
    });

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`unexpected:${res.statusCode || 0}`));
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function main() {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const t: any = await kvmConnector.createRelayTcpTicket(sid, { target_port: port, target_host: 'vm' });
  const wsUrl = String(t?.data?.wsUrl || '');
  console.log('TICKET=', JSON.stringify(t?.data || {}, null, 2));
  if (!wsUrl) throw new Error('missing wsUrl');

  const data = await readOnce(wsUrl);
  console.log('DATA=', data.slice(0, 200));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
