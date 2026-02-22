import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  const provision = await sandboxAgentProvisionService.provision({
    metadata: { owner: 'codex-test', purpose: 'bridge-preconnect-check' },
    idempotencyKey: `bridge-preconnect-${Date.now()}`,
  });

  const sid = provision.sessionId;
  console.log('sessionId=', sid);
  console.log('osacEndpoint=', provision.osacEndpoint);

  const exec = async (command: string, timeoutSeconds = 120) => {
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
    if (jobId) {
      for (let i = 0; i < 180; i++) {
        const job = await kvmConnector.getJob(String(jobId));
        const status = (job as any)?.data?.status;
        if (status && status !== 'queued' && status !== 'running') {
          final = job;
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
    };
  };

  const before = await exec('curl -sS -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true', 40);
  console.log('beforeConnect=', JSON.stringify({
    status: before.status,
    exit: before.exit,
    stdout: before.stdout.replace(/\s+/g, ' ').trim(),
    stderr: before.stderr.replace(/\s+/g, ' ').trim(),
  }));

  await osacConnectionManager.getConnection(sid);
  console.log('bridgeConnected= true');

  await sleep(2000);
  const after = await exec('curl -sS -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true', 40);
  console.log('afterConnect=', JSON.stringify({
    status: after.status,
    exit: after.exit,
    stdout: after.stdout.replace(/\s+/g, ' ').trim().slice(0, 1600),
    stderr: after.stderr.replace(/\s+/g, ' ').trim().slice(0, 500),
  }));

  const osacLog = await exec('tail -n 30 /opt/.altus/opencode/log/osac.log 2>/dev/null || true', 40);
  console.log('osacLogTail=', osacLog.stdout.replace(/\s+/g, ' ').trim().slice(0, 3000));

  await osacConnectionManager.close(sid);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
