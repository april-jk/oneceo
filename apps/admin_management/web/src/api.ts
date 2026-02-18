import type {
  AgentManagementOverview,
  AuditResponse,
  ConversationSessionDetailResponse,
  ConversationSessionsResponse,
  DashboardOverview,
  HostListResponse,
  KvmJobInfo,
  KvmSandboxInfo,
  KvmSandboxPortMapping,
  KvmSessionInfo,
  KvmSessionQuota,
  KvmSnapshotInfo,
  SandboxManagementOverview,
  VmDetailResponse,
  VmIpInfo,
  VmListResponse,
  VmMetricsInfo,
} from './types';

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiFailure = {
  success: false;
  error: {
    message: string;
  };
};

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const API_TIMEOUT_MS = Number((import.meta.env.VITE_API_TIMEOUT_MS as string | undefined) ?? 12000);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  }).finally(() => {
    clearTimeout(timer);
  });

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok) {
    throw new Error(payload && 'error' in payload ? payload.error.message : `请求失败: ${response.status}`);
  }

  if (!payload || !('success' in payload) || payload.success !== true) {
    throw new Error('接口返回格式异常');
  }

  return payload.data;
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    signal: controller.signal,
    body: formData,
  }).finally(() => {
    clearTimeout(timer);
  });

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok) {
    throw new Error(payload && 'error' in payload ? payload.error.message : `请求失败: ${response.status}`);
  }
  if (!payload || !('success' in payload) || payload.success !== true) {
    throw new Error('接口返回格式异常');
  }
  return payload.data;
}

