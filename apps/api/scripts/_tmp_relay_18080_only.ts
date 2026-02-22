import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function wsHttp(wsUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const bufs: Buffer[] = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.terminate(); } catch {}
      reject(new Error('timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n', 'utf8'), { binary: true });
    });

    ws.on('message', (d) => {
      const b = Buffer.isBuffer(d) ? d : Buffer.from(d as any);
      bufs.push(b);
      const s = Buffer.concat(bufs).toString('utf8');
      if (s.includes('\r\n\r\n')) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.close();
        resolve(s);
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`unexpected ${res.statusCode || 0}`));
    });

    ws.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

(async()=>{
  const sid = process.argv[2] || 'sess_cccee2e824f34dcb';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const t:any = await kvmConnector.createRelayTcpTicket(sid, { target_port: 18080, target_host: 'vm' });
  console.log('TICKET=', JSON.stringify(t?.data || {}, null, 2));
  const wsUrl = String(t?.data?.wsUrl || '');
  const resp = await wsHttp(wsUrl);
  console.log('HEAD=', resp.split('\r\n').slice(0,3).join(' | '));
})();
