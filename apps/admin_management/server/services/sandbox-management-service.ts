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
  items: RuntimeRegistryItem[];
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

function summarizeStatus(records: E2bSandboxListItem[]): SandboxStatusSummary {
  return {
    total: records.length,
    running: records.filter((item) => item.state === 'running').length,
    paused: records.filter((item) => item.state === 'paused').length,
  };
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
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

export class SandboxManagementService {
  private async listTrackedEnvironments(limit: number) {
    return oneceoApiConnector.listSandboxEnvironments(limit).catch(() => []);
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
    const sandboxes = await e2bConnector.listSandboxes(limit, query);
    return query?.templateId
      ? sandboxes.filter((item) => item.templateId === query.templateId || item.alias === query.templateId)
      : sandboxes;
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

  async getRuntimeRegistry(limit = 80): Promise<RuntimeRegistryResponse> {
    const [trackedEnvironments, taskSessions, liveSandboxes] = await Promise.all([
      this.listTrackedEnvironments(Math.max(limit, 120)),
      this.listTaskSessions(Math.max(limit, 120)),
      this.listLiveSandboxes(Math.max(limit, 120)).catch(() => []),
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

    const sliced = items.slice(0, limit);
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
    const [trackedEnvironment, registry, liveSandbox, liveSandboxDetail, liveSandboxFullInfo, metrics] = await Promise.all([
      oneceoApiConnector.getSandboxEnvironment(sandboxId).catch(() => null),
      this.getRuntimeRegistry(200),
      this.listLiveSandboxes(200).then((items) => items.find((item) => item.sandboxId === sandboxId) || null).catch(() => null),
      e2bConnector.getSandboxInfo(sandboxId).catch(() => null),
      e2bConnector.getSandboxFullInfo(sandboxId).catch(() => null),
      this.getEnvironmentMetrics(sandboxId).catch(() => []),
    ]);

    const registryRuntime = registry.items.find((item) => item.sandboxId === sandboxId) || null;
    const trackedMetadata = asRecord(trackedEnvironment?.metadata);
    const liveMetadata = asRecord(liveSandbox?.metadata);
    const metadata = { ...trackedMetadata, ...liveMetadata };
    const taskSessionId = registryRuntime?.taskSessionId || asText(metadata.taskSessionId);

    const [taskSession, debug] = taskSessionId
      ? await Promise.all([
          oneceoApiConnector.getTaskCreationSession(taskSessionId).catch(() => null),
          oneceoApiConnector.getTaskCreationDebug(taskSessionId).catch(() => null),
        ])
      : [null, null];

    const runtime =
      buildRuntimeItem({
        tracked: trackedEnvironment,
        live: liveSandbox,
        taskSession,
      }) || registryRuntime;

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
        workspaceRoot: asText(metadata.opencodeWorkspaceRoot),
        stateRoot: asText(metadata.opencodeStateRoot),
      },
      archive: {
        archiveStatus: deriveArchiveStatus(metadata),
        archiveDirty: asBoolean(metadata.archiveDirty),
        pendingArchiveUpdate: asBoolean(metadata.pendingArchiveUpdate),
        archiveKey: asText(metadata.r2ArchiveKey),
        snapshotKey: asText(metadata.snapshotKey),
        metadataKey: asText(metadata.metadataKey),
        archivePendingSince: asText(metadata.archivePendingSince),
        lastDirtyAt: asText(metadata.lastDirtyAt),
        lastDirtyReason: asText(metadata.lastDirtyReason),
        restoredAt: asText(metadata.restoredAt),
      },
      metadata,
    };
  }

  async setEnvironmentTimeout(sandboxId: string, timeoutMs: number) {
    return e2bConnector.setSandboxTimeout(sandboxId, timeoutMs);
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
    return e2bConnector.createSandbox(payload);
  }

  async closeEnvironment(sandboxId: string) {
    return e2bConnector.killSandbox(sandboxId);
  }

  async pauseEnvironment(sandboxId: string) {
    return e2bConnector.pauseSandbox(sandboxId);
  }

  async resumeEnvironment(sandboxId: string) {
    return e2bConnector.resumeSandbox(sandboxId);
  }

  async archiveEnvironment(sandboxId: string) {
    return oneceoApiConnector.archiveSandboxEnvironment(sandboxId);
  }

  async restoreEnvironment(sandboxId: string) {
    return oneceoApiConnector.restoreSandboxEnvironment(sandboxId);
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
        case 'files.list':
          return sandbox.files.list(String(payload?.path ?? '/'), payload as any);
        case 'files.read':
          return sandbox.files.read(String(payload?.path ?? ''), payload as any);
        case 'files.write':
          return sandbox.files.write(String(payload?.path ?? ''), payload?.data as any, payload as any);
        case 'files.writeFiles':
          return sandbox.files.writeFiles((payload?.files as any[]) ?? [], payload as any);
        case 'files.remove':
          return sandbox.files.remove(String(payload?.path ?? ''), payload as any);
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
