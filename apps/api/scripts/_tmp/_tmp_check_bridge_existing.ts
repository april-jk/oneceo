import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  console.error('usage: pnpm exec tsx scripts/_tmp_check_bridge_existing.ts <sessionId>');
  process.exit(1);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function execCmd(sessionId: string, command: string, timeoutSeconds = 120) {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const submit: any = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });
  const jobId = submit?.data?.jobId || submit?.data?.job_id || submit?.jobId || submit?.job_id;
  let final: any = submit;
  if (jobId) {
    for (let i = 0; i < 180; i++) {
      const job: any = await kvmConnector.getJob(String(jobId));
      const status = String(job?.data?.status || '').toLowerCase();
      if (status && status !== 'queued' && status !== 'running') {
        final = job;
        break;
      }
      await sleep(1000);
    }
  }
  const payload = final?.data?.result || final?.data || final || {};
  return {
    status: String(final?.data?.status || payload.status || 'unknown'),
    exit: payload.exitcode ?? payload.exitCode ?? null,
    stdout: String(payload.stdout || payload.output || ''),
    stderr: String(payload.stderr || ''),
  };
}

async function probe(sessionId: string, label: string) {
  const res = await execCmd(
    sessionId,
    'curl -sS -m 40 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true',
    80
  );
  console.log(
    JSON.stringify(
      {
        label,
        status: res.status,
        exit: res.exit,
        stdout: res.stdout.slice(0, 1200),
        stderr: res.stderr.slice(0, 400),
      },
      null,
      2
    )
  );
}

async function main() {
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  console.log(`session=${sid}`);
  await probe(sid, 'before_connect');

  await osacConnectionManager.ensurePersistent(sid);
  console.log('ensurePersistent called');

  await sleep(1500);
  await probe(sid, 'after_connect');

  await sleep(5000);
  await probe(sid, 'after_5s');

  await osacConnectionManager.close(sid);
  console.log('connection closed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
