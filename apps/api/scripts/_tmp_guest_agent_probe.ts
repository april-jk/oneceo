import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const vmName = process.env.OSAC_FIXED_SANDBOX_VM_NAME || 'test_session_manual_use';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const latest = await sandboxExecutionEnvironmentDAO.findLatestByVmName(vmName);
  const sid = String(latest?.sessionId || '').trim();
  if (!sid) {
    console.error('[probe] no session for vm', vmName);
    return;
  }
  console.log('[probe] session', sid, 'vm', vmName);
  const execResult: any = await kvmConnector.execSession(sid, {
    path: '/bin/true',
    args: [],
    capture_output: false,
    timeout_seconds: 10,
  });
  const jobId = execResult?.data?.jobId || execResult?.data?.job_id || execResult?.jobId || execResult?.job_id;
  if (!jobId) {
    console.log('[probe] execResult', JSON.stringify(execResult, null, 2));
    return;
  }
  for (let i = 0; i < 30; i++) {
    const job: any = await kvmConnector.getJob(String(jobId));
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      console.log('[probe] job', JSON.stringify(job, null, 2));
      return;
    }
    await sleep(1000);
  }
  console.log('[probe] job timeout');
})();
