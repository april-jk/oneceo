import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function tryWs(url: string, authToken?: string): Promise<string> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const ws = new WebSocket(url, 'kvm.tcp.v1', { headers });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      resolve('timeout');
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve('open');
    });

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      resolve(`unexpected:${res.statusCode || 0}`);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve(`error:${err instanceof Error ? err.message : String(err)}`);
    });
  });
}

async function main() {
  const sid = process.argv[2] || 'sess_e7c544c9a7b5499a';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const ticketResp: any = await kvmConnector.createRelayTcpTicket(sid, { target_port: 19090, target_host: 'vm' });
  const wsUrl = String(ticketResp?.data?.wsUrl || '');
  const ticket = String(ticketResp?.data?.ticket || '');
  console.log('wsUrl=', wsUrl);
  console.log('ticket=', ticket);

  if (!wsUrl || !ticket) {
    throw new Error('missing wsUrl/ticket');
  }

  const base = wsUrl.split('?')[0];
  const host = wsUrl.replace(/^ws:\/\//, '').split('/')[0];
  const altUrls = [
    wsUrl,
    `${base}/${ticket}`,
    `${base}?token=${encodeURIComponent(ticket)}`,
    `${base}?relay_ticket=${encodeURIComponent(ticket)}`,
    `ws://${host}/v1/ws/relay/tcp/${encodeURIComponent(ticket)}`,
    `ws://${host}/v1/ws/relay?ticket=${encodeURIComponent(ticket)}`,
    `ws://${host}/v1/relay/tcp?ticket=${encodeURIComponent(ticket)}`,
  ];

  for (const url of altUrls) {
    const result = await tryWs(url);
    console.log(url, '=>', result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
