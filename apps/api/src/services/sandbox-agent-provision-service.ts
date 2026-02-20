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
import { osacAgentService } from './osac-agent-service';
import { KvmClientError } from '../clients/kvm-orchestrator-client';
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

type SandboxStatus = 'ready' | 'using';
type WarmPoolState = 'seeding' | 'ready' | 'using' | 'retired' | 'failed';
type AllocationSource = 'warm_pool' | 'cold_start';

function toSandboxStatus(value: unknown, fallback: SandboxStatus = 'using'): SandboxStatus {
  return value === 'ready' ? 'ready' : value === 'using' ? 'using' : fallback;
}

function toWarmPoolState(value: unknown): WarmPoolState | null {
  if (value === 'seeding') return 'seeding';
  if (value === 'ready') return 'ready';
  if (value === 'using') return 'using';
  if (value === 'retired') return 'retired';
  if (value === 'failed') return 'failed';
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
  const defaultProxyBaseUrl = `http://127.0.0.1:${proxyPort}`;
  const baseUrlCandidate =
    process.env.OPENCODE_BASE_URL ||
    process.env.OPENCODE_PROXY_BASE_URL ||
    defaultProxyBaseUrl;
  const apiKeyCandidate =
    process.env.OPENCODE_API_KEY ||
    process.env.OPENCODE_PROXY_API_KEY ||
    'local-proxy';
  const publicBaseUrlCandidate =
    process.env.OPENCODE_PUBLIC_BASE_URL ||
    process.env.LLM_PROXY_UPSTREAM_BASE_URL ||
    '';
  const publicApiKeyCandidate =
    process.env.OPENCODE_PUBLIC_API_KEY ||
    process.env.LLM_PROXY_UPSTREAM_API_KEY ||
    '';
  const proxyEnabledRaw = (process.env.OSAC_LLM_PROXY_ENABLE || 'false').trim().toLowerCase();
  const proxyEnabled = proxyEnabledRaw !== 'false';
  const forcedProxyBaseUrl = normalizeOpenAiBaseUrl(`http://127.0.0.1:${proxyPort}/v1`);
  const normalizedCandidateBaseUrl = normalizeOpenAiBaseUrl(baseUrlCandidate);
  const useForcedProxyBase = proxyEnabled;
  const usePublicDirectFallback =
    !proxyEnabled &&
    isLoopbackBaseUrl(normalizedCandidateBaseUrl) &&
    !!publicBaseUrlCandidate;
  const baseUrlRaw = useForcedProxyBase
    ? forcedProxyBaseUrl
    : usePublicDirectFallback
      ? publicBaseUrlCandidate
      : baseUrlCandidate;
  const apiKeyRaw = useForcedProxyBase
    ? 'local-proxy'
    : usePublicDirectFallback && publicApiKeyCandidate
      ? publicApiKeyCandidate
      : apiKeyCandidate;

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
      useForcedProxyBase ||
      usePublicDirectFallback
    ),
    explicitApiKey: Boolean(
      process.env.OPENCODE_API_KEY ||
      process.env.OPENCODE_PROXY_API_KEY ||
      useForcedProxyBase ||
      (usePublicDirectFallback && publicApiKeyCandidate)
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
  const enabledRaw = (process.env.OSAC_LLM_PROXY_ENABLE || 'false').trim().toLowerCase();
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

function extractOsacAuthToken(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const osac = payload.osac && typeof payload.osac === 'object' ? (payload.osac as Record<string, unknown>) : null;
  return pickString(
    payload.osacAuthToken,
    payload.osacToken,
    payload.authToken,
    payload.token,
    payload.osac_auth_token,
    payload.osac_token,
    payload.auth_token,
    osac?.authToken,
    osac?.token
  );
}

function extractPoolClaimSessionId(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const session = payload.session && typeof payload.session === 'object'
    ? (payload.session as Record<string, unknown>)
    : null;
  return pickString(
    payload.sessionId,
    payload.session_id,
    payload.orchestratorSessionId,
    payload.orchestrator_session_id,
    session?.sessionId,
    session?.session_id,
    session?.id
  );
}

function extractPoolClaimVmName(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const vm = payload.vm && typeof payload.vm === 'object' ? (payload.vm as Record<string, unknown>) : null;
  const target = payload.target && typeof payload.target === 'object'
    ? (payload.target as Record<string, unknown>)
    : null;
  return pickString(
    payload.vmName,
    payload.vm_name,
    vm?.name,
    vm?.vmName,
    target?.vmName,
    target?.vm_name
  );
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

type ProvisionInput = {
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  bind?: Record<string, unknown>;
  requestBaseUrl?: string;
  __skipWarmPool?: boolean;
  __warmPoolSeed?: boolean;
  __warmPoolReason?: string;
};

type ProvisionResult = {
  sessionId: string;
  vmName: string | null;
  vmIpAddress: string | null;
  osacEndpoint: string | null;
  osacHost?: string | null;
  osacHostPort?: number | null;
  osacConnectionMode?: 'direct' | 'port-mapping' | 'kvm-tcp-relay' | null;
  osacAuthToken?: string | null;
  status: string;
  sandboxStatus?: SandboxStatus;
  allocationSource: AllocationSource;
  degradedFromWarmPool: boolean;
  readyGatePassed: boolean;
  bootstrap: {
    osacBinaryUrl: string;
    opencodeBinaryUrl: string;
    osacPort: number;
    osacPathSuffix: string;
  };
  warmPoolHit?: boolean;
};

type WarmPoolConfig = {
  enabled: boolean;
  targetSize: number;
  maxInflight: number;
  checkIntervalMs: number;
  scanLimit: number;
  waitReadyMs: number;
  waitPollMs: number;
  seedingTtlMs: number;
  creatingTtlMs: number;
  readyGateEnabled: boolean;
  readyGateTimeoutMs: number;
  readyGateModelsTimeoutMs: number;
  readyGatePollMs: number;
  cleanupCloseSession: boolean;
};

type ProvisionReadyGateConfig = {
  enabled: boolean;
  strict: boolean;
  timeoutMs: number;
  modelsTimeoutMs: number;
  pollMs: number;
};

type KvmWarmPoolConfig = {
  enabled: boolean;
  claimTimeoutMs: number;
  strict: boolean;
  releaseOnFailure: boolean;
};

type WarmPoolSummary = {
  enabled: boolean;
  targetSize: number;
  maxInflight: number;
  inFlight: number;
  checkIntervalMs: number;
  availableCount: number;
  healthyReadyCount: number;
  usingCount: number;
  seedingCount: number;
  staleSeedingCount: number;
  totalWarmCount: number;
  lastEnsureAt: string | null;
  lastEnsureReason: string | null;
  lastEnsureError: string | null;
  lastCleanupAt: string | null;
  coldStartFallbackCount: number;
  claimFailByCode: Record<string, number>;
  readyQueue: string[];
  samples: Array<{
    sessionId: string;
    status: string;
    vmName: string | null;
    warmState: string | null;
    sandboxStatus: SandboxStatus | null;
    osacEndpoint: string | null;
    createdAt?: string;
  }>;
};

export class SandboxAgentProvisionService {
  private readonly warmPoolConfig: WarmPoolConfig = (() => {
    const targetSize = Math.max(0, Number(process.env.OSAC_WARM_POOL_SIZE || 5));
    const defaultMaxInflight = targetSize > 0 ? targetSize : 1;
    const waitReadyMs = Math.max(0, Number(process.env.OSAC_WARM_POOL_WAIT_READY_MS || 10000));
    const waitPollMs = Math.max(500, Number(process.env.OSAC_WARM_POOL_WAIT_POLL_MS || 2000));
    const seedingTtlMs = Math.max(60_000, Number(process.env.OSAC_WARM_POOL_SEEDING_TTL_MS || 180000));
    const creatingTtlMs = Math.max(120_000, Number(process.env.OSAC_WARM_POOL_CREATING_TTL_MS || 300000));
    const readyGateTimeoutMs = Math.max(5000, Number(process.env.OSAC_WARM_POOL_READY_GATE_TIMEOUT_MS || 60000));
    const readyGateModelsTimeoutMs = Math.max(
      5000,
      Number(process.env.OSAC_WARM_POOL_READY_GATE_MODELS_TIMEOUT_MS || 90000)
    );
    const readyGatePollMs = Math.max(500, Number(process.env.OSAC_WARM_POOL_READY_GATE_POLL_MS || 1500));
    return {
      enabled: toBool(process.env.OSAC_WARM_POOL_ENABLED, true),
      targetSize,
      maxInflight: Math.max(1, Number(process.env.OSAC_WARM_POOL_MAX_INFLIGHT || defaultMaxInflight)),
      checkIntervalMs: Math.max(5000, Number(process.env.OSAC_WARM_POOL_CHECK_INTERVAL_MS || 20000)),
      scanLimit: Math.max(20, Number(process.env.OSAC_WARM_POOL_SCAN_LIMIT || 80)),
      waitReadyMs,
      waitPollMs,
      seedingTtlMs,
      creatingTtlMs,
      readyGateEnabled: toBool(process.env.OSAC_WARM_POOL_READY_GATE_ENABLED, true),
      readyGateTimeoutMs,
      readyGateModelsTimeoutMs,
      readyGatePollMs,
      cleanupCloseSession: toBool(process.env.OSAC_WARM_POOL_CLEANUP_CLOSE_SESSION, true),
    };
  })();
  private readonly provisionReadyGateConfig: ProvisionReadyGateConfig = (() => {
    return {
      enabled: toBool(process.env.OSAC_PROVISION_READY_GATE_ENABLED, true),
      strict: toBool(process.env.OSAC_PROVISION_READY_GATE_STRICT, true),
      timeoutMs: Math.max(5000, Number(process.env.OSAC_PROVISION_READY_GATE_TIMEOUT_MS || 60000)),
      modelsTimeoutMs: Math.max(
        5000,
        Number(process.env.OSAC_PROVISION_READY_GATE_MODELS_TIMEOUT_MS || 90000)
      ),
      pollMs: Math.max(500, Number(process.env.OSAC_PROVISION_READY_GATE_POLL_MS || 1500)),
    };
  })();
  private readonly kvmWarmPoolConfig: KvmWarmPoolConfig = (() => {
    return {
      enabled: toBool(
        process.env.OSAC_KVM_POOL_ENABLED,
        osacBootstrapConfig.connectionMode === 'kvm-tcp-relay'
      ),
      claimTimeoutMs: Math.max(1000, Number(process.env.OSAC_KVM_POOL_CLAIM_TIMEOUT_MS || 15000)),
      strict: toBool(process.env.OSAC_KVM_POOL_STRICT, false),
      releaseOnFailure: toBool(process.env.OSAC_KVM_POOL_RELEASE_ON_FAILURE, true),
    };
  })();

  private warmPoolTimer: NodeJS.Timeout | null = null;
  private warmPoolInFlight = 0;
  private warmPoolStarted = false;
  private warmPoolLastEnsureAt: string | null = null;
  private warmPoolLastEnsureReason: string | null = null;
  private warmPoolLastEnsureError: string | null = null;
  private warmPoolLastCleanupAt: string | null = null;
  private warmPoolColdStartFallbackCount = 0;
  private readonly warmPoolClaimFailByCode = new Map<string, number>();
  private warmPoolLock: Promise<void> = Promise.resolve();

  constructor() {}

  private withWarmPoolLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.warmPoolLock;
    let release: (() => void) | null = null;
    this.warmPoolLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    return previous
      .then(fn)
      .finally(() => {
        if (release) {
          release();
        }
      });
  }

  private async withTimeout<T>(label: string, timeoutMs: number, promise: Promise<T>): Promise<T> {
    const normalized = Math.max(1000, timeoutMs);
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), normalized);
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private getWarmPoolState(metadata: Record<string, unknown> | null | undefined): WarmPoolState | null {
    if (!metadata) return null;
    const warmPool = metadata.warmPool as Record<string, unknown> | undefined;
    return toWarmPoolState(warmPool?.state);
  }

  private bumpWarmPoolClaimFailure(reason: string) {
    const key = reason && reason.trim() ? reason.trim() : 'unknown';
    this.warmPoolClaimFailByCode.set(key, (this.warmPoolClaimFailByCode.get(key) || 0) + 1);
  }

  private getWarmPoolClaimFailureSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of this.warmPoolClaimFailByCode.entries()) {
      out[key] = value;
    }
    return out;
  }

  private getRowTimeMs(row: any): number {
    const value = row?.updatedAt || row?.createdAt;
    const ms = value ? new Date(value).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  }

  private getRowAgeMs(row: any, nowMs: number): number {
    const timeMs = this.getRowTimeMs(row);
    if (timeMs <= 0) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Math.max(0, nowMs - timeMs);
  }

  private getWarmPoolFailureCode(message: string): string {
    const text = message || '';
    const codeMatch = text.match(/\bcode=([a-zA-Z0-9_.-]+)/);
    if (codeMatch?.[1]) {
      return codeMatch[1];
    }
    const jsonMatch = text.match(/"code"\s*:\s*"([^"]+)"/);
    if (jsonMatch?.[1]) {
      return jsonMatch[1];
    }
    const compact = text.toLowerCase();
    if (compact.includes('token_mismatch')) return 'token_mismatch';
    if (compact.includes('bridge_disconnected')) return 'bridge_disconnected';
    if (compact.includes('mapping_not_ready')) return 'mapping_not_ready';
    if (compact.includes('mapping_stale')) return 'mapping_stale';
    if (compact.includes('timed out') || compact.includes('timeout')) return 'timeout';
    return 'unknown';
  }

  private isStaleWarmRow(row: any, nowMs: number): boolean {
    const metadata = (row?.metadata || {}) as Record<string, unknown>;
    const warmState = this.getWarmPoolState(metadata);
    const ageMs = this.getRowAgeMs(row, nowMs);
    if (warmState === 'seeding' && ageMs > this.warmPoolConfig.seedingTtlMs) {
      return true;
    }
    if (row?.status === 'creating' && warmState !== 'ready' && warmState !== 'using' && ageMs > this.warmPoolConfig.creatingTtlMs) {
      return true;
    }
    return false;
  }

  private async cleanupStaleWarmRows(rows: any[], trigger: string): Promise<number> {
    const nowMs = Date.now();
    let cleaned = 0;
    for (const row of rows) {
      if (!this.isStaleWarmRow(row, nowMs)) {
        continue;
      }
      const sessionId = String(row?.sessionId || '');
      if (!sessionId) {
        continue;
      }
      const metadata = (row?.metadata || {}) as Record<string, unknown>;
      try {
        await this.markWarmSessionState(sessionId, metadata, 'retired', `stale_${trigger}`);
      } catch {
        // ignore state update failure and still attempt close/update-status
      }

      if (this.warmPoolConfig.cleanupCloseSession) {
        try {
          await kvmConnector.closeSession(sessionId, { graceful: true });
        } catch {
          // ignore close errors
        }
      }

      try {
        await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'failed', row?.vmName || null);
      } catch {
        // ignore status update failure
      }
      cleaned += 1;
    }
    if (cleaned > 0) {
      this.warmPoolLastCleanupAt = new Date().toISOString();
    }
    return cleaned;
  }

  private async verifyWarmReadyGate(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<{ ok: boolean; metadata: Record<string, unknown>; reason?: string }> {
    const health = await this.verifyWarmSessionHealthDetailed(sessionId, metadata);
    if (!health.ok) {
      return { ok: false, metadata: health.metadata, reason: health.reason || 'unhealthy_before_gate' };
    }
    const healthyMetadata = health.metadata;
    if (!this.warmPoolConfig.readyGateEnabled) {
      return { ok: true, metadata: healthyMetadata };
    }

    try {
      const connected = await this.withTimeout(
        'warm_ready_gate_connect',
        this.warmPoolConfig.readyGateTimeoutMs,
        osacConnectionManager.ensurePersistent(sessionId)
      );
      if (!connected) {
        return { ok: false, metadata: healthyMetadata, reason: 'ws_not_ready' };
      }

      await this.withTimeout(
        'warm_ready_gate_session_list',
        this.warmPoolConfig.readyGateTimeoutMs,
        osacAgentService.getSessionList(sessionId, { maxCount: 1, format: 'json' })
      );

      const probe = await this.withTimeout(
        'warm_ready_gate_models_probe',
        this.warmPoolConfig.readyGateModelsTimeoutMs,
        osacAgentService.executeCommandAndWait(
          sessionId,
          {
            command: 'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"',
            options: {},
          },
          {
            timeoutMs: this.warmPoolConfig.readyGateModelsTimeoutMs,
            pollMs: this.warmPoolConfig.readyGatePollMs,
          }
        )
      );

      const output = String(probe.output || '');
      if (!output.includes('"data"')) {
        const reason = this.getWarmPoolFailureCode(output);
        return { ok: false, metadata: healthyMetadata, reason: reason || 'models_probe_failed' };
      }
      return { ok: true, metadata: healthyMetadata };
    } catch (error) {
      const reason = this.getWarmPoolFailureCode(error instanceof Error ? error.message : String(error));
      return { ok: false, metadata: healthyMetadata, reason };
    }
  }

  private async verifyProvisionReadyGate(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<{ ok: boolean; metadata: Record<string, unknown>; reason?: string }> {
    if (!this.provisionReadyGateConfig.enabled) {
      return { ok: true, metadata };
    }

    const startedAt = Date.now();
    const overallTimeoutMs = Math.max(3000, this.provisionReadyGateConfig.timeoutMs);
    const deadline = startedAt + overallTimeoutMs;

    let currentMetadata = metadata;
    let lastReason = 'unhealthy_before_gate';

    while (Date.now() < deadline) {
      const health = await this.verifyWarmSessionHealthDetailed(sessionId, currentMetadata);
      currentMetadata = health.metadata;
      if (!health.ok) {
        lastReason = health.reason || 'unhealthy_before_gate';
      } else {
        try {
          const remainingMs = Math.max(1000, deadline - Date.now());
          const connectTimeoutMs = Math.min(remainingMs, Math.max(3000, this.provisionReadyGateConfig.timeoutMs));
          const modelsTimeoutMs = Math.min(remainingMs, Math.max(5000, this.provisionReadyGateConfig.modelsTimeoutMs));

          const connected = await this.withTimeout(
            'provision_ready_gate_connect',
            connectTimeoutMs,
            osacConnectionManager.ensurePersistent(sessionId)
          );
          if (!connected) {
            lastReason = 'ws_not_ready';
          } else {
            await this.withTimeout(
              'provision_ready_gate_session_list',
              connectTimeoutMs,
              osacAgentService.getSessionList(sessionId, { maxCount: 1, format: 'json' })
            );

            const probe = await this.withTimeout(
              'provision_ready_gate_models_probe',
              modelsTimeoutMs,
              osacAgentService.executeCommandAndWait(
                sessionId,
                {
                  command: 'curl -sS -m 60 http://127.0.0.1:18111/v1/models -H "Authorization: Bearer local-proxy"',
                  options: {},
                },
                {
                  timeoutMs: modelsTimeoutMs,
                  pollMs: this.provisionReadyGateConfig.pollMs,
                }
              )
            );

            const output = String(probe.output || '');
            if (!output.includes('"data"')) {
              const reason = this.getWarmPoolFailureCode(output);
              lastReason = reason || 'models_probe_failed';
            } else {
              return { ok: true, metadata: currentMetadata };
            }
          }
        } catch (error) {
          lastReason = this.getWarmPoolFailureCode(error instanceof Error ? error.message : String(error));
        }
      }

      const sleepMs = Math.max(300, this.provisionReadyGateConfig.pollMs);
      if (Date.now() + sleepMs >= deadline) {
        break;
      }
      await sleep(sleepMs);
    }

    return { ok: false, metadata: currentMetadata, reason: lastReason || 'provision_ready_gate_timeout' };
  }

  private isWarmPoolManaged(metadata: Record<string, unknown> | null | undefined): boolean {
    if (!metadata) return false;
    const warmState = this.getWarmPoolState(metadata);
    if (warmState) return true;
    const owner = pickString(metadata.owner);
    const purpose = pickString(metadata.purpose);
    return owner === 'osac-warm-pool' || purpose === 'osac-warm-pool';
  }

  private buildWarmSeedMetadata(reason: string): Record<string, unknown> {
    return {
      owner: 'osac-warm-pool',
      purpose: 'osac-warm-pool',
      warmPool: {
        state: 'seeding',
        sandboxStatus: 'using',
        reason,
        seededAt: new Date().toISOString(),
      },
      warmPoolSandboxStatus: 'using',
      sandboxStatus: 'using',
    };
  }

  private shouldUseWarmPool(input: ProvisionInput): boolean {
    if (!this.warmPoolConfig.enabled || this.warmPoolConfig.targetSize <= 0) {
      return false;
    }
    if (input.__skipWarmPool) {
      return false;
    }
    // idempotent create must preserve deterministic behavior.
    if (input.idempotencyKey) {
      return false;
    }
    return true;
  }

  private ensureWarmPoolStarted() {
    if (!this.warmPoolConfig.enabled || this.warmPoolConfig.targetSize <= 0) {
      return;
    }
    if (this.warmPoolStarted) {
      return;
    }
    this.warmPoolStarted = true;
    this.warmPoolTimer = setInterval(() => {
      void this.ensureWarmPool('ticker');
    }, this.warmPoolConfig.checkIntervalMs);
    if (this.warmPoolTimer && typeof this.warmPoolTimer.unref === 'function') {
      this.warmPoolTimer.unref();
    }
    void this.ensureWarmPool('startup');
  }

  private scheduleWarmPoolEnsure(reason: string) {
    if (!this.warmPoolConfig.enabled || this.warmPoolConfig.targetSize <= 0) {
      return;
    }
    this.ensureWarmPoolStarted();
    void this.ensureWarmPool(reason);
  }

  private async listWarmPoolRows(limit?: number) {
    const maxRows = limit || this.warmPoolConfig.scanLimit;
    const rows = await sandboxExecutionEnvironmentDAO.listRecent(maxRows);
    return rows.filter((row: any) => this.isWarmPoolManaged((row?.metadata || {}) as Record<string, unknown>));
  }

  private async refreshWarmMappingMetadata(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (osacBootstrapConfig.connectionMode !== 'port-mapping') {
      return metadata;
    }
    const host = osacBootstrapConfig.portMappingHost || buildOrchestratorHost();
    if (!host) {
      return metadata;
    }

    const preferredHostPort =
      typeof metadata.osacHostPort === 'number'
        ? metadata.osacHostPort
        : typeof metadata.osacHostPort === 'string'
          ? Number(metadata.osacHostPort)
          : undefined;

    const ports = await kvmConnector.listSandboxPorts(sessionId, buildSandboxPortProbeQuery(5));
    const items = extractSandboxPortMappings(ports.data);
    const matched = findSandboxPortMapping(
      items as any[],
      osacBootstrapConfig.osacPort,
      Number.isFinite(preferredHostPort as number) ? Number(preferredHostPort) : undefined
    );
    if (!matched || !isSandboxPortReady(matched as any)) {
      return metadata;
    }

    const normalized = normalizeSandboxPortMapping(matched as any);
    if (normalized.hostPort === null) {
      return metadata;
    }

    const endpoint = `ws://${host}:${normalized.hostPort}${osacBootstrapConfig.osacPathSuffix}`;
    if (
      pickString(metadata.osacEndpoint) === endpoint &&
      Number(metadata.osacHostPort || 0) === normalized.hostPort
    ) {
      return metadata;
    }

    const nextMetadata: Record<string, unknown> = {
      ...metadata,
      osacConnectionMode: 'port-mapping',
      osacHost: host,
      osacHostPort: normalized.hostPort,
      osacEndpoint: endpoint,
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, nextMetadata);
    return nextMetadata;
  }

  private async verifyWarmSessionHealthDetailed(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<{ ok: boolean; metadata: Record<string, unknown>; reason?: string }> {
    try {
      const sandbox = await kvmConnector.getSandbox(sessionId);
      const sandboxData = (sandbox.data as any) || {};
      const state = String(sandboxData?.state || '').toLowerCase();
      if (state && state !== 'running') {
        return { ok: false, metadata, reason: `sandbox_state_${state}` };
      }
      const lifecycleState = pickString(sandboxData?.lifecycleState, sandboxData?.lifecycle_state);
      if (lifecycleState) {
        const normalized = lifecycleState.toLowerCase();
        if (normalized !== 'ready' && normalized !== 'running') {
          return { ok: false, metadata, reason: `sandbox_lifecycle_${normalized}` };
        }
      }
      const readyGate = (sandboxData?.readyGate || sandboxData?.ready_gate || {}) as Record<string, unknown>;
      if (Object.keys(readyGate).length > 0) {
        const explicitReady =
          readyGate?.ready === true ||
          readyGate?.ok === true ||
          readyGate?.passed === true ||
          readyGate?.pass === true;

        const componentValues = [
          readyGate?.vmExists,
          readyGate?.vm_exists,
          readyGate?.vmRunning,
          readyGate?.vm_running,
          readyGate?.bindingOk,
          readyGate?.binding_ok,
          readyGate?.qgaConnected,
          readyGate?.qga_connected,
          readyGate?.vmPortReady,
          readyGate?.vm_port_ready,
          readyGate?.loopbackPortReady,
          readyGate?.loopback_port_ready,
          readyGate?.hostPortReady,
          readyGate?.host_port_ready,
          readyGate?.osacPidReady,
          readyGate?.osac_pid_ready,
        ].filter((value) => typeof value === 'boolean') as boolean[];

        const hasFailureMarker =
          Boolean(pickString(readyGate?.failureReason, readyGate?.failure_reason)) ||
          Boolean(pickString(readyGate?.failedStage, readyGate?.failed_stage));

        const ready =
          explicitReady ||
          (componentValues.length > 0 ? componentValues.every((value) => value === true) : !hasFailureMarker);

        if (!ready) {
          const failedStage = pickString(readyGate?.failedStage, readyGate?.failed_stage);
          const reasonCode = pickString(readyGate?.reasonCode, readyGate?.reason_code);
          const failureReason = pickString(readyGate?.failureReason, readyGate?.failure_reason);
          if (reasonCode) {
            return { ok: false, metadata, reason: reasonCode };
          }
          if (failureReason) {
            return { ok: false, metadata, reason: failureReason };
          }
          if (failedStage) {
            return { ok: false, metadata, reason: `ready_gate_${failedStage}` };
          }
          return { ok: false, metadata, reason: 'ready_gate_not_passed' };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Session') && message.includes('not found')) {
        return { ok: false, metadata, reason: 'kvm_session_not_found' };
      }
      if (message.includes('SESSION_NOT_FOUND')) {
        return { ok: false, metadata, reason: 'kvm_session_not_found' };
      }
      return { ok: false, metadata, reason: 'sandbox_query_failed' };
    }

    try {
      const refreshed = await this.refreshWarmMappingMetadata(sessionId, metadata);
      const endpoint = pickString(refreshed.osacEndpoint);
      if (!endpoint) {
        return { ok: false, metadata: refreshed, reason: 'osac_endpoint_missing' };
      }
      return { ok: true, metadata: refreshed };
    } catch {
      return { ok: false, metadata, reason: 'mapping_refresh_failed' };
    }
  }

  private async verifyWarmSessionHealth(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const detail = await this.verifyWarmSessionHealthDetailed(sessionId, metadata);
    return detail.ok ? detail.metadata : null;
  }

  private async markWarmSessionState(
    sessionId: string,
    metadata: Record<string, unknown>,
    state: WarmPoolState,
    reason?: string
  ) {
    const warmPool = (metadata.warmPool || {}) as Record<string, unknown>;
    const sandboxStatus: SandboxStatus = state === 'ready' ? 'ready' : 'using';
    const nextMetadata: Record<string, unknown> = {
      ...metadata,
      warmPool: {
        ...warmPool,
        state,
        sandboxStatus,
        reason: reason || warmPool.reason || '',
        updatedAt: new Date().toISOString(),
      },
      warmPoolSandboxStatus: sandboxStatus,
      sandboxStatus,
    };
    await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, nextMetadata);
  }

  private buildProvisionResult(
    sessionId: string,
    vmName: string | null | undefined,
    metadata: Record<string, unknown>,
    requestBaseUrl?: string,
    options?: {
      warmPoolHit?: boolean;
      allocationSource?: AllocationSource;
      degradedFromWarmPool?: boolean;
      readyGatePassed?: boolean;
    }
  ): ProvisionResult {
    const downloadBase = buildDownloadBaseUrl(requestBaseUrl);
    const sandboxStatus = toSandboxStatus(
      pickString(
        metadata.sandboxStatus,
        metadata.warmPoolSandboxStatus,
        ((metadata.warmPool as Record<string, unknown> | undefined) || {}).sandboxStatus
      ),
      pickString(metadata.osacEndpoint) ? 'ready' : 'using'
    );
    return {
      sessionId,
      vmName: vmName || null,
      vmIpAddress: pickString(metadata.vmIpAddress) || null,
      osacEndpoint: pickString(metadata.osacEndpoint) || null,
      osacHost: pickString(metadata.osacHost) || null,
      osacHostPort:
        typeof metadata.osacHostPort === 'number'
          ? metadata.osacHostPort
          : typeof metadata.osacHostPort === 'string' && metadata.osacHostPort.trim()
            ? Number(metadata.osacHostPort)
            : null,
      osacConnectionMode:
        (pickString(metadata.osacConnectionMode) as ProvisionResult['osacConnectionMode']) || null,
      osacAuthToken: pickString(metadata.osacAuthToken, metadata.osacToken) || null,
      status: pickString(metadata.osacEndpoint) ? 'ready' : 'pending',
      sandboxStatus,
      allocationSource: options?.allocationSource || 'cold_start',
      degradedFromWarmPool: options?.degradedFromWarmPool === true,
      readyGatePassed: options?.readyGatePassed === true,
      bootstrap: {
        osacBinaryUrl: `${downloadBase}/osac`,
        opencodeBinaryUrl: `${downloadBase}/opencode`,
        osacPort: osacBootstrapConfig.osacPort,
        osacPathSuffix: osacBootstrapConfig.osacPathSuffix,
      },
      warmPoolHit: options?.warmPoolHit === true ? true : undefined,
    };
  }

  private shouldUseKvmWarmPool(input: ProvisionInput): boolean {
    if (!this.kvmWarmPoolConfig.enabled) {
      return false;
    }
    // keep deterministic semantics for idempotent create.
    if (input.idempotencyKey) {
      return false;
    }
    // legacy internal warm-seed path should never enter KVM pool path.
    if (input.__warmPoolSeed === true) {
      return false;
    }
    return true;
  }

  private buildKvmWarmPoolPurpose(input: ProvisionInput): string {
    const metadata = input.metadata || {};
    return (
      pickString(
        metadata.poolPurpose,
        metadata.taskTitle,
        metadata.taskSessionId,
        metadata.owner,
        metadata.purpose
      ) || 'osac-provision'
    );
  }

  private async releaseClaimedKvmWarmPoolSession(
    sessionId: string,
    result: 'success' | 'failed',
    reason: string
  ) {
    if (!this.kvmWarmPoolConfig.releaseOnFailure) {
      return;
    }
    try {
      await kvmConnector.releasePoolSandbox(sessionId, { result, reason });
    } catch (error) {
      console.warn(
        '[KVM_POOL_RELEASE_WARN]',
        sessionId,
        result,
        reason,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async tryProvisionFromKvmWarmPool(input: ProvisionInput): Promise<ProvisionResult | null> {
    if (!this.shouldUseKvmWarmPool(input)) {
      return null;
    }

    const purpose = this.buildKvmWarmPoolPurpose(input);
    let claimPayload: Record<string, unknown> | null = null;
    let claimRequestId: string | undefined;

    try {
      const claim = await kvmConnector.claimPoolSandbox({
        purpose,
        timeout_ms: this.kvmWarmPoolConfig.claimTimeoutMs,
      });
      claimPayload = (claim.data || {}) as Record<string, unknown>;
      claimRequestId = claim.requestId;
    } catch (error) {
      const kvmError = error instanceof KvmClientError ? error : null;
      const code = (kvmError?.code || '').toUpperCase();
      const message = error instanceof Error ? error.message : String(error);
      const isTemporary =
        code === 'POOL_EMPTY_TEMPORARY' ||
        code === 'POOL_READY_GATE_FAILED' ||
        (kvmError?.status === 409 && message.includes('POOL_EMPTY_TEMPORARY'));
      if (isTemporary && !this.kvmWarmPoolConfig.strict) {
        return null;
      }
      if (!this.kvmWarmPoolConfig.strict) {
        console.warn('[KVM_POOL_CLAIM_WARN]', code || kvmError?.status || 'unknown', message);
        return null;
      }
      throw error;
    }

    const sessionId = extractPoolClaimSessionId(claimPayload);
    if (!sessionId) {
      if (!this.kvmWarmPoolConfig.strict) {
        return null;
      }
      throw new Error('KVM pool claim 返回缺少 session_id');
    }
    const vmName = extractPoolClaimVmName(claimPayload);

    let sessionMetadata: Record<string, unknown> = {};
    try {
      const session = await kvmConnector.getSession(sessionId);
      const data = (session.data || {}) as Record<string, unknown>;
      const meta =
        (data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : null) ||
        (data.meta && typeof data.meta === 'object' ? (data.meta as Record<string, unknown>) : null);
      if (meta) {
        sessionMetadata = meta;
      }
    } catch {
      // keep claim-only metadata path
    }
    const existing = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    const existingMetadata = ((existing?.metadata || {}) as Record<string, unknown>) || {};

    const osacToken =
      extractOsacAuthToken(claimPayload) ||
      extractOsacAuthToken(sessionMetadata) ||
      extractOsacAuthToken(existingMetadata) ||
      extractOsacAuthToken(input.metadata || null);

    if (!osacToken) {
      await this.releaseClaimedKvmWarmPoolSession(sessionId, 'failed', 'pool_missing_osac_token');
      if (!this.kvmWarmPoolConfig.strict) {
        return null;
      }
      throw new Error('KVM pool claim 缺少 osac auth token');
    }

    const relayObj =
      (claimPayload?.relay && typeof claimPayload.relay === 'object'
        ? (claimPayload.relay as Record<string, unknown>)
        : null) ||
      claimPayload;
    const relayWsUrl = pickString(relayObj.wsUrl, relayObj.ws_url);
    const relaySubprotocol = pickString(relayObj.subprotocol) || 'kvm.tcp.v1';
    const relayExpiresAt = pickString(relayObj.expiresAt, relayObj.expires_at);
    const relayId = pickString(relayObj.relayId, relayObj.relay_id);

    const endpoint = `ws://127.0.0.1:${osacBootstrapConfig.osacPort}${osacBootstrapConfig.osacPathSuffix}`;
    const mergedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      ...sessionMetadata,
      ...(input.metadata || {}),
      sandboxStatus: 'using',
      osacEndpoint: endpoint,
      osacAuthToken: osacToken,
      osacConnectionMode: 'kvm-tcp-relay',
      allocationSource: 'warm_pool',
      kvmWarmPool: {
        source: 'warm_pool',
        purpose,
        claimedAt: new Date().toISOString(),
        claimRequestId: claimRequestId || null,
        relayWsUrl: relayWsUrl || null,
        relaySubprotocol,
        relayExpiresAt: relayExpiresAt || null,
        relayId: relayId || null,
      },
    };

    await sandboxEnvironmentService.attachPoolEnvironment({
      sessionId,
      vmName,
      metadata: mergedMetadata,
      status: 'ready',
    });

    let readyGatePassed = !this.provisionReadyGateConfig.enabled;
    let readyGateReason: string | null = null;
    if (this.provisionReadyGateConfig.enabled) {
      const gate = await this.verifyProvisionReadyGate(sessionId, mergedMetadata);
      readyGatePassed = gate.ok;
      readyGateReason = gate.reason || null;

      const nextMetadata: Record<string, unknown> = {
        ...gate.metadata,
        osacReadyGate: {
          ok: gate.ok,
          reason: gate.reason || null,
          source: 'pool_claim',
          checkedAt: new Date().toISOString(),
        },
      };
      await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, nextMetadata);
      if (!gate.ok) {
        await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'failed', vmName || null);
        await this.releaseClaimedKvmWarmPoolSession(sessionId, 'failed', gate.reason || 'pool_ready_gate_failed');
        if (this.kvmWarmPoolConfig.strict) {
          throw new Error(`KVM pool ready gate failed: ${gate.reason || 'unknown'}`);
        }
        return null;
      }
    }

    const latest = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
    const latestMetadata = ((latest?.metadata || mergedMetadata) as Record<string, unknown>) || {};
    const result = this.buildProvisionResult(
      sessionId,
      vmName || latest?.vmName || null,
      latestMetadata,
      input.requestBaseUrl,
      {
        warmPoolHit: true,
        allocationSource: 'warm_pool',
        degradedFromWarmPool: false,
        readyGatePassed,
      }
    );

    if (readyGateReason) {
      console.warn('[OSAC_POOL_READY_GATE_WARN]', sessionId, readyGateReason);
    }
    return result;
  }

  private async tryClaimWarmSession(input: ProvisionInput): Promise<ProvisionResult | null> {
    return this.withWarmPoolLock(async () => {
      const rows = await this.listWarmPoolRows(this.warmPoolConfig.scanLimit);
      const candidates = (rows as any[])
        .filter((row: any) => {
          if (row?.status !== 'ready') return false;
          const state = this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>);
          return state === 'ready';
        })
        .sort((a: any, b: any) => {
          const ta = new Date(a?.createdAt || 0).getTime();
          const tb = new Date(b?.createdAt || 0).getTime();
          return ta - tb;
        });

      for (const row of candidates) {
        if (row?.status !== 'ready') {
          continue;
        }
        const metadata = (row?.metadata || {}) as Record<string, unknown>;
        if (this.getWarmPoolState(metadata) !== 'ready') {
          continue;
        }
        const sessionId = String(row.sessionId || '');
        if (!sessionId) {
          continue;
        }
        const gate = await this.verifyWarmReadyGate(sessionId, metadata);
        if (!gate.ok) {
          const reason = gate.reason || 'ready_gate_failed';
          this.bumpWarmPoolClaimFailure(reason);
          await this.markWarmSessionState(sessionId, metadata, 'retired', reason);
          continue;
        }
        const healthyMetadata = gate.metadata;

        const warmPool = (healthyMetadata.warmPool || {}) as Record<string, unknown>;
        const nextMetadata: Record<string, unknown> = {
          ...healthyMetadata,
          ...(input.metadata || {}),
          warmPool: {
            ...warmPool,
            state: 'using',
            sandboxStatus: 'using',
            claimedAt: new Date().toISOString(),
            source: 'warm_pool',
          },
          warmPoolSandboxStatus: 'using',
          sandboxStatus: 'using',
          warmPoolHit: true,
        };

        await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, nextMetadata);
        return this.buildProvisionResult(
          sessionId,
          row?.vmName || null,
          nextMetadata,
          input.requestBaseUrl,
          {
            warmPoolHit: true,
            allocationSource: 'warm_pool',
            degradedFromWarmPool: false,
            readyGatePassed: true,
          }
        );
      }
      return null;
    });
  }

  private async waitForWarmPoolClaim(input: ProvisionInput): Promise<ProvisionResult | null> {
    if (this.warmPoolConfig.waitReadyMs <= 0) {
      return null;
    }
    const start = Date.now();
    while (Date.now() - start < this.warmPoolConfig.waitReadyMs) {
      await sleep(this.warmPoolConfig.waitPollMs);
      const claimed = await this.tryClaimWarmSession(input);
      if (claimed) {
        return claimed;
      }
    }
    return null;
  }

  private async ensureWarmPool(reason: string) {
    if (!this.warmPoolConfig.enabled || this.warmPoolConfig.targetSize <= 0) {
      return;
    }

    this.warmPoolLastEnsureAt = new Date().toISOString();
    this.warmPoolLastEnsureReason = reason;
    this.warmPoolLastEnsureError = null;

    try {
      await this.withWarmPoolLock(async () => {
        let rows = await this.listWarmPoolRows(this.warmPoolConfig.scanLimit);
        const cleaned = await this.cleanupStaleWarmRows(rows as any[], reason);
        if (cleaned > 0) {
          rows = await this.listWarmPoolRows(this.warmPoolConfig.scanLimit);
        }
        const readyCount = rows.filter(
          (row: any) =>
            row?.status === 'ready' &&
            this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>) === 'ready'
        ).length;
        const seedingCount = rows.filter((row: any) => {
          const warmState = this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>);
          if (warmState === 'retired' || warmState === 'failed') {
            return false;
          }
          return warmState === 'seeding' || row?.status === 'creating';
        }).length;

        const readyDeficit = this.warmPoolConfig.targetSize - readyCount;
        const pendingCount = seedingCount + this.warmPoolInFlight;
        const need = Math.max(0, readyDeficit - pendingCount);
        const forcedNeed = reason === 'claimed' && readyDeficit > 0 ? 1 : 0;
        const totalNeed = Math.max(need, forcedNeed);
        if (totalNeed <= 0) {
          return;
        }

        const spawn = Math.min(
          totalNeed,
          Math.max(0, this.warmPoolConfig.maxInflight - this.warmPoolInFlight)
        );
        for (let i = 0; i < spawn; i++) {
          this.warmPoolInFlight += 1;
          void this.spawnWarmPoolSeed(reason);
        }
      });
    } catch (error) {
      this.warmPoolLastEnsureError = error instanceof Error ? error.message : String(error);
      console.warn('[OSAC_WARM_POOL_ENSURE_ERROR]', this.warmPoolLastEnsureError);
    }
  }

  private async spawnWarmPoolSeed(reason: string) {
    try {
      await this.provision({
        metadata: this.buildWarmSeedMetadata(reason),
        __skipWarmPool: true,
        __warmPoolSeed: true,
        __warmPoolReason: reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OSAC_WARM_POOL_SEED_ERROR]', reason, message);
    } finally {
      this.warmPoolInFlight = Math.max(0, this.warmPoolInFlight - 1);
      this.scheduleWarmPoolEnsure('seed-finished');
    }
  }

  async getWarmPoolStatus(): Promise<WarmPoolSummary> {
    const rows = await this.listWarmPoolRows(this.warmPoolConfig.scanLimit);
    const nowMs = Date.now();
    const available = rows.filter(
      (row: any) =>
        row?.status === 'ready' &&
        this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>) === 'ready'
    );
    const healthyReady = available.filter((row: any) => {
      const metadata = (row?.metadata || {}) as Record<string, unknown>;
      return Boolean(pickString(metadata.osacEndpoint));
    });
    const using = rows.filter((row: any) => {
      const warmState = this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>);
      return warmState === 'using';
    });
    const seeding = rows.filter((row: any) => {
      const warmState = this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>);
      if (warmState === 'retired' || warmState === 'failed') {
        return false;
      }
      return warmState === 'seeding' || row?.status === 'creating';
    });
    const staleSeeding = rows.filter((row: any) => this.isStaleWarmRow(row, nowMs));
    const readyQueue = available
      .slice()
      .sort((a: any, b: any) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        return ta - tb;
      })
      .map((row: any) => String(row?.sessionId || ''))
      .filter(Boolean);

    return {
      enabled: this.warmPoolConfig.enabled,
      targetSize: this.warmPoolConfig.targetSize,
      maxInflight: this.warmPoolConfig.maxInflight,
      inFlight: this.warmPoolInFlight,
      checkIntervalMs: this.warmPoolConfig.checkIntervalMs,
      availableCount: available.length,
      healthyReadyCount: healthyReady.length,
      usingCount: using.length,
      seedingCount: seeding.length,
      staleSeedingCount: staleSeeding.length,
      totalWarmCount: rows.length,
      lastEnsureAt: this.warmPoolLastEnsureAt,
      lastEnsureReason: this.warmPoolLastEnsureReason,
      lastEnsureError: this.warmPoolLastEnsureError,
      lastCleanupAt: this.warmPoolLastCleanupAt,
      coldStartFallbackCount: this.warmPoolColdStartFallbackCount,
      claimFailByCode: this.getWarmPoolClaimFailureSnapshot(),
      readyQueue,
      samples: rows.slice(0, 10).map((row: any) => ({
        sessionId: String(row?.sessionId || ''),
        status: String(row?.status || ''),
        vmName: row?.vmName || null,
        warmState: this.getWarmPoolState((row?.metadata || {}) as Record<string, unknown>),
        sandboxStatus: pickString(
          ((row?.metadata || {}) as Record<string, unknown>).sandboxStatus,
          ((row?.metadata || {}) as Record<string, unknown>).warmPoolSandboxStatus,
          (((row?.metadata || {}) as Record<string, unknown>).warmPool as Record<string, unknown> | undefined)?.sandboxStatus
        ) as SandboxStatus | null,
        osacEndpoint: pickString((row?.metadata || {}).osacEndpoint),
        createdAt: row?.createdAt ? new Date(row.createdAt).toISOString() : undefined,
      })),
    };
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    let attemptedKvmWarmPool = false;
    if (this.shouldUseKvmWarmPool(input)) {
      attemptedKvmWarmPool = true;
      const pooled = await this.tryProvisionFromKvmWarmPool(input);
      if (pooled) {
        return pooled;
      }
    }

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
    const existingMetadata = ((existing?.metadata || {}) as Record<string, unknown>) || {};
    const mergedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      ...(input.metadata || {}),
      sandboxStatus: 'using',
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

    let provisionReadyGatePassed = !this.provisionReadyGateConfig.enabled;
    let provisionReadyGateReason: string | null = null;
    if (osacEndpoint && this.provisionReadyGateConfig.enabled) {
      const latest = await sandboxExecutionEnvironmentDAO.getBySessionId(sessionId);
      const latestMetadata = ((latest?.metadata || mergedMetadata) as Record<string, unknown>) || {};
      const gate = await this.verifyProvisionReadyGate(sessionId, latestMetadata);
      provisionReadyGatePassed = gate.ok;
      provisionReadyGateReason = gate.reason || null;

      const nextMetadata: Record<string, unknown> = {
        ...gate.metadata,
        osacReadyGate: {
          ok: gate.ok,
          reason: gate.reason || null,
          source: 'provision',
          checkedAt: new Date().toISOString(),
        },
      };
      await sandboxExecutionEnvironmentDAO.updateMetadata(sessionId, nextMetadata);

      if (!gate.ok) {
        if (this.provisionReadyGateConfig.strict) {
          await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'failed', vmName || environment.vmName || null);
          throw new Error(`OSAC provision ready gate failed: ${gate.reason || 'unknown'}`);
        }
        await sandboxExecutionEnvironmentDAO.updateStatus(sessionId, 'creating', vmName || environment.vmName || null);
      }
    }

    const finalReady = Boolean(osacEndpoint) && provisionReadyGatePassed;
    let resultHost = pickString(mergedMetadata.osacHost);
    let resultHostPort =
      typeof mergedMetadata.osacHostPort === 'number'
        ? mergedMetadata.osacHostPort
        : typeof mergedMetadata.osacHostPort === 'string' && mergedMetadata.osacHostPort.trim()
          ? Number(mergedMetadata.osacHostPort)
          : null;
    if (osacEndpoint) {
      try {
        const endpointUrl = new URL(osacEndpoint);
        if (!resultHost) {
          resultHost = endpointUrl.hostname;
        }
        if (resultHostPort === null && endpointUrl.port) {
          const parsedPort = Number(endpointUrl.port);
          if (Number.isFinite(parsedPort) && parsedPort > 0) {
            resultHostPort = parsedPort;
          }
        }
      } catch {
        // keep fallback values
      }
    }

    const result: ProvisionResult = {
      sessionId,
      vmName: vmName || environment.vmName,
      vmIpAddress: ipAddress,
      osacEndpoint,
      status: finalReady ? 'ready' : 'pending',
      sandboxStatus: finalReady ? 'ready' : 'using',
      allocationSource: 'cold_start',
      degradedFromWarmPool: attemptedKvmWarmPool,
      readyGatePassed: provisionReadyGatePassed,
      osacAuthToken: osacToken,
      osacConnectionMode: osacBootstrapConfig.connectionMode,
      osacHost: resultHost || null,
      osacHostPort: resultHostPort,
      bootstrap: {
        osacBinaryUrl,
        opencodeBinaryUrl,
        osacPort: osacBootstrapConfig.osacPort,
        osacPathSuffix: osacBootstrapConfig.osacPathSuffix,
      },
    };

    if (provisionReadyGateReason) {
      console.warn('[OSAC_PROVISION_READY_GATE_WARN]', sessionId, provisionReadyGateReason);
    }

    return result;
  }
}

export const sandboxAgentProvisionService = new SandboxAgentProvisionService();
