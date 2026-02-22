import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function main() {
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { normalizeOpencodeModel } = await import('../src/utils/opencode-model');

  const normalized = normalizeOpencodeModel(
    process.env.OPENCODE_MODEL,
    process.env.OPENCODE_PROVIDER_ID || 'openai'
  );
  if (!normalized) throw new Error('Invalid OPENCODE_MODEL');

  const provision = await sandboxAgentProvisionService.provision({
    metadata: { owner: 'codex-test', purpose: 'verify-osac-forwarding' },
    idempotencyKey: `verify-forward-${Date.now()}`,
  });

  const sid = provision.sessionId;
  console.log('sessionId=', sid);
  console.log('osacEndpoint=', provision.osacEndpoint);

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function exec(command: string, timeoutSeconds = 180) {
    const result = await kvmConnector.execSession(sid, {
      path: '/bin/bash',
      args: ['-lc', command],
      capture_output: true,
      timeout_seconds: timeoutSeconds,
    });

    const jobId =
      (result as any)?.data?.jobId ||
      (result as any)?.data?.job_id ||
      (result as any)?.jobId ||
      (result as any)?.job_id;

    let final: any = result;
    let finished = !jobId;
    if (jobId) {
      for (let i = 0; i < 240; i++) {
        const job = await kvmConnector.getJob(String(jobId));
        const status = (job as any)?.data?.status;
        if (status && status !== 'queued' && status !== 'running') {
          final = job;
          finished = true;
          break;
        }
        await sleep(1000);
      }
    }

    const payload = (final as any)?.data?.result || (final as any)?.data || final || {};
    return {
      status: String((final as any)?.data?.status || payload.status || 'unknown'),
      exit: payload.exitcode ?? payload.exitCode ?? null,
      stdout: String(payload.stdout || payload.output || ''),
      stderr: String(payload.stderr || ''),
      finished,
    };
  }

  const configCheck = await exec('cat /root/.config/opencode/opencode.json');
  console.log('configStatus=', configCheck.status, 'exit=', configCheck.exit, 'finished=', configCheck.finished);
  console.log('configSnippet=', configCheck.stdout.replace(/\s+/g, ' ').trim().slice(0, 1200));

  let localProxyReady = false;
  for (let i = 0; i < 20; i++) {
    const probe = await exec('curl -sS -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"', 40);
    const probeOut = probe.stdout.replace(/\s+/g, ' ').trim();
    if (probe.exit === 0 && probeOut.includes('"data"')) {
      localProxyReady = true;
      console.log('localProxyProbe=', probeOut.slice(0, 800));
      break;
    }
    await sleep(2000);
  }
  console.log('localProxyReady=', localProxyReady);

  const runCmd = `/opt/.altus/opencode/opencode run --format json --model ${normalized.fullModel} hello`;
  const runResult = await exec(runCmd, 240);
  console.log('runStatus=', runResult.status, 'exit=', runResult.exit, 'finished=', runResult.finished);
  console.log('runStdoutSnippet=', runResult.stdout.replace(/\s+/g, ' ').trim().slice(0, 1200));
  if (runResult.stderr) {
    console.log('runStderrSnippet=', runResult.stderr.replace(/\s+/g, ' ').trim().slice(0, 800));
  }
}

main().catch((error) => {
  console.error('verify-osac-forwarding failed:', error);
  process.exit(1);
});
