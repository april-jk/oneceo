import { config } from '../config';
import { AppError } from '../utils/errors';
import { deepCamelCase } from '../utils/case';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type OneceoEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string | { message?: string };
};

export type TaskCreationSession = {
  id: string;
  userId?: string | null;
  user?: AdminTaskSessionUser | null;
  title: string;
  status: 'in_progress' | 'waiting_user' | 'completed' | 'failed' | string;
  stage?: 'collecting' | 'clarifying' | 'planning' | 'executing' | 'completed' | 'failed' | string;
  runtime?: {
    orchestratorSessionId?: string;
    opencodeSessionId?: string;
    updatedAt?: string;
  };
  pendingQuestion?: string;
  pendingOptions?: string[];
  pendingResume?: {
    stage: string;
    reason?: string;
    lastUserInput?: string;
    updatedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
  messages?: TaskCreationMessage[];
};

export type AdminTaskSessionUser = {
  id: string;
  source: 'app_user' | 'legacy_user_id' | 'missing_app_user' | string;
  displayName?: string | null;
  email?: string | null;
  status?: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionCreatedAt?: string | null;
};

export type TaskCreationMessage = {
  id: string;
  role: 'user' | 'agent' | 'system' | string;
  messageType?: string;
  content: string;
  createdAt: string;
  metadata?: unknown;
};

export type SandboxEnvironmentRecord = {
  id: string;
  sessionId: string;
  orchestratorSessionId?: string | null;
  vmName?: string | null;
  baseImage?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
};

export type TaskSessionSandboxBinding = {
  id: string;
  sessionId: string;
  sandboxId: string;
  workspaceRoot?: string | null;
  status?: string | null;
  metadataJson?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string | null;
};

export type TaskSessionSandboxEnvironments = {
  taskSessionId: string;
  binding: TaskSessionSandboxBinding | null;
  primaryEnvironment: SandboxEnvironmentRecord | null;
  relatedEnvironments: SandboxEnvironmentRecord[];
};

export type TaskDebugInfo = {
  ready: boolean;
  url?: string;
  status?: string;
  updatedAt?: string;
  sandboxId?: string;
  message?: string;
};

export type OsacMessageRecord = {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type AdminSkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type AdminSkillDetail = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
  publishedRevisionId: string | null;
  latestBodyMarkdown: string;
  renderedSkillMarkdown: string | null;
  resourceSummary?: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  };
  resources?: Array<{
    id: string;
    resourcePath: string;
    resourceType: 'reference' | 'template';
    createdAt: string;
  }>;
  updatedAt: string;
};

export type AdminSkillRevision = {
  id: string;
  revisionNumber: number;
  createdAt: string;
  createdBy?: string | null;
  publishedAt?: string | null;
  isPublished: boolean;
};

export type AdminSkillRenderedRevision = {
  skillId: string;
  revisionId: string;
  revisionNumber: number;
  slug: string;
  renderedMarkdown: string;
  signature: string;
};

