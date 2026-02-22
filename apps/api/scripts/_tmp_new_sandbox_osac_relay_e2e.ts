import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

dotenv.config({ path: '.env' });

type AnyMap = Record<string, any>;

function nowIso() {
  return new Date().toISOString();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing env: ${name}`);
  }
  return value.trim();
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getJobId(payload: any): string | null {
  return firstNonEmpty(payload?.data?.jobId, payload?.data?.job_id, payload?.jobId, payload?.job_id);
}

async function waitJob(kvmConnector: any, jobId: string, timeoutMs = 240000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job: AnyMap = await kvmConnector.getJob(jobId);
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`wait job timeout: ${jobId}`);
}

async function execAndWait(
  kvmConnector: any,
  sessionId: string,
  command: string,
  timeoutSeconds = 60
): Promise<any> {
  const submit: AnyMap = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId = getJobId(submit);
  if (!jobId) return submit;
  return waitJob(kvmConnector, jobId, Math.max(60000, timeoutSeconds * 2000));
}

async function uploadAndWait(
  kvmConnector: any,
  sessionId: string,
  localFile: string,
  remoteDir: string
): Promise<any> {
  const submit: AnyMap = await kvmConnector.uploadSessionFile(sessionId, {
    filename: path.basename(localFile),
    buffer: fs.readFileSync(localFile),
    targetPath: remoteDir,
    overwrite: 'replace',
    mkdirs: true,
    chmod: '755',
    deliveryMode: 'guest-agent',
  });
  const jobId = getJobId(submit);
  if (!jobId) return submit;
  return waitJob(kvmConnector, jobId, 300000);
}

async function waitGuestAgent(kvmConnector: any, sessionId: string, attempts = 60): Promise<void> {
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const done = await execAndWait(kvmConnector, sessionId, '/bin/true', 10);
      const status = String(done?.data?.status || done?.status || 'completed').toLowerCase();
      if (!status || status === 'completed') {
        return;
      }
      lastError = JSON.stringify(done?.data?.error || done?.error || {});
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }
  throw new Error(`guest-agent not ready: ${lastError}`);
}

async function ensureVmRunning(kvmConnector: any, vmName: string): Promise<void> {
  const vm = await kvmConnector.getVm(vmName);
  const state = String(vm?.data?.state || '').toLowerCase();
  if (state === 'running') return;

  const start = await kvmConnector.controlVm(vmName, 'start', true);
  const startJobId = getJobId(start);
  if (startJobId) {
    const done = await waitJob(kvmConnector, startJobId, 240000);
    const status = String(done?.data?.status || '').toLowerCase();
    if (status && status !== 'completed') {
      throw new Error(`vm start failed: ${JSON.stringify(done?.data?.error || {})}`);
    }
  }
}

async function waitVmIp(kvmConnector: any, vmName: string, attempts = 40): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    try {
      const vmIp = await kvmConnector.getVmIp(vmName, { refresh: 'true' });
      const ips = vmIp?.data?.ipAddresses || vmIp?.data?.ip_addresses || [];
      if (Array.isArray(ips) && ips.length > 0) {
        const first = String(ips[0] || '').split('/')[0];
        if (first) return first;
      }
    } catch {
      // ignore
    }
    await sleep(2000);
  }
  throw new Error(`vm ip unavailable: ${vmName}`);
}

async function waitPortListening(
  kvmConnector: any,
  sessionId: string,
  port: number,
  attempts = 30
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const probe = await execAndWait(
      kvmConnector,
      sessionId,
      `ss -ltnp | grep ':${port}' || true`,
      20
    );
    const stdout = String(probe?.data?.result?.stdout || probe?.data?.stdout || '');
    if (stdout.includes(`:${port}`)) {
      return stdout;
    }
    await sleep(1500);
  }
  throw new Error(`port ${port} not listening`);
}

async function relayOsacWsHandshake(relayWsUrl: string, osacToken: string): Promise<string> {
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
        const head = text.split('\r\n').slice(0, 8).join('\n');
        finish(() => {
          ws.close();
          resolve(head);
        });
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      finish(() => reject(new Error(`relay unexpected response: ${res.statusCode || 0}`)));
    });

    ws.on('error', (error) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });

    ws.on('close', () => {
      if (!done) {
        const text = Buffer.concat(chunks).toString('utf8') || 'closed_without_payload';
        finish(() => resolve(text));
      }
    });
  });
}

async function createSandboxWithRawHttp(sessionId: string): Promise<{ ok: boolean; status: number; body: string }> {
  const base = requireEnv('KVM_ORCHESTRATOR_URL');
  const token = requireEnv('KVM_ORCH_TOKEN');
  const payload: AnyMap = {
    session_id: sessionId,
    vm_name: `sandbox_${sessionId}`,
    auto_bind: true,
    start: true,
    base_image: process.env.KVM_SANDBOX_BASE_IMAGE,
    network: process.env.KVM_SANDBOX_NETWORK,
    memory_mb: Number(process.env.KVM_SANDBOX_MEMORY_MB || 2048),
    vcpus: Number(process.env.KVM_SANDBOX_VCPUS || 2),
    os_variant: process.env.KVM_SANDBOX_OS_VARIANT,
  };
  const res = await fetch(`${base}/v1/sandboxes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `codex-osac-18080-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const osacLocal = path.resolve(process.cwd(), process.env.OSAC_BINARY_PATH || '');
  const opencodeLocal = path.resolve(process.cwd(), process.env.OPENCODE_BINARY_PATH || '');
  if (!fs.existsSync(osacLocal)) throw new Error(`osac binary missing: ${osacLocal}`);
  if (!fs.existsSync(opencodeLocal)) throw new Error(`opencode binary missing: ${opencodeLocal}`);

  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const create = await kvmConnector.createSession({
    metadata: {
      owner: 'codex-osac-18080',
      purpose: 'new-sandbox-osac-relay-check',
      createdAt: nowIso(),
    },
  });
  const sessionId = firstNonEmpty(create?.data?.sessionId, create?.data?.session_id);
  if (!sessionId) throw new Error('session_id missing');
  console.log('SESSION_ID=', sessionId);

  const sandbox = await createSandboxWithRawHttp(sessionId);
  console.log('CREATE_SANDBOX_STATUS=', sandbox.status);
  console.log('CREATE_SANDBOX_BODY=', sandbox.body);
  if (!sandbox.ok) {
    throw new Error(`createSandbox failed status=${sandbox.status}`);
  }

  let vmName: string | null = null;
  for (let i = 0; i < 30; i++) {
    try {
      const vm = await kvmConnector.getSessionVm(sessionId);
      vmName = firstNonEmpty(vm?.data?.vm?.name, vm?.data?.name, vm?.data?.vmName);
      if (vmName) break;
    } catch {
      // ignore
    }
    await sleep(2000);
  }
  if (!vmName) throw new Error('vm name unavailable');
  console.log('VM_NAME=', vmName);

  await ensureVmRunning(kvmConnector, vmName);
  const vmIp = await waitVmIp(kvmConnector, vmName, 50);
  console.log('VM_IP=', vmIp);

  await waitGuestAgent(kvmConnector, sessionId, 80);
  console.log('GUEST_AGENT=READY');

  const remoteDir = '/opt/.altus/opencode';
  const osacRemote = `${remoteDir}/osac`;
  const opencodeRemote = `${remoteDir}/opencode`;
  const osacToken = `osac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const prep = await execAndWait(
    kvmConnector,
    sessionId,
    `mkdir -p ${remoteDir}/log ${remoteDir}/tmp && pkill -f '${osacRemote}' || true`,
    40
  );
  console.log('PREP=', JSON.stringify(prep?.data?.result || prep?.data || {}, null, 2));

  const upOsac = await uploadAndWait(kvmConnector, sessionId, osacLocal, `${remoteDir}/`);
  console.log('UPLOAD_OSAC_STATUS=', upOsac?.data?.status || upOsac?.status || 'ok');

  const upOpencode = await uploadAndWait(kvmConnector, sessionId, opencodeLocal, `${remoteDir}/`);
  console.log('UPLOAD_OPENCODE_STATUS=', upOpencode?.data?.status || upOpencode?.status || 'ok');

  const launch = [
    `mv -f ${remoteDir}/${path.basename(osacLocal)} ${osacRemote}`,
    `mv -f ${remoteDir}/${path.basename(opencodeLocal)} ${opencodeRemote}`,
    `chmod +x ${osacRemote} ${opencodeRemote}`,
    `touch ${remoteDir}/log/osac.log`,
    `nohup env OSAC_AUTH_TOKEN='${osacToken.replace(/'/g, "'\\''")}' OSAC_LISTEN_ADDR=':18080' OSAC_OPENCODE_PATH='${opencodeRemote}' OSAC_LOG_DIR='${remoteDir}/log' OSAC_UPDATE_TMP='${remoteDir}/tmp' OPENCODE_BIN='${opencodeRemote}' OPENCODE_PATH='${opencodeRemote}' ${osacRemote} >> ${remoteDir}/log/osac.log 2>&1 < /dev/null &`,
    `sleep 1`,
    `ss -ltnp | grep ':18080' || true`,
  ].join(' && ');

  const started = await execAndWait(kvmConnector, sessionId, launch, 80);
  console.log('START=', JSON.stringify(started?.data?.result || started?.data || {}, null, 2));

  const listen = await waitPortListening(kvmConnector, sessionId, 18080, 35);
  console.log('LISTEN=', listen.trim());

  const relayTicket = await kvmConnector.createRelayTcpTicket(sessionId, {
    target_port: 18080,
    target_host: 'vm',
  });
  console.log('RELAY_TICKET=', JSON.stringify(relayTicket?.data || {}, null, 2));
  const wsUrl = firstNonEmpty(relayTicket?.data?.wsUrl, relayTicket?.data?.ws_url);
  if (!wsUrl) throw new Error('relay ws url missing');

  const handshake = await relayOsacWsHandshake(wsUrl, osacToken);
  console.log('OSAC_WS_HANDSHAKE=\n' + handshake);
  if (!handshake.includes('101')) {
    throw new Error('OSAC ws handshake did not return 101');
  }

  console.log('RESULT=OK OSAC 18080 reachable via KVM relay');
}

main().catch((error) => {
  console.error('ERR=', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

