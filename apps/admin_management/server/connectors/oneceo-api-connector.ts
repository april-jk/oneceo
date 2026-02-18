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
  pendingQuestion?: string;
  pendingOptions?: string[];
  createdAt: string;
  updatedAt: string;
  messages?: Array<{
    id: string;
    role: 'user' | 'agent' | 'system' | string;
    messageType?: string;
    content: string;
    createdAt: string;
    metadata?: unknown;
  }>;
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
}

export const oneceoApiConnector = new OneceoApiConnector();
