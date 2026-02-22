import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) {
  console.error('usage: pnpm exec tsx scripts/_tmp_bridge_with_handler.ts <sessionId>');
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
    for (let i = 0; i < 240; i++) {
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

async function main() {
  const { osacLlmProxyBridgeService } = await import('../src/services/osac-llm-proxy-bridge');
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  osacLlmProxyBridgeService.initialize();
  await osacConnectionManager.ensurePersistent(sid);
  await sleep(1500);

  const models = await execCmd(
    sid,
    'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true',
    90
  );

  console.log(
    JSON.stringify(
      {
        status: models.status,
        exit: models.exit,
        stdout: models.stdout.slice(0, 1200),
        stderr: models.stderr.slice(0, 400),
      },
      null,
      2
    )
  );

  await osacConnectionManager.close(sid);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
