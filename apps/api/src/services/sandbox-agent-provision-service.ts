import { sandboxEnvironmentService } from './sandbox-environment-service';
import { sandboxExecutionEnvironmentDAO } from '../db/dao';
import { kvmConnector } from '../connectors/kvm-connector';
import {
  buildSandboxPortProbeQuery,
  extractSandboxPortMappings,
  findSandboxPortMapping,
  getSandboxPortCheckCount,
  getSandboxPortWaitSeconds,
  isSandboxPortReady,
  normalizeSandboxPortMapping,
} from '../connectors/kvm-call-pattern';
import { ensureDatabaseConnection } from '../config/database';
import { osacBootstrapConfig } from '../config/osac-bootstrap-config';
import { osacConnectionManager } from './osac-connection-manager';
import { normalizeOpencodeModel } from '../utils/opencode-model';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractIpAddress(payload: any): string | null {
  const normalize = (value: string) => value.split('/')[0].trim();
  const pickIp = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const ip = normalize(value);
    if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') return ip;
    return null;
  };

  const direct = pickIp(
    pickString(
      payload?.ipAddress,
      payload?.ip_address,
      payload?.network?.ipAddress,
      payload?.network?.ip_address
    )
  );
  if (direct) return direct;

  const addressLists = [
    payload?.ipAddresses,
    payload?.ip_addresses,
    payload?.network?.ipAddresses,
    payload?.network?.ip_addresses,
  ];
  for (const list of addressLists) {
    if (Array.isArray(list)) {
      for (const entry of list) {
        const candidate = pickIp(entry);
        if (candidate) return candidate;
      }
    }
  }

  const interfaces =
    payload?.network?.interfaces ||
    payload?.network?.interface ||
    payload?.interfaces ||
    payload?.networkAdapters ||
    payload?.networks;

  if (Array.isArray(interfaces)) {
    for (const entry of interfaces) {
      const candidate = pickIp(pickString(entry?.ipAddress, entry?.ip_address, entry?.ip));
      if (candidate) return candidate;
    }
  }

  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVmIp(sessionId: string, vmName: string | null, maxAttempts: number = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sandboxIp = await kvmConnector.getSandboxIp(sessionId).catch(() => null);
    const sandboxData = (sandboxIp?.data as any) || {};
    const sandboxIpAddress = extractIpAddress(sandboxData);
    if (sandboxIpAddress) {
      return sandboxIpAddress;
    }

    if (vmName) {
      const vmIp = await kvmConnector.getVmIp(vmName).catch(() => null);
      const vmIpData = (vmIp?.data as any) || {};
      const vmIpAddress = extractIpAddress(vmIpData);
      if (vmIpAddress) {
        return vmIpAddress;
      }
    }

    const sessionVm = await kvmConnector.getSessionVm(sessionId);
    const vmData = (sessionVm.data as any) || {};
    let vmInfo = vmData;

    if (vmName && (!vmData?.ipAddress && !vmData?.ip_address)) {
      const vmDetail = await kvmConnector.getVm(vmName);
      vmInfo = (vmDetail.data as any) || vmData;
    }

    const ipAddress = extractIpAddress(vmInfo);
    if (ipAddress) {
      return ipAddress;
    }

    if (attempt < maxAttempts) {
      await sleep(2000);
    }
  }

  return null;
}

async function waitForJob(jobId: string, timeoutMs: number = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await kvmConnector.getJob(jobId);
    const data = job.data as any;
    const status = data?.status;
    if (status && !['queued', 'running'].includes(status)) {
      return data;
    }
    await sleep(1200);
  }
  throw new Error(`等待任务超时: ${jobId}`);
}

async function awaitJobIfNeeded(result: any) {
  const jobId =
    result?.jobId ||
    result?.job_id ||
    result?.data?.jobId ||
    result?.data?.job_id;
  if (!jobId) {
    return result?.data ?? result;
  }
  return waitForJob(String(jobId));
}

function extractExecOutput(payload: any): string {
  if (!payload) return '';
  return (
    payload?.stdout ||
    payload?.output ||
    payload?.result?.stdout ||
    payload?.result?.output ||
    payload?.data?.stdout ||
    payload?.data?.output ||
    ''
  );
}

function assertJobSuccess(result: any, context: string) {
  const status = result?.status || result?.data?.status;
  if (!status || status === 'completed') {
    return;
  }
  const reason =
    result?.error?.details?.reason ||
    result?.error?.message ||
    result?.error?.details?.exception ||
    result?.error?.type ||
    'unknown_error';
  throw new Error(`${context} failed: ${status} (${reason})`);
}

function parseFirstIp(text: string): string | null {
  const matches = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g);
  if (!matches) return null;
  for (const ip of matches) {
    if (ip !== '127.0.0.1' && ip !== '0.0.0.0') {
      return ip;
    }
  }
  return null;
}

