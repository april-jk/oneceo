import { getPublicErrorMessage } from '../utils/error-response';
import { Blob } from 'buffer';

const baseUrl = process.env.KVM_ORCHESTRATOR_URL || 'http://192.168.10.172:8500';
const token = process.env.KVM_ORCH_TOKEN || '';
const baseRequestTimeoutMs = Math.max(1000, Number(process.env.KVM_HTTP_TIMEOUT_MS || 15000));
const baseRetries = Math.max(0, Number(process.env.KVM_HTTP_RETRIES || 1));
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

function toInt(value: string | undefined, fallback: number, min: number = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function resolveRequestPolicy(path: string, method: HttpMethod, isForm: boolean): { timeoutMs: number; retries: number } {
  const healthTimeoutMs = toInt(process.env.KVM_HTTP_TIMEOUT_HEALTH_MS, Math.min(baseRequestTimeoutMs, 8000), 1000);
  const metaTimeoutMs = toInt(process.env.KVM_HTTP_TIMEOUT_META_MS, Math.max(baseRequestTimeoutMs, 15000), 1000);
  const sandboxTimeoutMs = toInt(process.env.KVM_HTTP_TIMEOUT_SANDBOX_MS, Math.max(baseRequestTimeoutMs, 30000), 1000);
  const jobTimeoutMs = toInt(process.env.KVM_HTTP_TIMEOUT_JOB_MS, Math.max(baseRequestTimeoutMs, 30000), 1000);
  const execTimeoutMs = toInt(process.env.KVM_HTTP_TIMEOUT_EXEC_MS, Math.max(baseRequestTimeoutMs, 90000), 1000);
  const uploadTimeoutMs = toInt(process.env.KVM_HTTP_TIMEOUT_UPLOAD_MS, Math.max(baseRequestTimeoutMs, 120000), 1000);

  const metaRetries = toInt(process.env.KVM_HTTP_RETRIES_META, baseRetries, 0);
  const sandboxRetries = toInt(process.env.KVM_HTTP_RETRIES_SANDBOX, Math.max(baseRetries, 1), 0);
  const jobRetries = toInt(process.env.KVM_HTTP_RETRIES_JOB, Math.max(baseRetries, 1), 0);
  const execRetries = toInt(process.env.KVM_HTTP_RETRIES_EXEC, Math.max(baseRetries, 1), 0);
  const uploadRetries = toInt(process.env.KVM_HTTP_RETRIES_UPLOAD, Math.max(baseRetries, 1), 0);

  if (path === '/health') {
    return { timeoutMs: healthTimeoutMs, retries: 0 };
  }
  if (path.startsWith('/v1/jobs/')) {
    return { timeoutMs: jobTimeoutMs, retries: jobRetries };
  }
  if (path.includes('/exec')) {
    return { timeoutMs: execTimeoutMs, retries: execRetries };
  }
  if (isForm || path.includes('/files')) {
    return { timeoutMs: uploadTimeoutMs, retries: uploadRetries };
  }
  if (path.startsWith('/v1/sandboxes/')) {
    return { timeoutMs: sandboxTimeoutMs, retries: sandboxRetries };
  }
  if (path.startsWith('/v1/sessions') || path.startsWith('/v1/vms')) {
    return { timeoutMs: metaTimeoutMs, retries: metaRetries };
  }
  if (method === 'GET') {
    return { timeoutMs: metaTimeoutMs, retries: metaRetries };
  }
  return { timeoutMs: Math.max(metaTimeoutMs, baseRequestTimeoutMs), retries: baseRetries };
}

export class KvmClientError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

function buildHeaders(withAuth: boolean, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    ...(extra || {}),
  };

  if (withAuth) {
    if (!token) {
      throw new KvmClientError(500, 'KVM_ORCH_TOKEN is not configured');
    }
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

function isRetryableStatus(status: number) {
  return status >= 500 || status === 429;
}

function shouldRetryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes('aborted') ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('network')
  );
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  options?: { withAuth?: boolean; headers?: Record<string, string> }
): Promise<T> {
  const withAuth = options?.withAuth !== false;
  const headers = buildHeaders(withAuth, options?.headers);
  const policy = resolveRequestPolicy(path, method, false);

  let payloadBody: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = headers['content-type'] || 'application/json';
    payloadBody = JSON.stringify(body);
  }

  let lastError: unknown;
  const maxAttempts = Math.max(1, policy.retries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        method,
        headers,
        body: payloadBody,
      }, policy.timeoutMs);

      const payload: any = await response.json().catch(() => ({}));
      const requestId = payload?.request_id;

      if (!response.ok) {
        const message = payload?.message || getPublicErrorMessage('KVM 服务暂时不可用');
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          lastError = new KvmClientError(response.status, message, requestId);
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        throw new KvmClientError(response.status, message, requestId);
      }

      return payload as T;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryError(error)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  if (lastError instanceof KvmClientError) {
    throw lastError;
  }
  if (lastError && (lastError as any).name === 'AbortError') {
    throw new KvmClientError(504, 'KVM 服务请求超时');
  }
  const message = lastError instanceof Error ? lastError.message : getPublicErrorMessage('KVM 服务暂时不可用');
  throw new KvmClientError(502, message);
}

