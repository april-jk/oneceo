import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const { kvmConnector } = await import('../src/connectors/kvm-connector');
const sessionId = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';
const cmd = `systemctl is-active osac.service || true; ss -ltnp | grep 18080 || true`;
const start = await kvmConnector.execSession(sessionId, { path: '/bin/bash', args: ['-lc', cmd], capture_output: true, timeout_seconds: 15 });
let data: any = start.data || {};
if (data.jobId) {
  for (let i = 0; i < 10; i += 1) {
    const job = await kvmConnector.getJob(data.jobId);
    const jobData: any = job.data || {};
    if (jobData.status && jobData.status !== 'running') { data = jobData; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log(JSON.stringify(data, null, 2));
