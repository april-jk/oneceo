import type {
  AdminThemeKey,
  AdminThemeMode,
  AdminThemeSettings,
  AgentManagementOverview,
  AppUserDetailResponse,
  AppUserListResponse,
  AuditDetailResponse,
  AuditResponse,
  ConversationSessionDetailResponse,
  ConversationSessionInfraResponse,
  ConversationSessionsResponse,
  DeploymentConversationListResponse,
  DeploymentManagementListResponse,
  DeploymentManagementOverview,
  DeploymentRecord,
  DeploymentUserListResponse,
  RailwayBatchActionResponse,
  RailwayServiceListResponse,
  ConnectorGuidePolicy,
  ConnectorGuideCatalogSummary,
  ConnectorGuidePolicyDetail,
  ConnectorGuideRevision,
  ConnectorGuideValidationResult,
  DashboardOverview,
  HostListResponse,
  OsacRelease,
  OsacReleaseDetailResponse,
  OsacReleaseListResponse,
  SkillDetail,
  SkillGovernanceOptions,
  SkillImportJob,
  SkillImportResult,
  SkillImportPreview,
  SkillRenderedRevision,
  SkillRevision,
  SkillRevisionResources,
  SkillSummary,
  SkillValidationResult,
  KvmJobInfo,
  KvmSandboxInfo,
  KvmSandboxPortMapping,
  KvmSessionInfo,
  KvmSessionQuota,
  KvmSnapshotInfo,
  E2bSandboxDetail,
  E2bSandboxFullInfo,
  E2bSandboxMetricPoint,
  E2bTemplate,
  E2bTemplateBuildInfo,
  E2bTemplateBuildLogsResponse,
  E2bTemplateWithBuilds,
  SandboxRuntimeDetail,
  SandboxRuntimeRegistry,
  SandboxManagementOverview,
  SandboxLiveSummary,
  SandboxArchiveHistoryEntry,
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

export type AdminUser = {
  id: string;
  loginName: string;
  displayName: string;
  role: 'admin' | 'super_admin' | string;
  status?: string;
};

const API_BASE_URL = (import.meta.env.VITE_ADMIN_MANAGEMENT_API_BASE_URL as string | undefined) ?? '';
const API_TIMEOUT_MS = Number((import.meta.env.VITE_API_TIMEOUT_MS as string | undefined) ?? 12000);
const OSAC_UPLOAD_TIMEOUT_MS = Number((import.meta.env.VITE_OSAC_UPLOAD_TIMEOUT_MS as string | undefined) ?? 300000);

type RequestOptions = RequestInit & {
  timeoutMs?: number;
  abortMessage?: string;
};

function toRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(fallbackMessage);
  }
  return error instanceof Error ? error : new Error(fallbackMessage);
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? API_TIMEOUT_MS;
  const abortMessage = init?.abortMessage || '请求超时，请稍后重试';
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  }).catch((error) => {
    throw toRequestError(error, abortMessage);
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

async function requestForm<T>(
  path: string,
  formData: FormData,
  options?: Pick<RequestOptions, 'timeoutMs' | 'abortMessage'>
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? API_TIMEOUT_MS;
  const abortMessage = options?.abortMessage || '请求超时，请稍后重试';
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    signal: controller.signal,
    body: formData,
  }).catch((error) => {
    throw toRequestError(error, abortMessage);
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
  getCurrentAdmin: () => request<{ adminUser: AdminUser }>('/api/admin/auth/me'),
  adminLogin: (payload: { loginName: string; password: string }) =>
    request<{ adminUser: AdminUser }>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminLogout: () =>
    request<{ ok: boolean }>('/api/admin/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getAdminTheme: () => request<AdminThemeSettings>('/api/theme'),
  updateAdminTheme: (payload: { themeKey: AdminThemeKey; mode: AdminThemeMode }) =>
    request<AdminThemeSettings>('/api/theme', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getOverview: () => request<DashboardOverview>('/api/dashboard/overview'),

  getDeploymentOverview: (query: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
    taskSessionId?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.query) params.set('query', query.query);
    if (query.status) params.set('status', query.status);
    if (query.hasUrl) params.set('hasUrl', query.hasUrl);
    if (query.userId) params.set('userId', query.userId);
    if (query.taskSessionId) params.set('taskSessionId', query.taskSessionId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<DeploymentManagementOverview>(`/api/deployment-management/overview${suffix}`);
  },

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
  listSkills: (query?: { query?: string; status?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (query?.query) params.set('query', query.query);
    if (query?.status) params.set('status', query.status);
    if (query?.category) params.set('category', query.category);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<SkillSummary[]>(`/api/skill-management${suffix}`);
  },
  getSkillGovernanceOptions: () => request<SkillGovernanceOptions>('/api/skill-management/governance-options'),
  getSkill: (skillId: string) => request<SkillDetail>(`/api/skill-management/${encodeURIComponent(skillId)}`),
  createSkill: (payload: {
    slug: string;
    name: string;
    description?: string;
    category?: string;
    governance?: {
      systemRole?: string | null;
      adminManaged?: boolean;
      required?: boolean;
      autoActivation?: {
        enabled?: boolean;
        triggers?: string[];
        toolNames?: string[];
      };
    };
    bodyMarkdown: string;
    resources?: Array<{
      resourcePath: string;
      resourceType?: 'reference' | 'template';
      contentMarkdown: string;
    }>;
    createdBy?: string;
  }) =>
    request<SkillDetail>('/api/skill-management', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSkill: (
    skillId: string,
    payload: {
      name?: string;
      description?: string;
      category?: string;
      governance?: {
        systemRole?: string | null;
        adminManaged?: boolean;
        required?: boolean;
        autoActivation?: {
          enabled?: boolean;
          triggers?: string[];
          toolNames?: string[];
        };
      };
      bodyMarkdown?: string;
      resources?: Array<{
        resourcePath: string;
        resourceType?: 'reference' | 'template';
        contentMarkdown: string;
      }>;
      createdBy?: string;
    }
  ) =>
    request<SkillDetail>(`/api/skill-management/${encodeURIComponent(skillId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  archiveSkill: (skillId: string) =>
    request<SkillDetail>(`/api/skill-management/${encodeURIComponent(skillId)}/archive`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  activateSkill: (skillId: string) =>
    request<SkillDetail>(`/api/skill-management/${encodeURIComponent(skillId)}/activate`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  listSkillRevisions: (skillId: string) =>
    request<SkillRevision[]>(`/api/skill-management/${encodeURIComponent(skillId)}/revisions`),
  getRenderedSkillRevision: (skillId: string, revisionId: string) =>
    request<SkillRenderedRevision>(
      `/api/skill-management/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/rendered`
    ),
  getSkillRevisionResources: (skillId: string, revisionId: string) =>
    request<SkillRevisionResources>(
      `/api/skill-management/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/resources`
    ),
  validateSkillRevision: (skillId: string, revisionId: string, sessionId: string) =>
    request<SkillValidationResult>(
      `/api/skill-management/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/validate`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }
    ),
  previewSkillFolderImport: (payload: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
  }) =>
    request<SkillImportPreview>('/api/skill-management/import/folder-preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  importSkillFolder: (payload: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
    createdBy?: string;
    skillId?: string;
  }) =>
    request<SkillImportResult>('/api/skill-management/import/folder', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createSkillFolderImportJob: (payload: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
    createdBy?: string;
    skillId?: string;
  }) =>
    request<SkillImportJob>('/api/skill-management/import/folder-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSkillFolderImportJob: (jobId: string) =>
    request<SkillImportJob>(`/api/skill-management/import/folder-jobs/${encodeURIComponent(jobId)}`),
  listConnectorGuidePolicies: (query?: { connectorKey?: string; status?: string; query?: string }) => {
    const params = new URLSearchParams();
    if (query?.connectorKey) params.set('connectorKey', query.connectorKey);
    if (query?.status) params.set('status', query.status);
    if (query?.query) params.set('query', query.query);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<ConnectorGuidePolicy[]>(`/api/connector-guides${suffix}`);
  },
  getConnectorGuideCatalogSummary: () => request<ConnectorGuideCatalogSummary>('/api/connector-guides/catalog-summary'),
  getConnectorGuidePolicy: (policyId: string) =>
    request<ConnectorGuidePolicyDetail>(`/api/connector-guides/${encodeURIComponent(policyId)}`),
  createConnectorGuidePolicy: (payload: {
    connectorKey: string;
    triggerMode: string;
    description?: string;
    createdBy?: string;
  }) =>
    request<ConnectorGuidePolicy>('/api/connector-guides', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateConnectorGuidePolicy: (
    policyId: string,
    payload: { triggerMode?: string; description?: string; status?: string }
  ) =>
    request<ConnectorGuidePolicy>(`/api/connector-guides/${encodeURIComponent(policyId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  createConnectorGuideRevision: (policyId: string, payload?: { createdBy?: string }) =>
    request<ConnectorGuideRevision>(`/api/connector-guides/${encodeURIComponent(policyId)}/revisions`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  getConnectorGuideRevision: (policyId: string, revisionId: string) =>
    request<ConnectorGuideRevision>(
      `/api/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}`
    ),
  updateConnectorGuideRevision: (
    policyId: string,
    revisionId: string,
    payload: {
      serverInstructionsMarkdown?: string;
      guideReminderMarkdown?: string;
      blockingRulesMarkdown?: string;
      notes?: string;
    }
  ) =>
    request<ConnectorGuideRevision>(
      `/api/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  validateConnectorGuideRevision: (policyId: string, revisionId: string) =>
    request<ConnectorGuideValidationResult>(
      `/api/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}/validate`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    ),
  publishConnectorGuideRevision: (policyId: string, revisionId: string) =>
    request<{
      policy: ConnectorGuidePolicy;
      revision: ConnectorGuideRevision;
      validation: ConnectorGuideValidationResult;
    }>(
      `/api/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}/publish`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    ),
  rollbackConnectorGuideRevision: (policyId: string, revisionId: string) =>
    request<{
      policy: ConnectorGuidePolicy;
      revision: ConnectorGuideRevision;
    }>(
      `/api/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}/rollback`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    ),
  listOsacReleases: (query?: { status?: string; channel?: string; query?: string }) => {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (query?.channel) params.set('channel', query.channel);
    if (query?.query) params.set('query', query.query);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<OsacReleaseListResponse>(`/api/osac-releases${suffix}`);
  },
  getOsacRelease: (releaseId: string) =>
    request<OsacReleaseDetailResponse>(`/api/osac-releases/${encodeURIComponent(releaseId)}`),
  uploadOsacRelease: (payload: {
    version: string;
    fileBase64: string;
    releaseNotes?: string;
    sourceCommit?: string;
    uploadedBy?: string;
    channel?: string;
  }) =>
    request<OsacRelease>('/api/osac-releases', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: OSAC_UPLOAD_TIMEOUT_MS,
      abortMessage: '上传 OSAC release 超时，请稍后重试',
    }),
  validateOsacRelease: (releaseId: string) =>
    request<OsacRelease>(`/api/osac-releases/${encodeURIComponent(releaseId)}/validate`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  publishOsacRelease: (releaseId: string, publishedBy = 'admin_management') =>
    request<OsacReleaseDetailResponse>(`/api/osac-releases/${encodeURIComponent(releaseId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ publishedBy }),
    }),
  rollbackOsacRelease: (releaseId: string, publishedBy = 'admin_management') =>
    request<OsacReleaseDetailResponse>(`/api/osac-releases/${encodeURIComponent(releaseId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ publishedBy }),
    }),
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
  listDeploymentRecords: (query: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
    taskSessionId?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.query) params.set('query', query.query);
    if (query.status) params.set('status', query.status);
    if (query.hasUrl) params.set('hasUrl', query.hasUrl);
    if (query.userId) params.set('userId', query.userId);
    if (query.taskSessionId) params.set('taskSessionId', query.taskSessionId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<DeploymentManagementListResponse>(`/api/deployment-management${suffix}`);
  },
  listDeploymentConversations: (query: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
    taskSessionId?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.query) params.set('query', query.query);
    if (query.status) params.set('status', query.status);
    if (query.hasUrl) params.set('hasUrl', query.hasUrl);
    if (query.userId) params.set('userId', query.userId);
    if (query.taskSessionId) params.set('taskSessionId', query.taskSessionId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<DeploymentConversationListResponse>(`/api/deployment-management/conversations${suffix}`);
  },
  listDeploymentUsers: (query: {
    limit?: number;
    query?: string;
    status?: string;
    hasUrl?: string;
    userId?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.query) params.set('query', query.query);
    if (query.status) params.set('status', query.status);
    if (query.hasUrl) params.set('hasUrl', query.hasUrl);
    if (query.userId) params.set('userId', query.userId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<DeploymentUserListResponse>(`/api/deployment-management/users${suffix}`);
  },
  getDeploymentDetail: (taskSessionId: string) =>
    request<DeploymentRecord>(`/api/deployment-management/task-sessions/${encodeURIComponent(taskSessionId)}`),
  listRailwayServices: (query: {
    limit?: number;
    query?: string;
    status?: string;
    risk?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.query) params.set('query', query.query);
    if (query.status) params.set('status', query.status);
    if (query.risk) params.set('risk', query.risk);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<RailwayServiceListResponse>(`/api/deployment-management/railway/services${suffix}`);
  },
  batchDeleteRailwayServices: (serviceKeys: string[]) =>
    request<RailwayBatchActionResponse>('/api/deployment-management/railway/services/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ serviceKeys }),
    }),
  batchConfigureRailwayServices: (
    serviceKeys: string[],
    patch: {
      builder?: string;
      buildCommand?: string;
      startCommand?: string;
      rootDirectory?: string;
      healthcheckPath?: string;
      sourceImage?: string;
    }
  ) =>
    request<RailwayBatchActionResponse>('/api/deployment-management/railway/services/batch-configure', {
      method: 'POST',
      body: JSON.stringify({ serviceKeys, patch }),
    }),
  batchUpsertRailwayServiceVariables: (
    serviceKeys: string[],
    variables: Record<string, string>,
    replace?: boolean
  ) =>
    request<RailwayBatchActionResponse>('/api/deployment-management/railway/services/batch-variables', {
      method: 'POST',
      body: JSON.stringify({ serviceKeys, variables, replace: replace === true }),
    }),
  listAppUsers: (query?: {
    limit?: number;
    query?: string;
    status?: string;
    activity?: string;
    hasSession?: string;
    hasConversation?: string;
    hasSandbox?: string;
    ownershipHealth?: string;
    sortKey?: string;
    sortDirection?: string;
  }) => {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.query) params.set('query', query.query);
    if (query?.status) params.set('status', query.status);
    if (query?.activity) params.set('activity', query.activity);
    if (query?.hasSession) params.set('hasSession', query.hasSession);
    if (query?.hasConversation) params.set('hasConversation', query.hasConversation);
    if (query?.hasSandbox) params.set('hasSandbox', query.hasSandbox);
    if (query?.ownershipHealth) params.set('ownershipHealth', query.ownershipHealth);
    if (query?.sortKey) params.set('sortKey', query.sortKey);
    if (query?.sortDirection) params.set('sortDirection', query.sortDirection);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<AppUserListResponse>(`/api/user-management/app-users${suffix}`);
  },
  getAppUserDetail: (userId: string) =>
    request<AppUserDetailResponse>(`/api/user-management/app-users/${encodeURIComponent(userId)}`),
  updateAppUserStatus: (userId: string, status: 'active' | 'disabled') =>
    request<AppUserDetailResponse>(`/api/user-management/app-users/${encodeURIComponent(userId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  getConversationSessionCore: (sessionId: string) =>
    request<ConversationSessionDetailResponse>(`/api/conversations/sessions/${encodeURIComponent(sessionId)}/core`, {
      timeoutMs: 10000,
      abortMessage: '加载会话核心数据超时，请稍后重试',
    }),
  getConversationSessionInfra: (sessionId: string) =>
    request<ConversationSessionInfraResponse>(`/api/conversations/sessions/${encodeURIComponent(sessionId)}/infra`, {
      timeoutMs: 20000,
      abortMessage: '加载运行关联信息超时，请稍后重试',
    }),
  getAgentManagementOverview: () =>
    request<AgentManagementOverview>('/api/agent-management/overview'),
  getSandboxManagementOverview: (limit = 50) =>
    request<SandboxManagementOverview>(`/api/sandbox-management/overview?limit=${limit}`),
  getSandboxLiveSummary: (options?: { forceRefresh?: boolean }) =>
    request<SandboxLiveSummary>(`/api/sandbox-management/live-summary${options?.forceRefresh ? '?refresh=1' : ''}`, {
      timeoutMs: 30000,
      abortMessage: '加载 E2B Sandbox 数量超时，请稍后重试',
    }),
  getSandboxRuntimeRegistry: (limit = 100) =>
    request<SandboxRuntimeRegistry>(`/api/sandbox-management/runtime-registry?limit=${limit}`, {
      timeoutMs: 30000,
      abortMessage: '加载 Sandbox Runtime 列表超时，请稍后重试',
    }),
  getSandboxRuntimeDetail: (sandboxId: string) =>
    request<SandboxRuntimeDetail>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/runtime-detail`, {
      timeoutMs: 30000,
      abortMessage: '加载 Sandbox 详情超时，请稍后重试',
    }),
  getSandboxArchiveHistory: (sandboxId: string) =>
    request<SandboxArchiveHistoryEntry[]>(
      `/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/archive-history`
    ),
  getSandboxArchiveDownloadUrl: (sandboxId: string, expiresInSeconds = 3600, snapshotKey?: string) =>
    request<{
      key: string;
      fileName: string;
      downloadUrl: string;
      expiresInSeconds: number;
    }>(
      `/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/archive-download-url?expiresInSeconds=${Math.max(60, Math.min(86400, Math.floor(expiresInSeconds || 3600)))}${snapshotKey ? `&snapshotKey=${encodeURIComponent(snapshotKey)}` : ''}`
    ),
  getSandboxEnvironment: (sandboxId: string) =>
    request<E2bSandboxDetail>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}`),
  getSandboxFullInfo: (sandboxId: string) =>
    request<E2bSandboxFullInfo>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/full-info`),
  getSandboxMetrics: (sandboxId: string, query?: { start?: string; end?: string }) => {
    const params = new URLSearchParams();
    if (query?.start) params.set('start', query.start);
    if (query?.end) params.set('end', query.end);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<E2bSandboxMetricPoint[]>(
      `/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/metrics${suffix}`
    );
  },
  createSandboxEnvironment: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/sandbox-management/environments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  refreshSandboxRuntime: (sandboxId: string) =>
    request<SandboxRuntimeDetail>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/refresh-runtime`, {
      method: 'POST',
    }),
  archiveSandboxEnvironment: (sandboxId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/archive`, {
      method: 'POST',
    }),
  openSandboxEnvironment: (sandboxId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/open`, {
      method: 'POST',
    }),
  restartSandboxEnvironment: (sandboxId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/restart`, {
      method: 'POST',
    }),
  restoreSandboxEnvironment: (sandboxId: string, payload?: { snapshotKey?: string }) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/restore`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  checkSandboxConnectivity: (sandboxId: string) =>
    request<Record<string, unknown>>(
      `/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/connectivity-check`,
      {
        method: 'POST',
      }
    ),
  setSandboxTimeout: (sandboxId: string, timeoutMs: number) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/timeout`, {
      method: 'POST',
      body: JSON.stringify({ timeoutMs }),
    }),
  closeSandboxEnvironment: (sandboxId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/close`, {
      method: 'POST',
    }),
  pauseSandboxEnvironment: (sandboxId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/pause`, {
      method: 'POST',
    }),
  resumeSandboxEnvironment: (sandboxId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/resume`, {
      method: 'POST',
    }),
  runSandboxToolAction: (sandboxId: string, action: string, payload?: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/sandbox-management/environments/${encodeURIComponent(sandboxId)}/tools`, {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
    }),

  listTemplates: (teamID?: string) =>
    request<E2bTemplate[]>(`/api/sandbox-management/templates${teamID ? `?teamID=${encodeURIComponent(teamID)}` : ''}`),
  getTemplate: (templateId: string, query?: { limit?: number; nextToken?: string }) => {
    const params = new URLSearchParams();
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.nextToken) params.set('nextToken', query.nextToken);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<E2bTemplateWithBuilds>(`/api/sandbox-management/templates/${encodeURIComponent(templateId)}${suffix}`);
  },
  createTemplate: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/sandbox-management/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTemplate: (templateId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/sandbox-management/templates/${encodeURIComponent(templateId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  rebuildTemplate: (templateId: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/sandbox-management/templates/${encodeURIComponent(templateId)}/rebuild`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteTemplate: (templateId: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
    }),
  getTemplateBuildLogs: (templateId: string, buildId: string, query?: Record<string, unknown>) => {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<E2bTemplateBuildLogsResponse>(
      `/api/sandbox-management/templates/${encodeURIComponent(templateId)}/builds/${encodeURIComponent(buildId)}/logs${suffix}`
    );
  },
  getTemplateBuildStatus: (templateId: string, buildId: string, query?: Record<string, unknown>) => {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<E2bTemplateBuildInfo>(
      `/api/sandbox-management/templates/${encodeURIComponent(templateId)}/builds/${encodeURIComponent(buildId)}/status${suffix}`
    );
  },
  checkTemplateAlias: (alias: string) =>
    request<Record<string, unknown>>(`/api/sandbox-management/templates/aliases/${encodeURIComponent(alias)}`),
  assignTemplateTags: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/sandbox-management/templates/tags', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteTemplateTags: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/sandbox-management/templates/tags', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    }),

  listAudit: (
    query: {
      query?: string;
      operator?: string;
      action?: string;
      result?: string;
      sessionId?: string;
      targetVmId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<AuditResponse>(`/api/audit${suffix}`);
  },
  getAuditDetail: (auditId: string) =>
    request<AuditDetailResponse>(`/api/audit/${encodeURIComponent(auditId)}`),
};
