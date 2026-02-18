import { config } from '../config';
import { deepCamelCase } from '../utils/case';
import { AppError } from '../utils/errors';
import type {
  KvmJobInfo,
  KvmSessionInfo,
  KvmSessionListItem,
  KvmSessionQuota,
  KvmSnapshotInfo,
  KvmVmDetail,
  KvmVmIpInfo,
  KvmVmListItem,
  KvmVmMetrics,
  KvmVmState,
  VmAction,
  VmLifecycleState,
} from '../types';

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

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  withAuth?: boolean;
  headers?: Record<string, string>;
  retries?: number;
  query?: Record<string, unknown>;
  idempotencyKey?: string;
};

type VmListRawItem = {
  name?: string;
  vm_name?: string;
  state?: string;
  ipAddresses?: string[];
  ip_addresses?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type VmDetailRaw = {
  name?: string;
  vmName?: string;
  state?: string;
  ipAddresses?: string[];
  ip_addresses?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type VmMetricsRaw = {
  name?: string;
  vmName?: string;
  state?: string;
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

function parseSessionIdFromVmName(vmName: string): string | undefined {
  if (!vmName) {
    return undefined;
  }
  if (vmName.startsWith('sandbox_sess_')) {
    return vmName.replace('sandbox_', '');
  }
  const matched = vmName.match(/sess_[a-zA-Z0-9]+/);
  return matched?.[0];
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

function toWsUrl(httpUrl: string) {
  if (httpUrl.startsWith('https://')) {
    return `wss://${httpUrl.slice('https://'.length)}`;
  }
  if (httpUrl.startsWith('http://')) {
    return `ws://${httpUrl.slice('http://'.length)}`;
  }
  return httpUrl;
}

function parseEnvelopeError(statusCode: number, payload: unknown): AppError {
  const normalized = payload as OrchestratorEnvelope<unknown>;
  const message =
    normalized?.message ||
    (normalized?.error && typeof normalized.error === 'object' && 'details' in normalized.error
      ? String(normalized.error.details)
      : `请求失败 (${statusCode})`);

  return new AppError(statusCode, message, payload);
}

function normalizeVmListPayload(data: unknown): VmListRawItem[] {
  if (Array.isArray(data)) {
    return data as VmListRawItem[];
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items as VmListRawItem[];
    }
    if (Array.isArray(record.vms)) {
      return record.vms as VmListRawItem[];
    }
  }
  return [];
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

  private buildHeaders(
    withAuth = true,
    extra?: Record<string, string>,
    idempotencyKey?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...(extra || {}),
    };

    if (withAuth) {
      if (!this.token) {
        throw new AppError(500, '缺少 KVM_ORCH_TOKEN，无法访问 kvm-orchestrator');
      }
      headers.authorization = `Bearer ${this.token}`;
    }

    if (idempotencyKey) {
      headers['idempotency-key'] = idempotencyKey;
    }

    return headers;
  }

  private async parseResponseBody<T = unknown>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json().catch(() => ({}))) as T;
    }

    const text = await response.text().catch(() => '');
    return ({ message: text } as unknown) as T;
  }

  private async send(path: string, options?: RequestOptions): Promise<Response> {
    const method = options?.method ?? 'GET';
    const withAuth = options?.withAuth !== false;
    const maxAttempts = Math.max(1, (options?.retries ?? this.retries) + 1);
    const url = `${this.baseUrl}${path}${this.buildQueryString(options?.query)}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const headers = this.buildHeaders(withAuth, options?.headers, options?.idempotencyKey);

        let body: RequestInit['body'] = undefined;
        if (options?.body !== undefined && options?.body !== null) {
          if (
            typeof options.body === 'string' ||
            options.body instanceof Uint8Array ||
            options.body instanceof ArrayBuffer
          ) {
            body = options.body as RequestInit['body'];
          } else {
            if (!headers['content-type']) {
              headers['content-type'] = 'application/json';
            }
            body = JSON.stringify(options.body);
          }
        }

        const response = await fetchWithTimeout(
          url,
          {
            method,
            headers,
            body,
          },
          this.timeoutMs
        );

        if (!response.ok) {
          const payload = await this.parseResponseBody(response);
          const error = parseEnvelopeError(response.status, payload);

          if (attempt < maxAttempts && isRetryableStatus(response.status)) {
            lastError = error;
            await sleep(400);
            continue;
          }

          throw error;
        }

        return response;
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

  private async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const response = await this.send(path, options);
    const payload = (await this.parseResponseBody(response)) as OrchestratorEnvelope<unknown> | unknown;
    const normalized =
      payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
        ? (payload as OrchestratorEnvelope<unknown>).data
        : payload;
    return deepCamelCase<T>(normalized);
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

  async listVms(query?: { state?: string; limit?: number; offset?: number; withState?: boolean }) {
    const data = await this.request<Record<string, unknown> | VmListRawItem[]>('/v1/vms', {
      retries: 0,
      query: {
        state: query?.state,
        limit: query?.limit,
        offset: query?.offset,
        with_state: query?.withState,
      },
    });

    const items = normalizeVmListPayload(data).map<KvmVmListItem>((item) => {
      const name = item.name || item.vm_name || 'unknown';
      const ipAddresses = item.ipAddresses || item.ip_addresses || [];
      return {
        vmId: name,
        name,
        sessionId: parseSessionIdFromVmName(name),
        state: parseVmState(item.state),
        stateRaw: item.state,
        ipAddresses,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    const filtered = query?.state ? items.filter((item) => item.state === query.state) : items;
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

    const name = detail.name || detail.vmName || vmId;
    const stats = (metrics?.stats || {}) as Record<string, unknown>;
    const memoryActualKb = asNumber(metrics?.memory?.actual, 2048 * 1024);
    const cpuCores = Math.max(1, asNumber(stats['vcpu.current'], 2));
    const diskBytes = asNumber(stats['block.0.capacity'], 20 * 1024 * 1024 * 1024);
    const ipAddresses = detail.ipAddresses || detail.ip_addresses || [];

    return {
      vmId: name,
      name,
      sessionId: parseSessionIdFromVmName(name),
      state: parseVmState(detail.state),
      stateRaw: detail.state,
      ipAddresses,
      config: {
        cpuCores,
        memoryMb: kbToMb(memoryActualKb),
        rootDiskGb: Math.max(1, Math.round(bytesToGb(diskBytes))),
      },
      network: {
        ipAddress: toIpv4(ipAddresses),
      },
      createdAt: detail.createdAt || new Date().toISOString(),
      updatedAt: detail.updatedAt,
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

  async getVmIp(vmId: string, refresh?: boolean): Promise<KvmVmIpInfo> {
    const data = await this.request<{ ipAddresses?: string[]; ip_addresses?: string[]; vmName?: string; name?: string }>(
      `/v1/vms/${encodeURIComponent(vmId)}/ip`,
      { query: { refresh } }
    );
    const ipAddresses = data.ipAddresses || data.ip_addresses || [];
    return {
      vmId: data.vmName || data.name || vmId,
      ipAddresses,
      primaryIp: toIpv4(ipAddresses),
    };
  }

  async getVmState(vmId: string): Promise<KvmVmState> {
    const metrics = await this.request<VmMetricsRaw>(`/v1/vms/${encodeURIComponent(vmId)}/metrics`);
    const stats = (metrics.stats || {}) as Record<string, unknown>;

    return {
      vmId,
      state: parseVmState(metrics.state),
      stateRaw: metrics.state,
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

  async getVmMetrics(vmId: string, options?: { retries?: number }): Promise<KvmVmMetrics> {
    const metrics = await this.request<VmMetricsRaw>(`/v1/vms/${encodeURIComponent(vmId)}/metrics`, {
      retries: options?.retries,
    });
    const stats = (metrics.stats || {}) as Record<string, number | string>;
    return {
      vmId: metrics.name || metrics.vmName || vmId,
      state: parseVmState(metrics.state),
      stateRaw: metrics.state,
      memoryActualMb: metrics.memory?.actual ? kbToMb(metrics.memory.actual) : undefined,
      memoryRssMb: metrics.memory?.rss ? kbToMb(metrics.memory.rss) : undefined,
      stats,
      collectedAt: metrics.collectedAt,
    };
  }

  async getVmLogs(vmId: string, lines = 100) {
    return this.request<Record<string, unknown>>(`/v1/vms/${encodeURIComponent(vmId)}/logs`, {
      query: { lines },
    });
  }

  async runVmAction(vmId: string, action: VmAction, options?: { async?: boolean; idempotencyKey?: string }) {
    const mappedAction = action === 'stop' ? 'shutdown' : action;
    return this.request<Record<string, unknown>>(`/v1/vms/${encodeURIComponent(vmId)}/${mappedAction}`, {
      method: 'POST',
      query: { async: options?.async },
      idempotencyKey: options?.idempotencyKey,
    });
  }

  async startVm(vmId: string) {
    const result = await this.runVmAction(vmId, 'start');
    return {
      ...result,
      vmId,
      state: 'running',
      startedAt: new Date().toISOString(),
    };
  }

  async stopVm(vmId: string, _force = false) {
    const result = await this.runVmAction(vmId, 'shutdown');
    return {
      ...result,
      vmId,
      state: 'stopped',
      stoppedAt: new Date().toISOString(),
    };
  }

  async getJob(jobId: string): Promise<KvmJobInfo> {
    const data = await this.request<Record<string, unknown>>(`/v1/jobs/${encodeURIComponent(jobId)}`);
    return {
      jobId: String(data.jobId || data.id || jobId),
      status: String(data.status || 'unknown'),
      type: typeof data.type === 'string' ? data.type : undefined,
      operationId: typeof data.operationId === 'string' ? data.operationId : undefined,
      target: (data.target as Record<string, unknown>) || undefined,
      result: (data.result as Record<string, unknown>) || null,
      error: (data.error as Record<string, unknown>) || null,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    };
  }

  async createSession(
    body: { metadata?: Record<string, unknown> } = {},
    idempotencyKey?: string
  ): Promise<KvmSessionInfo> {
    const data = await this.request<Record<string, unknown>>('/v1/sessions', {
      method: 'POST',
      body,
      idempotencyKey,
    });
    return this.normalizeSession(data);
  }

  async getSession(sessionId: string): Promise<KvmSessionInfo> {
    const data = await this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}`);
    return this.normalizeSession(data);
  }

  async listSessions(query?: { userId?: string; status?: string; limit?: number; offset?: number }) {
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? 200;
    try {
      const data = await this.request<Record<string, unknown> | Array<Record<string, unknown>>>('/v1/sessions', {
        query: {
          user_id: query?.userId,
          status: query?.status,
          limit,
          offset,
        },
      });

      const items = Array.isArray(data)
        ? data
        : Array.isArray((data as Record<string, unknown>)?.items)
          ? ((data as Record<string, unknown>).items as Array<Record<string, unknown>>)
          : Array.isArray((data as Record<string, unknown>)?.sessions)
            ? ((data as Record<string, unknown>).sessions as Array<Record<string, unknown>>)
            : [];

      const sessions = items.map<KvmSessionListItem>((item) => ({
        sessionId: String(item.sessionId || item.id || ''),
        userId: String(item.userId || item.owner || 'unknown'),
        status: String(item.status || 'unknown'),
        vmId: typeof item.vmId === 'string' ? item.vmId : undefined,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      }));

      return {
        total: sessions.length,
        offset,
        limit,
        sessions,
      };
    } catch {
      return {
        total: 0,
        offset,
        limit,
        sessions: [] as KvmSessionListItem[],
      };
    }
  }

  async bindSessionVm(sessionId: string, body: { vmName?: string; autoAllocate?: boolean }) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/bind`, {
      method: 'POST',
      body,
    });
  }

  async getSessionVm(sessionId: string) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/vm`);
  }

  async closeSession(sessionId: string, body?: { gracefulShutdown?: boolean }) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/close`, {
      method: 'POST',
      body: body || {},
    });
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
      } satisfies KvmSessionQuota,
    };
  }

  async updateQuota(sessionId: string, quota: KvmSessionQuota) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/quota`, {
      method: 'PUT',
      body: quota,
    });
  }

  async vmExec(vmId: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/vms/${encodeURIComponent(vmId)}/exec`, {
      method: 'POST',
      body,
    });
  }

  async sessionExec(sessionId: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/exec`, {
      method: 'POST',
      body,
    });
  }

  async uploadVmFiles(
    vmId: string,
    bodyBuffer: Uint8Array,
    contentType: string,
    query?: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    return this.request<Record<string, unknown>>(`/v1/vms/${encodeURIComponent(vmId)}/files`, {
      method: 'POST',
      body: bodyBuffer,
      headers: { 'content-type': contentType },
      query,
      idempotencyKey,
    });
  }

  async uploadSessionFiles(
    sessionId: string,
    bodyBuffer: Uint8Array,
    contentType: string,
    query?: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/files`, {
      method: 'POST',
      body: bodyBuffer,
      headers: { 'content-type': contentType },
      query,
      idempotencyKey,
    });
  }

  async deleteVmFiles(vmId: string, query: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/vms/${encodeURIComponent(vmId)}/files`, {
      method: 'DELETE',
      query,
    });
  }

  async deleteSessionFiles(sessionId: string, query: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/files`, {
      method: 'DELETE',
      query,
    });
  }

  async createSandbox(body: Record<string, unknown>, idempotencyKey?: string) {
    return this.request<Record<string, unknown>>('/v1/sandboxes', {
      method: 'POST',
      body,
      idempotencyKey,
    });
  }

  async getSandbox(sessionId: string) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}`);
  }

  async getSandboxIp(sessionId: string, refresh?: boolean) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ip`, {
      query: { refresh },
    });
  }

  async restartSandbox(sessionId: string, body?: { gracefulShutdown?: boolean; start?: boolean }) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}/restart`, {
      method: 'POST',
      body: body || {},
    });
  }

  async deleteSandbox(sessionId: string, query?: { deleteStorage?: boolean }) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      query,
    });
  }

  async createSandboxPortMapping(sessionId: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports`, {
      method: 'POST',
      body,
    });
  }

  async listSandboxPortMappings(
    sessionId: string,
    query?: { refresh?: boolean; verify?: boolean; waitSeconds?: number }
  ) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports`, {
      query,
    });
  }

  async deleteSandboxPortMapping(
    sessionId: string,
    query: { hostPort: number; protocol?: string; hostIp?: string; vmPort?: number }
  ) {
    return this.request<Record<string, unknown>>(`/v1/sandboxes/${encodeURIComponent(sessionId)}/ports`, {
      method: 'DELETE',
      query,
    });
  }

  async listVmSnapshots(vmId: string) {
    const data = await this.request<Record<string, unknown> | KvmSnapshotInfo[]>(
      `/v1/vms/${encodeURIComponent(vmId)}/snapshots`
    );
    if (Array.isArray(data)) {
      return data;
    }
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.items)) {
        return record.items as KvmSnapshotInfo[];
      }
      if (Array.isArray(record.snapshots)) {
        return record.snapshots as KvmSnapshotInfo[];
      }
    }
    return [];
  }

  async createVmSnapshot(vmId: string, body: { snapshotName: string; description?: string }) {
    return this.request<Record<string, unknown>>(`/v1/vms/${encodeURIComponent(vmId)}/snapshots/create`, {
      method: 'POST',
      body,
    });
  }

  async restoreVmSnapshot(vmId: string, snapshotName: string, body?: { targetState?: string }) {
    return this.request<Record<string, unknown>>(
      `/v1/vms/${encodeURIComponent(vmId)}/snapshots/${encodeURIComponent(snapshotName)}/restore`,
      {
        method: 'POST',
        body: body || {},
      }
    );
  }

  async deleteVmSnapshot(vmId: string, snapshotName: string) {
    return this.request<Record<string, unknown>>(
      `/v1/vms/${encodeURIComponent(vmId)}/snapshots/${encodeURIComponent(snapshotName)}`,
      {
        method: 'DELETE',
      }
    );
  }

  getEventsWsUrl(replayLast = 20) {
    const wsBase = toWsUrl(this.baseUrl);
    const safeReplay = Math.max(0, Math.min(200, replayLast));
    return `${wsBase}/v1/ws/events?token=${encodeURIComponent(this.token)}&replay_last=${safeReplay}`;
  }

  async createVm(input: {
    sessionId: string;
    cpuCores?: number;
    memoryMb?: number;
    rootDiskGb?: number;
    tags?: Record<string, string>;
  }) {
    const vmName = `sandbox_${input.sessionId}`;
    const data = await this.createSandbox(
      {
        session_id: input.sessionId,
        vm_name: vmName,
        memory_mb: input.memoryMb,
        vcpus: input.cpuCores,
        auto_bind: true,
        start: false,
        metadata: input.tags || {},
      },
      `sandbox-${input.sessionId}`
    );

    return {
      vmId: String(data.vmName || vmName),
      sessionId: String(data.sessionId || input.sessionId),
      name: String(data.vmName || vmName),
      state: parseVmState(typeof data.state === 'string' ? data.state : undefined),
      config: {
        cpuCores: input.cpuCores || 0,
        memoryMb: input.memoryMb || 0,
        rootDiskGb: input.rootDiskGb || 0,
        networkBridge: 'default',
      },
      createdAt: new Date().toISOString(),
    };
  }

  private normalizeSession(data: Record<string, unknown>): KvmSessionInfo {
    const quotaRaw = (data.quota as Record<string, unknown>) || {};
    const quota: KvmSessionQuota | undefined =
      Object.keys(quotaRaw).length > 0
        ? {
            maxActionsPerMinute: asNumber(quotaRaw.maxActionsPerMinute, 0),
            maxRuntimeMinutes: asNumber(quotaRaw.maxRuntimeMinutes, 0),
            maxRebootsPerHour: asNumber(quotaRaw.maxRebootsPerHour, 0),
          }
        : undefined;

    return {
      sessionId: String(data.sessionId || data.id || ''),
      status: String(data.status || 'unknown'),
      vmName: typeof data.vmName === 'string' ? data.vmName : null,
      metadata: (data.metadata as Record<string, unknown>) || {},
      quota,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
      closedAt: typeof data.closedAt === 'string' ? data.closedAt : null,
    };
  }
}

export const kvmOrchestratorConnector = new KvmOrchestratorConnector();
