import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const provision = await withTimeout(
    sandboxAgentProvisionService.provision({
      metadata: { owner: 'codex-test', purpose: 'quick-bridge-check' },
      idempotencyKey: `quick-bridge-${Date.now()}`,
    }),
    360000,
    'provision'
  );

  const sid = provision.sessionId;
  console.log('sessionId=', sid);
  console.log('osacEndpoint=', provision.osacEndpoint);

  const handle = await withTimeout(osacConnector.connectForSession(sid), 60000, 'ws-connect');
  console.log('wsConnect=ok');

  const listReply = await withTimeout(
    handle.request(
      { type: 'GET_SESSION_LIST', payload: { maxCount: 1, format: 'json' } },
      (msg) => msg.type === 'SESSION_LIST_RESPONSE'
    ),
    60000,
    'get-session-list'
  );
  console.log('sessionListReply=', listReply.type);

  const execResult = await withTimeout(
    kvmConnector.execSession(sid, {
      path: '/bin/bash',
      args: ['-lc', 'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true'],
      capture_output: true,
      timeout_seconds: 75,
    }),
    90000,
    'exec-start'
  );

  const jobId =
    (execResult as any)?.data?.jobId ||
    (execResult as any)?.data?.job_id ||
    (execResult as any)?.jobId ||
    (execResult as any)?.job_id;

  let final: any = execResult;
  if (jobId) {
    for (let i = 0; i < 90; i++) {
      const job = await withTimeout(kvmConnector.getJob(String(jobId)), 20000, 'get-job');
      const status = (job as any)?.data?.status;
      if (status && status !== 'queued' && status !== 'running') {
        final = job;
        break;
      }
      await sleep(1000);
    }
  }

  const payload = (final as any)?.data?.result || (final as any)?.data || final || {};
  const out = String(payload.stdout || payload.output || '').replace(/\s+/g, ' ').trim();
  console.log('modelsProbe=', out.slice(0, 1800));

  handle.close();
}

main().catch((error) => {
  console.error('quick-bridge-check failed:', error?.message || String(error));
  process.exit(1);
});
