import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sid = 'sess_859051c7037247f3';
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const cmd = `set -e
IFACE=$(ip -o link show | awk -F': ' '$2!~/^lo$/ {print $2; exit}')
echo IFACE=$IFACE
ip link set "$IFACE" up || true
if command -v dhclient >/dev/null 2>&1; then
  dhclient -v "$IFACE" || true
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

  const vmIp: any = await kvmConnector.getVmIp('kvm_orch_test_20260208_114556', { refresh: 'true' });
  console.log('VM_IP', JSON.stringify(vmIp, null, 2));

  try {
    const port: any = await kvmConnector.createSandboxPort(sid, {
      vm_port: 18080,
      host_port: 23080,
      protocol: 'tcp',
    });
    console.log('PORT', JSON.stringify(port, null, 2));
  } catch (error: any) {
    console.log('PORT_ERR', error?.message || String(error), error?.status, error?.requestId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
