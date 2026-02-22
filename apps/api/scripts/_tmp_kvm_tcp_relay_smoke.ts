import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 180000) {
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

async function runExecAndWait(kvmConnector: any, sessionId: string, command: string, timeoutSeconds = 60) {
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

async function readBanner(wsUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'kvm.tcp.v1');
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('relay banner timeout'));
    }, 10000);

    ws.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as any).toString('utf8');
      clearTimeout(timer);
      ws.close();
      resolve(text.trim());
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`unexpected relay response status=${res.statusCode || 0}`));
    });
  });
}

async function main() {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const health: any = await kvmConnector.health();
  console.log('HEALTH=', JSON.stringify(health?.data || {}, null, 2));

  const created: any = await kvmConnector.createSession({
    metadata: {
      owner: 'codex-relay-smoke',
      purpose: 'kvm-relay-smoke',
      createdAt: new Date().toISOString(),
    },
  });
  const sessionId = String(created?.data?.sessionId || '');
  if (!sessionId) throw new Error('missing sessionId');
  console.log('SESSION=', sessionId);

  const bind: any = await kvmConnector.bindSessionVm(sessionId, { auto_allocate: true });
  console.log('BIND=', JSON.stringify(bind?.data || {}, null, 2));

  const vm: any = await kvmConnector.getSessionVm(sessionId);
  const vmName = String(vm?.data?.vm?.name || vm?.data?.name || '');
  console.log('VM=', vmName || 'unknown');

  if (vmName) {
    const start: any = await kvmConnector.controlVm(vmName, 'start', true);
    const startJobId = String(start?.data?.jobId || start?.data?.job_id || '');
    if (startJobId) {
      const startDone = await waitJob(kvmConnector, startJobId, 180000);
      console.log('START=', JSON.stringify(startDone?.data?.status || startDone?.data || {}, null, 2));
    }
  }

  const dhcpCmd = `set -e
IFACE=$(ip -o link show | awk -F': ' '$2!~/^lo$/ {print $2; exit}')
ip link set "$IFACE" up || true
if command -v dhclient >/dev/null 2>&1; then
  dhclient -v "$IFACE" || true
fi
ip -4 -o addr show scope global || true
hostname -I || true`;

  try {
    const dhcp = await runExecAndWait(kvmConnector, sessionId, dhcpCmd, 60);
    console.log('DHCP=', JSON.stringify(dhcp?.data?.result || dhcp?.data || {}, null, 2));
  } catch (error) {
    console.warn('DHCP_WARN=', error instanceof Error ? error.message : String(error));
  }

  const ticket: any = await kvmConnector.createRelayTcpTicket(sessionId, {
    target_port: 22,
    target_host: 'vm',
  });
  const wsUrl = String(ticket?.data?.wsUrl || '');
  console.log('TICKET=', JSON.stringify(ticket?.data || {}, null, 2));
  if (!wsUrl) throw new Error('relay wsUrl missing');

  const banner = await readBanner(wsUrl);
  console.log('BANNER=', banner);
}

main().catch((error) => {
  console.error('ERR=', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
