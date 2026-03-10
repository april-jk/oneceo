import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.env.SID;
if (!sid) {
  throw new Error('SID is required');
}

const rounds = Number(process.env.ROUNDS || 20);
const curlTimeoutSeconds = Number(process.env.CURL_TIMEOUT_SECONDS || 60);
const defaultExecTimeoutSeconds = Math.max(300, rounds * (curlTimeoutSeconds * 2 + 5));
const execTimeoutSeconds = Number(process.env.EXEC_TIMEOUT_SECONDS || defaultExecTimeoutSeconds);
const roundIntervalSeconds = Number(process.env.ROUND_INTERVAL_SECONDS || 1);
const execRetryAttempts = Number(process.env.EXEC_RETRY_ATTEMPTS || 3);
const execRetryDelayMs = Number(process.env.EXEC_RETRY_DELAY_MS || 3000);

if (rounds > 5) {
  console.warn(
    `[WARN] ROUNDS=${rounds} may create an oversized exec command in some KVM setups. ` +
      'Recommended: run 5 rounds per batch and repeat batches.'
  );
}

type ExecResult = {
  status: string;
  exit: number | null;
  stdout: string;
  stderr: string;
};

type RoundResult = {
  round: number;
  modelsCode: number;
  modelsOk: boolean;
  chatCode: number;
  chatOk: boolean;
  success: boolean;
};

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function execInVm(command: string, timeoutSeconds: number): Promise<ExecResult> {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= execRetryAttempts; attempt++) {
    try {
      const started = await kvmConnector.execSession(sid!, {
        path: '/bin/bash',
        args: ['-lc', command],
        capture_output: true,
        timeout_seconds: timeoutSeconds,
      });

      const jobId =
        (started as any)?.data?.jobId ||
        (started as any)?.data?.job_id ||
        (started as any)?.jobId ||
        (started as any)?.job_id;

      let final: any = started;
      if (jobId) {
        for (let i = 0; i < timeoutSeconds + 15; i++) {
          const polled = await kvmConnector.getJob(String(jobId));
          const status = (polled as any)?.data?.status;
          if (status && status !== 'queued' && status !== 'running') {
            final = polled;
            break;
          }
          await sleep(1000);
        }
      }

      const payload = (final as any)?.data?.result || (final as any)?.data || final || {};
      return {
        status: (final as any)?.data?.status || payload.status || 'unknown',
        exit: payload.exitcode ?? payload.exitCode ?? null,
        stdout: String(payload.stdout || payload.output || ''),
        stderr: String(payload.stderr || ''),
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRetryable = /rate limit|too many requests|429|temporarily unavailable|暂时不可用|timeout/i.test(
        message
      );
      if (!isRetryable || attempt >= execRetryAttempts) {
        throw error;
      }
      await sleep(execRetryDelayMs * attempt);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}

function buildBatchCommand(payloadBase64: string) {
  return [
    'set -euo pipefail',
    `PAYLOAD_B64='${payloadBase64}'`,
    "echo \"$PAYLOAD_B64\" | base64 -d >/tmp/p.json",
    'PASS=0',
    'FAIL=0',
    `for i in $(seq 1 ${rounds}); do`,
    '  MODELS_BODY="/tmp/osac_models_${i}.json"',
    '  CHAT_BODY="/tmp/osac_chat_${i}.json"',
    `  MODELS_CODE=$(curl -sS -o "$MODELS_BODY" -w "%{http_code}" -m ${curlTimeoutSeconds} http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy")`,
    `  CHAT_CODE=$(curl -sS -o "$CHAT_BODY" -w "%{http_code}" -m ${curlTimeoutSeconds} http://127.0.0.1:18111/v1/chat/completions -H "Authorization: Bearer local-proxy" -H "Content-Type: application/json" --data-binary @/tmp/p.json)`,
    '  MODELS_OK=0',
    '  CHAT_OK=0',
    '  grep -q \'"object":"list"\' "$MODELS_BODY" && MODELS_OK=1 || true',
    '  grep -q \'"content":"OK"\' "$CHAT_BODY" && CHAT_OK=1 || true',
    '  echo "ROUND=$i MODELS_CODE=$MODELS_CODE MODELS_OK=$MODELS_OK CHAT_CODE=$CHAT_CODE CHAT_OK=$CHAT_OK"',
    '  if [ "$MODELS_CODE" = "200" ] && [ "$MODELS_OK" = "1" ] && [ "$CHAT_CODE" = "200" ] && [ "$CHAT_OK" = "1" ]; then',
    '    PASS=$((PASS + 1))',
    '  else',
    '    FAIL=$((FAIL + 1))',
    '    echo "ROUND_FAIL=$i"',
    '    echo -n "MODELS_FAIL_BODY="',
    '    tr "\\n" " " <"$MODELS_BODY" | head -c 350',
    '    echo',
    '    echo -n "CHAT_FAIL_BODY="',
    '    tr "\\n" " " <"$CHAT_BODY" | head -c 350',
    '    echo',
    '  fi',
    `  sleep ${roundIntervalSeconds}`,
    'done',
    `echo "SUMMARY PASS=$PASS FAIL=$FAIL ROUNDS=${rounds}"`,
    'if [ "$FAIL" -gt 0 ]; then exit 12; fi',
  ].join('\n');
}

function parseRoundLines(stdout: string): RoundResult[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('ROUND='));

  return lines
    .map((line) => {
      const match = line.match(
        /ROUND=(\d+)\s+MODELS_CODE=(\d+)\s+MODELS_OK=(\d+)\s+CHAT_CODE=(\d+)\s+CHAT_OK=(\d+)/
      );
      if (!match) return null;
      const modelsCode = toNumber(match[2], 0);
      const chatCode = toNumber(match[4], 0);
      const modelsOk = match[3] === '1';
      const chatOk = match[5] === '1';
      return {
        round: toNumber(match[1], 0),
        modelsCode,
        modelsOk,
        chatCode,
        chatOk,
        success: modelsCode === 200 && modelsOk && chatCode === 200 && chatOk,
      };
    })
    .filter((item): item is RoundResult => item !== null);
}

async function main() {
  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'reply with OK only' }],
    stream: false,
  });
  const payloadBase64 = Buffer.from(payload, 'utf8').toString('base64');

  const startedAt = new Date().toISOString();
  const command = buildBatchCommand(payloadBase64);
  const execResult = await execInVm(command, execTimeoutSeconds);
  const results = parseRoundLines(execResult.stdout);
  for (const item of results) {
    console.log(JSON.stringify(item));
  }

  const failed = results.filter((item) => !item.success);
  const summaryLine = execResult.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith('SUMMARY '));
  const summary = {
    sessionId: sid,
    rounds,
    curlTimeoutSeconds,
    execTimeoutSeconds,
    startedAt,
    finishedAt: new Date().toISOString(),
    passedRounds: results.length - failed.length,
    failedRounds: failed.length,
    vmSummary: summaryLine || null,
    execStatus: execResult.status,
    execExit: execResult.exit,
  };

  console.log(JSON.stringify({ summary }, null, 2));

  if (failed.length > 0 || execResult.exit !== 0) {
    console.error(
      JSON.stringify(
        {
          failedRounds: failed,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
