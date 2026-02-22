import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const j: any = await kvmConnector.getJob(jobId);
    const st = String(j?.data?.status || '').toLowerCase();
    if (st && st !== 'queued' && st !== 'running') {
      return j;
    }
    await sleep(1000);
  }
  throw new Error(`job timeout ${jobId}`);
}

(async () => {
  const sid = process.argv[2] || 'sess_cccee2e824f34dcb';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  try {
    const vm: any = await kvmConnector.getSessionVm(sid);
    console.log('VM=', JSON.stringify(vm?.data || {}, null, 2));
  } catch (error: any) {
    console.log('VM_ERR', error?.message || String(error), error?.status, error?.requestId);
  }

  const cmd = `echo ==== ps ====\nps -ef | grep -E '[o]sac|[o]pencode' || true\necho ==== port ====\nss -ltnp | grep ':18080' || true\necho ==== files ====\nls -l /opt/.altus/opencode 2>/dev/null | head -n 40 || true`;

  try {
    const submit: any = await kvmConnector.execSession(sid, {
      path: '/bin/bash',
      args: ['-lc', cmd],
      capture_output: true,
      timeout_seconds: 40,
    });
    const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
    if (!jobId) {
      console.log('EXEC_SUBMIT=', JSON.stringify(submit, null, 2));
      return;
    }
    const done = await waitJob(kvmConnector, String(jobId));
    console.log('EXEC=', JSON.stringify(done?.data?.result || done?.data || {}, null, 2));
  } catch (error: any) {
    console.log('EXEC_ERR', error?.message || String(error), error?.status, error?.requestId);
  }
})();