async function fetchIpViaGuestExec(sessionId: string, attempts: number = 10): Promise<string | null> {
  const command = `set -e;
IFACE=$(ip -o link show | awk -F': ' '{print $2}' | grep -v '^lo$' | head -n1);
if [ -n "$IFACE" ]; then
  ip link set "$IFACE" up || true;
  if command -v dhclient >/dev/null 2>&1; then
    dhclient -v "$IFACE" || true;
  elif command -v udhcpc >/dev/null 2>&1; then
    udhcpc -i "$IFACE" || true;
  elif command -v nmcli >/dev/null 2>&1; then
    nmcli dev connect "$IFACE" || true;
  fi;
fi;
hostname -I 2>/dev/null || ip -4 -o addr show scope global | awk '{print $4}'`;
  for (let i = 0; i < attempts; i++) {
    const execResult = await kvmConnector.execSession(sessionId, {
      path: '/bin/bash',
      args: ['-lc', command],
      capture_output: true,
      timeout_seconds: 10,
    });

    const finished = await awaitJobIfNeeded(execResult);
    const output = extractExecOutput(finished);
    const ipFromOutput = parseFirstIp(output);
    if (ipFromOutput) {
      return ipFromOutput;
    }

    const fallbackOutput = extractExecOutput(execResult);
    const fallbackIp = parseFirstIp(fallbackOutput);
    if (fallbackIp) {
      return fallbackIp;
    }

    await sleep(2000);
  }

  return null;
}

async function waitForGuestAgent(sessionId: string, attempts: number = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      const execResult = await kvmConnector.execSession(sessionId, {
        path: '/bin/true',
        args: [],
        capture_output: false,
        timeout_seconds: 5,
      });
      const finished = await awaitJobIfNeeded(execResult);
      assertJobSuccess(finished, 'Guest agent 探活');
      return;
    } catch {
      if (i < attempts - 1) {
        await sleep(2000);
        continue;
      }
      throw new Error('Guest agent 未就绪，无法下发文件');
    }
  }
}

async function waitForOsacListening(sessionId: string, port: number, attempts: number = 10) {
  const checkCommand = `if command -v ss >/dev/null 2>&1; then ss -ltn; elif command -v netstat >/dev/null 2>&1; then netstat -ltn; else exit 0; fi`;
  for (let i = 0; i < attempts; i++) {
    try {
      const execResult = await kvmConnector.execSession(sessionId, {
        path: '/bin/bash',
        args: ['-lc', checkCommand],
        capture_output: true,
        timeout_seconds: 8,
      });
      const finished = await awaitJobIfNeeded(execResult);
      const output = extractExecOutput(finished) || extractExecOutput(execResult);
      if (output && output.includes(`:${port}`)) {
        return true;
      }
    } catch {
      // ignore and retry
    }
    await sleep(2000);
  }
  return false;
}

function buildDownloadBaseUrl(reqBaseUrl?: string): string {
  if (osacBootstrapConfig.downloadBaseUrl) {
    return osacBootstrapConfig.downloadBaseUrl.replace(/\/+$/, '');
  }
  if (reqBaseUrl) {
    return `${reqBaseUrl.replace(/\/+$/, '')}/api/sandbox/osac/binaries`;
  }
  return 'http://localhost:4000/api/sandbox/osac/binaries';
}

function buildOrchestratorHost(): string | null {
  const raw = process.env.KVM_ORCHESTRATOR_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.hostname;
  } catch {
    return null;
  }
}

function pickPortMappingConfig() {
  const base =
    osacBootstrapConfig.portMappingBase && Number.isFinite(osacBootstrapConfig.portMappingBase)
      ? Number(osacBootstrapConfig.portMappingBase)
      : 20000;
  const range =
    osacBootstrapConfig.portMappingRange && Number.isFinite(osacBootstrapConfig.portMappingRange)
      ? Number(osacBootstrapConfig.portMappingRange)
      : 2000;
  return { base, range };
}

function computePortCandidate(sessionId: string, base: number, range: number): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  const offset = range > 0 ? hash % range : 0;
  return base + offset;
}

