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

  private async request<T>(path: string, options?: { method?: HttpMethod; body?: unknown }): Promise<T> {
    const method = options?.method || 'GET';
    const maxAttempts = Math.max(1, this.retries + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          `${this.baseUrl}${path}`,
          {
            method,
            headers: {
              'content-type': 'application/json',
              ...(config.oneceoInternalToken
                ? { 'x-oneceo-internal-token': config.oneceoInternalToken }
                : {}),
            },
            body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
          },
          this.timeoutMs
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

  getAgentHealth() {
    return this.request<{ success: boolean; message: string; timestamp: string }>('/api/agents/health');
  }

  getSandboxHealth() {
    return this.request<{ status?: string; service?: string; version?: string; time?: string }>('/api/sandbox/health');
  }

  listSandboxEnvironments(limit = 20) {
    return this.request<SandboxEnvironmentRecord[]>(`/api/sandbox/environment?limit=${limit}`);
  }

  listTaskCreationSessions(limit = 20) {
    return this.request<TaskCreationSession[]>(`/api/task-creation/sessions?limit=${limit}`);
  }

  getTaskCreationSession(sessionId: string) {
    return this.request<TaskCreationSession>(`/api/task-creation/sessions/${encodeURIComponent(sessionId)}`);
  }

  getTaskCreationMessages(sessionId: string) {
    return this.request<TaskCreationSession['messages']>(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/messages`
    );
  }

  getTaskCreationIntent(sessionId: string) {
    return this.request<Record<string, unknown>>(`/api/task-creation/sessions/${encodeURIComponent(sessionId)}/intent`);
  }

  getTaskCreationTaskDescription(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/task-description`
    );
  }

  getTaskCreationExecutionPlan(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/execution-plan`
    );
  }

  getTaskCreationDebug(sessionId: string) {
    return this.request<TaskDebugInfo>(`/api/task-creation/sessions/${encodeURIComponent(sessionId)}/debug`);
  }

  startTaskCreationRuntime(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/task-creation/sessions/${encodeURIComponent(sessionId)}/runtime/start`,
      {
        method: 'POST',
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

  restoreSandboxEnvironment(sessionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/sandbox/environment/${encodeURIComponent(sessionId)}/restore`,
      {
        method: 'POST',
      }
    );
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

  validateSkillRevision(skillId: string, revisionId: string, sessionId: string) {
    return this.request<AdminSkillValidationResult>(
      `/api/internal/skills/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(revisionId)}/validate`,
      {
        method: 'POST',
        body: { sessionId },
      }
    );
  }
}

export const oneceoApiConnector = new OneceoApiConnector();
