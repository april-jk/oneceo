import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

type ExecResult = { status: string; exit: number | null; stdout: string; stderr: string };

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(kvmConnector: any, jobId: string) {
  for (let i = 0; i < 240; i++) {
    const job = await kvmConnector.getJob(jobId);
    const status = (job as any)?.data?.status;
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`job timeout: ${jobId}`);
}

async function execInVm(kvmConnector: any, sid: string, command: string, timeoutSeconds = 120): Promise<ExecResult> {
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

  const final = jobId ? await waitJob(kvmConnector, String(jobId)) : result;
  const payload = (final as any)?.data?.result || (final as any)?.data || final || {};
  return {
    status: String((final as any)?.data?.status || payload.status || 'unknown'),
    exit: payload.exitcode ?? payload.exitCode ?? null,
    stdout: String(payload.stdout || payload.output || ''),
    stderr: String(payload.stderr || ''),
  };
}

async function main() {
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const provision = await sandboxAgentProvisionService.provision({
    metadata: { owner: 'codex-test', purpose: 'ws-auth-diagnose' },
    idempotencyKey: `ws-auth-diagnose-${Date.now()}`,
  });

  const sid = provision.sessionId;
  console.log('sessionId=', sid);
  console.log('osacEndpoint=', provision.osacEndpoint);

  const env = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const metadata = (env?.metadata || {}) as Record<string, any>;
  console.log('metadataToken=', String(metadata.osacAuthToken || metadata.osacToken || metadata?.osac?.token || ''));

  const tokenEtc = await execInVm(
    kvmConnector,
    sid,
    "echo '---etc---'; grep '^OSAC_AUTH_TOKEN=' /etc/environment || true; echo '---proc---'; PID=$(pgrep -o osac || true); if [ -n \"$PID\" ]; then tr '\\0' '\\n' < /proc/$PID/environ | grep '^OSAC_AUTH_TOKEN=' || true; else echo NO_OSAC_PID; fi",
    90,
  );
  console.log('vmTokenCheck=', tokenEtc.stdout.replace(/\s+/g, ' ').trim());

  try {
    const handle = await osacConnector.connectForSession(sid);
    console.log('wsConnect=ok');
    const reply = await handle.request(
      { type: 'GET_SESSION_LIST', payload: { maxCount: 1, format: 'json' } },
      (msg: any) => msg.type === 'SESSION_LIST_RESPONSE'
    );
    console.log('sessionListReplyType=', reply.type);

    const localProbeWhileOpen = await execInVm(
      kvmConnector,
      sid,
      'curl -sS -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true',
      60
    );
    console.log('localProbeWhileWsOpen=', localProbeWhileOpen.stdout.replace(/\s+/g, ' ').trim());

    handle.close();

    const localProbeAfterClose = await execInVm(
      kvmConnector,
      sid,
      'curl -sS -m 20 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true',
      60
    );
    console.log('localProbeAfterWsClose=', localProbeAfterClose.stdout.replace(/\s+/g, ' ').trim());
  } catch (error: any) {
    console.log('wsConnect=fail', error?.message || String(error));
  }

  const logTail = await execInVm(kvmConnector, sid, 'tail -n 80 /opt/.altus/opencode/log/osac.log 2>/dev/null || true', 90);
  console.log('osacLogTail=', logTail.stdout.replace(/\s+/g, ' ').trim().slice(0, 5000));

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
