import { Sandbox } from 'e2b';
import type { E2bSandboxFullInfo, E2bSandboxListItem } from '../connectors/e2b-connector';
import { e2bConnector } from '../connectors/e2b-connector';
import { e2bTemplateConnector } from '../connectors/e2b-template-connector';
import {
  oneceoApiConnector,
  type SandboxEnvironmentRecord,
  type TaskCreationSession,
} from '../connectors/oneceo-api-connector';
import { config } from '../config';
import { AppError } from '../utils/errors';

type SandboxStatusSummary = {
  total: number;
  running: number;
  paused: number;
};

type RuntimeRiskTag =
  | 'unbound_task_session'
  | 'missing_osac_endpoint'
  | 'missing_opencode_base_url'
  | 'archive_pending_too_long'
  | 'archive_failed'
  | 'inactive_but_running'
  | 'missing_executor_metadata'
  | 'untracked_environment';

type RuntimeRegistryItem = {
  sandboxId: string;
  orchestratorSessionId: string;
  taskSessionId?: string | null;
  taskTitle?: string | null;
  taskStatus?: string | null;
  executor: string;
  codexExecutionMode?: string | null;
  template?: string | null;
  alias?: string | null;
  status: string;
  sandboxState?: string | null;
  archiveStatus?: string | null;
  archiveDirty: boolean;
  pendingArchiveUpdate: boolean;
  lastActiveAt?: string | null;
  lastActiveReason?: string | null;
  opencodeBaseUrl?: string | null;
  osacEndpoint?: string | null;
  osacHostPort?: number | null;
  trafficAccessTokenPresent: boolean;
  startedAt?: string | null;
  endAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  dedupeReplacedAt?: string | null;
  dedupeReason?: string | null;
  dedupeReplacementSandboxId?: string | null;
  riskTags: RuntimeRiskTag[];
  source: 'tracked' | 'live_only';
};

type RuntimeRegistryResponse = {
  summary: {
    total: number;
    running: number;
    paused: number;
    closed: number;
    pendingArchive: number;
    archiveFailed: number;
    risky: number;
  };
  distributions: {
    executors: Array<{ label: string; value: number }>;
    templates: Array<{ label: string; value: number }>;
    archiveStatuses: Array<{ label: string; value: number }>;
  };
  hasMore: boolean;
  items: RuntimeRegistryItem[];
};

const RUNTIME_REGISTRY_MAX_LIMIT = 200;
const LIVE_SUMMARY_CACHE_MS = 60000;
const LIVE_SANDBOX_LIST_CACHE_MS = 30000;

type LiveSummaryResponse = Awaited<ReturnType<typeof e2bConnector.summarizeLiveSandboxes>>;
type LiveSandboxListCacheEntry = {
  expiresAt: number;
  limit: number;
  data: E2bSandboxListItem[];
};
type LiveSandboxListRequest = {
  limit: number;
  promise: Promise<E2bSandboxListItem[]>;
};

type RuntimeDetailResponse = {
  runtime: RuntimeRegistryItem;
  trackedEnvironment: SandboxEnvironmentRecord | null;
  liveSandbox: E2bSandboxListItem | null;
  liveSandboxDetail: Awaited<ReturnType<typeof e2bConnector.getSandboxInfo>> | null;
  liveSandboxFullInfo: E2bSandboxFullInfo | null;
  taskSession: TaskCreationSession | null;
  debug: unknown;
  metrics: Awaited<ReturnType<typeof e2bConnector.getSandboxMetrics>>;
  connectivity: {
    osacConfigured: boolean;
    opencodeConfigured: boolean;
    trafficAccessTokenPresent: boolean;
    workspaceRoot?: string | null;
    stateRoot?: string | null;
  };
  archive: {
    archiveStatus?: string | null;
    archiveDirty: boolean;
    pendingArchiveUpdate: boolean;
    archiveKey?: string | null;
    snapshotKey?: string | null;
    metadataKey?: string | null;
    archivePendingSince?: string | null;
    lastDirtyAt?: string | null;
    lastDirtyReason?: string | null;
    restoredAt?: string | null;
  };
  metadata: Record<string, unknown>;
};

type SandboxArchiveHistoryEntry = {
  snapshotKey: string;
  archiveKey?: string | null;
  metadataKey?: string | null;
  archivedAt: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  reason?: string | null;
  status?: string | null;
  isCurrent: boolean;
};

function hasLiveSandbox(runtime: RuntimeDetailResponse['runtime']) {
  return runtime.sandboxState === 'running' || runtime.sandboxState === 'paused';
}

function summarizeStatus(records: E2bSandboxListItem[]): SandboxStatusSummary {
  return {
    total: records.length,
    running: records.filter((item) => item.state === 'running').length,
    paused: records.filter((item) => item.state === 'paused').length,
  };
}

function createLiveSandboxListCacheKey(query?: {
  state?: Array<'running' | 'paused'>;
  metadata?: Record<string, string>;
}) {
  const state = [...(query?.state ?? ['running', 'paused'])].sort();
  const metadata = query?.metadata
    ? Object.fromEntries(Object.entries(query.metadata).sort(([left], [right]) => left.localeCompare(right)))
    : null;
  return JSON.stringify({ state, metadata });
}

