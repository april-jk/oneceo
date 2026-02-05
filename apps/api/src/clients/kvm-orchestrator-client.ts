import { getPublicErrorMessage } from '../utils/error-response';

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

export const kvmOrchestratorClient = {
  health: () => request('/health', 'GET', undefined, { withAuth: false }),

  // vm
  listVms: () => request('/v1/vms', 'GET'),
  getVm: (name: string) => request(`/v1/vms/${encodeURIComponent(name)}`, 'GET'),
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

  // job
  getJob: (jobId: string) => request(`/v1/jobs/${encodeURIComponent(jobId)}`, 'GET'),
};