function shellEscapeSingle(value: string) {
  return value.replace(/'/g, `'\\''`);
}

function generateOsacToken() {
  // fix2 compatibility: keep token strictly alphanumeric to avoid WS auth parser edge cases.
  return crypto.randomBytes(24).toString('hex');
}

function normalizeOpenAiBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname || '/';
    if (pathname === '/' || pathname === '') {
      parsed.pathname = '/v1';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function isLoopbackBaseUrl(input: string): boolean {
  const raw = input.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.trim().toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function resolveOpencodeEnv() {
  const proxyPort = Number(process.env.OSAC_LLM_PROXY_PORT || 18111);
  const defaultBaseUrl = `http://127.0.0.1:${proxyPort}`;
  const baseUrlCandidate =
    process.env.OPENCODE_BASE_URL ||
    process.env.OPENCODE_PROXY_BASE_URL ||
    defaultBaseUrl;
  const apiKeyCandidate =
    process.env.OPENCODE_API_KEY ||
    process.env.OPENCODE_PROXY_API_KEY ||
    'local-proxy';
  const proxyEnabledRaw = (process.env.OSAC_LLM_PROXY_ENABLE || 'true').trim().toLowerCase();
  const proxyEnabled = proxyEnabledRaw !== 'false';
  const forcedProxyBaseUrl = normalizeOpenAiBaseUrl(`http://127.0.0.1:${proxyPort}/v1`);
  const normalizedCandidateBaseUrl = normalizeOpenAiBaseUrl(baseUrlCandidate);
  const useForcedProxyBase = proxyEnabled && !isLoopbackBaseUrl(normalizedCandidateBaseUrl);
  const baseUrlRaw = useForcedProxyBase ? forcedProxyBaseUrl : baseUrlCandidate;
  const apiKeyRaw = useForcedProxyBase ? 'local-proxy' : apiKeyCandidate;

  const modelRaw =
    process.env.OPENCODE_MODEL ||
    process.env.OPENCODE_DEFAULT_MODEL ||
    '';
  const providerRaw = process.env.OPENCODE_PROVIDER_ID || 'openai';
  const normalized = normalizeOpencodeModel(modelRaw, providerRaw);

  return {
    baseUrl: normalizeOpenAiBaseUrl(baseUrlRaw),
    apiKey: apiKeyRaw.trim(),
    model: normalized?.fullModel || '',
    modelId: normalized?.modelId || '',
    providerId: normalized?.providerId || providerRaw.trim() || 'openai',
    providerName: (process.env.OPENCODE_PROVIDER_NAME || '').trim(),
    explicitBaseUrl: Boolean(
      process.env.OPENCODE_BASE_URL ||
      process.env.OPENCODE_PROXY_BASE_URL ||
      useForcedProxyBase
    ),
    explicitApiKey: Boolean(
      process.env.OPENCODE_API_KEY ||
      process.env.OPENCODE_PROXY_API_KEY ||
      useForcedProxyBase
    ),
    explicitProviderId: Boolean(process.env.OPENCODE_PROVIDER_ID),
  };
}

function shouldWriteOpencodeProviderConfig(env: ReturnType<typeof resolveOpencodeEnv>): boolean {
  if (!env.model || !env.modelId || !env.baseUrl || !env.apiKey) {
    return false;
  }
  return Boolean(env.explicitBaseUrl || env.explicitApiKey || env.explicitProviderId);
}

function resolveOsacLlmProxyEnv(requestBaseUrl?: string) {
  const proxyPort = Number(process.env.OSAC_LLM_PROXY_PORT || 18111);
  const bridgeBase = (process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL || '').trim().replace(/\/+$/, '');
  let fallbackBase = '';
  if (bridgeBase) {
    fallbackBase = bridgeBase;
  } else if (requestBaseUrl) {
    try {
      const parsed = new URL(requestBaseUrl);
      const isLoopbackHost =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1';
      if (!isLoopbackHost) {
        fallbackBase = `${parsed.origin}/api/llm-proxy`;
      }
    } catch {
      fallbackBase = '';
    }
  }
  const rawUpstream =
    process.env.OSAC_LLM_UPSTREAM_BASE_URL ||
    fallbackBase;
  const upstreamBaseUrl = rawUpstream.trim().replace(/\/+$/, '');
  const upstreamToken = (process.env.OSAC_LLM_UPSTREAM_TOKEN || '').trim();
  const timeoutMs = (process.env.OSAC_LLM_PROXY_TIMEOUT_MS || '').trim();
  const maxInflightPerSession = (process.env.OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION || '').trim();
  const queueTimeoutMs = (process.env.OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS || '').trim();
  const streamIdleTimeoutMs = (process.env.OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS || '').trim();
  const wsPingInterval = (process.env.OSAC_WS_PING_INTERVAL || '').trim();
  const wsIdleTimeout = (process.env.OSAC_WS_IDLE_TIMEOUT || '').trim();
  const instanceLockPath = (process.env.OSAC_INSTANCE_LOCK_PATH || '').trim();
  const enabledRaw = (process.env.OSAC_LLM_PROXY_ENABLE || 'true').trim().toLowerCase();
  const enabled = enabledRaw !== 'false';
  return {
    enabled,
    proxyPort,
    upstreamBaseUrl,
    upstreamToken,
    timeoutMs,
    maxInflightPerSession,
    queueTimeoutMs,
    streamIdleTimeoutMs,
    wsPingInterval,
    wsIdleTimeout,
    instanceLockPath,
  };
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function shouldEagerBridgeOnProvision(): boolean {
  // Default disabled: eager bridge can hold OSAC in candidate state before probe-ready.
  return toBool(process.env.OSAC_PROVISION_EAGER_BRIDGE, false);
}

async function ensureVmEnv(
  sessionId: string,
  token: string,
  requestBaseUrl?: string,
  opencodeEnvInput?: ReturnType<typeof resolveOpencodeEnv>
) {
  const escapedToken = shellEscapeSingle(token);
  const listenAddr = `:${osacBootstrapConfig.osacPort}`;
  const escapedListen = shellEscapeSingle(listenAddr);
  const opencodeEnv = opencodeEnvInput || resolveOpencodeEnv();
  const osacLlmEnv = resolveOsacLlmProxyEnv(requestBaseUrl);
  const extraLines: string[] = [];

  if (opencodeEnv.baseUrl) {
    const escaped = shellEscapeSingle(opencodeEnv.baseUrl);
    extraLines.push(`if grep -q '^OPENAI_BASE_URL=' /etc/environment; then
  sed -i "s|^OPENAI_BASE_URL=.*|OPENAI_BASE_URL='${escaped}'|" /etc/environment;
else
  echo "OPENAI_BASE_URL='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (opencodeEnv.apiKey) {
    const escaped = shellEscapeSingle(opencodeEnv.apiKey);
    extraLines.push(`if grep -q '^OPENAI_API_KEY=' /etc/environment; then
  sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY='${escaped}'|" /etc/environment;
else
  echo "OPENAI_API_KEY='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (opencodeEnv.model) {
    const escaped = shellEscapeSingle(opencodeEnv.model);
    extraLines.push(`if grep -q '^OPENCODE_MODEL=' /etc/environment; then
  sed -i "s|^OPENCODE_MODEL=.*|OPENCODE_MODEL='${escaped}'|" /etc/environment;
else
  echo "OPENCODE_MODEL='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (opencodeEnv.providerId) {
    const escaped = shellEscapeSingle(opencodeEnv.providerId);
    extraLines.push(`if grep -q '^OPENCODE_PROVIDER_ID=' /etc/environment; then
  sed -i "s|^OPENCODE_PROVIDER_ID=.*|OPENCODE_PROVIDER_ID='${escaped}'|" /etc/environment;
else
  echo "OPENCODE_PROVIDER_ID='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (Number.isFinite(osacLlmEnv.proxyPort)) {
    const escaped = shellEscapeSingle(String(osacLlmEnv.proxyPort));
    extraLines.push(`if grep -q '^OSAC_LLM_PROXY_PORT=' /etc/environment; then
  sed -i "s|^OSAC_LLM_PROXY_PORT=.*|OSAC_LLM_PROXY_PORT='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_PROXY_PORT='${escaped}'" >> /etc/environment;
fi;`);
  }
  extraLines.push(`if grep -q '^OSAC_LLM_PROXY_ENABLE=' /etc/environment; then
  sed -i "s|^OSAC_LLM_PROXY_ENABLE=.*|OSAC_LLM_PROXY_ENABLE='${osacLlmEnv.enabled ? 'true' : 'false'}'|" /etc/environment;
else
  echo "OSAC_LLM_PROXY_ENABLE='${osacLlmEnv.enabled ? 'true' : 'false'}'" >> /etc/environment;
fi;`);
  if (osacLlmEnv.upstreamBaseUrl) {
    const escaped = shellEscapeSingle(osacLlmEnv.upstreamBaseUrl);
    extraLines.push(`if grep -q '^OSAC_LLM_UPSTREAM_BASE_URL=' /etc/environment; then
  sed -i "s|^OSAC_LLM_UPSTREAM_BASE_URL=.*|OSAC_LLM_UPSTREAM_BASE_URL='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_UPSTREAM_BASE_URL='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.upstreamToken) {
    const escaped = shellEscapeSingle(osacLlmEnv.upstreamToken);
    extraLines.push(`if grep -q '^OSAC_LLM_UPSTREAM_TOKEN=' /etc/environment; then
  sed -i "s|^OSAC_LLM_UPSTREAM_TOKEN=.*|OSAC_LLM_UPSTREAM_TOKEN='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_UPSTREAM_TOKEN='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.timeoutMs) {
    const escaped = shellEscapeSingle(osacLlmEnv.timeoutMs);
    extraLines.push(`if grep -q '^OSAC_LLM_PROXY_TIMEOUT_MS=' /etc/environment; then
  sed -i "s|^OSAC_LLM_PROXY_TIMEOUT_MS=.*|OSAC_LLM_PROXY_TIMEOUT_MS='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_PROXY_TIMEOUT_MS='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.maxInflightPerSession) {
    const escaped = shellEscapeSingle(osacLlmEnv.maxInflightPerSession);
    extraLines.push(`if grep -q '^OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION=' /etc/environment; then
  sed -i "s|^OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION=.*|OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.queueTimeoutMs) {
    const escaped = shellEscapeSingle(osacLlmEnv.queueTimeoutMs);
    extraLines.push(`if grep -q '^OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS=' /etc/environment; then
  sed -i "s|^OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS=.*|OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.streamIdleTimeoutMs) {
    const escaped = shellEscapeSingle(osacLlmEnv.streamIdleTimeoutMs);
    extraLines.push(`if grep -q '^OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS=' /etc/environment; then
  sed -i "s|^OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS=.*|OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS='${escaped}'|" /etc/environment;
else
  echo "OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.wsPingInterval) {
    const escaped = shellEscapeSingle(osacLlmEnv.wsPingInterval);
    extraLines.push(`if grep -q '^OSAC_WS_PING_INTERVAL=' /etc/environment; then
  sed -i "s|^OSAC_WS_PING_INTERVAL=.*|OSAC_WS_PING_INTERVAL='${escaped}'|" /etc/environment;
else
  echo "OSAC_WS_PING_INTERVAL='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.wsIdleTimeout) {
    const escaped = shellEscapeSingle(osacLlmEnv.wsIdleTimeout);
    extraLines.push(`if grep -q '^OSAC_WS_IDLE_TIMEOUT=' /etc/environment; then
  sed -i "s|^OSAC_WS_IDLE_TIMEOUT=.*|OSAC_WS_IDLE_TIMEOUT='${escaped}'|" /etc/environment;
else
  echo "OSAC_WS_IDLE_TIMEOUT='${escaped}'" >> /etc/environment;
fi;`);
  }
  if (osacLlmEnv.instanceLockPath) {
    const escaped = shellEscapeSingle(osacLlmEnv.instanceLockPath);
    extraLines.push(`if grep -q '^OSAC_INSTANCE_LOCK_PATH=' /etc/environment; then
  sed -i "s|^OSAC_INSTANCE_LOCK_PATH=.*|OSAC_INSTANCE_LOCK_PATH='${escaped}'|" /etc/environment;
else
  echo "OSAC_INSTANCE_LOCK_PATH='${escaped}'" >> /etc/environment;
fi;`);
  }

  const updateEnv = `set -e;
if grep -q '^OSAC_AUTH_TOKEN=' /etc/environment; then
  sed -i "s|^OSAC_AUTH_TOKEN=.*|OSAC_AUTH_TOKEN='${escapedToken}'|" /etc/environment;
else
  echo "OSAC_AUTH_TOKEN='${escapedToken}'" >> /etc/environment;
fi;
if grep -q '^OSAC_LISTEN_ADDR=' /etc/environment; then
  sed -i "s|^OSAC_LISTEN_ADDR=.*|OSAC_LISTEN_ADDR='${escapedListen}'|" /etc/environment;
else
  echo "OSAC_LISTEN_ADDR='${escapedListen}'" >> /etc/environment;
fi;
${extraLines.join('\n')}
`;

  const result = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', updateEnv],
    capture_output: true,
    timeout_seconds: 20,
  });

  const finished = await awaitJobIfNeeded(result);
  assertJobSuccess(finished, '写入 OSAC 环境变量');
}

async function ensureOpencodeProviderConfig(
  sessionId: string,
  opencodeEnv: ReturnType<typeof resolveOpencodeEnv>
) {
  if (!shouldWriteOpencodeProviderConfig(opencodeEnv)) {
    return;
  }

  const providerId = opencodeEnv.providerId;
  const modelId = opencodeEnv.modelId;
  const fullModel = opencodeEnv.model;
  const providerName = opencodeEnv.providerName || `Custom ${providerId}`;
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [providerId]: {
        npm: '@ai-sdk/openai-compatible',
        name: providerName,
        options: {
          baseURL: opencodeEnv.baseUrl,
          apiKey: opencodeEnv.apiKey,
        },
        models: {
          [modelId]: {
            name: modelId,
          },
        },
      },
    },
    model: fullModel,
    small_model: fullModel,
  };

  const encoded = Buffer.from(JSON.stringify(config, null, 2), 'utf8').toString('base64');
  const writeCommand = `set -e;
mkdir -p /root/.config/opencode;
echo '${encoded}' | base64 -d > /root/.config/opencode/opencode.json;
chmod 600 /root/.config/opencode/opencode.json`;

  const result = await kvmConnector.execSession(sessionId, {
    path: '/bin/bash',
    args: ['-lc', writeCommand],
    capture_output: true,
    timeout_seconds: 20,
  });

  const finished = await awaitJobIfNeeded(result);
  assertJobSuccess(finished, '写入 OpenCode provider 配置');
}

export class SandboxAgentProvisionService {
  async provision(input: {
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    bind?: Record<string, unknown>;
    requestBaseUrl?: string;
  }) {
    await ensureDatabaseConnection({ retries: 3, delayMs: 1000 });

    const environment = await sandboxEnvironmentService.openEnvironment({
      metadata: input.metadata || {},
      idempotencyKey: input.idempotencyKey,
      bind: input.bind,
    });

    const sessionId = environment.sessionId;

    const sessionVm = await kvmConnector.getSessionVm(sessionId);
    const vmData = (sessionVm.data as any) || {};
    const vmName = pickString(
      vmData?.name,
      vmData?.vmName,
      vmData?.vm?.name,
      environment.vmName
    );

    let ipAddress = await waitForVmIp(sessionId, vmName);
    let osacEndpoint =
      osacBootstrapConfig.connectionMode === 'port-mapping'
        ? null
        : ipAddress
          ? `ws://${ipAddress}:${osacBootstrapConfig.osacPort}${osacBootstrapConfig.osacPathSuffix}`
          : null;

    const downloadBase = buildDownloadBaseUrl(input.requestBaseUrl);
    const osacBinaryUrl = `${downloadBase}/osac`;
    const opencodeBinaryUrl = `${downloadBase}/opencode`;

    const osacToken = generateOsacToken();

    const existing = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    const mergedMetadata = {
      ...(existing?.metadata || {}),
      ...(input.metadata || {}),
      osacEndpoint,
      vmIpAddress: ipAddress,
      osacAuthToken: osacToken,
      osacConnectionMode: osacBootstrapConfig.connectionMode,
      osacBootstrap: {
        osacPort: osacBootstrapConfig.osacPort,
        osacPathSuffix: osacBootstrapConfig.osacPathSuffix,
        osacBinaryUrl,
        opencodeBinaryUrl,
        authToken: osacBootstrapConfig.binaryAuthToken ? 'required' : 'none',
      },
    };

    if (!ipAddress) {
      ipAddress = await fetchIpViaGuestExec(sessionId);
      osacEndpoint = ipAddress
        ? `ws://${ipAddress}:${osacBootstrapConfig.osacPort}${osacBootstrapConfig.osacPathSuffix}`
        : null;
    }

    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
      ...mergedMetadata,
      osacEndpoint,
      vmIpAddress: ipAddress,
    });

    const remoteDir = osacBootstrapConfig.remoteBaseDir.replace(/\/+$/, '');
    const remoteOsacPath = `${remoteDir}/${osacBootstrapConfig.osacBinaryName}`;
    const remoteOpencodePath = `${remoteDir}/${osacBootstrapConfig.opencodeBinaryName}`;
    const remoteDirPath = `${remoteDir}/`;

    const opencodeEnv = resolveOpencodeEnv();
    await waitForGuestAgent(sessionId, 12);
    await ensureVmEnv(sessionId, osacToken, input.requestBaseUrl, opencodeEnv);
    await ensureOpencodeProviderConfig(sessionId, opencodeEnv);

    const osacBuffer = fs.readFileSync(osacBootstrapConfig.osacBinaryPath);
    const opencodeBuffer = fs.readFileSync(osacBootstrapConfig.opencodeBinaryPath);

    // 注意：guest-agent 下发时 targetPath 以目录结尾更稳定（避免被当作文件路径解析）
    const osacUpload = await kvmConnector.uploadSessionFile(sessionId, {
      filename: path.basename(osacBootstrapConfig.osacBinaryPath),
      buffer: osacBuffer,
      targetPath: remoteDirPath,
      overwrite: 'replace',
      mkdirs: true,
      chmod: '755',
      deliveryMode: osacBootstrapConfig.deliveryMode,
    });

    const osacUploadJob = await awaitJobIfNeeded(osacUpload);
    assertJobSuccess(osacUploadJob, 'OSAC 上传');

    const opencodeUpload = await kvmConnector.uploadSessionFile(sessionId, {
      filename: path.basename(osacBootstrapConfig.opencodeBinaryPath),
      buffer: opencodeBuffer,
      targetPath: remoteDirPath,
      overwrite: 'replace',
      mkdirs: true,
      chmod: '755',
      deliveryMode: osacBootstrapConfig.deliveryMode,
    });

    const opencodeUploadJob = await awaitJobIfNeeded(opencodeUpload);
    assertJobSuccess(opencodeUploadJob, 'OpenCode 上传');

    const osacLlmEnv = resolveOsacLlmProxyEnv(input.requestBaseUrl);
    const env: Record<string, string> = {
      OSAC_AUTH_TOKEN: osacToken,
      OSAC_LISTEN_ADDR: `:${osacBootstrapConfig.osacPort}`,
      OSAC_OPENCODE_PATH: remoteOpencodePath,
      OSAC_LOG_DIR: `${remoteDir}/log`,
      OSAC_UPDATE_TMP: `${remoteDir}/tmp`,
      OPENCODE_BIN: remoteOpencodePath,
      OPENCODE_PATH: remoteOpencodePath,
      OSAC_LLM_PROXY_ENABLE: osacLlmEnv.enabled ? 'true' : 'false',
    };
    if (Number.isFinite(osacLlmEnv.proxyPort)) {
      env.OSAC_LLM_PROXY_PORT = String(osacLlmEnv.proxyPort);
    }
    if (osacLlmEnv.upstreamBaseUrl) {
      env.OSAC_LLM_UPSTREAM_BASE_URL = osacLlmEnv.upstreamBaseUrl;
    }
    if (osacLlmEnv.upstreamToken) {
      env.OSAC_LLM_UPSTREAM_TOKEN = osacLlmEnv.upstreamToken;
    }
    if (osacLlmEnv.timeoutMs) {
      env.OSAC_LLM_PROXY_TIMEOUT_MS = osacLlmEnv.timeoutMs;
    }
    if (osacLlmEnv.maxInflightPerSession) {
      env.OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION = osacLlmEnv.maxInflightPerSession;
    }
    if (osacLlmEnv.queueTimeoutMs) {
      env.OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS = osacLlmEnv.queueTimeoutMs;
    }
    if (osacLlmEnv.streamIdleTimeoutMs) {
      env.OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS = osacLlmEnv.streamIdleTimeoutMs;
    }
    if (osacLlmEnv.wsPingInterval) {
      env.OSAC_WS_PING_INTERVAL = osacLlmEnv.wsPingInterval;
    }
    if (osacLlmEnv.wsIdleTimeout) {
      env.OSAC_WS_IDLE_TIMEOUT = osacLlmEnv.wsIdleTimeout;
    }
    if (osacLlmEnv.instanceLockPath) {
      env.OSAC_INSTANCE_LOCK_PATH = osacLlmEnv.instanceLockPath;
    }
    if (opencodeEnv.baseUrl) {
      env.OPENAI_BASE_URL = opencodeEnv.baseUrl;
    }
    if (opencodeEnv.apiKey) {
      env.OPENAI_API_KEY = opencodeEnv.apiKey;
    }
    if (opencodeEnv.model) {
      env.OPENCODE_MODEL = opencodeEnv.model;
    }
    if (opencodeEnv.providerId) {
      env.OPENCODE_PROVIDER_ID = opencodeEnv.providerId;
    }

    let launchCommand = osacBootstrapConfig.launchCommand;
    if (!launchCommand || !launchCommand.trim()) {
      launchCommand = remoteOsacPath;
    }

    const osacUploadedName = path.basename(osacBootstrapConfig.osacBinaryPath);
    const opencodeUploadedName = path.basename(osacBootstrapConfig.opencodeBinaryPath);
    const inlineEnvParts = [
      `OSAC_AUTH_TOKEN='${shellEscapeSingle(osacToken)}'`,
      `OSAC_LISTEN_ADDR=':${osacBootstrapConfig.osacPort}'`,
      `OSAC_OPENCODE_PATH='${remoteOpencodePath}'`,
      `OSAC_LOG_DIR='${remoteDir}/log'`,
      `OSAC_UPDATE_TMP='${remoteDir}/tmp'`,
      `OPENCODE_BIN='${remoteOpencodePath}'`,
      `OPENCODE_PATH='${remoteOpencodePath}'`,
      `OSAC_LLM_PROXY_ENABLE='${osacLlmEnv.enabled ? 'true' : 'false'}'`,
    ];
    if (Number.isFinite(osacLlmEnv.proxyPort)) {
      inlineEnvParts.push(`OSAC_LLM_PROXY_PORT='${shellEscapeSingle(String(osacLlmEnv.proxyPort))}'`);
    }
    if (osacLlmEnv.upstreamBaseUrl) {
      inlineEnvParts.push(
        `OSAC_LLM_UPSTREAM_BASE_URL='${shellEscapeSingle(osacLlmEnv.upstreamBaseUrl)}'`
      );
    }
    if (osacLlmEnv.upstreamToken) {
      inlineEnvParts.push(`OSAC_LLM_UPSTREAM_TOKEN='${shellEscapeSingle(osacLlmEnv.upstreamToken)}'`);
    }
    if (osacLlmEnv.timeoutMs) {
      inlineEnvParts.push(`OSAC_LLM_PROXY_TIMEOUT_MS='${shellEscapeSingle(osacLlmEnv.timeoutMs)}'`);
    }
    if (osacLlmEnv.maxInflightPerSession) {
      inlineEnvParts.push(
        `OSAC_LLM_PROXY_MAX_INFLIGHT_PER_SESSION='${shellEscapeSingle(osacLlmEnv.maxInflightPerSession)}'`
      );
    }
    if (osacLlmEnv.queueTimeoutMs) {
      inlineEnvParts.push(
        `OSAC_LLM_PROXY_QUEUE_TIMEOUT_MS='${shellEscapeSingle(osacLlmEnv.queueTimeoutMs)}'`
      );
    }
    if (osacLlmEnv.streamIdleTimeoutMs) {
      inlineEnvParts.push(
        `OSAC_LLM_PROXY_STREAM_IDLE_TIMEOUT_MS='${shellEscapeSingle(osacLlmEnv.streamIdleTimeoutMs)}'`
      );
    }
    if (osacLlmEnv.wsPingInterval) {
      inlineEnvParts.push(`OSAC_WS_PING_INTERVAL='${shellEscapeSingle(osacLlmEnv.wsPingInterval)}'`);
    }
    if (osacLlmEnv.wsIdleTimeout) {
      inlineEnvParts.push(`OSAC_WS_IDLE_TIMEOUT='${shellEscapeSingle(osacLlmEnv.wsIdleTimeout)}'`);
    }
    if (osacLlmEnv.instanceLockPath) {
      inlineEnvParts.push(`OSAC_INSTANCE_LOCK_PATH='${shellEscapeSingle(osacLlmEnv.instanceLockPath)}'`);
    }
    if (opencodeEnv.baseUrl) {
      inlineEnvParts.push(`OPENAI_BASE_URL='${shellEscapeSingle(opencodeEnv.baseUrl)}'`);
    }
    if (opencodeEnv.apiKey) {
      inlineEnvParts.push(`OPENAI_API_KEY='${shellEscapeSingle(opencodeEnv.apiKey)}'`);
    }
    if (opencodeEnv.model) {
      inlineEnvParts.push(`OPENCODE_MODEL='${shellEscapeSingle(opencodeEnv.model)}'`);
    }
    if (opencodeEnv.providerId) {
      inlineEnvParts.push(`OPENCODE_PROVIDER_ID='${shellEscapeSingle(opencodeEnv.providerId)}'`);
    }
    const inlineEnv = inlineEnvParts.join(' ');
    const startCommand = `mkdir -p ${remoteDir} ${remoteDir}/log ${remoteDir}/tmp && mv -f ${remoteDir}/${osacUploadedName} ${remoteOsacPath} && mv -f ${remoteDir}/${opencodeUploadedName} ${remoteOpencodePath} && chmod +x ${remoteOsacPath} ${remoteOpencodePath} && setsid env ${inlineEnv} ${launchCommand} >> ${remoteDir}/log/osac.log 2>&1 < /dev/null &`;

    const execResult = await kvmConnector.execSession(sessionId, {
      path: '/bin/bash',
      args: ['-lc', startCommand],
      capture_output: false,
      timeout_seconds: 30,
      env,
    });

    const execJob = await awaitJobIfNeeded(execResult);
    assertJobSuccess(execJob, 'OSAC 启动');
    let osacReady = await waitForOsacListening(sessionId, osacBootstrapConfig.osacPort, 12);

    if (!osacReady) {
      const fallbackCommand = `mkdir -p ${remoteDir} ${remoteDir}/log ${remoteDir}/tmp && touch ${remoteDir}/log/osac.log && chmod +x ${remoteOsacPath} ${remoteOpencodePath} && nohup env ${inlineEnv} ${launchCommand} >> ${remoteDir}/log/osac.log 2>&1 < /dev/null &`;
      const fallbackExec = await kvmConnector.execSession(sessionId, {
        path: '/bin/bash',
        args: ['-lc', fallbackCommand],
        capture_output: false,
        timeout_seconds: 30,
        env,
      });
      const fallbackJob = await awaitJobIfNeeded(fallbackExec);
      assertJobSuccess(fallbackJob, 'OSAC 启动(回退)');
      osacReady = await waitForOsacListening(sessionId, osacBootstrapConfig.osacPort, 10);
    }

    // 连接模式说明：
    // - direct: 直接使用 VM IP + OSAC 端口，适合内网可直达场景
    // - port-mapping: 由宿主机进行端口转发，外部仅需连接宿主机映射端口
    // 后续可视化平台可基于 metadata.osacConnectionMode / osacHostPort / osacEndpoint 做展示。
    if (osacBootstrapConfig.connectionMode === 'port-mapping') {
      const host = osacBootstrapConfig.portMappingHost || buildOrchestratorHost();
      const { base, range } = pickPortMappingConfig();
      let mappedPort = computePortCandidate(sessionId, base, range);
      let mapped = false;

      try {
        const existingPorts = await kvmConnector.listSandboxPorts(
          sessionId,
          buildSandboxPortProbeQuery(0)
        );
        const existingItems = extractSandboxPortMappings(existingPorts.data);
        const existing = findSandboxPortMapping(existingItems as any[], osacBootstrapConfig.osacPort);
        const normalizedExisting = normalizeSandboxPortMapping(existing as any);
        if (existing && normalizedExisting.hostPort !== null) {
          mappedPort = normalizedExisting.hostPort;
          mapped = true;
        }
      } catch {
        // ignore and continue to create mapping
      }

      for (let attempt = 0; attempt < Math.max(range, 1); attempt++) {
        if (mapped) {
          break;
        }
        try {
          await kvmConnector.createSandboxPort(sessionId, {
            vm_port: osacBootstrapConfig.osacPort,
            host_port: mappedPort,
            protocol: 'tcp',
          });
          mapped = true;
          break;
        } catch {
          mappedPort = base + ((mappedPort - base + 1) % Math.max(range, 1));
        }
      }

      if (mapped && host) {
        osacEndpoint = `ws://${host}:${mappedPort}${osacBootstrapConfig.osacPathSuffix}`;
        await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
          ...mergedMetadata,
          osacEndpoint,
          osacHost: host,
          osacHostPort: mappedPort,
          osacConnectionMode: 'port-mapping',
        });
      }

      // 等待端口映射就绪（fix5: 支持 refresh/verify/wait_seconds）
      if (mapped && host) {
        const waitSeconds = getSandboxPortWaitSeconds();
        const maxChecks = getSandboxPortCheckCount();
        for (let i = 0; i < maxChecks; i++) {
          try {
            const ports = await kvmConnector.listSandboxPorts(
              sessionId,
              buildSandboxPortProbeQuery(waitSeconds)
            );
            const items = extractSandboxPortMappings(ports.data);
            const matched = findSandboxPortMapping(
              items as any[],
              osacBootstrapConfig.osacPort,
              mappedPort
            );
            if (matched && isSandboxPortReady(matched as any)) {
              break;
            }
          } catch {
            // ignore and retry
          }
          await sleep(2000);
        }
      }
    }

    if (!ipAddress && osacBootstrapConfig.connectionMode !== 'port-mapping') {
      ipAddress = await waitForVmIp(sessionId, vmName, 20);
      if (!ipAddress) {
        ipAddress = await fetchIpViaGuestExec(sessionId);
      }
      osacEndpoint = ipAddress
        ? `ws://${ipAddress}:${osacBootstrapConfig.osacPort}${osacBootstrapConfig.osacPathSuffix}`
        : null;
      await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, {
        ...mergedMetadata,
        osacEndpoint,
        vmIpAddress: ipAddress,
        osacAuthToken: osacToken,
      });
    }

    if (osacLlmEnv.enabled && osacEndpoint && shouldEagerBridgeOnProvision()) {
      const bridgeReady = await osacConnectionManager.ensurePersistent(sessionId);
      if (!bridgeReady) {
        console.warn(
          '[OSAC_BRIDGE_NOT_READY]',
          sessionId,
          'websocket auth/port mapping may be unstable; continue with background reconnect'
        );
      }
    }

    return {
      sessionId,
      vmName: vmName || environment.vmName,
      vmIpAddress: ipAddress,
      osacEndpoint,
      status: osacEndpoint ? 'ready' : 'pending',
      bootstrap: {
        osacBinaryUrl,
        opencodeBinaryUrl,
        osacPort: osacBootstrapConfig.osacPort,
        osacPathSuffix: osacBootstrapConfig.osacPathSuffix,
      },
    };
  }
}

export const sandboxAgentProvisionService = new SandboxAgentProvisionService();