function filterLiveSandboxes(
  sandboxes: E2bSandboxListItem[],
  limit: number,
  query?: {
    templateId?: string;
  }
) {
  const filtered = query?.templateId
    ? sandboxes.filter((item) => item.templateId === query.templateId || item.alias === query.templateId)
    : sandboxes;
  return filtered.slice(0, limit);
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildBashCommand(script: string): string {
  return `bash -lc ${shellEscape(script)}`;
}

function extractCommandText(value: unknown, key: 'stdout' | 'stderr'): string {
  if (!value || typeof value !== 'object') return '';
  const text = (value as Record<string, unknown>)[key];
  return typeof text === 'string' ? text : '';
}

function extractCommandExitCode(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const exitCode = (value as Record<string, unknown>).exitCode;
  return typeof exitCode === 'number' && Number.isFinite(exitCode) ? exitCode : null;
}

function buildDirectoryListScript(path: string): string {
  return [
    'set -euo pipefail',
    `target=${shellEscape(path)}`,
    'if [ ! -e "$target" ]; then',
    "  printf '__ONECEO_NOT_FOUND__\\n'",
    '  exit 44',
    'fi',
    'if [ ! -d "$target" ]; then',
    "  printf '__ONECEO_NOT_DIR__\\n'",
    '  exit 45',
    'fi',
    'find "$target" -mindepth 1 -maxdepth 1 \\( -type d -o -type f -o -type l \\) -printf \'%P\\t%p\\t%y\\t%M\\t%s\\t%T@\\n\' | sort',
  ].join('\n');
}

function buildRemovePathScript(path: string): string {
  return [
    'set -euo pipefail',
    `target=${shellEscape(path)}`,
    'if [ "$target" = "/" ]; then',
    "  printf '__ONECEO_REFUSE_ROOT__\\n'",
    '  exit 46',
    'fi',
    'if [ ! -e "$target" ] && [ ! -L "$target" ]; then',
    "  printf '__ONECEO_NOT_FOUND__\\n'",
    '  exit 44',
    'fi',
    'rm -rf -- "$target"',
    "printf '__ONECEO_REMOVED__\\n'",
  ].join('\n');
}

function parseDirectoryEntries(stdout: string, basePath: string) {
  const normalizedBasePath = basePath.trim().replace(/\/+$/, '') || '/';
  const items = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name = '', path = '', type = '', permissions = '', sizeText = '0', modifiedAtText = ''] = line.split('\t');
      const normalizedType = type === 'd' ? 'dir' : type === 'f' ? 'file' : 'item';
      const size = Number(sizeText);
      const modifiedAtUnix = Number(modifiedAtText);
      return {
        name,
        path,
        type: normalizedType,
        permissions: permissions || null,
        sizeBytes: Number.isFinite(size) ? size : null,
        modifiedAt:
          Number.isFinite(modifiedAtUnix) && modifiedAtUnix > 0
            ? new Date(modifiedAtUnix * 1000).toISOString()
            : null,
      };
    });

  return {
    path: normalizedBasePath,
    parentPath: normalizedBasePath === '/'
      ? '/'
      : `/${normalizedBasePath.split('/').filter(Boolean).slice(0, -1).join('/')}` || '/',
    items,
  };
}

function buildProcessListScript(): string {
  return [
    'set -euo pipefail',
    'ps -eo pid=,ppid=,user=,%cpu=,%mem=,etime=,stat=,comm=,args= --sort=-%cpu,-%mem -ww',
  ].join('\n');
}

function parseProcessEntries(stdout: string) {
  const items = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/, 9);
      if (parts.length < 8) {
        return null;
      }

      const [pidText, ppidText, user = '', cpuText = '', memoryText = '', elapsed = '', state = '', command = '', args = ''] = parts;
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      const cpuPercent = Number(cpuText);
      const memoryPercent = Number(memoryText);

      return {
        pid: Number.isFinite(pid) ? pid : null,
        ppid: Number.isFinite(ppid) ? ppid : null,
        user,
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent.toFixed(1) : null,
        memoryPercent: Number.isFinite(memoryPercent) ? memoryPercent.toFixed(1) : null,
        elapsed,
        state,
        command,
        args,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    source: 'ps',
    generatedAt: new Date().toISOString(),
    items,
  };
}

function buildProcessKillScript(pid: number): string {
  return [
    'set -euo pipefail',
    `pid=${Math.floor(pid)}`,
    'if ! kill -0 "$pid" 2>/dev/null; then',
    '  echo "PID_NOT_FOUND:$pid"',
    '  exit 44',
    'fi',
    'kill -9 "$pid"',
    'echo "PID_KILLED:$pid"',
  ].join('\n');
}

function buildPortScanScript(): string {
  return [
    'set -euo pipefail',
    'if command -v ss >/dev/null 2>&1; then',
    '  echo "__ONECEO_SCANNER__:ss"',
    '  ss -ltnpH',
    'elif command -v netstat >/dev/null 2>&1; then',
    '  echo "__ONECEO_SCANNER__:netstat"',
    '  netstat -ltnp 2>/dev/null | tail -n +3',
    'else',
    '  echo "__ONECEO_SCANNER__:lsof"',
    '  lsof -i -P -n 2>/dev/null | tail -n +2',
    'fi',
  ].join('\n');
}

