import { config } from '../config';
import { deepCamelCase } from '../utils/case';
import { AppError } from '../utils/errors';
import type { KvmSessionListItem, KvmVmDetail, KvmVmListItem, KvmVmState } from '../types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type OrchestratorEnvelope<T> = {
  code: number;
  message: string;
  data?: T;
  error?: {
    type: string;
    details?: string;
    field?: string;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(statusCode: number) {
  return statusCode >= 500 || statusCode === 429;
}

function shouldRetryError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

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

export class KvmOrchestratorConnector {
  private readonly baseUrl = config.kvmOrchestratorUrl;
  private readonly timeoutMs = config.kvmRequestTimeoutMs;
  private readonly retries = config.kvmRequestRetries;

  private buildQueryString(query?: Record<string, unknown>): string {
    if (!query) {
      return '';
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      params.set(key, String(value));
    }

    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
  }

  private async request<T>(path: string, options?: { method?: HttpMethod; body?: unknown }): Promise<T> {
    const method = options?.method ?? 'GET';
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
            body: options?.body === undefined ? undefined : JSON.stringify(options.body),
          },
          this.timeoutMs
        );

        const payload = (await response.json().catch(() => ({}))) as OrchestratorEnvelope<unknown>;
        const statusCode = response.status;

        if (!response.ok) {
          const message = payload?.error?.details || payload?.message || `请求失败 (${statusCode})`;
          const error = new AppError(statusCode, message, payload?.error);

          if (attempt < maxAttempts && isRetryableStatus(statusCode)) {
            lastError = error;
            await sleep(500);
            continue;
          }

          throw error;
        }

        if (typeof payload?.code === 'number' && payload.code !== 0) {
          throw new AppError(502, payload.message || 'KVM 返回异常结果', payload.error);
        }

        return deepCamelCase<T>(payload?.data ?? payload);
      } catch (error) {
        lastError = error;

        if (attempt >= maxAttempts || !shouldRetryError(error)) {
          break;
        }

        await sleep(500);
      }
    }

    if (lastError instanceof AppError) {
      throw lastError;
    }

    if (lastError && typeof lastError === 'object' && 'name' in lastError && (lastError as any).name === 'AbortError') {
      throw new AppError(504, '连接 kvm-orchestrator 超时');
    }

    throw new AppError(502, '无法连接 kvm-orchestrator', {
      cause: lastError instanceof Error ? lastError.message : lastError,
    });
  }

  health() {
    return this.request<{ status: string; service: string; timestamp: string }>('/health');
  }

  listVms(query?: { state?: string; limit?: number; offset?: number }) {
    return this.request<{ total: number; limit: number; offset: number; vms: KvmVmListItem[] }>(
      `/api/v1/kvm/list${this.buildQueryString(query)}`
    );
  }

  getVm(vmId: string) {
    return this.request<KvmVmDetail>(`/api/v1/kvm/${encodeURIComponent(vmId)}`);
  }

  getVmState(vmId: string) {
    return this.request<KvmVmState>(`/api/v1/kvm/${encodeURIComponent(vmId)}/state`);
  }

  startVm(vmId: string) {
    return this.request<{ vmId: string; state: string; ipAddress?: string; startedAt: string }>(
      `/api/v1/kvm/${encodeURIComponent(vmId)}/start`,
      {
        method: 'POST',
        body: {
          wait_ready: false,
        },
      }
    );
  }

  stopVm(vmId: string, force = false) {
    return this.request<{ vmId: string; state: string; stoppedAt: string }>(`/api/v1/kvm/${encodeURIComponent(vmId)}/stop`, {
      method: 'POST',
      body: {
        force,
      },
    });
  }

  createVm(input: {
    sessionId: string;
    cpuCores?: number;
    memoryMb?: number;
    rootDiskGb?: number;
    tags?: Record<string, string>;
  }) {
    return this.request<{
      vmId: string;
      sessionId: string;
      name: string;
      state: string;
      config: {
        cpuCores: number;
        memoryMb: number;
        rootDiskGb: number;
        networkBridge: string;
      };
      createdAt: string;
    }>('/api/v1/kvm/create', {
      method: 'POST',
      body: {
        session_id: input.sessionId,
        cpu_cores: input.cpuCores,
        memory_mb: input.memoryMb,
        root_disk_gb: input.rootDiskGb,
        tags: input.tags,
      },
    });
  }

  listSessions(query?: { userId?: string; status?: string; limit?: number; offset?: number }) {
    return this.request<{ total: number; limit: number; offset: number; sessions: KvmSessionListItem[] }>(
      `/api/v1/session/list${
        this.buildQueryString({
          user_id: query?.userId,
          status: query?.status,
          limit: query?.limit,
          offset: query?.offset,
        })
      }`
    );
  }

  getQuota(sessionId: string) {
    return this.request<{
      quotaId: string;
      sessionId: string;
      cpu: {
        cores: number;
        maxCores: number;
        usagePercent: number;
      };
      memory: {
        mb: number;
        maxMb: number;
        usageMb: number;
      };
      storage: {
        gb: number;
        maxGb: number;
        usageGb: number;
      };
    }>(`/api/v1/quota/${encodeURIComponent(sessionId)}`);
  }
}

export const kvmOrchestratorConnector = new KvmOrchestratorConnector();