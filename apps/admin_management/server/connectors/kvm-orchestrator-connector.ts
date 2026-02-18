import { config } from '../config';
import { deepCamelCase } from '../utils/case';
import { AppError } from '../utils/errors';
import type { KvmSessionListItem, KvmVmDetail, KvmVmListItem, KvmVmState, VmLifecycleState } from '../types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type OrchestratorEnvelope<T> = {
  code?: string | number;
  message?: string;
  data?: T;
  error?: {
    type?: string;
    details?: unknown;
    field?: string;
  } | null;
  request_id?: string;
};

type VmListRawItem = {
  name: string;
  state: string;
};

type VmDetailRaw = {
  name: string;
  state: string;
  ipAddresses?: string[];
};

type VmMetricsRaw = {
  name: string;
  state: string;
  memory?: {
    actual?: number;
    rss?: number;
  };
  stats?: Record<string, number | string>;
  collectedAt?: string;
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

function parseVmState(state: string | undefined): VmLifecycleState {
  const normalized = (state || '').toLowerCase();
  if (normalized.includes('running')) return 'running';
  if (normalized.includes('pause')) return 'paused';
  if (normalized === 'shut off' || normalized.includes('stopped') || normalized.includes('shutdown')) return 'stopped';
  return 'error';
}

function parseSessionIdFromVmName(vmName: string): string {
  if (vmName.startsWith('sandbox_sess_')) {
    return vmName.replace('sandbox_', '');
  }

  const matched = vmName.match(/sess_[a-zA-Z0-9]+/);
  if (matched?.[0]) {
    return matched[0];
  }

  return `session-${vmName}`;
}

function toIpv4(ipList: string[] | undefined): string | undefined {
  if (!ipList || ipList.length === 0) {
    return undefined;
  }

  for (const item of ipList) {
    const ip = item.split('/')[0];
    if (ip && !ip.includes(':')) {
      return ip;
    }
  }

  return ipList[0]?.split('/')[0];
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function formatErrorDetails(details: unknown): string {
  if (details === undefined || details === null) {
    return '';
  }
  if (typeof details === 'string') {
    return details;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function bytesToGb(bytes: number): number {
  return Number((bytes / (1024 * 1024 * 1024)).toFixed(2));
}

function kbToMb(kb: number): number {
  return Math.floor(kb / 1024);
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
  private readonly token = config.kvmOrchToken;

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

  private buildHeaders(withAuth = true, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...(extra || {}),
    };

    if (withAuth) {
      if (!this.token) {
        throw new AppError(500, '缺少 KVM_ORCH_TOKEN，无法访问 kvm-orchestrator');
      }
      headers.authorization = `Bearer ${this.token}`;
    }

    return headers;
  }

  private async request<T>(
    path: string,
    options?: {
      method?: HttpMethod;
      body?: unknown;
      withAuth?: boolean;
      headers?: Record<string, string>;
      retries?: number;
    }
  ): Promise<T> {
    const method = options?.method ?? 'GET';
    const withAuth = options?.withAuth !== false;
    const maxAttempts = Math.max(1, (options?.retries ?? this.retries) + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const headers = this.buildHeaders(withAuth, options?.headers);
        if (options?.body !== undefined) {
          headers['content-type'] = 'application/json';
        }

        const response = await fetchWithTimeout(
          `${this.baseUrl}${path}`,
          {
            method,
            headers,
            body: options?.body === undefined ? undefined : JSON.stringify(options.body),
          },
          this.timeoutMs
        );

        const payload = (await response.json().catch(() => ({}))) as OrchestratorEnvelope<unknown>;
        const statusCode = response.status;

        if (!response.ok) {
          const detailMessage =
            payload?.error && typeof payload.error === 'object' && 'details' in payload.error
              ? formatErrorDetails(payload.error.details)
              : '';
          const message = detailMessage || payload?.message || `请求失败 (${statusCode})`;
          const error = new AppError(statusCode, message, payload?.error ?? payload);

          if (attempt < maxAttempts && isRetryableStatus(statusCode)) {
            lastError = error;
            await sleep(400);
            continue;
          }

          throw error;
        }

        return deepCamelCase<T>(payload?.data ?? payload);
      } catch (error) {
        lastError = error;

        if (attempt >= maxAttempts || !shouldRetryError(error)) {
          break;
        }

        await sleep(400);
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

  async health() {
    const data = await this.request<{ status?: string; service?: string; time?: string; timestamp?: string }>('/health', {
      withAuth: false,
      retries: 0,
    });

    return {
      status: data.status || 'unknown',
      service: data.service || 'kvm-orchestrator',
      timestamp: data.timestamp || data.time || new Date().toISOString(),
    };
  }

  async listVms(query?: { state?: string; limit?: number; offset?: number }) {
    const data = await this.request<{ total?: number; items?: VmListRawItem[] }>('/v1/vms', { retries: 0 });
    const items = Array.isArray(data.items) ? data.items : [];

    const normalized = items.map<KvmVmListItem>((item) => ({
      vmId: item.name,
      state: parseVmState(item.state),
    }));

    const filtered = query?.state ? normalized.filter((item) => item.state === query.state) : normalized;
    const limit = query?.limit ?? 200;
    const offset = query?.offset ?? 0;

    return {
      total: filtered.length,
      limit,
      offset,
      vms: filtered.slice(offset, offset + limit),
    };
  }

  async getVm(vmId: string): Promise<KvmVmDetail> {
    const [detail, metrics] = await Promise.all([
      this.request<VmDetailRaw>(`/v1/vms/${encodeURIComponent(vmId)}`),
      this.request<VmMetricsRaw>(`/v1/vms/${encodeURIComponent(vmId)}/metrics`).catch(() => undefined),
    ]);

    const stats = (metrics?.stats || {}) as Record<string, unknown>;
    const memoryActualKb = asNumber(metrics?.memory?.actual, 2048 * 1024);
    const cpuCores = Math.max(1, asNumber(stats['vcpu.current'], 2));
    const diskBytes = asNumber(stats['block.0.capacity'], 20 * 1024 * 1024 * 1024);

    return {
      vmId: detail.name,
      name: detail.name,
      state: parseVmState(detail.state),
      config: {
        cpuCores,
        memoryMb: kbToMb(memoryActualKb),
        rootDiskGb: Math.max(1, Math.round(bytesToGb(diskBytes))),
      },
      network: {
        ipAddress: toIpv4(detail.ipAddresses),
      },
      createdAt: new Date().toISOString(),
      stateInfo: metrics
        ? {
            uptimeSeconds: 0,
            cpuUsagePercent: 0,
            memoryUsageMb: kbToMb(asNumber(metrics.memory?.rss, 0)),
            diskUsageGb: bytesToGb(asNumber(stats['block.0.allocation'], 0)),
          }
        : undefined,
    };
  }

  async getVmState(vmId: string): Promise<KvmVmState> {
    const metrics = await this.request<VmMetricsRaw>(`/v1/vms/${encodeURIComponent(vmId)}/metrics`);
    const stats = (metrics.stats || {}) as Record<string, unknown>;

    return {
      vmId,
      state: parseVmState(metrics.state),
      uptimeSeconds: 0,
      cpuUsagePercent: 0,
      memoryUsageMb: kbToMb(asNumber(metrics.memory?.rss, 0)),
      diskUsageGb: bytesToGb(asNumber(stats['block.0.allocation'], 0)),
      network: {
        inBytes: asNumber(stats['net.0.rx.bytes'], 0),
        outBytes: asNumber(stats['net.0.tx.bytes'], 0),
      },
      lastUpdate: metrics.collectedAt || new Date().toISOString(),
    };
  }

  async startVm(vmId: string) {
    await this.request(`/v1/vms/${encodeURIComponent(vmId)}/start`, {
      method: 'POST',
    });

    return {
      vmId,
      state: 'running',
      startedAt: new Date().toISOString(),
    };
  }

  async stopVm(vmId: string, _force = false) {
    await this.request(`/v1/vms/${encodeURIComponent(vmId)}/shutdown`, {
      method: 'POST',
    });

    return {
      vmId,
      state: 'stopped',
      stoppedAt: new Date().toISOString(),
    };
  }

  async createVm(input: {
    sessionId: string;
    cpuCores?: number;
    memoryMb?: number;
    rootDiskGb?: number;
    tags?: Record<string, string>;
  }) {
    const vmName = `sandbox_${input.sessionId}`;
    const data = await this.request<{ vmName?: string; sessionId?: string; state?: string }>(`/v1/sandboxes`, {
      method: 'POST',
      body: {
        session_id: input.sessionId,
        vm_name: vmName,
        memory_mb: input.memoryMb,
        vcpus: input.cpuCores,
        auto_bind: true,
        start: false,
        metadata: input.tags || {},
      },
    });

    return {
      vmId: data.vmName || vmName,
      sessionId: data.sessionId || input.sessionId,
      name: data.vmName || vmName,
      state: parseVmState(data.state),
      config: {
        cpuCores: input.cpuCores || 0,
        memoryMb: input.memoryMb || 0,
        rootDiskGb: input.rootDiskGb || 0,
        networkBridge: 'default',
      },
      createdAt: new Date().toISOString(),
    };
  }

  async listSessions(query?: { userId?: string; status?: string; limit?: number; offset?: number }) {
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? 200;
    return {
      total: 0,
      offset,
      limit,
      sessions: [] as KvmSessionListItem[],
    };
  }

  async getQuota(sessionId: string) {
    const quota = await this.request<{
      maxActionsPerMinute?: number;
      maxRuntimeMinutes?: number;
      maxRebootsPerHour?: number;
    }>(`/v1/sessions/${encodeURIComponent(sessionId)}/quota`);

    return {
      sessionId,
      quota: {
        maxActionsPerMinute: quota.maxActionsPerMinute ?? 0,
        maxRuntimeMinutes: quota.maxRuntimeMinutes ?? 0,
        maxRebootsPerHour: quota.maxRebootsPerHour ?? 0,
      },
    };
  }
}

export const kvmOrchestratorConnector = new KvmOrchestratorConnector();