export type AdminSkillRevisionResources = {
  skill: {
    id: string;
    slug: string;
    name: string;
  };
  revision: {
    id: string;
    revisionNumber: number;
  };
  resourceSummary: {
    totalCount: number;
    referenceCount: number;
    templateCount: number;
    paths: string[];
  };
  resources: Array<{
    id: string;
    resourceKey: string;
    resourcePath: string;
    resourceType: 'reference' | 'template';
    title: string;
    summary: string;
    contentStorage: 'database' | 'object_storage';
    mimeType: string;
    storagePath: string | null;
    storageLocatorJson: Record<string, unknown> | null;
    loadStage: string;
    sortOrder: number;
    contentMarkdown: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type AdminSkillValidationResult = {
  sessionId: string;
  skillId: string;
  revisionId: string;
  slug: string | null;
  skillPath: string | null;
  signature: string;
  restartTriggered: boolean;
  syncedAt: string;
};

export type AdminSkillImportPreview = {
  rootFolderName: string;
  slug: string;
  name: string;
  discoveryDescription: string;
  activationSummary: string;
  entry: {
    entryName: string;
    entryDescription: string;
    bodyMarkdown: string;
  };
  files: Array<{
    relativePath: string;
    nodeType: 'file';
    resourceKind: 'reference' | 'template' | 'example' | 'script';
    storageTarget: 'database' | 'object_storage';
    processingState: 'pending';
    sizeBytes: number;
  }>;
  resources: Array<{
    resourceKey: string;
    resourcePath: string;
    resourceKind: 'reference' | 'template' | 'example' | 'script';
    title: string;
    summary: string;
    contentFormat: 'markdown' | 'text' | 'json';
    contentMode: 'inline' | 'chunked';
    fullTextHash: string;
    contentSize: number;
    chunks: Array<{
      chunkIndex: number;
      chunkRole: 'summary' | 'body';
      chunkSummary: string;
      contentText: string;
      tokenEstimate: number;
    }>;
  }>;
  warnings: string[];
};

export type AdminSkillImportResult = {
  mode: 'create' | 'revision';
  preview: AdminSkillImportPreview;
  skill: AdminSkillDetail;
  revision: AdminSkillRevision;
};

export type AdminSkillImportJob = {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  preview: AdminSkillImportPreview;
  files: Array<{
    relativePath: string;
    storageTarget: 'database' | 'object_storage';
    processingState: 'pending' | 'processing' | 'success' | 'failed';
    error?: string | null;
  }>;
  result?: AdminSkillImportResult | null;
  error?: string | null;
};

export type AdminConnectorGuidePolicy = {
  id: string;
  connectorKey: string;
  status: 'draft' | 'active' | 'archived' | string;
  triggerMode: 'on_attach' | 'on_active_use' | 'on_attach_and_active_use' | string;
  description: string;
  publishedRevisionId: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminConnectorGuideRevision = {
  id: string;
  policyId: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'archived' | string;
  serverInstructionsMarkdown: string;
  guideReminderMarkdown: string;
  blockingRulesMarkdown: string;
  notes: string;
  createdBy?: string | null;
  createdAt: string;
  publishedAt?: string | null;
};

export type AdminConnectorGuidePolicyDetail = AdminConnectorGuidePolicy & {
  publishedRevision?: AdminConnectorGuideRevision | null;
  revisions: AdminConnectorGuideRevision[];
};

export type AdminConnectorGuideValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type AdminConnectorCatalogItem = {
  key: string;
  name: string;
  available: boolean;
  availabilityReason?: string;
  visibleInMenu: boolean;
};

export type AdminConnectorGuideCatalogSummary = {
  items: AdminConnectorCatalogItem[];
  stats: {
    total: number;
    available: number;
    unavailable: number;
  };
  updatedAt: string;
};

export type AdminOsacRelease = {
  id: string;
  artifactType: string;
  platform: string;
  arch: string;
  version: string;
  channel: string;
  status: 'uploaded' | 'validated' | 'published' | 'archived' | string;
  bucket: string;
  objectKey: string;
  manifestKey: string;
  sha256: string;
  sizeBytes: number;
  releaseNotes: string;
  sourceCommit?: string | null;
  uploadedBy?: string | null;
  publishedBy?: string | null;
  uploadedAt: string;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadataJson?: Record<string, unknown> | null;
};

export type AdminOsacReleaseList = {
  currentPublishedReleaseId: string | null;
  currentPublishedVersion: string | null;
  channel: string;
  items: AdminOsacRelease[];
};

export type AdminOsacReleaseDetail = {
  release: AdminOsacRelease;
  currentPublishedReleaseId: string | null;
  currentPublishedVersion: string | null;
};

export type InternalAdminLoginResult = {
  sessionToken: string;
  adminUser: {
    id: string;
    loginName: string;
    displayName: string;
    role: string;
    status: string;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(statusCode: number) {
  return statusCode >= 500 || statusCode === 429;
}

function shouldRetryError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('timeout') || message.includes('network') || message.includes('aborted');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class OneceoApiConnector {
  private readonly baseUrl = config.oneceoApiUrl;
  private readonly timeoutMs = config.oneceoRequestTimeoutMs;
  private readonly retries = config.oneceoRequestRetries;

  private async request<T>(
    path: string,
    options?: { method?: HttpMethod; body?: unknown; headers?: Record<string, string>; timeoutMs?: number; retries?: number }
  ): Promise<T> {
    const method = options?.method || 'GET';
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const retries = options?.retries ?? this.retries;
    const maxAttempts = Math.max(1, retries + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          `${this.baseUrl}${path}`,
          {
            method,
            headers: {
              'content-type': 'application/json',
              'x-oneceo-internal-token': config.oneceoInternalToken,
              ...(options?.headers || {}),
            },
            body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
          },
          timeoutMs
        );

        const payload = (await response.json().catch(() => ({}))) as OneceoEnvelope<unknown>;

        if (!response.ok) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : payload.error?.message || payload.message || `请求失败 (${response.status})`;
          throw new AppError(response.status, message, payload);
        }

        if (payload.success === false) {
          const message =
            typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || 'Oneceo API 返回失败';
          throw new AppError(502, message, payload);
        }

        return deepCamelCase<T>(payload.data ?? payload);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !shouldRetryError(error)) {
          break;
        }
        await sleep(300);
      }
    }

    if (lastError instanceof AppError) {
      throw lastError;
    }
    if (lastError && typeof lastError === 'object' && 'name' in lastError && (lastError as any).name === 'AbortError') {
      throw new AppError(504, '连接 oneceo api 超时');
    }
    throw new AppError(502, '无法连接 oneceo api', {
      cause: lastError instanceof Error ? lastError.message : lastError,
    });
  }

  health() {
    return this.request<{ status: string; timestamp: string; version?: string }>('/health');
  }

  adminLogin(input: { loginName: string; password: string }) {
    return this.request<InternalAdminLoginResult>('/api/internal/admin-auth/login', {
      method: 'POST',
      body: input,
    });
  }

  adminLogout(sessionToken: string) {
    return this.request<{ ok: true }>('/api/internal/admin-auth/logout', {
      method: 'POST',
      body: { sessionToken },
    });
  }

  resolveAdminSession(sessionToken: string) {
    return this.request<{ adminUser: InternalAdminLoginResult['adminUser'] }>('/api/internal/admin-auth/resolve', {
      method: 'POST',
      body: { sessionToken },
    });
  }

  getAgentHealth() {
    return this.request<{ success: boolean; message: string; timestamp: string }>('/api/agents/health');
  }

  getSandboxHealth() {
    return this.request<{ status?: string; service?: string; version?: string; time?: string }>('/api/sandbox/health');
  }

  listSandboxEnvironments(limit = 20) {
    return this.request<SandboxEnvironmentRecord[]>(`/api/sandbox/environment?limit=${limit}`);
  }

  listSandboxEnvironmentRegistry(limit = 20) {
    return this.request<SandboxEnvironmentRecord[]>(`/api/internal/sandbox/environment-registry?limit=${limit}`);
  }

  getTaskSessionSandboxEnvironments(taskSessionId: string) {
    return this.request<TaskSessionSandboxEnvironments>(
      `/api/internal/sandbox/by-task-session/${encodeURIComponent(taskSessionId)}`
    );
  }

  listTaskCreationSessions(limit = 20) {
    return this.request<TaskCreationSession[]>(`/api/internal/task-creation/admin/sessions?limit=${limit}`);
  }

  getTaskCreationSession(sessionId: string) {
    return this.request<TaskCreationSession>(`/api/internal/task-creation/admin/sessions/${encodeURIComponent(sessionId)}`);
  }

  getTaskCreationMessages(sessionId: string) {
    return this.request<TaskCreationSession['messages']>(
      `/api/internal/task-creation/admin/sessions/${encodeURIComponent(sessionId)}/messages`
    );
  }

  getTaskCreationIntent(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/internal/task-creation/admin/sessions/${encodeURIComponent(sessionId)}/intent`
    );
  }

  getTaskCreationTaskDescription(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/internal/task-creation/admin/sessions/${encodeURIComponent(sessionId)}/task-description`
    );
  }

  getTaskCreationExecutionPlan(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/internal/task-creation/admin/sessions/${encodeURIComponent(sessionId)}/execution-plan`
    );
  }

  getTaskCreationDebug(sessionId: string) {
    return this.request<TaskDebugInfo>(`/api/internal/task-creation/admin/sessions/${encodeURIComponent(sessionId)}/debug`);
  }

  startTaskCreationRuntime(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/internal/task-creation/sessions/${encodeURIComponent(sessionId)}/runtime/start`,
      {
        method: 'POST',
        timeoutMs: 60_000,
        retries: 0,
      }
    );
  }

  getSandboxEnvironment(sessionId: string) {
    return this.request<SandboxEnvironmentRecord>(`/api/sandbox/environment/${encodeURIComponent(sessionId)}`);
  }

  archiveSandboxEnvironment(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/sandbox/environment/${encodeURIComponent(sessionId)}/archive`,
      {
        method: 'POST',
      }
    );
  }

  restoreSandboxEnvironment(sessionId: string, payload?: { snapshotKey?: string }) {
    return this.request<Record<string, unknown>>(
      `/api/sandbox/environment/${encodeURIComponent(sessionId)}/restore`,
      {
        method: 'POST',
        body: payload ? JSON.stringify(payload) : undefined,
      }
    );
  }

  getSandboxArchiveHistory(sessionId: string) {
    return this.request<Array<Record<string, unknown>>>(
      `/api/internal/sandbox/${encodeURIComponent(sessionId)}/archive-history`
    );
  }

  getSandboxArchiveDownloadUrl(sessionId: string, expiresInSeconds = 3600, snapshotKey?: string) {
    const ttl = Number.isFinite(expiresInSeconds) ? Math.max(60, Math.min(86_400, Math.floor(expiresInSeconds))) : 3600;
    const suffix = snapshotKey
      ? `?expiresInSeconds=${ttl}&snapshotKey=${encodeURIComponent(snapshotKey)}`
      : `?expiresInSeconds=${ttl}`;
    return this.request<{
      key: string;
      fileName: string;
      downloadUrl: string;
      expiresInSeconds: number;
    }>(`/api/internal/sandbox/${encodeURIComponent(sessionId)}/archive-download-url${suffix}`);
  }

  checkSandboxConnectivity(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/sandbox/environment/${encodeURIComponent(sessionId)}/connectivity-check`,
      {
        method: 'POST',
      }
    );
  }

  closeSandboxEnvironment(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/sandbox/environment/${encodeURIComponent(sessionId)}/close`,
      {
        method: 'POST',
      }
    );
  }

  listOsacMessages(sessionId: string, limit = 200) {
    return this.request<OsacMessageRecord[]>(
      `/api/sandbox/osac/${encodeURIComponent(sessionId)}/messages?limit=${Math.max(1, Math.min(limit, 500))}`
    );
  }

  listSkills(query?: { query?: string; status?: string; category?: string }) {
    const params = new URLSearchParams();
    if (query?.query) params.set('query', query.query);
    if (query?.status) params.set('status', query.status);
    if (query?.category) params.set('category', query.category);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<AdminSkillSummary[]>(`/api/internal/skills${suffix}`);
  }

  getSkill(skillId: string) {
    return this.request<AdminSkillDetail>(`/api/internal/skills/${encodeURIComponent(skillId)}`);
  }

  createSkill(input: {
    slug: string;
    name: string;
    description?: string;
    category?: string;
    bodyMarkdown: string;
    resources?: Array<{
      resourcePath: string;
      resourceType?: 'reference' | 'template';
      contentMarkdown: string;
    }>;
    createdBy?: string;
  }) {
    return this.request<AdminSkillDetail>('/api/internal/skills', {
      method: 'POST',
      body: input,
    });
  }

  updateSkill(
    skillId: string,
    input: {
      name?: string;
      description?: string;
      category?: string;
      bodyMarkdown?: string;
      resources?: Array<{
        resourcePath: string;
        resourceType?: 'reference' | 'template';
        contentMarkdown: string;
      }>;
      createdBy?: string;
    }
  ) {
    return this.request<AdminSkillDetail>(`/api/internal/skills/${encodeURIComponent(skillId)}`, {
      method: 'PUT',
      body: input,
    });
  }

  archiveSkill(skillId: string) {
    return this.request<AdminSkillDetail>(`/api/internal/skills/${encodeURIComponent(skillId)}/archive`, {
      method: 'POST',
    });
  }

  activateSkill(skillId: string) {
    return this.request<AdminSkillDetail>(`/api/internal/skills/${encodeURIComponent(skillId)}/activate`, {
      method: 'POST',
    });
  }

  listSkillRevisions(skillId: string) {
    return this.request<AdminSkillRevision[]>(`/api/internal/skills/${encodeURIComponent(skillId)}/revisions`);
  }

  getRenderedSkillRevision(skillId: string, revisionId: string) {
    return this.request<AdminSkillRenderedRevision>(
      `/api/internal/skills/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/rendered`
    );
  }

  getSkillRevisionResources(skillId: string, revisionId: string) {
    return this.request<AdminSkillRevisionResources>(
      `/api/internal/skills/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/resources`
    );
  }

  validateSkillRevision(skillId: string, revisionId: string, sessionId: string) {
    return this.request<AdminSkillValidationResult>(
      `/api/internal/skills/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/validate`,
      {
        method: 'POST',
        body: { sessionId },
      }
    );
  }

  previewSkillFolderImport(input: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
  }) {
    return this.request<AdminSkillImportPreview>('/api/internal/skills/import/folder-preview', {
      method: 'POST',
      body: input,
    });
  }

  importSkillFolder(input: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
    createdBy?: string;
    skillId?: string;
  }) {
    return this.request<AdminSkillImportResult>('/api/internal/skills/import/folder', {
      method: 'POST',
      body: input,
    });
  }

  createSkillFolderImportJob(input: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
    createdBy?: string;
    skillId?: string;
  }) {
    return this.request<AdminSkillImportJob>('/api/internal/skills/import/folder-jobs', {
      method: 'POST',
      body: input,
    });
  }

  getSkillFolderImportJob(jobId: string) {
    return this.request<AdminSkillImportJob>(`/api/internal/skills/import/folder-jobs/${encodeURIComponent(jobId)}`);
  }

  listConnectorGuides(filters?: { connectorKey?: string; status?: string; query?: string }) {
    const params = new URLSearchParams();
    if (filters?.connectorKey) params.set('connectorKey', filters.connectorKey);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.query) params.set('query', filters.query);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<AdminConnectorGuidePolicy[]>(`/api/internal/connector-guides${suffix}`);
  }

  getConnectorGuidePolicy(policyId: string) {
    return this.request<AdminConnectorGuidePolicyDetail>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}`
    );
  }

  createConnectorGuidePolicy(input: {
    connectorKey: string;
    triggerMode: string;
    description?: string;
    createdBy?: string;
  }) {
    return this.request<AdminConnectorGuidePolicy>('/api/internal/connector-guides', {
      method: 'POST',
      body: input,
    });
  }

  updateConnectorGuidePolicy(
    policyId: string,
    input: {
      triggerMode?: string;
      description?: string;
      status?: string;
    }
  ) {
    return this.request<AdminConnectorGuidePolicy>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}`,
      {
        method: 'PUT',
        body: input,
      }
    );
  }

  createConnectorGuideRevision(policyId: string, input?: { createdBy?: string }) {
    return this.request<AdminConnectorGuideRevision>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}/revisions`,
      {
        method: 'POST',
        body: input || {},
      }
    );
  }

  getConnectorGuideRevision(policyId: string, revisionId: string) {
    return this.request<AdminConnectorGuideRevision>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}`
    );
  }

  updateConnectorGuideRevision(
    policyId: string,
    revisionId: string,
    input: {
      serverInstructionsMarkdown?: string;
      guideReminderMarkdown?: string;
      blockingRulesMarkdown?: string;
      notes?: string;
    }
  ) {
    return this.request<AdminConnectorGuideRevision>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}`,
      {
        method: 'PUT',
        body: input,
      }
    );
  }

  validateConnectorGuideRevision(policyId: string, revisionId: string) {
    return this.request<AdminConnectorGuideValidationResult>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}/validate`,
      {
        method: 'POST',
        body: {},
      }
    );
  }

  publishConnectorGuideRevision(policyId: string, revisionId: string) {
    return this.request<{
      policy: AdminConnectorGuidePolicy;
      revision: AdminConnectorGuideRevision;
      validation: AdminConnectorGuideValidationResult;
    }>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}/publish`,
      {
        method: 'POST',
        body: {},
      }
    );
  }

  rollbackConnectorGuideRevision(policyId: string, revisionId: string) {
    return this.request<{
      policy: AdminConnectorGuidePolicy;
      revision: AdminConnectorGuideRevision;
    }>(
      `/api/internal/connector-guides/${encodeURIComponent(policyId)}/revisions/${encodeURIComponent(revisionId)}/rollback`,
      {
        method: 'POST',
        body: {},
      }
    );
  }

  listConnectorCatalog() {
    return this.request<AdminConnectorCatalogItem[]>('/api/connectors/catalog');
  }

  listOsacReleases(filters?: { status?: string; query?: string; channel?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.query) params.set('query', filters.query);
    if (filters?.channel) params.set('channel', filters.channel);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<AdminOsacReleaseList>(`/api/internal/runtime-artifacts/osac/releases${suffix}`);
  }

  getOsacRelease(releaseId: string) {
    return this.request<AdminOsacReleaseDetail>(
      `/api/internal/runtime-artifacts/osac/releases/${encodeURIComponent(releaseId)}`
    );
  }

  uploadOsacRelease(input: {
    version: string;
    fileBase64: string;
    releaseNotes?: string;
    sourceCommit?: string;
    uploadedBy?: string;
    channel?: string;
  }) {
    return this.request<AdminOsacRelease>('/api/internal/runtime-artifacts/osac/releases', {
      method: 'POST',
      body: input,
      timeoutMs: config.oneceoOsacUploadTimeoutMs,
      retries: 0,
    });
  }

  validateOsacRelease(releaseId: string) {
    return this.request<AdminOsacRelease>(
      `/api/internal/runtime-artifacts/osac/releases/${encodeURIComponent(releaseId)}/validate`,
      {
        method: 'POST',
        body: {},
      }
    );
  }

  publishOsacRelease(releaseId: string, publishedBy?: string) {
    return this.request<AdminOsacReleaseDetail>(
      `/api/internal/runtime-artifacts/osac/releases/${encodeURIComponent(releaseId)}/publish`,
      {
        method: 'POST',
        body: {
          publishedBy,
        },
      }
    );
  }

  rollbackOsacRelease(releaseId: string, publishedBy?: string) {
    return this.request<AdminOsacReleaseDetail>(
      `/api/internal/runtime-artifacts/osac/releases/${encodeURIComponent(releaseId)}/rollback`,
      {
        method: 'POST',
        body: {
          publishedBy,
        },
      }
    );
  }
}

export const oneceoApiConnector = new OneceoApiConnector();
