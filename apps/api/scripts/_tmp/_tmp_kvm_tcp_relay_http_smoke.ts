import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job: any = await kvmConnector.getJob(jobId);
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
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

async function wsTcpRoundTrip(wsUrl: string, payload: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const chunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch {}
      reject(new Error('relay read timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(payload, { binary: true });
    });

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      chunks.push(buf);
      const joined = Buffer.concat(chunks).toString('utf8');
      if (joined.includes('\r\n\r\n')) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve(Buffer.concat(chunks));
      }
    });

    ws.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    ws.on('unexpected-response', (_req, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`unexpected relay response status=${res.statusCode || 0}`));
    });

    ws.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

async function main() {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const created: any = await kvmConnector.createSession({
    metadata: {
      owner: 'codex-relay-http-smoke',
      purpose: 'kvm-relay-http-smoke',
      createdAt: new Date().toISOString(),
    },
  });
  const sessionId = String(created?.data?.sessionId || '');
  if (!sessionId) throw new Error('missing sessionId');
  console.log('SESSION=', sessionId);

  try {
    await kvmConnector.bindSessionVm(sessionId, { vm_name: 'kvm_orch_test_20260208_114556' });
  } catch {
    await kvmConnector.bindSessionVm(sessionId, { auto_allocate: true });
  }
  const vm: any = await kvmConnector.getSessionVm(sessionId);
  const vmName = String(vm?.data?.vm?.name || vm?.data?.name || '');
  if (!vmName) throw new Error('missing vmName');
  console.log('VM=', vmName);

  const start: any = await kvmConnector.controlVm(vmName, 'start', true);
  const startJobId = String(start?.data?.jobId || start?.data?.job_id || '');
  if (startJobId) {
    await waitJob(kvmConnector, startJobId, 180000);
  }

  const prepResult = await runExec(
    kvmConnector,
    sessionId,
    `set -e
IFACE=$(ip -o link show | awk -F': ' '$2!~/^lo$/ {print $2; exit}')
ip link set "$IFACE" up || true
if command -v dhclient >/dev/null 2>&1; then
  dhclient -v "$IFACE" || true
fi
mkdir -p /tmp/relay_http
nohup python3 -m http.server 19090 --directory /tmp/relay_http >/tmp/relay_http.log 2>&1 < /dev/null &
sleep 1
ss -ltn | grep ':19090' || true`
  );
  console.log('PREP=', JSON.stringify(prepResult?.data?.result || prepResult?.data || prepResult || {}, null, 2));

  const ticket: any = await kvmConnector.createRelayTcpTicket(sessionId, {
    target_port: 19090,
    target_host: 'vm',
  });
  const wsUrl = String(ticket?.data?.wsUrl || '');
  if (!wsUrl) throw new Error('missing relay wsUrl');

  const request = Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n', 'utf8');
  const response = await wsTcpRoundTrip(wsUrl, request);
  const text = response.toString('utf8');
  console.log('RELAY_HTTP_RESPONSE_HEAD=', text.split('\r\n').slice(0, 3).join(' | '));

  if (!text.includes('HTTP/1.0 200 OK') && !text.includes('HTTP/1.1 200 OK')) {
    throw new Error('relay http response is not 200 OK');
  }

  console.log('RELAY_HTTP_SMOKE=OK', sessionId, vmName);
}

main().catch((error) => {
  console.error('ERR=', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
