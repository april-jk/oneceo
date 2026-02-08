import { getPublicErrorMessage } from '../utils/error-response';
import { Blob } from 'buffer';

const baseUrl = process.env.KVM_ORCHESTRATOR_URL || 'http://192.168.10.172:8500';
const token = process.env.KVM_ORCH_TOKEN || '';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

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

async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  options?: { withAuth?: boolean; headers?: Record<string, string> }
): Promise<T> {
  const withAuth = options?.withAuth !== false;
  const headers = buildHeaders(withAuth, options?.headers);

  let payloadBody: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = headers['content-type'] || 'application/json';
    payloadBody = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payloadBody,
  });

  const payload: any = await response.json().catch(() => ({}));
  const requestId = payload?.request_id;

  if (!response.ok) {
    const message = payload?.message || getPublicErrorMessage('KVM 服务暂时不可用');
    throw new KvmClientError(response.status, message, requestId);
  }

  return payload as T;
}

async function requestForm<T>(
  path: string,
  form: FormData,
  options?: { withAuth?: boolean; headers?: Record<string, string> }
): Promise<T> {
  const withAuth = options?.withAuth !== false;
  const headers = buildHeaders(withAuth, options?.headers);

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: form,
  });

  const payload: any = await response.json().catch(() => ({}));
  const requestId = payload?.request_id;

  if (!response.ok) {
    const message = payload?.message || getPublicErrorMessage('KVM 服务暂时不可用');
    throw new KvmClientError(response.status, message, requestId);
  }

  return payload as T;
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
  listSandboxPorts: (sessionId: string) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports`, 'GET'),
  deleteSandboxPort: (sessionId: string, query: Record<string, string>) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports?${new URLSearchParams(query).toString()}`, 'DELETE'),
  restartSandbox: (sessionId: string, body: Record<string, unknown>) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}/restart`, 'POST', body),
  deleteSandbox: (sessionId: string, query?: Record<string, string>) =>
    request(`/v1/sandboxes/${encodeURIComponent(sessionId)}${query ? `?${new URLSearchParams(query).toString()}` : ''}`, 'DELETE'),

  // job
  getJob: (jobId: string) => request(`/v1/jobs/${encodeURIComponent(jobId)}`, 'GET'),
};
