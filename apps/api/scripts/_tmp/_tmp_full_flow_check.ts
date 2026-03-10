import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

function logStep(step: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${step}`);
}

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

async function waitJob(getJob: (id: string) => Promise<any>, jobId: string, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job: any = await getJob(jobId);
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') return job;
    await sleep(1000);
  }
  throw new Error(`job timeout ${jobId}`);
}

(async () => {
  const hardTimer = setTimeout(() => {
    console.error('HARD_TIMEOUT 180s');
    process.exit(2);
  }, 180000);

  try {
    logStep('import services');
    const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
    const { osacConnector } = await import('../src/connectors/osac-connector');
    const { kvmConnector } = await import('../src/connectors/kvm-connector');

    logStep('provision start');
    const provision: any = await withTimeout(
      sandboxAgentProvisionService.provision({
        metadata: { owner: 'codex-full-flow', purpose: 'full-flow-check' },
        idempotencyKey: `full-flow-${Date.now()}`,
      }),
      120000,
      'provision'
    );
    logStep(`provision ok sessionId=${provision?.sessionId} endpoint=${provision?.osacEndpoint}`);

    const sid = String(provision?.sessionId || '').trim();
    if (!sid) throw new Error('missing sessionId from provision');

    logStep('osac connect');
    const handle = await withTimeout(osacConnector.connectForSession(sid), 30000, 'osac-connect');
    logStep('osac connected');

    logStep('get session list');
    const listReply = await withTimeout(
      handle.request({ type: 'GET_SESSION_LIST', payload: { maxCount: 1, format: 'json' } }, (msg) => msg.type === 'SESSION_LIST_RESPONSE'),
      30000,
      'get-session-list'
    );
    logStep(`session list ok type=${listReply.type}`);

    logStep('exec models probe');
    const execResult: any = await withTimeout(
      kvmConnector.execSession(sid, {
        path: '/bin/bash',
        args: ['-lc', 'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true'],
        capture_output: true,
        timeout_seconds: 90,
      }),
      90000,
      'exec-submit'
    );
    const jobId = execResult?.data?.jobId || execResult?.data?.job_id || execResult?.jobId || execResult?.job_id;
    let final = execResult;
    if (jobId) {
      final = await withTimeout(waitJob(kvmConnector.getJob, String(jobId), 120000), 120000, 'exec-job');
    }
    const out = String(final?.data?.result?.stdout || final?.data?.result?.output || final?.data?.stdout || '').trim();
    logStep(`models probe output=${out.slice(0, 200)}`);

    handle.close();
    logStep('full flow ok');
    clearTimeout(hardTimer);
    process.exit(0);
  } catch (error: any) {
    console.error('full flow failed:', error?.message || String(error));
    clearTimeout(hardTimer);
    process.exit(1);
  }
})();
