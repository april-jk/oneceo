import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });

type ExecOutcome = {
  status: string;
  exit: number | null;
  stdout: string;
  stderr: string;
  errorCode: string | null;
  errorMessage: string | null;
  jobId: string | null;
};

type RoundResult = {
  round: number;
  ok: boolean;
  status: string;
  exit: number | null;
  durationMs: number;
  timedOut: boolean;
  guestAgentRecovered: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  stdoutSnippet: string;
  stderrSnippet: string;
};

type ProxyPrecheckResult = {
  ok: boolean;
  status: string;
  exit: number | null;
  errorCode: string | null;
  retryAfterMs: number | null;
  errorMessage: string | null;
  stdoutSnippet: string;
  stderrSnippet: string;
};

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveBridgeBaseUrlFromEnv(): string | null {
  const explicit = (process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL || '').trim();
  if (!explicit) return null;
  return explicit.replace(/\/+$/, '');
}

function resolveLocalProxyToken(): string {
  return (process.env.OSAC_LLM_PROXY_TOKEN || ['local', 'proxy'].join('-')).trim();
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  const bounded = Math.max(1000, timeoutMs);
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout (${bounded}ms)`));
    }, bounded);
    fn()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isTimeoutLike(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted|超时/i.test(message);
}

function isTokenMismatchLike(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /token_mismatch/i.test(message);
}

function isGuestAgentUnavailable(outcome: ExecOutcome): boolean {
  const text = `${outcome.errorMessage || ''}\n${outcome.stderr}`.toLowerCase();
  return (
    text.includes('guest agent is not responding') ||
    text.includes('qemu guest agent is not available')
  );
}

function looksOk(output: string): boolean {
  if (!output) return false;
  return /"text":"OK"/.test(output) || /\bOK\b/.test(output);
}

function extractErrorCode(text: string): string | null {
  if (!text) return null;
  const match = text.match(/"code"\s*:\s*"([^"]+)"/i);
  if (match?.[1]) return match[1];
  return null;
}

function extractRetryAfterMs(text: string): number | null {
  if (!text) return null;
  const match = text.match(/"retryAfterMs"\s*:\s*([0-9]+)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function isRetryableProxyError(code: string | null): boolean {
  if (!code) return false;
  return [
    'bridge_disconnected',
    'bridge_no_ack',
    'bridge_not_ready',
    'mapping_not_ready',
    'mapping_stale',
    'bridge_backpressure',
    'upstream_timeout_first_byte',
  ].includes(code);
}

function isCircuitOpenPrecheckFailure(precheck: ProxyPrecheckResult | null): boolean {
  if (!precheck || precheck.ok) return false;
  if (precheck.errorCode !== 'bridge_disconnected') return false;
  const text = `${precheck.errorMessage || ''}\n${precheck.stdoutSnippet}\n${precheck.stderrSnippet}`;
  return /circuit_open|circuit open/i.test(text);
}

function pickSnippet(text: string, max: number): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max);
}

async function provisionSessionWithRetry(
  sandboxAgentProvisionService: any,
  attempts: number,
  delayMs: number
): Promise<{ sessionId: string }> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await sandboxAgentProvisionService.provision({
        metadata: { owner: 'codex-test', purpose: 'opencode-regression' },
        idempotencyKey: `opencode-regression-${Date.now()}-${i + 1}`,
      });
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Provision failed');
}

async function waitForSandboxReady(
  kvmConnector: any,
  sessionId: string,
  maxAttempts: number,
  delayMs: number
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const sandbox = await kvmConnector.getSandbox(sessionId);
    const state = String((sandbox as any)?.data?.state || '').toLowerCase();

    let vmPortReady = false;
    let hostPortReady = false;
    try {
      const ports = await kvmConnector.listSandboxPorts(sessionId, {
        refresh: 'true',
        verify: 'true',
        wait_seconds: '5',
      } as any);
      const first = (ports as any)?.data?.items?.[0] || null;
      vmPortReady = Boolean(first?.vmPortReady);
      hostPortReady = Boolean(first?.hostPortReady);
    } catch {
      vmPortReady = false;
      hostPortReady = false;
    }

    if (state === 'running' && vmPortReady && hostPortReady) {
      return;
    }

    if (i < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }

  throw new Error('Sandbox/port mapping not ready in time');
}

async function ensureSandboxRunningAndReady(
  kvmConnector: any,
  sessionId: string,
  readyAttempts: number,
  readyDelayMs: number
): Promise<void> {
  const sandbox = await kvmConnector.getSandbox(sessionId);
  const state = String((sandbox as any)?.data?.state || '').toLowerCase();

  if (state !== 'running') {
    await kvmConnector.restartSandbox(sessionId, { graceful: false, wait: true } as any);
  }

  await waitForSandboxReady(kvmConnector, sessionId, readyAttempts, readyDelayMs);
}

async function waitForWsReady(
  osacConnectionManager: any,
  sessionId: string,
  attempts: number,
  delayMs: number,
  probeMode: 'ping' | 'request' | 'open',
  pingTimeoutMs: number,
  connectAcquireTimeoutMs: number
): Promise<void> {
  let lastError: unknown = null;
  const acquireTimeoutMs = Math.max(2000, connectAcquireTimeoutMs);
  for (let i = 0; i < attempts; i++) {
    try {
      const ready = await osacConnectionManager.ensurePersistent(sessionId);
      if (!ready) {
        throw new Error('OSAC persistent bridge not ready');
      }

      if (probeMode === 'request') {
        await osacConnectionManager.request(
          sessionId,
          { type: 'GET_SESSION_LIST', payload: { maxCount: 1, format: 'json' } },
          (msg: any) => msg.type === 'SESSION_LIST_RESPONSE',
          { connectAcquireTimeoutMs: acquireTimeoutMs }
        );
      } else if (probeMode === 'ping') {
        const entry = await osacConnectionManager.getConnection(sessionId, {
          connectAcquireTimeoutMs: acquireTimeoutMs,
        });
        await entry.handle.ping(pingTimeoutMs);
      } else {
        const entry = await osacConnectionManager.getConnection(sessionId, {
          connectAcquireTimeoutMs: acquireTimeoutMs,
        });
        if (!entry?.handle?.isOpen?.()) {
          throw new Error('OSAC persistent bridge open probe failed');
        }
      }
      return;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(message || 'OSAC bridge probe failed');
}

async function execInVm(
  kvmConnector: any,
  sessionId: string,
  command: string,
  timeoutSeconds: number,
  pollTimeoutMs: number,
  pollIntervalMs: number
): Promise<ExecOutcome> {
  const started = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', command],
    capture_output: true,
    timeout_seconds: timeoutSeconds,
  });

  const jobId =
    (started as any)?.data?.jobId ||
    (started as any)?.data?.job_id ||
    (started as any)?.jobId ||
    (started as any)?.job_id ||
    null;

  let finalPayload: any = (started as any)?.data || started || {};

  if (jobId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < pollTimeoutMs) {
      const polled = await kvmConnector.getJob(String(jobId));
      const data = (polled as any)?.data || {};
      const status = String(data?.status || '').toLowerCase();
      if (status && status !== 'queued' && status !== 'running') {
        finalPayload = data;
        break;
      }
      await sleep(pollIntervalMs);
    }
  }

  const result = finalPayload?.result || {};
  const error = finalPayload?.error || null;

  return {
    status: String(finalPayload?.status || result?.status || 'unknown'),
    exit: result?.exitcode ?? result?.exitCode ?? null,
    stdout: String(result?.stdout || result?.output || ''),
    stderr: String(result?.stderr || ''),
    errorCode: error?.code || null,
    errorMessage:
      error?.details?.stderr ||
      error?.details?.reason ||
      error?.message ||
      null,
    jobId: jobId ? String(jobId) : null,
  };
}

async function recoverGuestAgent(
  kvmConnector: any,
  sessionId: string,
  readyAttempts: number,
  readyDelayMs: number
): Promise<void> {
  await kvmConnector.restartSandbox(sessionId, { graceful: false, wait: true } as any);
  await waitForSandboxReady(kvmConnector, sessionId, readyAttempts, readyDelayMs);
}

async function precheckLlmProxy(
  kvmConnector: any,
  sessionId: string,
  timeoutSeconds: number,
  execTimeoutMs: number,
  pollTimeoutMs: number,
  pollIntervalMs: number
): Promise<ProxyPrecheckResult> {
  const proxyCommand = [
    '/usr/bin/curl',
    '-sS',
    '--max-time',
    String(Math.max(5, timeoutSeconds)),
    '-H',
    shellQuote(`Authorization: Bearer ${resolveLocalProxyToken()}`),
    'http://127.0.0.1:18111/v1/models',
  ].join(' ');

  const outcome = await withTimeout('proxy-precheck', execTimeoutMs, async () =>
    execInVm(kvmConnector, sessionId, proxyCommand, Math.max(5, timeoutSeconds + 5), pollTimeoutMs, pollIntervalMs)
  );

  const stdoutSnippet = pickSnippet(outcome.stdout, 300);
  const stderrSnippet = pickSnippet(outcome.stderr, 220);
  const errorCode =
    extractErrorCode(outcome.stdout) ||
    extractErrorCode(outcome.stderr) ||
    outcome.errorCode ||
    null;
  const retryAfterMs =
    extractRetryAfterMs(outcome.stdout) ||
    extractRetryAfterMs(outcome.stderr);
  const errorMessage = outcome.errorMessage || null;
  const ok =
    outcome.status === 'completed' &&
    outcome.exit === 0 &&
    !errorCode &&
    /"data"\s*:\s*\[/i.test(outcome.stdout);

  return {
    ok,
    status: outcome.status,
    exit: outcome.exit,
    errorCode,
    retryAfterMs,
    errorMessage,
    stdoutSnippet,
    stderrSnippet,
  };
}

type LocalBridgeServer = {
  started: boolean;
  baseUrl: string;
  close: () => Promise<void>;
};

async function ensureLocalBridgeServer(
  desiredPort: number
): Promise<LocalBridgeServer> {
  const port = Math.max(1, Math.floor(desiredPort));
  const baseUrl = `http://127.0.0.1:${port}/api/llm-proxy`;

  try {
    const probeController = new AbortController();
    const timer = setTimeout(() => probeController.abort(), 800);
    const probe = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: probeController.signal,
    });
    clearTimeout(timer);
    if (probe.ok) {
      return {
        started: false,
        baseUrl,
        close: async () => {},
      };
    }
  } catch {
    // ignore probe errors and try to start local bridge server
  }

  const express = (await import('express')).default;
  const llmProxyRoutes = (await import('../src/routes/llm-proxy-routes')).default;
  const app = express();
  app.use('/api/llm-proxy', express.raw({ type: '*/*' }), llmProxyRoutes);

  const server = await new Promise<any>((resolve, reject) => {
    const instance = app.listen(port, '127.0.0.1');
    instance.once('listening', () => resolve(instance));
    instance.once('error', (error: any) => reject(error));
  });

  return {
    started: true,
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const disableOsacHealthcheck = toBool(process.env.DISABLE_OSAC_HEALTHCHECK, true);
  if (disableOsacHealthcheck) {
    process.env.OSAC_PERSISTENT_HEALTHCHECK_MS = '0';
    process.env.OSAC_HEALTHCHECK_MODE = 'request';
  }

  const configuredBridgeBaseUrl = resolveBridgeBaseUrlFromEnv();
  const localBridgePort = Math.max(1, toNumber(process.env.OSAC_REGRESSION_BRIDGE_PORT, toNumber(process.env.PORT, 4000)));
  let localBridgeServer: LocalBridgeServer | null = null;
  if (configuredBridgeBaseUrl) {
    process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL = configuredBridgeBaseUrl;
  } else {
    localBridgeServer = await ensureLocalBridgeServer(localBridgePort);
    process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL = localBridgeServer.baseUrl;
  }

  const rounds = toNumber(process.env.ROUNDS, 10);
  const roundIntervalMs = toNumber(process.env.ROUND_INTERVAL_MS, 1500);
  const commandTimeoutSeconds = toNumber(process.env.COMMAND_TIMEOUT_SECONDS, 60);
  const execTimeoutSeconds = toNumber(process.env.EXEC_TIMEOUT_SECONDS, 90);
  const pollTimeoutMs = toNumber(process.env.JOB_POLL_TIMEOUT_MS, 120000);
  const pollIntervalMs = toNumber(process.env.JOB_POLL_INTERVAL_MS, 1000);
  const readyAttempts = toNumber(process.env.READY_ATTEMPTS, 25);
  const readyDelayMs = toNumber(process.env.READY_DELAY_MS, 3000);
  const provisionAttempts = toNumber(process.env.PROVISION_ATTEMPTS, 3);
  const provisionDelayMs = toNumber(process.env.PROVISION_DELAY_MS, 4000);
  const wsReadyAttempts = toNumber(process.env.WS_READY_ATTEMPTS, 8);
  const wsReadyDelayMs = toNumber(process.env.WS_READY_DELAY_MS, 3000);
  const wsProbeModeRaw = (process.env.WS_PROBE_MODE || 'ping').trim().toLowerCase();
  const wsProbeMode = (
    wsProbeModeRaw === 'request' ? 'request' :
      wsProbeModeRaw === 'open' ? 'open' :
        'ping'
  ) as 'ping' | 'request' | 'open';
  const wsPingTimeoutMs = Math.max(1000, toNumber(process.env.WS_PING_TIMEOUT_MS, 15000));
  const wsConnectAcquireTimeoutMs = Math.max(
    2000,
    toNumber(process.env.WS_CONNECT_ACQUIRE_TIMEOUT_MS, Math.max(30_000, wsPingTimeoutMs + 2000))
  );
  const restartOnGuestAgentError = toBool(process.env.RESTART_ON_GA_ERROR, true);
  const maxConsecutiveFailures = Math.max(1, toNumber(process.env.MAX_CONSECUTIVE_FAILURES, 3));
  const maxFailures = Math.max(1, toNumber(process.env.MAX_FAILURES, Math.ceil(rounds * 0.5)));
  const totalBudgetMs = Math.max(60_000, toNumber(process.env.TOTAL_BUDGET_MS, 30 * 60 * 1000));
  const provisionStageTimeoutMs = Math.max(30_000, toNumber(process.env.PROVISION_STAGE_TIMEOUT_MS, 180_000));
  const readyStageTimeoutMs = Math.max(30_000, toNumber(process.env.READY_STAGE_TIMEOUT_MS, 180_000));
  const wsReadyStageTimeoutMs = Math.max(10_000, toNumber(process.env.WS_STAGE_TIMEOUT_MS, 90_000));
  const recoverStageTimeoutMs = Math.max(30_000, toNumber(process.env.RECOVER_STAGE_TIMEOUT_MS, 180_000));
  const roundExecTimeoutMs = Math.max(
    30_000,
    toNumber(process.env.ROUND_EXEC_TIMEOUT_MS, Math.max((execTimeoutSeconds + 30) * 1000, 120_000))
  );
  const enableProxyPrecheck = toBool(process.env.ENABLE_PROXY_PRECHECK, true);
  const proxyPrecheckTimeoutSeconds = Math.max(
    5,
    toNumber(process.env.PROXY_PRECHECK_TIMEOUT_SECONDS, 20)
  );
  const proxyPrecheckExecTimeoutMs = Math.max(
    8_000,
    toNumber(process.env.PROXY_PRECHECK_EXEC_TIMEOUT_MS, 30_000)
  );
  const proxyPrecheckRetries = Math.max(0, toNumber(process.env.PROXY_PRECHECK_RETRIES, 1));
  const proxyPrecheckRetryDelayMs = Math.max(
    200,
    toNumber(process.env.PROXY_PRECHECK_RETRY_DELAY_MS, 900)
  );
  const proxyPrecheckBudgetMs = Math.max(
    1_000,
    toNumber(process.env.PROXY_PRECHECK_BUDGET_MS, 15_000)
  );
  const prompt = process.env.OPENCODE_PROMPT || 'reply with OK only';

  const { normalizeOpencodeModel } = await import('../src/utils/opencode-model');
  const { sandboxAgentProvisionService } = await import('../src/services/sandbox-agent-provision-service');
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');
  const { osacLlmProxyBridgeService } = await import('../src/services/osac-llm-proxy-bridge');

  const normalizedModel = normalizeOpencodeModel(
    process.env.OPENCODE_MODEL,
    process.env.OPENCODE_PROVIDER_ID || 'openai'
  );
  if (!normalizedModel) {
    throw new Error('Invalid OPENCODE_MODEL');
  }

  let sessionId = (process.env.SID || '').trim();
  let provisioned = false;
  const budgetStartMs = Date.now();
  const ensureBudget = (stage: string) => {
    const elapsed = Date.now() - budgetStartMs;
    if (elapsed > totalBudgetMs) {
      throw new Error(`Circuit break: total budget exceeded before ${stage} (${elapsed}ms > ${totalBudgetMs}ms)`);
    }
  };

  const roundResults: RoundResult[] = [];
  let consecutiveFailures = 0;
  let totalFailures = 0;
  let aborted = false;
  let abortReason: string | null = null;
  let fatalError: string | null = null;
  let persistentBridgeReady = false;

  try {
    if (!sessionId) {
      ensureBudget('provision');
      const provision = await withTimeout('provision', provisionStageTimeoutMs, async () =>
        provisionSessionWithRetry(sandboxAgentProvisionService, provisionAttempts, provisionDelayMs)
      );
      sessionId = provision.sessionId;
      provisioned = true;
    }

    ensureBudget('sandbox-ready');
    await withTimeout('sandbox-ready', readyStageTimeoutMs, async () =>
      ensureSandboxRunningAndReady(kvmConnector, sessionId, readyAttempts, readyDelayMs)
    );

    try {
      ensureBudget('ws-ready');
      await withTimeout('ws-ready', wsReadyStageTimeoutMs, async () =>
        waitForWsReady(
          osacConnectionManager,
          sessionId,
          wsReadyAttempts,
          wsReadyDelayMs,
          wsProbeMode,
          wsPingTimeoutMs,
          wsConnectAcquireTimeoutMs
        )
      );
    } catch (error) {
      if (!isTokenMismatchLike(error)) {
        throw error;
      }
      ensureBudget('ws-ready-token-recover');
      await withTimeout('ws-ready-token-recover', recoverStageTimeoutMs, async () =>
        recoverGuestAgent(kvmConnector, sessionId, readyAttempts, readyDelayMs)
      );
      ensureBudget('ws-ready-after-token-recover');
      await withTimeout('ws-ready-after-token-recover', wsReadyStageTimeoutMs, async () =>
        waitForWsReady(
          osacConnectionManager,
          sessionId,
          wsReadyAttempts,
          wsReadyDelayMs,
          wsProbeMode,
          wsPingTimeoutMs,
          wsConnectAcquireTimeoutMs
        )
      );
    }

    osacLlmProxyBridgeService.initialize();
    ensureBudget('bridge-ready');
    persistentBridgeReady = await withTimeout('bridge-ready', wsReadyStageTimeoutMs, async () =>
      osacConnectionManager.ensurePersistent(sessionId)
    );
    if (!persistentBridgeReady) {
      throw new Error('OSAC bridge persistent connection not ready');
    }

    const opencodeBin = '/opt/.altus/opencode/opencode';
    const cmd =
      `/usr/bin/timeout ${Math.max(1, commandTimeoutSeconds)} ` +
      `${opencodeBin} run --format json -m ${shellQuote(normalizedModel.fullModel)} ${shellQuote(prompt)}`;

    for (let i = 1; i <= rounds; i++) {
      ensureBudget(`round-${i}`);

      const roundStart = Date.now();
      let recovered = false;
      let timeoutLike = false;
      let row: RoundResult;

      try {
        if (enableProxyPrecheck) {
          let precheck: ProxyPrecheckResult | null = null;
          let attemptError: unknown = null;
          const precheckStart = Date.now();
          let probeAttempt = 0;
          while (true) {
            try {
              precheck = await precheckLlmProxy(
                kvmConnector,
                sessionId,
                proxyPrecheckTimeoutSeconds,
                proxyPrecheckExecTimeoutMs,
                pollTimeoutMs,
                pollIntervalMs
              );
              if (precheck.ok) break;
              const canRetry = isRetryableProxyError(precheck.errorCode);
              const elapsed = Date.now() - precheckStart;
              const withinBudget = elapsed < proxyPrecheckBudgetMs;
              if (!canRetry || !withinBudget || probeAttempt >= proxyPrecheckRetries) break;
              const delayMs = Math.max(
                proxyPrecheckRetryDelayMs,
                Math.min(3_000, precheck.retryAfterMs || 0)
              );
              await sleep(delayMs);
            } catch (error) {
              attemptError = error;
              const elapsed = Date.now() - precheckStart;
              const withinBudget = elapsed < proxyPrecheckBudgetMs;
              if (!withinBudget || probeAttempt >= proxyPrecheckRetries) break;
              await sleep(proxyPrecheckRetryDelayMs);
            }
            probeAttempt += 1;
          }

          if (isCircuitOpenPrecheckFailure(precheck) && !recovered) {
            ensureBudget(`round-${i}-recover-circuit`);
            await withTimeout(`round-${i}-recover-circuit`, recoverStageTimeoutMs, async () =>
              recoverGuestAgent(kvmConnector, sessionId, readyAttempts, readyDelayMs)
            );
            recovered = true;

            ensureBudget(`round-${i}-ws-reprobe-circuit`);
            await withTimeout(`round-${i}-ws-reprobe-circuit`, wsReadyStageTimeoutMs, async () =>
              waitForWsReady(
                osacConnectionManager,
                sessionId,
                wsReadyAttempts,
                wsReadyDelayMs,
                wsProbeMode,
                wsPingTimeoutMs,
                wsConnectAcquireTimeoutMs
              )
            );

            try {
              precheck = await precheckLlmProxy(
                kvmConnector,
                sessionId,
                proxyPrecheckTimeoutSeconds,
                proxyPrecheckExecTimeoutMs,
                pollTimeoutMs,
                pollIntervalMs
              );
            } catch (error) {
              attemptError = error;
              precheck = null;
            }
          }

          if (precheck && !precheck.ok) {
            const fallbackMessage =
              precheck.errorMessage ||
              (precheck.errorCode ? `proxy precheck failed: ${precheck.errorCode}` : 'proxy precheck failed');
            row = {
              round: i,
              ok: false,
              status: `precheck_${precheck.status || 'failed'}`,
              exit: precheck.exit,
              durationMs: Date.now() - roundStart,
              timedOut:
                precheck.exit === 124 ||
                isTimeoutLike(precheck.errorMessage || '') ||
                isTimeoutLike(precheck.stderrSnippet),
              guestAgentRecovered: recovered,
              errorCode: precheck.errorCode,
              errorMessage: fallbackMessage,
              stdoutSnippet: precheck.stdoutSnippet,
              stderrSnippet: precheck.stderrSnippet,
            };
            roundResults.push(row);
            console.log(JSON.stringify(row));
            totalFailures += 1;
            consecutiveFailures += 1;
            if (consecutiveFailures >= maxConsecutiveFailures) {
              aborted = true;
              abortReason = `Circuit break: ${consecutiveFailures} consecutive failures reached threshold ${maxConsecutiveFailures}`;
            } else if (totalFailures >= maxFailures) {
              aborted = true;
              abortReason = `Circuit break: total failures ${totalFailures} reached threshold ${maxFailures}`;
            }
            if (aborted) break;
            if (i < rounds && roundIntervalMs > 0) {
              await sleep(roundIntervalMs);
            }
            continue;
          }

          if (!precheck && attemptError) {
            const message = attemptError instanceof Error ? attemptError.message : String(attemptError);
            row = {
              round: i,
              ok: false,
              status: 'precheck_error',
              exit: null,
              durationMs: Date.now() - roundStart,
              timedOut: isTimeoutLike(attemptError),
              guestAgentRecovered: recovered,
              errorCode: null,
              errorMessage: message,
              stdoutSnippet: '',
              stderrSnippet: '',
            };
            roundResults.push(row);
            console.log(JSON.stringify(row));
            totalFailures += 1;
            consecutiveFailures += 1;
            if (consecutiveFailures >= maxConsecutiveFailures) {
              aborted = true;
              abortReason = `Circuit break: ${consecutiveFailures} consecutive failures reached threshold ${maxConsecutiveFailures}`;
            } else if (totalFailures >= maxFailures) {
              aborted = true;
              abortReason = `Circuit break: total failures ${totalFailures} reached threshold ${maxFailures}`;
            }
            if (aborted) break;
            if (i < rounds && roundIntervalMs > 0) {
              await sleep(roundIntervalMs);
            }
            continue;
          }
        }

        let outcome = await withTimeout(`round-${i}-exec`, roundExecTimeoutMs, async () =>
          execInVm(kvmConnector, sessionId, cmd, execTimeoutSeconds, pollTimeoutMs, pollIntervalMs)
        );

        if (restartOnGuestAgentError && isGuestAgentUnavailable(outcome)) {
          ensureBudget(`round-${i}-recover`);
          await withTimeout(`round-${i}-recover`, recoverStageTimeoutMs, async () =>
            recoverGuestAgent(kvmConnector, sessionId, readyAttempts, readyDelayMs)
          );
          recovered = true;

          ensureBudget(`round-${i}-ws-reprobe`);
          await withTimeout(`round-${i}-ws-reprobe`, wsReadyStageTimeoutMs, async () =>
            waitForWsReady(
              osacConnectionManager,
              sessionId,
              wsReadyAttempts,
              wsReadyDelayMs,
              wsProbeMode,
              wsPingTimeoutMs,
              wsConnectAcquireTimeoutMs
            )
          );

          outcome = await withTimeout(`round-${i}-exec-after-recover`, roundExecTimeoutMs, async () =>
            execInVm(kvmConnector, sessionId, cmd, execTimeoutSeconds, pollTimeoutMs, pollIntervalMs)
          );
        }

        const ok = outcome.status === 'completed' && outcome.exit === 0 && looksOk(outcome.stdout);
        timeoutLike =
          outcome.exit === 124 ||
          isTimeoutLike(outcome.errorMessage || '') ||
          isTimeoutLike(outcome.stderr);
        row = {
          round: i,
          ok,
          status: outcome.status,
          exit: outcome.exit,
          durationMs: Date.now() - roundStart,
          timedOut: timeoutLike,
          guestAgentRecovered: recovered,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
          stdoutSnippet: pickSnippet(outcome.stdout, 280),
          stderrSnippet: pickSnippet(outcome.stderr, 180),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        timeoutLike = isTimeoutLike(error);
        row = {
          round: i,
          ok: false,
          status: 'error',
          exit: null,
          durationMs: Date.now() - roundStart,
          timedOut: timeoutLike,
          guestAgentRecovered: recovered,
          errorCode: null,
          errorMessage: message,
          stdoutSnippet: '',
          stderrSnippet: '',
        };
      }

      roundResults.push(row);
      console.log(JSON.stringify(row));

      if (!row.ok) {
        totalFailures += 1;
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 0;
      }

      if (consecutiveFailures >= maxConsecutiveFailures) {
        aborted = true;
        abortReason = `Circuit break: ${consecutiveFailures} consecutive failures reached threshold ${maxConsecutiveFailures}`;
      } else if (totalFailures >= maxFailures) {
        aborted = true;
        abortReason = `Circuit break: total failures ${totalFailures} reached threshold ${maxFailures}`;
      }

      if (aborted) {
        break;
      }

      if (i < rounds && roundIntervalMs > 0) {
        await sleep(roundIntervalMs);
      }
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
    aborted = true;
    abortReason = fatalError;
  } finally {
    if (persistentBridgeReady && sessionId) {
      try {
        await osacConnectionManager.close(sessionId);
      } catch {
        // ignore close errors
      }
    }
    if (localBridgeServer?.started) {
      try {
        await localBridgeServer.close();
      } catch {
        // ignore close errors
      }
    }
  }

  const passed = roundResults.filter((item) => item.ok).length;
  const failed = roundResults.length - passed;

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sessionId,
    provisioned,
    rounds,
    roundsExecuted: roundResults.length,
    passed,
    failed,
    maxConsecutiveFailures,
    maxFailures,
    totalBudgetMs,
    aborted,
    abortReason,
    fatalError,
    model: normalizedModel.fullModel,
    commandTimeoutSeconds,
    execTimeoutSeconds,
    roundExecTimeoutMs,
    enableProxyPrecheck,
    proxyPrecheckTimeoutSeconds,
    proxyPrecheckExecTimeoutMs,
    proxyPrecheckRetries,
    proxyPrecheckRetryDelayMs,
    proxyPrecheckBudgetMs,
    disableOsacHealthcheck,
    bridgeBaseUrl: process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL || null,
    localBridgeServerStarted: Boolean(localBridgeServer?.started),
    wsProbeMode,
    wsPingTimeoutMs,
    wsConnectAcquireTimeoutMs,
    persistentBridgeReady,
  };

  const report = {
    summary,
    rounds: roundResults,
  };

  const reportDir = path.resolve('scripts', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `osac-opencode-regression-${nowStamp()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({ summary, reportPath }, null, 2));

  if (aborted || fatalError || failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
