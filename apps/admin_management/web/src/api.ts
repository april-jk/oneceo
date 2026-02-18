import type {
  AuditResponse,
  DashboardOverview,
  HostListResponse,
  HostStatus,
  VmListResponse,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
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

  listHosts: () => request<HostListResponse>('/api/hosts'),

  updateHost: (
    hostId: string,
    patch: {
      status?: HostStatus;
      cpuCapacityCores?: number;
      memoryCapacityGb?: number;
      storageCapacityGb?: number;
      notes?: string;
    }
  ) =>
    request(`/api/hosts/${encodeURIComponent(hostId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  listAudit: (limit = 40) => request<AuditResponse>(`/api/audit?limit=${limit}`),
};