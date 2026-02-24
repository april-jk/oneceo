import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const { kvmConnector } = await import('../src/connectors/kvm-connector');

const sessionId = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';

const cmd = `
set -e
pwd
whoami
ls -la /opt/.altus/opencode || true
ls -la /opt/.altus/opencode/log || true
ls -la /opt/.altus/opencode/tmp || true
ls -la /opt/.altus/opencode/osac /opt/.altus/opencode/opencode || true
file /opt/.altus/opencode/osac || true
file /opt/.altus/opencode/opencode || true
pgrep -a osac || true
ss -ltnp | grep 18080 || true
netstat -ltnp 2>/dev/null | grep 18080 || true
 tail -n 200 /opt/.altus/opencode/log/osac.log || true
`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  const start = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', cmd],
    capture_output: true,
    timeout_seconds: 30,
  });

  let data: any = start.data || {};
  if (data.jobId) {
    for (let i = 0; i < 20; i += 1) {
      const job = await kvmConnector.getJob(data.jobId);
      const jobData: any = job.data || {};
      if (jobData.status && jobData.status !== 'running') {
        data = jobData;
        break;
      }
      await sleep(1000);
    }
  }

  console.log(JSON.stringify(data, null, 2));
} catch (err: any) {
  console.error(err?.message || String(err));
  process.exit(1);
}
