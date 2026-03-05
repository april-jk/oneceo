import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || 'sess_56862cc1af114238';

async function relayHandshake(wsUrl: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const bufs: Buffer[] = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.terminate(); } catch {}
      reject(new Error('timeout'));
    }, 12000);

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };

    ws.on('open', () => {
      const req = [
        'GET /ws HTTP/1.1',
        'Host: 127.0.0.1:18080',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        `Authorization: Bearer ${token}`,
        '',
        '',
      ].join('\r\n');
      ws.send(Buffer.from(req, 'utf8'), { binary: true });
    });

    ws.on('message', (data) => {
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      bufs.push(b);
      const text = Buffer.concat(bufs).toString('utf8');
      if (text.includes('\r\n\r\n')) {
        finish(() => {
          ws.close();
          resolve(text.split('\r\n').slice(0, 12).join('\n'));
        });
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      finish(() => reject(new Error(`unexpected:${res.statusCode || 0}`)));
    });

    ws.on('error', (error) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  });
}

async function main() {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const env: any = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const token = String(env?.metadata?.osacAuthToken || '');
  if (!token) throw new Error('missing osac token in metadata');

  const t: any = await kvmConnector.createRelayTcpTicket(sid, { target_port: 18080, target_host: 'vm' });
  const wsUrl = String(t?.data?.wsUrl || '');
  console.log('TICKET=', JSON.stringify(t?.data || {}, null, 2));
  if (!wsUrl) throw new Error('missing wsUrl');

  const head = await relayHandshake(wsUrl, token);
  console.log('HANDSHAKE_HEAD=\n' + head);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
