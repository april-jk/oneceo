import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

async function roundTrip(wsUrl: string, authToken?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout'));
    }, 10000);

    ws.on('open', () => {
      const headers = [
        'GET /healthz HTTP/1.1',
        'Host: localhost',
        authToken ? `Authorization: Bearer ${authToken}` : undefined,
        'Connection: close',
        '\r\n',
      ].filter(Boolean).join('\r\n');
      ws.send(Buffer.from(headers, 'utf8'), { binary: true });
    });
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      chunks.push(buf);
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.includes('\r\n\r\n')) {
        clearTimeout(timer);
        ws.close();
        resolve(text);
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`unexpected response ${res.statusCode || 0}`));
    });
  });
}

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const ticket: any = await kvmConnector.createRelayTcpTicket(sid, { target_port: 18080, target_host: 'vm' });
  const wsUrl = String(ticket?.data?.wsUrl || '');
  if (!wsUrl) throw new Error('missing wsUrl');
  const response = await roundTrip(wsUrl, process.env.OSAC_AUTH_TOKEN || process.env.OSAC_PSK || 'manual_fix_session_35ff');
  console.log('HEAD=', response.split('\r\n').slice(0, 3).join(' | '));
})();
