import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2] || process.env.SID || '';
if (!sid) {
  console.error('Usage: pnpm exec tsx scripts/_tmp_probe_llm_proxy.ts <sessionId>');
  process.exit(1);
}

const model = process.env.OPENCODE_MODEL || 'claude-haiku-4-5-20251001';

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
  if (!jobId) {
    const payload = submit?.data?.result || submit?.data || submit || {};
    return {
      status: String(submit?.data?.status || payload.status || 'unknown'),
      exit: payload.exitcode ?? payload.exitCode ?? null,
      stdout: String(payload.stdout || payload.output || ''),
      stderr: String(payload.stderr || ''),
    };
  }

  const start = Date.now();
  while (Date.now() - start < 240_000) {
    const job: any = await kvmConnector.getJob(String(jobId));
    const status = String(job?.data?.status || '').toLowerCase();
    if (status && status !== 'queued' && status !== 'running') {
      const payload = job?.data?.result || job?.data || {};
      return {
        status,
        exit: payload.exitcode ?? payload.exitCode ?? null,
        stdout: String(payload.stdout || payload.output || ''),
        stderr: String(payload.stderr || ''),
      };
    }
    await sleep(1000);
  }
  throw new Error(`job poll timeout: ${jobId}`);
}

async function main() {
  const models = await execCmd(
    sid,
    'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"',
    90
  );
  console.log(
    'MODELS=',
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

  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply ONLY: sandbox_proxy_ok' }],
    max_tokens: 24,
  });
  const escapedPayload = payload.replace(/'/g, "'\\''");
  const chat = await execCmd(
    sid,
    `curl -sS -m 70 http://127.0.0.1:18111/v1/chat/completions -H "Authorization: Bearer local-proxy" -H "Content-Type: application/json" -d '${escapedPayload}'`,
    110
  );
  console.log(
    'CHAT=',
    JSON.stringify(
      {
        status: chat.status,
        exit: chat.exit,
        stdout: chat.stdout.slice(0, 1400),
        stderr: chat.stderr.slice(0, 400),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('ERR=', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

