import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j: any = await kvmConnector.getJob(jobId);
    const status = String(j?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      return j;
    }
    await sleep(1000);
  }
  throw new Error(`job timeout ${jobId}`);
}

function getJobId(payload: any): string | null {
  return payload?.data?.jobId || payload?.data?.job_id || payload?.jobId || payload?.job_id || null;
}

async function execAndWait(kvmConnector: any, sessionId: string, command: string, timeoutSeconds = 60) {
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

async function uploadAndWait(kvmConnector: any, sessionId: string, localPath: string, remoteDir: string) {
  const payload: any = await kvmConnector.uploadSessionFile(sessionId, {
    filename: path.basename(localPath),
    buffer: fs.readFileSync(localPath),
    targetPath: remoteDir,
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  const jobId = getJobId(payload);
  if (!jobId) return payload;
  return waitJob(kvmConnector, String(jobId), 300000);
}

async function waitPortListening(kvmConnector: any, sessionId: string, port: number, retries = 20) {
  for (let i = 0; i < retries; i++) {
    const probe: any = await execAndWait(
      kvmConnector,
      sessionId,
      `ss -ltnp | grep ':${port}' || true`,
      20
    );
    const out = String(probe?.data?.result?.stdout || probe?.data?.stdout || '');
    if (out.includes(`:${port}`)) {
      return out;
    }
    await sleep(1500);
  }
  return null;
}

async function relayWebSocketHandshake(relayWsUrl: string, osacToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayWsUrl, 'kvm.tcp.v1');
    const chunks: Buffer[] = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.terminate(); } catch {}
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
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      chunks.push(b);
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.includes('\r\n\r\n')) {
        const head = text.split('\r\n').slice(0, 8).join('\n');
        finish(() => {
          ws.close();
          resolve(head);
        });
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      finish(() => reject(new Error(`relay unexpected response ${res.statusCode || 0}`)));
    });

    ws.on('error', (err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });

    ws.on('close', () => {
      if (!done) {
        const text = Buffer.concat(chunks).toString('utf8');
        finish(() => resolve(text || 'closed_without_payload'));
      }
    });
  });
}

async function main() {
  const sid = process.argv[2] || 'sess_cccee2e824f34dcb';
  const osacToken = process.env.OSAC_AUTH_TOKEN || 'relay-test-token';
  const osacLocal = path.resolve(process.cwd(), process.env.OSAC_BINARY_PATH || '');
  const opencodeLocal = path.resolve(process.cwd(), process.env.OPENCODE_BINARY_PATH || '');

  if (!fs.existsSync(osacLocal)) throw new Error(`osac binary missing: ${osacLocal}`);
  if (!fs.existsSync(opencodeLocal)) throw new Error(`opencode binary missing: ${opencodeLocal}`);

  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const vm: any = await kvmConnector.getSessionVm(sid);
  console.log('VM=', JSON.stringify(vm?.data || {}, null, 2));

  const remoteDir = '/opt/.altus/opencode';
  const osacRemote = `${remoteDir}/osac`;
  const opencodeRemote = `${remoteDir}/opencode`;

  const prep = await execAndWait(
    kvmConnector,
    sid,
    `mkdir -p ${remoteDir}/log ${remoteDir}/tmp && pkill -f '/opt/.altus/opencode/osac' || true`,
    30
  );
  console.log('PREP=', JSON.stringify(prep?.data?.result || prep?.data || {}, null, 2));

  const up1 = await uploadAndWait(kvmConnector, sid, osacLocal, `${remoteDir}/`);
  console.log('UPLOAD_OSAC=', JSON.stringify(up1?.data?.status || up1?.data || {}, null, 2));

  const up2 = await uploadAndWait(kvmConnector, sid, opencodeLocal, `${remoteDir}/`);
  console.log('UPLOAD_OPENCODE=', JSON.stringify(up2?.data?.status || up2?.data || {}, null, 2));

  const launchCmd = [
    `mv -f ${remoteDir}/${path.basename(osacLocal)} ${osacRemote}`,
    `mv -f ${remoteDir}/${path.basename(opencodeLocal)} ${opencodeRemote}`,
    `chmod +x ${osacRemote} ${opencodeRemote}`,
    `touch ${remoteDir}/log/osac.log`,
    `nohup env OSAC_AUTH_TOKEN='${osacToken.replace(/'/g, "'\\''")}' OSAC_LISTEN_ADDR=':18080' OSAC_OPENCODE_PATH='${opencodeRemote}' OSAC_LOG_DIR='${remoteDir}/log' OSAC_UPDATE_TMP='${remoteDir}/tmp' OPENCODE_BIN='${opencodeRemote}' OPENCODE_PATH='${opencodeRemote}' ${osacRemote} >> ${remoteDir}/log/osac.log 2>&1 < /dev/null &`,
    `sleep 1`,
    `ss -ltnp | grep ':18080' || true`,
  ].join(' && ');

  const started = await execAndWait(kvmConnector, sid, launchCmd, 60);
  console.log('START=', JSON.stringify(started?.data?.result || started?.data || {}, null, 2));

  const listen = await waitPortListening(kvmConnector, sid, 18080, 20);
  if (!listen) {
    throw new Error('osac :18080 not listening after start');
  }
  console.log('LISTEN=', listen.trim());

  const ticket: any = await kvmConnector.createRelayTcpTicket(sid, {
    target_port: 18080,
    target_host: 'vm',
  });
  console.log('TICKET=', JSON.stringify(ticket?.data || {}, null, 2));

  const relayWsUrl = String(ticket?.data?.wsUrl || '');
  if (!relayWsUrl) throw new Error('missing relay wsUrl');

  const handshakeHead = await relayWebSocketHandshake(relayWsUrl, osacToken);
  console.log('HANDSHAKE_HEAD=\n' + handshakeHead);

  if (!handshakeHead.includes('101')) {
    throw new Error('osac ws handshake did not return 101');
  }

  console.log('RESULT=OSAC_18080_RELAY_OK');
}

main().catch((error) => {
  console.error('ERR=', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
