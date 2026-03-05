import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncate(value: string, max = 1000): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function withTimeout<T>(label: string, ms: number, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  process.env.OSAC_BINARY_PATH =
    process.env.OSAC_BINARY_PATH || '../../others/osac-linux/osac-linux-amd64_v1.1.2.fix10p4_debug';

  const warmWaitMs = Number(process.env.WARM_POOL_WAIT_MS || 10 * 60 * 1000);
  const warmPollMs = Number(process.env.WARM_POOL_POLL_MS || 15_000);
  const stageTimeoutMs = Number(process.env.WARM_POOL_STAGE_TIMEOUT_MS || 90_000);
  const execPollTimeoutMs = Number(process.env.WARM_POOL_EXEC_POLL_TIMEOUT_MS || 5 * 60 * 1000);
  const opencodeTimeoutSec = Number(process.env.WARM_POOL_OPENCODE_TIMEOUT_SEC || 240);

  const { normalizeOpencodeModel } = await import('../src/utils/opencode-model');
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  const normalized = normalizeOpencodeModel(
    process.env.OPENCODE_MODEL,
    process.env.OPENCODE_PROVIDER_ID || 'openai'
  );
  if (!normalized?.fullModel) {
    throw new Error('OPENCODE_MODEL invalid or missing');
  }

  async function execInVm(sessionId: string, command: string, timeoutSeconds = 120) {
    const submit = await withTimeout(
      'exec-submit',
      stageTimeoutMs,
      kvmConnector.execSession(sessionId, {
        path: '/bin/bash',
        args: ['-lc', command],
        capture_output: true,
        timeout_seconds: timeoutSeconds,
      })
    );

    const jobId =
      (submit as any)?.data?.jobId ||
      (submit as any)?.data?.job_id ||
      (submit as any)?.jobId ||
      (submit as any)?.job_id;

    if (!jobId) {
      const payload = (submit as any)?.data?.result || (submit as any)?.data || submit || {};
      return {
        status: String((submit as any)?.data?.status || payload.status || 'unknown'),
        exit: payload.exitcode ?? payload.exitCode ?? null,
        stdout: String(payload.stdout || payload.output || ''),
        stderr: String(payload.stderr || ''),
      };
    }

    const start = Date.now();
    while (Date.now() - start < execPollTimeoutMs) {
      const job = await withTimeout('job-poll', stageTimeoutMs, kvmConnector.getJob(String(jobId)));
      const status = String((job as any)?.data?.status || '').toLowerCase();
      if (status && status !== 'queued' && status !== 'running') {
        const payload = (job as any)?.data?.result || (job as any)?.data || {};
        return {
          status,
          exit: payload.exitcode ?? payload.exitCode ?? null,
          stdout: String(payload.stdout || payload.output || ''),
          stderr: String(payload.stderr || ''),
        };
      }
      await sleep(1000);
    }

    throw new Error(`job ${jobId} poll timeout`);
  }

  const waitStart = Date.now();
  let warmStatus: any = null;
  while (Date.now() - waitStart < warmWaitMs) {
    warmStatus = await withTimeout(
      'warm-pool-status',
      stageTimeoutMs,
      sandboxAgentProvisionService.getWarmPoolStatus()
    );
    console.log(
      `[warm-pool] available=${warmStatus.availableCount} using=${warmStatus.usingCount} seeding=${warmStatus.seedingCount} inFlight=${warmStatus.inFlight}`
    );
    if (warmStatus.availableCount > 0 && Array.isArray(warmStatus.readyQueue) && warmStatus.readyQueue.length > 0) {
      break;
    }
    await sleep(warmPollMs);
  }

  if (!warmStatus || warmStatus.availableCount <= 0) {
    throw new Error('warm pool has no ready sandbox within wait budget');
  }

  const provision = await withTimeout(
    'provision-claim',
    stageTimeoutMs * 2,
    sandboxAgentProvisionService.provision({
      metadata: {
        owner: 'codex-test',
        purpose: 'warm-pool-opencode-smoke',
        smokeAt: new Date().toISOString(),
      },
      requestBaseUrl: 'http://127.0.0.1:4000',
    })
  );

  console.log(
    JSON.stringify(
      {
        sessionId: provision.sessionId,
        warmPoolHit: provision.warmPoolHit === true,
        sandboxStatus: provision.sandboxStatus || null,
        osacEndpoint: provision.osacEndpoint || null,
      },
      null,
      2
    )
  );

  if (provision.warmPoolHit !== true) {
    throw new Error('provision did not claim from warm pool');
  }

  const sid = provision.sessionId;

  const modelProbe = await execInVm(
    sid,
    'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"',
    80
  );
  console.log(
    JSON.stringify(
      {
        stage: 'proxy-models-probe',
        status: modelProbe.status,
        exit: modelProbe.exit,
        stdout: truncate(modelProbe.stdout, 800),
        stderr: truncate(modelProbe.stderr, 500),
      },
      null,
      2
    )
  );
  if ((modelProbe.exit ?? 1) !== 0 || !modelProbe.stdout.includes('"data"')) {
    throw new Error('local proxy /v1/models probe failed');
  }

  const prompt =
    '请在当前目录创建 main.py，内容为一个最小程序：打印 warm-pool-smoke-ok。完成后执行 python3 main.py 并输出结果。';
  const opencodeCmd =
    'set -e;' +
    'mkdir -p /tmp/warm_pool_smoke && cd /tmp/warm_pool_smoke;' +
    `/usr/bin/timeout ${Math.max(30, opencodeTimeoutSec)} /opt/.altus/opencode/opencode run --format json -m ${shellQuote(normalized.fullModel)} ${shellQuote(prompt)};` +
    'if [ -f main.py ]; then python3 main.py; else echo "__NO_MAIN_PY__"; fi';

  const opencodeRun = await execInVm(sid, opencodeCmd, opencodeTimeoutSec + 90);
  console.log(
    JSON.stringify(
      {
        stage: 'opencode-run',
        status: opencodeRun.status,
        exit: opencodeRun.exit,
        stdout: truncate(opencodeRun.stdout, 2000),
        stderr: truncate(opencodeRun.stderr, 1000),
      },
      null,
      2
    )
  );

  const verify = await execInVm(
    sid,
    'if [ -f /tmp/warm_pool_smoke/main.py ]; then python3 /tmp/warm_pool_smoke/main.py; else echo "__NO_MAIN_PY__"; fi',
    40
  );

  const verifyStdout = (verify.stdout || '').toLowerCase();
  const ok = (verify.exit ?? 1) === 0 && verifyStdout.includes('warm-pool-smoke-ok');
  console.log(
    JSON.stringify(
      {
        stage: 'verify-main-py',
        status: verify.status,
        exit: verify.exit,
        stdout: truncate(verify.stdout, 300),
        stderr: truncate(verify.stderr, 300),
        ok,
      },
      null,
      2
    )
  );

  if (!ok) {
    throw new Error('opencode smoke output mismatch');
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        sessionId: sid,
        warmPoolHit: true,
        model: normalized.fullModel,
        output: 'warm-pool-smoke-ok',
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      )
    );
    process.exit(1);
  });

