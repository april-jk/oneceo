import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function sleep(ms: number) { await new Promise((r)=>setTimeout(r,ms)); }

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job: any = await kvmConnector.getJob(jobId);
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') return job;
    await sleep(1000);
  }
  throw new Error(`job timeout ${jobId}`);
}

async function runExec(kvmConnector: any, sessionId: string, command: string, timeoutSeconds = 60) {
  const submit: any = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
  if (!jobId) return submit;
  return waitJob(kvmConnector, String(jobId), Math.max(60000, timeoutSeconds * 2000));
}

async function roundTrip(wsUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n', 'utf8'), { binary: true });
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
  const sid = process.argv[2] || 'sess_6db835f3b5124ba4';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const prep = await runExec(kvmConnector, sid, "mkdir -p /tmp/relay_http && nohup python3 -m http.server 19090 --directory /tmp/relay_http >/tmp/relay_http.log 2>&1 < /dev/null & sleep 1; ss -ltn | grep ':19090' || true");
  console.log('PREP=', JSON.stringify(prep?.data?.result || prep?.data || prep || {}, null, 2));

  const ticket: any = await kvmConnector.createRelayTcpTicket(sid, { target_port: 19090, target_host: 'vm' });
  console.log('TICKET=', JSON.stringify(ticket?.data || {}, null, 2));
  const wsUrl = String(ticket?.data?.wsUrl || '');
  const response = await roundTrip(wsUrl);
  console.log('HEAD=', response.split('\r\n').slice(0, 3).join(' | '));
})();
