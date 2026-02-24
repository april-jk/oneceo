import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.env.OSAC_FIXED_SANDBOX_SESSION_ID || 'sess_4471f12d0bc444d3';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const cmd = `set -e
IFACE=$(ip -o link show | awk -F': ' '$2!~/^lo$/ {print $2; exit}')
echo IFACE=$IFACE
ip link set "$IFACE" up || true
if command -v dhclient >/dev/null 2>&1; then
  dhclient -1 -v -timeout 10 "$IFACE" || true
fi
if command -v udhcpc >/dev/null 2>&1; then
  udhcpc -t 3 -T 3 -n -i "$IFACE" || true
fi
ip -4 -o addr show scope global || true
hostname -I || true`;

  const submit: any = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', cmd],
    capture_output: true,
    timeout_seconds: 60,
  });
  const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
  if (!jobId) {
    console.log('SUBMIT', JSON.stringify(submit, null, 2));
    return;
  }
  for (let i = 0; i < 80; i++) {
    const job: any = await kvmConnector.getJob(String(jobId));
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      console.log('JOB', JSON.stringify(job, null, 2));
      break;
    }
    await sleep(1000);
  }

  const sandboxIp: any = await kvmConnector.getSandboxIp(sid, { refresh: 'true' } as any).catch((err: any) => ({ error: String(err) }));
  console.log('SANDBOX_IP', JSON.stringify(sandboxIp?.data ?? sandboxIp, null, 2));
})();
