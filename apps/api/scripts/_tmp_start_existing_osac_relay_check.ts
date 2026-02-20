import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

function requireSessionId(): string {
  const sid = (process.argv[2] || '').trim();
  if (!sid) {
    throw new Error('usage: pnpm exec tsx scripts/_tmp_start_existing_osac_relay_check.ts <sessionId>');
  }
  return sid;
}

function getJobId(payload: any): string | null {
  return payload?.data?.jobId || payload?.data?.job_id || payload?.jobId || payload?.job_id || null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 180000): Promise<any> {
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

async function execAndWait(
  kvmConnector: any,
  sessionId: string,
  command: string,
  timeoutSeconds = 60
): Promise<any> {
  const submit: any = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId = getJobId(submit);
  if (!jobId) return submit;
  return waitJob(kvmConnector, String(jobId), Math.max(60000, timeoutSeconds * 2000));
}

function extractStdout(payload: any): string {
  return String(payload?.data?.result?.stdout || payload?.data?.stdout || payload?.stdout || '');
}

async function waitPortListening(
  kvmConnector: any,
  sessionId: string,
  port: number,
  attempts = 25
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const probe: any = await execAndWait(
      kvmConnector,
      sessionId,
      `ss -ltnp | grep ':${port}' || true`,
      20
    );
    const out = extractStdout(probe);
    if (out.includes(`:${port}`)) {
      return out.trim();
    }
    await sleep(1200);
  }
  throw new Error(`port ${port} not listening`);
}

async function relayWsHandshake(relayWsUrl: string, osacToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayWsUrl, 'kvm.tcp.v1');
    const chunks: Buffer[] = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      reject(new Error('relay handshake timeout'));
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
        `Authorization: Bearer ${osacToken}`,
        '',
        '',
      ].join('\r\n');
      ws.send(Buffer.from(req, 'utf8'), { binary: true });
    });

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      chunks.push(buf);
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.includes('\r\n\r\n')) {
        finish(() => {
          ws.close();
          resolve(text.split('\r\n').slice(0, 8).join('\n'));
        });
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      finish(() => reject(new Error(`relay unexpected response ${res.statusCode || 0}`)));
    });

    ws.on('error', (error) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });

    ws.on('close', () => {
      if (done) return;
      finish(() => resolve(Buffer.concat(chunks).toString('utf8') || 'closed_without_payload'));
    });
  });
}

async function main() {
  const sessionId = requireSessionId();
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const osacToken =
    (process.env.OSAC_AUTH_TOKEN || '').trim() ||
    `relay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const osacPath = '/opt/.altus/opencode/osac';
  const opencodePath = '/opt/.altus/opencode/opencode';
  const logPath = '/opt/.altus/opencode/log/osac.log';

  const vm: any = await kvmConnector.getSessionVm(sessionId);
  console.log('VM=', JSON.stringify(vm?.data || {}, null, 2));

  const startCmd = [
    'set -e',
    'mkdir -p /opt/.altus/opencode/log /opt/.altus/opencode/tmp',
    `[ -x '${osacPath}' ]`,
    `[ -x '${opencodePath}' ]`,
    'pkill -x osac || true',
    `nohup env OSAC_AUTH_TOKEN='${osacToken.replace(/'/g, "'\\''")}' OSAC_LISTEN_ADDR=':18080' OSAC_OPENCODE_PATH='${opencodePath}' OSAC_LOG_DIR='/opt/.altus/opencode/log' OSAC_UPDATE_TMP='/opt/.altus/opencode/tmp' OPENCODE_BIN='${opencodePath}' OPENCODE_PATH='${opencodePath}' '${osacPath}' >> '${logPath}' 2>&1 < /dev/null &`,
    'sleep 1',
    "ss -ltnp | grep ':18080' || true",
    `tail -n 20 '${logPath}' || true`,
  ].join(' && ');

  const started = await execAndWait(kvmConnector, sessionId, startCmd, 80);
  console.log('START_STDOUT=', extractStdout(started).slice(0, 2000));

  const listening = await waitPortListening(kvmConnector, sessionId, 18080, 30);
  console.log('LISTEN=', listening);

  const ticket: any = await kvmConnector.createRelayTcpTicket(sessionId, {
    target_port: 18080,
    target_host: 'vm',
  });
  console.log('RELAY_TICKET=', JSON.stringify(ticket?.data || {}, null, 2));
  const wsUrl = String(ticket?.data?.wsUrl || '');
  if (!wsUrl) throw new Error('relay wsUrl missing');

  const handshake = await relayWsHandshake(wsUrl, osacToken);
  console.log('HANDSHAKE=\n' + handshake);
  if (!handshake.includes('101')) {
    throw new Error('osac handshake is not 101');
  }

  console.log('RESULT=OK');
}

main().catch((error) => {
  console.error('ERR=', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