async function requestForm<T>(
  path: string,
  form: FormData,
  options?: { withAuth?: boolean; headers?: Record<string, string> }
): Promise<T> {
  const withAuth = options?.withAuth !== false;
  const headers = buildHeaders(withAuth, options?.headers);
  const policy = resolveRequestPolicy(path, 'POST', true);

  let lastError: unknown;
  const maxAttempts = Math.max(1, policy.retries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: form,
      }, policy.timeoutMs);

      const payload: any = await response.json().catch(() => ({}));
      const requestId = payload?.request_id;

      if (!response.ok) {
        const message = payload?.message || getPublicErrorMessage('KVM 服务暂时不可用');
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          lastError = new KvmClientError(response.status, message, requestId);
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        throw new KvmClientError(response.status, message, requestId);
      }

      return payload as T;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryError(error)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  if (lastError instanceof KvmClientError) {
    throw lastError;
  }
  if (lastError && (lastError as any).name === 'AbortError') {
    throw new KvmClientError(504, 'KVM 服务请求超时');
  }
  const message = lastError instanceof Error ? lastError.message : getPublicErrorMessage('KVM 服务暂时不可用');
  throw new KvmClientError(502, message);
}

export type UploadFileInput = {
  filename: string;
  buffer: Buffer;
  targetPath?: string;
  overwrite?: 'deny' | 'allow' | 'replace';
  mkdirs?: boolean;
  extract?: boolean;
  sha256?: string;
  chunkIndex?: number;
  totalChunks?: number;
  uploadId?: string;
  sessionId?: string;
  chmod?: string;
  owner?: string;
  deliveryMode?: 'file-drop' | 'guest-agent';
};

export type ExecInput = {
  path: string;
  args?: string[];
  capture_output?: boolean;
  timeout_seconds?: number;
  env?: Record<string, string>;
};

export type SandboxCreateInput = {
  session_id?: string;
  vm_name?: string;
  base_image?: string;
  memory_mb?: number;
  vcpus?: number;
  network?: string;
  os_variant?: string;
  auto_bind?: boolean;
  start?: boolean;
  metadata?: Record<string, unknown>;
};

export type SandboxPortMappingInput = {
  vm_port: number;
  host_port: number;
  protocol?: 'tcp' | 'udp';
  host_ip?: string;
};

export type RelayTcpTicketInput = {
  target_port: number;
  target_host?: 'vm';
  connect_timeout_ms?: number;
  idle_timeout_ms?: number;
  ticket_ttl_ms?: number;
  single_use?: boolean;
};

function buildUploadForm(input: UploadFileInput) {
  const form = new FormData();
  const blob = new Blob([input.buffer]);
  form.append('file', blob, input.filename);

  if (input.targetPath) form.append('targetPath', input.targetPath);
  if (input.overwrite) form.append('overwrite', input.overwrite);
  if (input.mkdirs !== undefined) form.append('mkdirs', String(input.mkdirs));
  if (input.extract !== undefined) form.append('extract', String(input.extract));
  if (input.sha256) form.append('sha256', input.sha256);
  if (input.chunkIndex !== undefined) form.append('chunkIndex', String(input.chunkIndex));
  if (input.totalChunks !== undefined) form.append('totalChunks', String(input.totalChunks));
  if (input.uploadId) form.append('uploadId', input.uploadId);
  if (input.sessionId) form.append('sessionId', input.sessionId);
  if (input.chmod) form.append('chmod', input.chmod);
  if (input.owner) form.append('owner', input.owner);
  if (input.deliveryMode) form.append('deliveryMode', input.deliveryMode);

  return form;
}