function parsePortScanOutput(stdout: string) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  let scanner = 'unknown';
  if (lines[0]?.startsWith('__ONECEO_SCANNER__:')) {
    scanner = lines.shift()?.replace('__ONECEO_SCANNER__:', '').trim() || 'unknown';
  }

  return {
    scanner,
    generatedAt: new Date().toISOString(),
    lines,
    output: lines.join('\n'),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(value?: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / (1000 * 60 * 60);
}

function buildDistribution(items: RuntimeRegistryItem[], pick: (item: RuntimeRegistryItem) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = pick(item) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function deriveArchiveStatus(metadata: Record<string, unknown>): string | null {
  const value = asText(metadata.archiveStatus);
  if (value) return value;
  if (asBoolean(metadata.pendingArchiveUpdate) || asBoolean(metadata.archiveDirty)) {
    return 'pending_update';
  }
  return null;
}

function deriveExecutor(metadata: Record<string, unknown>): string {
  return (
    asText(metadata.sandboxExecutor) ||
    asText(metadata.executor) ||
    asText(metadata.driver) ||
    'opencode'
  );
}

function computeRiskTags(input: {
  metadata: Record<string, unknown>;
  runtimeStatus: string;
  sandboxState?: string | null;
  taskSessionId?: string | null;
  source: 'tracked' | 'live_only';
}): RuntimeRiskTag[] {
  const tags: RuntimeRiskTag[] = [];
  const archiveStatus = deriveArchiveStatus(input.metadata);
  const lastActiveAt = asText(input.metadata.lastActiveAt);
  const lastActiveHours = hoursSince(lastActiveAt);
  const running = input.runtimeStatus === 'ready' || input.sandboxState === 'running';

  if (!input.taskSessionId) tags.push('unbound_task_session');
  if (!asText(input.metadata.osacEndpoint)) tags.push('missing_osac_endpoint');
  if (!asText(input.metadata.opencodeBaseUrl)) tags.push('missing_opencode_base_url');
  if (!asText(input.metadata.sandboxExecutor) && !asText(input.metadata.executor)) tags.push('missing_executor_metadata');
  if (archiveStatus === 'failed') tags.push('archive_failed');
  if (
    (archiveStatus === 'pending_update' || asBoolean(input.metadata.pendingArchiveUpdate)) &&
    lastActiveHours !== null &&
    lastActiveHours > 1
  ) {
    tags.push('archive_pending_too_long');
  }
  if (running && lastActiveHours !== null && lastActiveHours > 6) {
    tags.push('inactive_but_running');
  }
  if (input.source === 'live_only') tags.push('untracked_environment');
  return tags;
}

function buildRuntimeItem(input: {
  tracked: SandboxEnvironmentRecord | null;
  live: E2bSandboxListItem | null;
  taskSession: TaskCreationSession | null;
}): RuntimeRegistryItem {
  const tracked = input.tracked;
  const live = input.live;
  const trackedMetadata = asRecord(tracked?.metadata);
  const liveMetadata = asRecord(live?.metadata);
  const metadata = { ...trackedMetadata, ...liveMetadata };
  const e2bMeta = asRecord(metadata.e2b);
  const taskSessionId =
    asText(metadata.taskSessionId) ||
    asText(input.taskSession?.id) ||
    asText(input.taskSession?.runtime?.orchestratorSessionId) ||
    null;
  const status = asText(tracked?.status) || (live?.state ? `live_${live.state}` : 'unknown');
  const sandboxId = tracked?.sessionId || live?.sandboxId || '';
  const item: RuntimeRegistryItem = {
    sandboxId,
    orchestratorSessionId: asText(tracked?.orchestratorSessionId) || sandboxId,
    taskSessionId,
    taskTitle: input.taskSession?.title || null,
    taskStatus: input.taskSession?.status || null,
    executor: deriveExecutor(metadata),
    codexExecutionMode: asText(metadata.codexExecutionMode) || asText(metadata.codexMode),
    template: asText((e2bMeta as any).template) || live?.templateId || tracked?.baseImage || null,
    alias: live?.alias || null,
    status,
    sandboxState: live?.state || null,
    archiveStatus: deriveArchiveStatus(metadata),
    archiveDirty: asBoolean(metadata.archiveDirty),
    pendingArchiveUpdate: asBoolean(metadata.pendingArchiveUpdate),
    lastActiveAt: asText(metadata.lastActiveAt),
    lastActiveReason: asText(metadata.lastActiveReason),
    opencodeBaseUrl: asText(metadata.opencodeBaseUrl),
    osacEndpoint: asText(metadata.osacEndpoint),
    osacHostPort: asNumber(metadata.osacHostPort) || asNumber(metadata.osacPort),
    trafficAccessTokenPresent: Boolean(asText((e2bMeta as any).trafficAccessToken) || asText(metadata.trafficAccessToken)),
    startedAt: live?.startedAt || null,
    endAt: live?.endAt || null,
    createdAt: tracked?.createdAt || null,
    updatedAt: tracked?.updatedAt || null,
    closedAt: tracked?.closedAt || null,
    dedupeReplacedAt: asText(metadata.dedupeReplacedAt),
    dedupeReason: asText(metadata.dedupeReason),
    dedupeReplacementSandboxId: asText(metadata.dedupeReplacementSandboxId),
    riskTags: [],
    source: tracked ? 'tracked' : 'live_only',
  };
  item.riskTags = computeRiskTags({
    metadata,
    runtimeStatus: item.status,
    sandboxState: item.sandboxState,
    taskSessionId: item.taskSessionId,
    source: item.source,
  });
  return item;
}

function toLiveListItemFromDetail(
  detail: Awaited<ReturnType<typeof e2bConnector.getSandboxInfo>> | null
): E2bSandboxListItem | null {
  if (!detail) return null;
  return {
    sandboxId: detail.sandboxId,
    state: detail.state,
    templateId: detail.templateId,
    alias: detail.name,
    startedAt: detail.startedAt,
    endAt: detail.endAt,
    cpuCount: detail.cpuCount,
    memoryMB: detail.memoryMB,
    diskSizeMB: detail.diskSizeMB,
    metadata: detail.metadata,
  };
}

export class SandboxManagementService {
  private liveSummaryCache: { expiresAt: number; data: LiveSummaryResponse } | null = null;
  private liveSandboxListCache = new Map<string, LiveSandboxListCacheEntry>();
  private liveSandboxListRequests = new Map<string, LiveSandboxListRequest>();

  private clearLiveSandboxCaches() {
    this.liveSummaryCache = null;
    this.liveSandboxListCache.clear();
    this.liveSandboxListRequests.clear();
  }

  private async listTrackedEnvironments(limit: number) {
    return oneceoApiConnector.listSandboxEnvironmentRegistry(limit).catch(() => []);
  }

  private async listTaskSessions(limit: number) {
    return oneceoApiConnector.listTaskCreationSessions(limit).catch(() => []);
  }

  private async listLiveSandboxes(
    limit: number,
    query?: {
      state?: Array<'running' | 'paused'>;
      metadata?: Record<string, string>;
      templateId?: string;
    }
  ) {
    if (!config.e2bApiKey) return [] as E2bSandboxListItem[];
    const fetchLimit = Math.max(limit, RUNTIME_REGISTRY_MAX_LIMIT);
    const cacheKey = createLiveSandboxListCacheKey(query);
    const now = Date.now();
    const cached = this.liveSandboxListCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.limit >= fetchLimit) {
      return filterLiveSandboxes(cached.data, limit, query);
    }

    const inFlight = this.liveSandboxListRequests.get(cacheKey);
    if (inFlight && inFlight.limit >= fetchLimit) {
      const sandboxes = await inFlight.promise;
      return filterLiveSandboxes(sandboxes, limit, query);
    }

    const request = e2bConnector
      .listSandboxes(fetchLimit, {
        state: query?.state,
        metadata: query?.metadata,
      })
      .then((sandboxes) => {
        this.liveSandboxListCache.set(cacheKey, {
          expiresAt: Date.now() + LIVE_SANDBOX_LIST_CACHE_MS,
          limit: fetchLimit,
          data: sandboxes,
        });
        return sandboxes;
      })
      .finally(() => {
        if (this.liveSandboxListRequests.get(cacheKey)?.promise === request) {
          this.liveSandboxListRequests.delete(cacheKey);
        }
      });
    this.liveSandboxListRequests.set(cacheKey, { limit: fetchLimit, promise: request });
    const sandboxes = await request;
    return filterLiveSandboxes(sandboxes, limit, query);
  }

  async getOverview(
    limit = 50,
    query?: {
      state?: Array<'running' | 'paused'>;
      metadata?: Record<string, string>;
      templateId?: string;
    }
  ) {
    const hasKey = Boolean(config.e2bApiKey);
    if (!hasKey) {
      return {
        sandboxApi: {
          online: false,
          status: 'missing_api_key',
          service: 'e2b',
          version: null,
          timestamp: null,
        },
        summary: summarizeStatus([]),
        sandboxes: [],
      };
    }

    try {
      const sandboxes = await this.listLiveSandboxes(limit, query);
      return {
        sandboxApi: {
          online: true,
          status: 'ok',
          service: 'e2b',
          version: null,
          timestamp: new Date().toISOString(),
        },
        summary: summarizeStatus(sandboxes),
        sandboxes,
      };
    } catch (error) {
      return {
        sandboxApi: {
          online: false,
          status: error instanceof Error ? error.message : 'unavailable',
          service: 'e2b',
          version: null,
          timestamp: new Date().toISOString(),
        },
        summary: summarizeStatus([]),
        sandboxes: [],
      };
    }
  }

  async getLiveSummary(): Promise<LiveSummaryResponse> {
    if (!config.e2bApiKey) {
      return {
        total: 0,
        running: 0,
        paused: 0,
        pagesScanned: 0,
        countedAt: new Date().toISOString(),
      };
    }
    const now = Date.now();
    if (this.liveSummaryCache && this.liveSummaryCache.expiresAt > now) {
      return this.liveSummaryCache.data;
    }
    const data = await e2bConnector.summarizeLiveSandboxes();
    this.liveSummaryCache = {
      expiresAt: now + LIVE_SUMMARY_CACHE_MS,
      data,
    };
    return data;
  }

  async getRuntimeRegistry(limit = 80): Promise<RuntimeRegistryResponse> {
    const fetchLimit = Math.min(Math.max(1, limit), RUNTIME_REGISTRY_MAX_LIMIT);
    const queryLimit = fetchLimit >= RUNTIME_REGISTRY_MAX_LIMIT ? fetchLimit : fetchLimit + 1;
    const [trackedEnvironments, taskSessions, liveSandboxes] = await Promise.all([
      this.listTrackedEnvironments(queryLimit),
      this.listTaskSessions(queryLimit),
      this.listLiveSandboxes(queryLimit),
    ]);

    const taskSessionById = new Map(taskSessions.map((item) => [item.id, item]));
    const taskSessionByRuntime = new Map(
      taskSessions
        .filter((item) => item.runtime?.orchestratorSessionId)
        .map((item) => [String(item.runtime?.orchestratorSessionId), item])
    );
    const liveById = new Map(liveSandboxes.map((item) => [item.sandboxId, item]));

    const items: RuntimeRegistryItem[] = trackedEnvironments.map((env) => {
      const metadata = asRecord(env.metadata);
      const taskSessionId = asText(metadata.taskSessionId);
      const taskSession =
        (taskSessionId ? taskSessionById.get(taskSessionId) : undefined) ||
        taskSessionByRuntime.get(env.sessionId) ||
        null;
      return buildRuntimeItem({
        tracked: env,
        live: liveById.get(env.sessionId) || null,
        taskSession,
      });
    });

    for (const live of liveSandboxes) {
      if (items.some((item) => item.sandboxId === live.sandboxId)) continue;
      const metadata = asRecord(live.metadata);
      const taskSessionId = asText(metadata.taskSessionId);
      items.push(
        buildRuntimeItem({
          tracked: null,
          live,
          taskSession: (taskSessionId ? taskSessionById.get(taskSessionId) : undefined) || taskSessionByRuntime.get(live.sandboxId) || null,
        })
      );
    }

    items.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.startedAt || a.createdAt || '1970-01-01');
      const bTime = Date.parse(b.updatedAt || b.startedAt || b.createdAt || '1970-01-01');
      return bTime - aTime;
    });

    const hasMore = items.length > fetchLimit;
    const sliced = items.slice(0, fetchLimit);
    return {
      summary: {
        total: sliced.length,
        running: sliced.filter((item) => item.sandboxState === 'running' || item.status === 'ready').length,
        paused: sliced.filter((item) => item.sandboxState === 'paused').length,
        closed: sliced.filter((item) => item.status === 'closed').length,
        pendingArchive: sliced.filter((item) => item.pendingArchiveUpdate || item.archiveStatus === 'pending_update').length,
        archiveFailed: sliced.filter((item) => item.archiveStatus === 'failed').length,
        risky: sliced.filter((item) => item.riskTags.length > 0).length,
      },
      distributions: {
        executors: buildDistribution(sliced, (item) => item.executor),
        templates: buildDistribution(sliced, (item) => item.template),
        archiveStatuses: buildDistribution(sliced, (item) => item.archiveStatus),
      },
      hasMore,
      items: sliced,
    };
  }

  async getEnvironment(sandboxId: string) {
    return e2bConnector.getSandboxInfo(sandboxId);
  }

  async getEnvironmentFullInfo(sandboxId: string): Promise<E2bSandboxFullInfo> {
    return e2bConnector.getSandboxFullInfo(sandboxId);
  }

  async getEnvironmentMetrics(sandboxId: string, start?: string, end?: string) {
    return e2bConnector.getSandboxMetrics(sandboxId, {
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  async getRuntimeDetail(sandboxId: string): Promise<RuntimeDetailResponse> {
    const [trackedEnvironment, liveSandboxDetail, liveSandboxFullInfo, metrics] = await Promise.all([
      oneceoApiConnector.getSandboxEnvironment(sandboxId).catch(() => null),
      e2bConnector.getSandboxInfo(sandboxId).catch(() => null),
      e2bConnector.getSandboxFullInfo(sandboxId).catch(() => null),
      this.getEnvironmentMetrics(sandboxId).catch(() => []),
    ]);

    const liveSandbox = toLiveListItemFromDetail(liveSandboxDetail);
    const trackedMetadata = asRecord(trackedEnvironment?.metadata);
    const liveMetadata = asRecord(liveSandbox?.metadata);
    const metadata = { ...trackedMetadata, ...liveMetadata };
    const taskSessionId = asText(metadata.taskSessionId);

    let taskSession: TaskCreationSession | null = null;
    let debug: unknown = null;
    if (taskSessionId) {
      [taskSession, debug] = await Promise.all([
        oneceoApiConnector.getTaskCreationSession(taskSessionId).catch(() => null),
        oneceoApiConnector.getTaskCreationDebug(taskSessionId).catch(() => null),
      ]);
    } else {
      const runtimeSessionId =
        asText(trackedEnvironment?.orchestratorSessionId) ||
        asText(trackedEnvironment?.sessionId) ||
        liveSandbox?.sandboxId ||
        null;
      if (runtimeSessionId) {
        const taskSessions = await this.listTaskSessions(200);
        taskSession =
          taskSessions.find((item) => String(item.runtime?.orchestratorSessionId || '') === runtimeSessionId) || null;
        if (taskSession?.id) {
          debug = await oneceoApiConnector.getTaskCreationDebug(taskSession.id).catch(() => null);
        }
      }
    }

    const runtime = buildRuntimeItem({
      tracked: trackedEnvironment,
      live: liveSandbox,
      taskSession,
    });

    return {
      runtime,
      trackedEnvironment,
      liveSandbox,
      liveSandboxDetail,
      liveSandboxFullInfo,
      taskSession,
      debug,
      metrics,
      connectivity: {
        osacConfigured: Boolean(asText(metadata.osacEndpoint)),
        opencodeConfigured: Boolean(asText(metadata.opencodeBaseUrl)),
        trafficAccessTokenPresent: Boolean(
          asText(asRecord(metadata.e2b).trafficAccessToken) || asText(metadata.trafficAccessToken)
        ),
        workspaceRoot:
          asText(metadata.opencodeWorkspaceRoot) ||
          asText(metadata.altusWorkspaceRoot) ||
          asText(metadata.workspaceRoot),
        stateRoot:
          asText(metadata.opencodeStateRoot) ||
          asText(metadata.altusStateRoot) ||
          asText(metadata.stateRoot),
      },
      archive: {
        archiveStatus: deriveArchiveStatus(metadata),
        archiveDirty: asBoolean(metadata.archiveDirty),
        pendingArchiveUpdate: asBoolean(metadata.pendingArchiveUpdate),
        archiveKey: asText(metadata.r2ArchiveKey),
        snapshotKey: asText(metadata.r2ArchiveSnapshotKey) || asText(metadata.snapshotKey),
        metadataKey: asText(metadata.r2ArchiveMetadataKey) || asText(metadata.metadataKey),
        archivePendingSince: asText(metadata.archivePendingSince),
        lastDirtyAt: asText(metadata.lastDirtyAt),
        lastDirtyReason: asText(metadata.lastDirtyReason),
        restoredAt: asText(metadata.restoredAt),
      },
      metadata,
    };
  }

  async setEnvironmentTimeout(sandboxId: string, timeoutMs: number) {
    const result = await e2bConnector.setSandboxTimeout(sandboxId, timeoutMs);
    this.clearLiveSandboxCaches();
    return result;
  }

  async createEnvironment(payload: {
    template?: string;
    timeoutMs?: number;
    metadata?: Record<string, string>;
    envs?: Record<string, string>;
    allowInternetAccess?: boolean;
    secure?: boolean;
    mcp?: unknown;
    network?: unknown;
    autoPause?: boolean;
  }) {
    const result = await e2bConnector.createSandbox(payload);
    this.clearLiveSandboxCaches();
    return result;
  }

  async closeEnvironment(sandboxId: string) {
    const result = await oneceoApiConnector.closeSandboxEnvironment(sandboxId);
    this.clearLiveSandboxCaches();
    return result;
  }

  async pauseEnvironment(sandboxId: string) {
    const result = await e2bConnector.pauseSandbox(sandboxId);
    this.clearLiveSandboxCaches();
    return result;
  }

  async resumeEnvironment(sandboxId: string) {
    const result = await e2bConnector.resumeSandbox(sandboxId);
    this.clearLiveSandboxCaches();
    return result;
  }

  async archiveEnvironment(sandboxId: string) {
    const detail = await this.getRuntimeDetail(sandboxId);
    if (!hasLiveSandbox(detail.runtime)) {
      if (detail.archive.archiveStatus === 'up_to_date' || detail.archive.archiveStatus === 'archived') {
        return {
          action: 'archive_noop',
          sandboxId,
          taskSessionId: detail.runtime.taskSessionId || null,
          archiveStatus: detail.archive.archiveStatus,
          message: '当前 Sandbox 已无活体实例，现有归档已是最新状态',
        };
      }
      throw new AppError(400, '当前 Sandbox 已无活体实例，无法执行手动归档');
    }
    const result = await oneceoApiConnector.archiveSandboxEnvironment(sandboxId);
    this.clearLiveSandboxCaches();
    return {
      action: 'archive',
      sandboxId,
      taskSessionId: detail.runtime.taskSessionId || null,
      result,
    };
  }

  async restoreEnvironment(sandboxId: string, options?: { snapshotKey?: string }) {
    const result = await oneceoApiConnector.restoreSandboxEnvironment(sandboxId, options);
    this.clearLiveSandboxCaches();
    return result;
  }

  async openEnvironment(sandboxId: string) {
    const detail = await this.getRuntimeDetail(sandboxId);
    if (detail.runtime.sandboxState === 'paused') {
      await e2bConnector.resumeSandbox(sandboxId);
      this.clearLiveSandboxCaches();
      return { action: 'resume', sandboxId, taskSessionId: detail.runtime.taskSessionId || null };
    }
    if (detail.runtime.taskSessionId) {
      const result = await oneceoApiConnector.startTaskCreationRuntime(detail.runtime.taskSessionId);
      this.clearLiveSandboxCaches();
      return { action: 'runtime_start', sandboxId, taskSessionId: detail.runtime.taskSessionId, result };
    }
    throw new AppError(400, '当前 Sandbox 未绑定 task session，无法执行开机');
  }

  async restartEnvironment(sandboxId: string) {
    const detail = await this.getRuntimeDetail(sandboxId);
    if (!detail.runtime.taskSessionId) {
      throw new AppError(400, '当前 Sandbox 未绑定 task session，无法执行重启');
    }
    let archiveResult: Record<string, unknown> | null = null;
    let closeResult: Record<string, unknown> | null = null;
    if (hasLiveSandbox(detail.runtime)) {
      archiveResult = await oneceoApiConnector.archiveSandboxEnvironment(sandboxId);
      closeResult = await oneceoApiConnector.closeSandboxEnvironment(sandboxId);
    }
    const runtimeResult = await oneceoApiConnector.startTaskCreationRuntime(detail.runtime.taskSessionId);
    this.clearLiveSandboxCaches();
    return {
      action: 'restart',
      sandboxId,
      taskSessionId: detail.runtime.taskSessionId,
      archiveResult,
      closeResult,
      runtimeResult,
      mode: hasLiveSandbox(detail.runtime) ? 'archive_close_start' : 'start_only',
    };
  }

  async getArchiveHistory(sandboxId: string): Promise<SandboxArchiveHistoryEntry[]> {
    return oneceoApiConnector.getSandboxArchiveHistory(sandboxId) as Promise<SandboxArchiveHistoryEntry[]>;
  }

  async getArchiveDownloadUrl(sandboxId: string, expiresInSeconds = 3600, snapshotKey?: string): Promise<{
    key: string;
    fileName: string;
    downloadUrl: string;
    expiresInSeconds: number;
  }> {
    return oneceoApiConnector.getSandboxArchiveDownloadUrl(sandboxId, expiresInSeconds, snapshotKey);
  }

  async connectivityCheck(sandboxId: string) {
    return oneceoApiConnector.checkSandboxConnectivity(sandboxId);
  }

  async refreshRuntime(sandboxId: string) {
    return this.getRuntimeDetail(sandboxId);
  }

  async listTemplates(teamID?: string) {
    return e2bTemplateConnector.listTemplates(teamID);
  }

  async getTemplate(templateID: string, opts?: { limit?: number; nextToken?: string }) {
    return e2bTemplateConnector.getTemplate(templateID, opts);
  }

  async createTemplate(payload: Record<string, unknown>) {
    return e2bTemplateConnector.createTemplate(payload as any);
  }

  async updateTemplate(templateID: string, payload: Record<string, unknown>) {
    return e2bTemplateConnector.updateTemplate(templateID, payload as any);
  }

  async rebuildTemplate(templateID: string, payload: Record<string, unknown>) {
    return e2bTemplateConnector.rebuildTemplate(templateID, payload as any);
  }

  async deleteTemplate(templateID: string) {
    return e2bTemplateConnector.deleteTemplate(templateID);
  }

  async getTemplateBuildLogs(templateID: string, buildID: string, query?: Record<string, unknown>) {
    return e2bTemplateConnector.getBuildLogs(templateID, buildID, query);
  }

  async getTemplateBuildStatus(templateID: string, buildID: string, query?: Record<string, unknown>) {
    return e2bTemplateConnector.getBuildStatus(templateID, buildID, query);
  }

  async checkTemplateAlias(alias: string) {
    return e2bTemplateConnector.checkTemplateAlias(alias);
  }

  async assignTemplateTags(payload: Record<string, unknown>) {
    return e2bTemplateConnector.assignTags(payload as any);
  }

  async deleteTemplateTags(payload: Record<string, unknown>) {
    return e2bTemplateConnector.deleteTags(payload as any);
  }

  private async withSandbox<T>(sandboxId: string, fn: (sandbox: Sandbox) => Promise<T>) {
    if (!config.e2bApiKey) {
      throw new AppError(500, 'E2B_API_KEY 未配置，无法访问 E2B API');
    }
    const sandbox = await Sandbox.connect(sandboxId, { apiKey: config.e2bApiKey });
    return fn(sandbox);
  }

  async runToolAction(sandboxId: string, action: string, payload?: Record<string, unknown>) {
    return this.withSandbox(sandboxId, async (sandbox) => {
      switch (action) {
        case 'command.list':
          return sandbox.commands.list(payload as any);
        case 'command.run':
          return sandbox.commands.run(String(payload?.cmd ?? ''), payload as any);
        case 'command.kill':
          return sandbox.commands.kill(Number(payload?.pid), payload as any);
        case 'command.stdin':
          return sandbox.commands.sendStdin(Number(payload?.pid), String(payload?.data ?? ''), payload as any);
        case 'files.list': {
          const targetPath = String(payload?.path ?? '/');
          const result = await sandbox.commands.run(buildBashCommand(buildDirectoryListScript(targetPath)), payload as any);
          const stdout = extractCommandText(result, 'stdout');
          const stderr = extractCommandText(result, 'stderr');
          const exitCode = extractCommandExitCode(result);
          if (exitCode === 44 || stdout.includes('__ONECEO_NOT_FOUND__')) {
            throw new AppError(400, `目录不存在：${targetPath}`);
          }
          if (exitCode === 45 || stdout.includes('__ONECEO_NOT_DIR__')) {
            throw new AppError(400, `当前路径不是目录：${targetPath}`);
          }
          if (exitCode !== null && exitCode !== 0) {
            throw new AppError(400, stderr || stdout || `查看目录失败：${targetPath}`);
          }
          return parseDirectoryEntries(stdout, targetPath);
        }
        case 'files.read':
          return sandbox.files.read(String(payload?.path ?? ''), payload as any);
        case 'files.write':
          return sandbox.files.write(String(payload?.path ?? ''), payload?.data as any, payload as any);
        case 'files.writeFiles':
          return sandbox.files.writeFiles((payload?.files as any[]) ?? [], payload as any);
        case 'files.remove':
          return sandbox.files.remove(String(payload?.path ?? ''), payload as any);
        case 'files.removeRecursive': {
          const targetPath = String(payload?.path ?? '');
          const result = await sandbox.commands.run(buildBashCommand(buildRemovePathScript(targetPath)), payload as any);
          const stdout = extractCommandText(result, 'stdout');
          const stderr = extractCommandText(result, 'stderr');
          const exitCode = extractCommandExitCode(result);
          if (exitCode === 44 || stdout.includes('__ONECEO_NOT_FOUND__')) {
            throw new AppError(400, `删除失败，路径不存在：${targetPath}`);
          }
          if (exitCode === 46 || stdout.includes('__ONECEO_REFUSE_ROOT__')) {
            throw new AppError(400, '删除失败，不能删除根目录');
          }
          if (exitCode !== null && exitCode !== 0) {
            throw new AppError(400, stderr || stdout || `删除失败：${targetPath}`);
          }
          return {
            path: targetPath,
            removed: true,
          };
        }
        case 'files.mkdir':
          return sandbox.files.makeDir(String(payload?.path ?? ''), payload as any);
        case 'files.rename':
          return sandbox.files.rename(String(payload?.oldPath ?? ''), String(payload?.newPath ?? ''), payload as any);
        case 'files.exists':
          return sandbox.files.exists(String(payload?.path ?? ''), payload as any);
        case 'files.info':
          return sandbox.files.getInfo(String(payload?.path ?? ''), payload as any);
        case 'git.status':
          return sandbox.git.status(String(payload?.path ?? '.'), payload as any);
        case 'git.branches':
          return sandbox.git.branches(String(payload?.path ?? '.'), payload as any);
        case 'git.clone':
          return sandbox.git.clone(String(payload?.url ?? ''), payload as any);
        case 'git.init':
          return sandbox.git.init(String(payload?.path ?? '.'), payload as any);
        case 'git.remoteAdd':
          return sandbox.git.remoteAdd(
            String(payload?.path ?? '.'),
            String(payload?.name ?? 'origin'),
            String(payload?.url ?? ''),
            payload as any
          );
        case 'git.remoteGet':
          return sandbox.git.remoteGet(String(payload?.path ?? '.'), String(payload?.name ?? 'origin'), payload as any);
        case 'git.createBranch':
          return sandbox.git.createBranch(String(payload?.path ?? '.'), String(payload?.branch ?? ''), payload as any);
        case 'git.checkoutBranch':
          return sandbox.git.checkoutBranch(String(payload?.path ?? '.'), String(payload?.branch ?? ''), payload as any);
        case 'git.deleteBranch':
          return sandbox.git.deleteBranch(String(payload?.path ?? '.'), String(payload?.branch ?? ''), payload as any);
        case 'git.add':
          return sandbox.git.add(String(payload?.path ?? '.'), payload as any);
        case 'git.commit':
          return sandbox.git.commit(String(payload?.path ?? '.'), String(payload?.message ?? ''), payload as any);
        case 'git.reset':
          return sandbox.git.reset(String(payload?.path ?? '.'), payload as any);
        case 'git.restore':
          return sandbox.git.restore(String(payload?.path ?? '.'), payload as any);
        case 'git.pull':
          return sandbox.git.pull(String(payload?.path ?? '.'), payload as any);
        case 'git.push':
          return sandbox.git.push(String(payload?.path ?? '.'), payload as any);
        case 'git.setConfig':
          return sandbox.git.setConfig(String(payload?.key ?? ''), String(payload?.value ?? ''), payload as any);
        case 'git.getConfig':
          return sandbox.git.getConfig(String(payload?.key ?? ''), payload as any);
        case 'git.configureUser':
          return sandbox.git.configureUser(String(payload?.name ?? ''), String(payload?.email ?? ''), payload as any);
        case 'git.dangerouslyAuthenticate':
          return sandbox.git.dangerouslyAuthenticate(payload as any);
        case 'system.process.list':
        {
          const result = await sandbox.commands.run(buildBashCommand(buildProcessListScript()), payload as any);
          const stdout = extractCommandText(result, 'stdout');
          const stderr = extractCommandText(result, 'stderr');
          const exitCode = extractCommandExitCode(result);
          if (exitCode !== null && exitCode !== 0) {
            throw new AppError(400, stderr || '获取进程列表失败');
          }
          return parseProcessEntries(stdout);
        }
        case 'system.process.kill': {
          const pid = Number(payload?.pid);
          if (!Number.isFinite(pid) || pid <= 0) {
            throw new AppError(400, 'PID 非法，无法结束进程');
          }
          const result = await sandbox.commands.run(buildBashCommand(buildProcessKillScript(pid)), payload as any);
          const stdout = extractCommandText(result, 'stdout');
          const stderr = extractCommandText(result, 'stderr');
          const exitCode = extractCommandExitCode(result);
          if (exitCode === 44 || stdout.includes('PID_NOT_FOUND:')) {
            throw new AppError(400, `PID 不存在：${pid}`);
          }
          if (exitCode !== null && exitCode !== 0) {
            throw new AppError(400, stderr || stdout || `结束进程失败：${pid}`);
          }
          return {
            pid,
            success: true,
            signal: 'SIGKILL',
            generatedAt: new Date().toISOString(),
          };
        }
        case 'system.ports.inspect': {
          const result = await sandbox.commands.run(buildBashCommand(buildPortScanScript()), payload as any);
          const stdout = extractCommandText(result, 'stdout');
          const stderr = extractCommandText(result, 'stderr');
          const exitCode = extractCommandExitCode(result);
          if (exitCode !== null && exitCode !== 0) {
            throw new AppError(400, stderr || '查看端口失败');
          }
          return parsePortScanOutput(stdout);
        }
        case 'sandbox.host':
          return sandbox.getHost(Number(payload?.port));
        case 'sandbox.uploadUrl':
          return sandbox.uploadUrl(payload?.path as any, payload as any);
        case 'sandbox.downloadUrl':
          return sandbox.downloadUrl(String(payload?.path ?? ''), payload as any);
        default:
          throw new AppError(400, `未知 action: ${action}`);
      }
    });
  }
}