export const api = {
  getOverview: () => request<DashboardOverview>('/api/dashboard/overview'),

  listVms: (query: { withState?: boolean; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.withState !== undefined) {
      params.set('withState', String(query.withState));
    }
    if (query.limit !== undefined) {
      params.set('limit', String(query.limit));
    }
    if (query.offset !== undefined) {
      params.set('offset', String(query.offset));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<VmListResponse>(`/api/kvm/vms${suffix}`);
  },

  powerVm: (vmId: string, action: 'start' | 'stop', operator = 'admin-ui') =>
    request(`/api/kvm/vms/${encodeURIComponent(vmId)}/power`, {
      method: 'POST',
      body: JSON.stringify({ action, operator }),
    }),

  runVmAction: (
    vmId: string,
    payload: { action: 'start' | 'shutdown' | 'reboot' | 'suspend' | 'resume' | 'stop'; async?: boolean; operator?: string }
  ) =>
    request<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getVmDetail: (vmId: string) => request<VmDetailResponse>(`/api/kvm/vms/${encodeURIComponent(vmId)}`),
  getVmIp: (vmId: string, refresh?: boolean) =>
    request<VmIpInfo>(`/api/kvm/vms/${encodeURIComponent(vmId)}/ip${refresh ? '?refresh=true' : ''}`),
  getVmMetrics: (vmId: string) => request<VmMetricsInfo>(`/api/kvm/vms/${encodeURIComponent(vmId)}/metrics`),
  getVmLogs: (vmId: string, lines = 120) =>
    request<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/logs?lines=${lines}`),
  vmExec: (
    vmId: string,
    payload: { path: string; args?: string[]; captureOutput?: boolean; timeoutSeconds?: number; env?: Record<string, string> }
  ) =>
    request<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/exec`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listVmSnapshots: (vmId: string) => request<KvmSnapshotInfo[]>(`/api/kvm/vms/${encodeURIComponent(vmId)}/snapshots`),
  createVmSnapshot: (vmId: string, payload: { snapshotName: string; description?: string }) =>
    request<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  restoreVmSnapshot: (vmId: string, snapshotName: string, payload?: { targetState?: string }) =>
    request<Record<string, unknown>>(
      `/api/kvm/vms/${encodeURIComponent(vmId)}/snapshots/${encodeURIComponent(snapshotName)}/restore`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    ),
  deleteVmSnapshot: (vmId: string, snapshotName: string) =>
    request<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/snapshots/${encodeURIComponent(snapshotName)}`, {
      method: 'DELETE',
    }),

  createSession: (payload?: { metadata?: Record<string, unknown> }) =>
    request<KvmSessionInfo>('/api/kvm/sessions', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  getSession: (sessionId: string) => request<KvmSessionInfo>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}`),
  bindSessionVm: (sessionId: string, payload: { vmName?: string; autoAllocate?: boolean }) =>
    request<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/bind`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSessionVm: (sessionId: string) =>
    request<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/vm`),
  closeSession: (sessionId: string, payload?: { gracefulShutdown?: boolean }) =>
    request<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/close`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  getSessionQuota: (sessionId: string) =>
    request<{ sessionId: string; quota: KvmSessionQuota }>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/quota`),
  updateSessionQuota: (sessionId: string, payload: KvmSessionQuota) =>
    request<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/quota`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  sessionExec: (
    sessionId: string,
    payload: { path: string; args?: string[]; captureOutput?: boolean; timeoutSeconds?: number; env?: Record<string, string> }
  ) =>
    request<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/exec`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createSandbox: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/kvm/sandboxes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSandbox: (sessionId: string) => request<KvmSandboxInfo>(`/api/kvm/sandboxes/${encodeURIComponent(sessionId)}`),
  getSandboxIp: (sessionId: string, refresh?: boolean) =>
    request<Record<string, unknown>>(
      `/api/kvm/sandboxes/${encodeURIComponent(sessionId)}/ip${refresh ? '?refresh=true' : ''}`
    ),
  restartSandbox: (sessionId: string, payload?: { gracefulShutdown?: boolean; start?: boolean }) =>
    request<Record<string, unknown>>(`/api/kvm/sandboxes/${encodeURIComponent(sessionId)}/restart`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  deleteSandbox: (sessionId: string, deleteStorage = true) =>
    request<Record<string, unknown>>(
      `/api/kvm/sandboxes/${encodeURIComponent(sessionId)}?deleteStorage=${String(deleteStorage)}`,
      {
        method: 'DELETE',
      }
    ),
  createSandboxPortMapping: (
    sessionId: string,
    payload: { vmPort: number; hostPort: number; protocol?: string; hostIp?: string }
  ) =>
    request<Record<string, unknown>>(`/api/kvm/sandboxes/${encodeURIComponent(sessionId)}/ports`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listSandboxPortMappings: (sessionId: string, query?: { refresh?: boolean; verify?: boolean; waitSeconds?: number }) => {
    const params = new URLSearchParams();
    if (query?.refresh !== undefined) params.set('refresh', String(query.refresh));
    if (query?.verify !== undefined) params.set('verify', String(query.verify));
    if (query?.waitSeconds !== undefined) params.set('waitSeconds', String(query.waitSeconds));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<Record<string, unknown> | KvmSandboxPortMapping[]>(
      `/api/kvm/sandboxes/${encodeURIComponent(sessionId)}/ports${suffix}`
    );
  },
  deleteSandboxPortMapping: (
    sessionId: string,
    query: { hostPort: number; protocol?: string; hostIp?: string; vmPort?: number }
  ) => {
    const params = new URLSearchParams();
    params.set('hostPort', String(query.hostPort));
    if (query.protocol) params.set('protocol', query.protocol);
    if (query.hostIp) params.set('hostIp', query.hostIp);
    if (query.vmPort !== undefined) params.set('vmPort', String(query.vmPort));
    return request<Record<string, unknown>>(`/api/kvm/sandboxes/${encodeURIComponent(sessionId)}/ports?${params.toString()}`, {
      method: 'DELETE',
    });
  },

  getJob: (jobId: string) => request<KvmJobInfo>(`/api/kvm/jobs/${encodeURIComponent(jobId)}`),
  getEventsWsUrl: (replayLast = 20) =>
    request<{ url: string; replayLast: number }>(`/api/kvm/events/ws-url?replayLast=${replayLast}`),

  uploadVmFile: (vmId: string, formData: FormData) =>
    requestForm<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/files`, formData),
  uploadSessionFile: (sessionId: string, formData: FormData) =>
    requestForm<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/files`, formData),
  deleteVmFile: (vmId: string, query: { targetPath: string; recursive?: boolean; ignoreMissing?: boolean; sessionId?: string }) => {
    const params = new URLSearchParams();
    params.set('targetPath', query.targetPath);
    if (query.recursive !== undefined) params.set('recursive', String(query.recursive));
    if (query.ignoreMissing !== undefined) params.set('ignoreMissing', String(query.ignoreMissing));
    if (query.sessionId) params.set('sessionId', query.sessionId);
    return request<Record<string, unknown>>(`/api/kvm/vms/${encodeURIComponent(vmId)}/files?${params.toString()}`, {
      method: 'DELETE',
    });
  },
  deleteSessionFile: (sessionId: string, query: { targetPath: string; recursive?: boolean; ignoreMissing?: boolean }) => {
    const params = new URLSearchParams();
    params.set('targetPath', query.targetPath);
    if (query.recursive !== undefined) params.set('recursive', String(query.recursive));
    if (query.ignoreMissing !== undefined) params.set('ignoreMissing', String(query.ignoreMissing));
    return request<Record<string, unknown>>(`/api/kvm/sessions/${encodeURIComponent(sessionId)}/files?${params.toString()}`, {
      method: 'DELETE',
    });
  },

  listHosts: () => request<HostListResponse>('/api/hosts'),
  listConversationSessions: (limit = 30) =>
    request<ConversationSessionsResponse>(`/api/conversations/sessions?limit=${limit}`),
  getConversationSessionDetail: (sessionId: string) =>
    request<ConversationSessionDetailResponse>(`/api/conversations/sessions/${encodeURIComponent(sessionId)}`),
  getAgentManagementOverview: () =>
    request<AgentManagementOverview>('/api/agent-management/overview'),
  getSandboxManagementOverview: (limit = 50) =>
    request<SandboxManagementOverview>(`/api/sandbox-management/overview?limit=${limit}`),

  listAudit: (limit = 40) => request<AuditResponse>(`/api/audit?limit=${limit}`),
};