export const kvmOrchestratorClient = {
  health: () => request('/health', 'GET', undefined, { withAuth: false }),

  // vm
  listVms: () => request('/v1/vms', 'GET'),
  getVm: (name: string) => request(`/v1/vms/${encodeURIComponent(name)}`, 'GET'),
  getVmIp: (name: string, query?: Record<string, string>) =>
    request(
      `/v1/vms/${encodeURIComponent(name)}/ip${query ? `?${new URLSearchParams(query).toString()}` : ''}`,
      'GET'
    ),
  controlVm: (
    name: string,
    action: 'start' | 'shutdown' | 'reboot' | 'suspend' | 'resume',
    asyncMode?: boolean
  ) => request(`/v1/vms/${encodeURIComponent(name)}/${action}${asyncMode ? '?async=true' : ''}`, 'POST'),
  getVmMetrics: (name: string) => request(`/v1/vms/${encodeURIComponent(name)}/metrics`, 'GET'),
  getVmLogs: (name: string, lines?: number) =>
    request(`/v1/vms/${encodeURIComponent(name)}/logs${lines ? `?lines=${lines}` : ''}`, 'GET'),

  listVmSnapshots: (name: string) => request(`/v1/vms/${encodeURIComponent(name)}/snapshots`, 'GET'),
  createVmSnapshot: (name: string, body: Record<string, unknown>) =>
    request(`/v1/vms/${encodeURIComponent(name)}/snapshots/create`, 'POST', body),
  restoreVmSnapshot: (name: string, snapshotName: string) =>
    request(`/v1/vms/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}/restore`, 'POST'),
  deleteVmSnapshot: (name: string, snapshotName: string) =>
    request(`/v1/vms/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}`, 'DELETE'),

  // session
  createSession: (body: Record<string, unknown>, idempotencyKey?: string) =>
    request('/v1/sessions', 'POST', body, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  getSession: (sessionId: string) => request(`/v1/sessions/${encodeURIComponent(sessionId)}`, 'GET'),
  bindSessionVm: (sessionId: string, body: Record<string, unknown>) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/bind`, 'POST', body),
  getSessionVm: (sessionId: string) => request(`/v1/sessions/${encodeURIComponent(sessionId)}/vm`, 'GET'),
  closeSession: (sessionId: string, body: Record<string, unknown>) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/close`, 'POST', body),

  getSessionQuota: (sessionId: string) => request(`/v1/sessions/${encodeURIComponent(sessionId)}/quota`, 'GET'),
  updateSessionQuota: (sessionId: string, body: Record<string, unknown>) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/quota`, 'PUT', body),

  uploadVmFile: (vmName: string, input: UploadFileInput) =>
    requestForm(`/v1/vms/${encodeURIComponent(vmName)}/files`, buildUploadForm(input)),
  uploadSessionFile: (sessionId: string, input: UploadFileInput) =>
    requestForm(`/v1/sessions/${encodeURIComponent(sessionId)}/files`, buildUploadForm(input)),
  deleteVmFile: (vmName: string, query: Record<string, string>) =>
    request(`/v1/vms/${encodeURIComponent(vmName)}/files?${new URLSearchParams(query).toString()}`, 'DELETE'),
  deleteSessionFile: (sessionId: string, query: Record<string, string>) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/files?${new URLSearchParams(query).toString()}`, 'DELETE'),
  execVm: (vmName: string, body: ExecInput) =>
    request(`/v1/vms/${encodeURIComponent(vmName)}/exec`, 'POST', body),
  execSession: (sessionId: string, body: ExecInput) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/exec`, 'POST', body),

  createSandbox: (body: SandboxCreateInput, idempotencyKey?: string) =>
    request('/v1/sandboxes', 'POST', body, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  getSandbox: (sessionId: string) => request(`/v1/sandboxes/${encodeURIComponent(sessionId)}`, 'GET'),
  getSandboxIp: (sessionId: string, query?: Record<string, string>) =>
    request(
      `/v1/sandboxes/${encodeURIComponent(sessionId)}/ip${
        query ? `?${new URLSearchParams(query).toString()}` : ''
      }`,
      'GET'
    ),
  createSandboxPort: (sessionId: string, body: SandboxPortMappingInput) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports`, 'POST', body),
  listSandboxPorts: (sessionId: string, query?: Record<string, string>) =>
    request(
      `/v1/sandboxes/${encodeURIComponent(sessionId)}/ports${
        query ? `?${new URLSearchParams(query).toString()}` : ''
      }`,
      'GET'
    ),
  deleteSandboxPort: (sessionId: string, query: Record<string, string>) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports?${new URLSearchParams(query).toString()}`, 'DELETE'),
  restartSandbox: (sessionId: string, body: Record<string, unknown>) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}/restart`, 'POST', body),
  deleteSandbox: (sessionId: string, query?: Record<string, string>) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}${query ? `?${new URLSearchParams(query).toString()}` : ''}`, 'DELETE'),

  // relay (tcp over websocket)
  createRelayTcpTicket: (sessionId: string, body: RelayTcpTicketInput) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/relay/tcp/ticket`, 'POST', body),
  getRelayTcpState: (sessionId: string) =>
    request(`/v1/sessions/${encodeURIComponent(sessionId)}/relay/tcp/state`, 'GET'),

  // job
  getJob: (jobId: string) => request(`/v1/jobs/${encodeURIComponent(jobId)}`, 'GET'),
};
