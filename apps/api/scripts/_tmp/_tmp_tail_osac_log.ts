import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.env.SID;
if (!sid) {
  throw new Error('SID is required');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getKvmConnector() {
  const module = await import('../src/connectors/kvm-connector');
  return module.kvmConnector;
}

async function waitJob(jobId: string) {
  const kvmConnector = await getKvmConnector();
  for (let i = 0; i < 180; i++) {
    const job = await kvmConnector.getJob(jobId);
    const status = (job as any)?.data?.status;
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`job timeout: ${jobId}`);
}

async function exec(command: string) {
  const kvmConnector = await getKvmConnector();
  const result = await kvmConnector.execSession(sid, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: 120,
  });

  const jobId =
    (result as any)?.data?.jobId ||
    (result as any)?.data?.job_id ||
    (result as any)?.jobId ||
    (result as any)?.job_id;

  const final = jobId ? await waitJob(String(jobId)) : result;
  const payload = (final as any)?.data?.result || (final as any)?.data || {};
  return {
    status: (final as any)?.data?.status || payload.status,
    exit: payload.exitcode ?? payload.exitCode,
    stdout: String(payload.stdout || payload.output || ''),
    stderr: String(payload.stderr || ''),
  };
}

async function main() {
  const checkPort = await exec("if command -v ss >/dev/null 2>&1; then ss -ltnp | grep 18111 || true; else netstat -ltnp 2>/dev/null | grep 18111 || true; fi");
  console.log('PORT_CHECK', JSON.stringify(checkPort));

  const logTail = await exec('tail -n 120 /opt/.altus/opencode/log/osac.log 2>/dev/null || echo "NO_OSAC_LOG"');
  console.log('OSAC_LOG_TAIL', logTail.stdout);

  const curlModels = await exec('curl -sS -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true');
  console.log('CURL_MODELS', JSON.stringify(curlModels));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
