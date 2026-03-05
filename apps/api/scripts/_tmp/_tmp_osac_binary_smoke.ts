import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

type ExecSummary = {
  status: string;
  exit: number | null;
  stdout: string;
  stderr: string;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitJob(kvmConnector: any, jobId: string, maxSeconds: number): Promise<any> {
  for (let i = 0; i < maxSeconds; i++) {
    const job = await withTimeout(kvmConnector.getJob(jobId), 15000, 'get-job');
    const status = (job as any)?.data?.status;
    if (status && status !== 'queued' && status !== 'running') {
      return job;
    }
    await sleep(1000);
  }
  throw new Error(`job timeout after ${maxSeconds}s: ${jobId}`);
}

async function execInVm(
  kvmConnector: any,
  sid: string,
  command: string,
  timeoutSeconds = 75
): Promise<ExecSummary> {
  const start = await withTimeout(
    kvmConnector.execSession(sid, {
      path: '/bin/bash',
      args: ['-lc', command],
      capture_output: true,
      timeout_seconds: timeoutSeconds,
    }),
    20000,
    'exec-start'
  );

  const jobId =
    (start as any)?.data?.jobId ||
    (start as any)?.data?.job_id ||
    (start as any)?.jobId ||
    (start as any)?.job_id;
  const final = jobId ? await waitJob(kvmConnector, String(jobId), timeoutSeconds + 15) : start;
  const payload = (final as any)?.data?.result || (final as any)?.data || final || {};
  return {
    status: String((final as any)?.data?.status || payload.status || 'unknown'),
    exit: payload.exitcode ?? payload.exitCode ?? null,
    stdout: String(payload.stdout || payload.output || ''),
    stderr: String(payload.stderr || ''),
  };
}

async function main() {
  const binaryPathArg = process.argv[2];
  if (!binaryPathArg) {
    throw new Error('Usage: pnpm exec tsx scripts/_tmp_osac_binary_smoke.ts <OSAC_BINARY_PATH>');
  }

  process.env.OSAC_BINARY_PATH = binaryPathArg;
  process.env.LLM_PROXY_TIMEOUT_MS = '60000';
  process.env.OSAC_LLM_PROXY_TIMEOUT_MS = '60000';

  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  const startedAt = Date.now();
  const provision = await withTimeout(
    sandboxAgentProvisionService.provision({
      metadata: {
        owner: 'codex-test',
        purpose: `binary-smoke-${binaryPathArg}`,
      },
      idempotencyKey: `binary-smoke-${Date.now()}`,
    }),
    240000,
    'provision'
  );

  const sid = provision.sessionId;
  const metadata = await sandboxExecutionEnvironmentDAO.getBySessionId(sid);
  const md = (metadata?.metadata || {}) as Record<string, unknown>;
  const token = String(md.osacAuthToken || '');

  let wsConnectError = '';
  let wsConnected = false;
  let sessionListType = '';
  let handle: any = null;

  for (let i = 1; i <= 4; i++) {
    try {
      handle = await withTimeout(osacConnector.connectForSession(sid), 12000, `ws-connect-${i}`);
      wsConnected = true;
      const reply = await withTimeout(
        handle.request(
          {
            type: 'GET_SESSION_LIST',
            payload: { maxCount: 1, format: 'json' },
          },
          (msg: any) => msg.type === 'SESSION_LIST_RESPONSE'
        ),
        15000,
        'get-session-list'
      );
      sessionListType = String(reply?.type || '');
      break;
    } catch (error: any) {
      wsConnectError = error?.message || String(error);
      await sleep(1500);
    }
  }

  const modelsProbe = await execInVm(
    kvmConnector,
    sid,
    'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy" || true',
    80
  );

  const osacLog = await execInVm(
    kvmConnector,
    sid,
    'tail -n 80 /opt/.altus/opencode/log/osac.log 2>/dev/null || true',
    30
  );

  if (handle) {
    try {
      handle.close();
    } catch {
      // ignore
    }
  }
  try {
    await osacConnectionManager.close(sid);
  } catch {
    // ignore
  }

  const summary = {
    binaryPath: binaryPathArg,
    durationSec: Math.floor((Date.now() - startedAt) / 1000),
    sessionId: sid,
    osacEndpoint: provision.osacEndpoint,
    vmIpAddress: provision.vmIpAddress,
    metadataVmIpAddress: md.vmIpAddress || null,
    tokenLength: token.length,
    wsConnected,
    wsConnectError: wsConnected ? null : wsConnectError || 'unknown',
    sessionListType: sessionListType || null,
    modelsProbe: {
      status: modelsProbe.status,
      exit: modelsProbe.exit,
      stdout: modelsProbe.stdout.replace(/\s+/g, ' ').trim().slice(0, 1200),
      stderr: modelsProbe.stderr.replace(/\s+/g, ' ').trim().slice(0, 300),
    },
    osacLogTail: osacLog.stdout.replace(/\s+/g, ' ').trim().slice(0, 3000),
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error('binary-smoke failed:', error?.message || String(error));
  process.exit(1);
});
