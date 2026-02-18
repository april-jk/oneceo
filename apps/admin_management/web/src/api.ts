import type {
  AgentManagementOverview,
  AuditResponse,
  ConversationSessionDetailResponse,
  ConversationSessionsResponse,
  DashboardOverview,
  HostListResponse,
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
  listConversationSessions: (limit = 30) =>
    request<ConversationSessionsResponse>(`/api/conversations/sessions?limit=${limit}`),
  getConversationSessionDetail: (sessionId: string) =>
    request<ConversationSessionDetailResponse>(`/api/conversations/sessions/${encodeURIComponent(sessionId)}`),
  getAgentManagementOverview: () =>
    request<AgentManagementOverview>('/api/agent-management/overview'),

  listAudit: (limit = 40) => request<AuditResponse>(`/api/audit?limit=${limit}`),
};
