import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function sleep(ms: number) { await new Promise((r)=>setTimeout(r,ms)); }

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j:any = await kvmConnector.getJob(jobId);
    const st = String(j?.data?.status || '').toLowerCase();
    if (st && st !== 'queued' && st !== 'running') return j;
    await sleep(1000);
  }
  throw new Error(`job timeout ${jobId}`);
}

function getJobId(payload: any): string | null {
  return payload?.data?.jobId || payload?.data?.job_id || payload?.jobId || payload?.job_id || null;
}

async function execAndWait(kvmConnector: any, sid: string, cmd: string, timeoutSeconds=60) {
  const submit:any = await kvmConnector.execSession(sid,{path:'/bin/bash',args:['-lc',cmd],capture_output:true,timeout_seconds:timeoutSeconds});
  const jid = getJobId(submit);
  if (!jid) return submit;
  return waitJob(kvmConnector, String(jid), Math.max(60000, timeoutSeconds*2000));
}

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
      const req = Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n', 'utf8');
      ws.send(req, { binary: true });
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

  const prep = await execAndWait(kvmConnector, sid, "pkill -f 'python3 -m http.server 18080' || true; nohup python3 -m http.server 18080 >/tmp/port18080.log 2>&1 < /dev/null & sleep 1; ss -ltn | grep ':18080' || true", 40);
  console.log('PREP=', JSON.stringify(prep?.data?.result || prep?.data || {}, null, 2));

  const ticket:any = await kvmConnector.createRelayTcpTicket(sid, { target_port: 18080, target_host: 'vm' });
  console.log('TICKET=', JSON.stringify(ticket?.data || {}, null, 2));

  const wsUrl = String(ticket?.data?.wsUrl || '');
  if (!wsUrl) throw new Error('missing wsUrl');

  const resp = await wsHttp(wsUrl);
  console.log('HEAD=', resp.split('\r\n').slice(0,3).join(' | '));
})();
