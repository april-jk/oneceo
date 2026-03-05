import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncate(value: string, max = 1500): string {
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
  const sid = process.env.SID;
  if (!sid) {
    throw new Error('SID is required');
  }

  const connectTimeoutMs = Number(process.env.WS_SMOKE_CONNECT_TIMEOUT_MS || 60_000);
  const commandTimeoutMs = Number(process.env.WS_SMOKE_COMMAND_TIMEOUT_MS || 6 * 60 * 1000);
  const pollMs = Number(process.env.WS_SMOKE_POLL_MS || 1500);
  const model = process.env.OPENCODE_MODEL || '';
  const provider = process.env.OPENCODE_PROVIDER_ID || 'openai';

  const { normalizeOpencodeModel } = await import('../src/utils/opencode-model');
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');
  const { osacAgentService } = await import('../src/services/osac-agent-service');

  const normalized = normalizeOpencodeModel(model, provider);
  if (!normalized?.fullModel) {
    throw new Error('OPENCODE_MODEL invalid or missing');
  }

  const connected = await withTimeout(
    'ws-connect',
    connectTimeoutMs,
    osacConnectionManager.ensurePersistent(sid)
  );
  if (!connected) {
    throw new Error('ensurePersistent returned false');
  }

  const probe = await withTimeout(
    'models-probe',
    commandTimeoutMs,
    osacAgentService.executeCommandAndWait(
      sid,
      {
        command: 'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"',
        options: {},
      },
      { timeoutMs: commandTimeoutMs, pollMs }
    )
  );

  console.log(
    JSON.stringify(
      {
        stage: 'proxy-models-probe',
        status: probe.status,
        output: truncate(probe.output, 1200),
      },
      null,
      2
    )
  );

  const probeOutput = (probe.output || '').toLowerCase();
  if (!probeOutput.includes('"data"')) {
    throw new Error('proxy models probe output missing data');
  }

  const prompt =
    '请在当前目录创建 main.py，内容为最小程序：打印 warm-pool-smoke-ok。完成后执行 python3 main.py 并输出结果。';
  const runCommand =
    'set -e;' +
    'mkdir -p /tmp/warm_pool_ws_smoke && cd /tmp/warm_pool_ws_smoke;' +
    `/usr/bin/timeout 240 /opt/.altus/opencode/opencode run --format json -m ${shellQuote(normalized.fullModel)} ${shellQuote(prompt)};` +
    'if [ -f main.py ]; then python3 main.py; else echo "__NO_MAIN_PY__"; fi';

  const run = await withTimeout(
    'opencode-run',
    commandTimeoutMs,
    osacAgentService.executeCommandAndWait(
      sid,
      {
        command: runCommand,
        options: {},
      },
      { timeoutMs: commandTimeoutMs, pollMs }
    )
  );

  console.log(
    JSON.stringify(
      {
        stage: 'opencode-run',
        status: run.status,
        output: truncate(run.output, 2500),
      },
      null,
      2
    )
  );

  const verify = await withTimeout(
    'verify-main',
    commandTimeoutMs,
    osacAgentService.executeCommandAndWait(
      sid,
      {
        command:
          'if [ -f /tmp/warm_pool_ws_smoke/main.py ]; then python3 /tmp/warm_pool_ws_smoke/main.py; else echo "__NO_MAIN_PY__"; fi',
        options: {},
      },
      { timeoutMs: commandTimeoutMs, pollMs }
    )
  );

  const verifyOutput = (verify.output || '').toLowerCase();
  const ok = verify.status === 'completed' && verifyOutput.includes('warm-pool-smoke-ok');

  console.log(
    JSON.stringify(
      {
        stage: 'verify-main',
        status: verify.status,
        output: truncate(verify.output, 300),
        ok,
      },
      null,
      2
    )
  );

  if (!ok) {
    throw new Error('verify output mismatch');
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        sessionId: sid,
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

