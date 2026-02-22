import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(jobId: string) {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const start = Date.now();
  while (Date.now() - start < 240000) {
    const job: any = await kvmConnector.getJob(String(jobId));
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') return job;
    await sleep(1000);
  }
  throw new Error(`job timeout ${jobId}`);
}

(async () => {
  try {
    console.log('STEP import service');
    const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');

    console.log('STEP provision start');
    const provision: any = await sandboxAgentProvisionService.provision({
      metadata: {
        owner: 'codex-debug',
        purpose: 'stack-check',
        createdAt: new Date().toISOString(),
      },
    });
    console.log('STEP provision ok', JSON.stringify({
      sessionId: provision?.sessionId,
      status: provision?.status,
      endpoint: provision?.osacEndpoint,
      readyGatePassed: provision?.readyGatePassed,
    }, null, 2));

    const sid = String(provision?.sessionId || '');
    if (!sid) throw new Error('missing sid');

    console.log('STEP exec models');
    const { kvmConnector } = await import('../src/connectors/kvm-connector');
    const submit: any = await kvmConnector.execSession(sid, {
      path: '/bin/bash',
      args: ['-lc', 'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"'],
      capture_output: true,
      timeout_seconds: 90,
    });
    console.log('STEP exec submit', JSON.stringify(submit, null, 2));
    const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
    if (jobId) {
      const done = await waitJob(String(jobId));
      console.log('STEP exec done', JSON.stringify(done, null, 2));
    }

    console.log('DONE');
  } catch (error: any) {
    console.error('ERR_TYPE', error?.constructor?.name || typeof error);
    console.error('ERR_MESSAGE', error?.message || String(error));
    console.error('ERR_FULL', error);
    if (error?.stack) console.error(error.stack);
    process.exit(1);
  }
})();
