import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const cmd = `ip -o link show; ip -4 -o addr show scope global || true; hostname -I || true`;
  const submit: any = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', cmd],
    capture_output: true,
    timeout_seconds: 20,
  });
  const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
  if (!jobId) {
    console.log('SUBMIT', JSON.stringify(submit, null, 2));
    return;
  }
  for (let i = 0; i < 40; i++) {
    const job: any = await kvmConnector.getJob(String(jobId));
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      console.log('JOB', JSON.stringify(job, null, 2));
      break;
    }
    await sleep(1000);
  }
})();
