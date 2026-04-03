import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionConnectorBindingDAO,
  taskSessionRunDAO,
} from '../db/dao';
import {
  type ConnectorKey,
  type ConnectorRuntimeStatus,
  type ConnectorUsageStatus,
  connectorRegistry,
} from './connector-registry';
import { userConnectorService } from './user-connector-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import { ensureSandboxRuntimeMetadata } from './sandbox-runtime-metadata-service';
import { githubConnectorRepositoryService } from './github-connector-repository-service';
import { osacConnectionManager } from './osac-connection-manager';
import { connectorGuideService } from './connector-guide-service';
import type { OsacMessage } from '../clients/osac-client';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

export type SessionConnectorConfig = {
  repositories?: string[];
};

export type SessionConnectorStatus = {
  connectorKey: ConnectorKey;
  name: string;
  icon: string;
  authMode: string;
  available: boolean;
  availabilityReason?: string;
  globalAuthStatus: string;
  attached: boolean;
  desiredState: string;
  runtimeStatus: string;
  usageStatus: ConnectorUsageStatus;
  displayName?: string | null;
  selectedProfileId?: string | null;
  selectedProfileName?: string | null;
  selectedProfileLastAuthAt?: string | null;
  attachedProfileId?: string | null;
  attachedProfileName?: string | null;
  availableProfilesCount?: number;
  enabledTools?: string[];
  authorizedRepositories?: string[];
  lastUsedAt?: string | null;
  lastError?: string | null;
  serverName?: string | null;
};

type RuntimeContext = {
  orchestratorSessionId: string;
  baseUrl: string;
  trafficAccessToken?: string;
};

type SessionMcpProviderStatus = {
  providerId: string;
  sessionId: string;
  status: string;
  transport?: string | null;
  envVersion?: number;
  tools: Array<{
    providerId: string;
    toolName: string;
    title?: string | null;
    description?: string | null;
    inputSchema?: Record<string, unknown> | null;
  }>;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeRepositoryFullName(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  const parts = text
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length !== 2) return '';
  return `${parts[0]}/${parts[1]}`;
}

function repositoryKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeGithubRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeRepositoryFullName(item);
    if (!normalized) continue;
    const key = repositoryKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeSessionConfig(
  connectorKey: ConnectorKey,
  value: unknown
): SessionConnectorConfig | null {
  const config = pickObject(value);
  if (connectorKey !== 'github') {
    return Object.keys(config).length > 0 ? (config as SessionConnectorConfig) : null;
  }
  const repositories = normalizeGithubRepositories(config.repositories);
  if (repositories.length === 0) {
    return null;
  }
  return { repositories };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = asText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function isActive(lastUsedAt: unknown, enabled: boolean): boolean {
  if (!enabled || !lastUsedAt) return false;
  const date = lastUsedAt instanceof Date ? lastUsedAt : new Date(String(lastUsedAt));
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 30_000;
}

function serverNameFor(connectorKey: ConnectorKey, taskSessionId: string) {
  return `${connectorKey}--${taskSessionId}`;
}

function providerIdFor(taskSessionId: string, connectorKey: ConnectorKey, profileId: string) {
  return `task_session:${taskSessionId}:connector:${connectorKey}:profile:${profileId}`;
}

function extractTaskSessionId(metadata: Record<string, unknown>): string {
  return asText(metadata.taskSessionId);
}

function mapRuntimeStatus(value: unknown): ConnectorRuntimeStatus {
  const text = asText(value).toLowerCase();
  if (!text) return 'unknown';
  if (text === 'connected') return 'connected';
  if (text === 'connecting') return 'connecting';
  if (text === 'pending_recover') return 'unknown';
  if (text === 'recovering') return 'connecting';
  if (text === 'needs_auth') return 'needs_auth';
  if (text === 'failed' || text === 'error') return 'failed';
  if (text === 'disabled') return 'disabled';
  if (text === 'disconnected') return 'disconnected';
  return 'unknown';
}

function pickToolName(event: Record<string, unknown>): string {
  const properties =
    event.properties && typeof event.properties === 'object'
      ? (event.properties as Record<string, unknown>)
      : {};
  const part =
    properties.part && typeof properties.part === 'object'
      ? (properties.part as Record<string, unknown>)
      : {};
  return (
    asText(part.tool) ||
    asText(part.name) ||
    asText(properties.tool) ||
    asText(properties.name)
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildSupabaseProxyEnv(connectorKey: ConnectorKey): Record<string, string> {
  if (connectorKey !== 'supabase') {
    return {};
  }

  const proxyEnabled = toBool(
    process.env.ONECEO_PROXY_ENABLED ?? process.env.E2B_PROXY_ENABLED ?? 'true',
    true
  );
  if (!proxyEnabled) {
    return {};
  }

  const httpProxy = asText(process.env.HTTP_PROXY || process.env.http_proxy);
  const httpsProxy = asText(process.env.HTTPS_PROXY || process.env.https_proxy) || httpProxy;
  const noProxy = asText(process.env.NO_PROXY || process.env.no_proxy);

  const env: Record<string, string> = {};
  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
    env.http_proxy = httpProxy;
  }
  if (httpsProxy) {
    env.HTTPS_PROXY = httpsProxy;
    env.https_proxy = httpsProxy;
  }
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }
  return env;
}

function isOsacRequestTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('OSAC 请求超时') || /request timeout/i.test(message);
}

export class SessionConnectorService {
  private asPayloadRecord(message: OsacMessage | null | undefined): Record<string, unknown> {
    const payload = message?.payload;
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  }

  private normalizeSessionMcpProviders(message: OsacMessage | null | undefined) {
    const payload = this.asPayloadRecord(message);
    const result = new Map<string, SessionMcpProviderStatus>();
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const topLevelTools = Array.isArray(payload.tools) ? payload.tools : [];

    for (const item of providers) {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      if (!record) continue;
      const providerId = asText(record.providerId);
      if (!providerId) continue;
      const tools = Array.isArray(record.tools) ? record.tools : [];
      result.set(providerId, {
        providerId,
        sessionId: asText(record.sessionId) || '',
        status: asText(record.status) || 'unknown',
        transport: asText(record.transport) || null,
        envVersion: typeof record.envVersion === 'number' ? record.envVersion : undefined,
        tools: tools
          .map((tool) => {
            const toolRecord = tool && typeof tool === 'object' ? (tool as Record<string, unknown>) : null;
            if (!toolRecord) return null;
            const toolName = asText(toolRecord.toolName || toolRecord.name);
            if (!toolName) return null;
            return {
              providerId,
              toolName,
              title: asText(toolRecord.title) || null,
              description: asText(toolRecord.description) || null,
              inputSchema:
                toolRecord.inputSchema && typeof toolRecord.inputSchema === 'object'
                  ? (toolRecord.inputSchema as Record<string, unknown>)
                  : null,
            };
          })
          .filter(Boolean) as SessionMcpProviderStatus['tools'],
      });
    }

    for (const item of topLevelTools) {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      if (!record) continue;
      const providerId = asText(record.providerId);
      const toolName = asText(record.toolName || record.name);
      if (!providerId || !toolName) continue;
      const provider = result.get(providerId) || {
        providerId,
        sessionId: asText(payload.sessionId) || '',
        status: 'connected',
        transport: null,
        tools: [],
      };
      provider.tools.push({
        providerId,
        toolName,
        title: asText(record.title) || null,
        description: asText(record.description) || null,
        inputSchema:
          record.inputSchema && typeof record.inputSchema === 'object'
            ? (record.inputSchema as Record<string, unknown>)
            : null,
      });
      result.set(providerId, provider);
    }
    return result;
  }

  private async requestRuntime(
    runtime: RuntimeContext,
    message: OsacMessage,
    match?: (reply: OsacMessage) => boolean
  ) {
    return osacConnectionManager.request(runtime.orchestratorSessionId, message, match);
  }

  private buildProviderTransport(
    connectorKey: ConnectorKey,
    profileMaterial: NonNullable<Awaited<ReturnType<typeof userConnectorService.getProfileMaterial>>>,
    sessionConfig: Record<string, unknown> | null
  ) {
    const runtimeConfig = connectorRegistry.materializeRuntimeConfig({
      connectorKey,
      account: profileMaterial,
      sessionConfig,
    });
    if (runtimeConfig.type === 'local') {
      return {
        transport: {
          type: 'local_stdio' as const,
          command: runtimeConfig.command,
          env: runtimeConfig.environment || {},
        },
        transportName: 'local_stdio',
      };
    }
    const proxyEnv = buildSupabaseProxyEnv(connectorKey);
    return {
      transport: {
        type: 'remote_sse' as const,
        url: runtimeConfig.url,
        headers: runtimeConfig.headers || {},
        env: proxyEnv,
      },
      transportName: 'remote_sse',
    };
  }

  async assertSessionOwnership(taskSessionId: string, userId: string) {
    let session:
      | Awaited<ReturnType<typeof taskCreationSessionDAO.getSession>>
      | Awaited<ReturnType<typeof taskCreationSessionDAO.createSession>>
      | null = await taskCreationSessionDAO.getSession(taskSessionId);
    if (!session) {
      const memory = await taskCreationFileMemoryStore.getSession(taskSessionId);
      if (memory) {
        session = await taskCreationSessionDAO.createSession({
          id: taskSessionId,
          userId,
          status: memory.status,
        } as any);
      }
    }
    if (!session) {
      throw new Error('会话不存在');
    }
    if (session.userId && session.userId !== userId) {
      throw new Error('当前用户无权管理该会话连接器');
    }
    if (!session.userId) {
      throw new Error('会话缺少归属用户，无法管理该会话连接器');
    }
    return session;
  }

  private async resolveRuntimeContext(
    taskSessionId: string,
    orchestratorSessionId?: string | null
  ): Promise<RuntimeContext | null> {
    const target =
      asText(orchestratorSessionId) ||
      asText((await taskCreationFileMemoryStore.getSession(taskSessionId))?.runtime?.orchestratorSessionId);
    if (!target) return null;
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(target);
    if (!environment || environment.status !== 'ready') return null;
    const ensured = await ensureSandboxRuntimeMetadata(target, { taskSessionId });
    if (!ensured?.baseUrl) {
      throw new Error('未找到 OpenCode baseUrl');
    }
    return {
      orchestratorSessionId: target,
      baseUrl: ensured.baseUrl,
      trafficAccessToken: ensured.trafficAccessToken || undefined,
    };
  }

  private async getRuntimeMcpMap(runtime: RuntimeContext | null) {
    if (!runtime) return new Map<string, SessionMcpProviderStatus>();
    const reply = await this.requestRuntime(
      runtime,
      {
        type: 'LIST_SESSION_MCP_TOOLS',
        payload: {
          sessionId: runtime.orchestratorSessionId,
        },
      },
      (message) => message.type === 'SESSION_MCP_TOOLS_RESPONSE'
    );
    return this.normalizeSessionMcpProviders(reply);
  }

  private async waitForRuntimeServer(
    runtime: RuntimeContext,
    providerId: string,
    attempts = 12,
    delayMs = 500
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const liveMap = await this.getRuntimeMcpMap(runtime);
      const live = liveMap.get(providerId);
      const status = mapRuntimeStatus(live?.status);
      if (live && status === 'connected') {
        return live;
      }
      if (attempt < attempts - 1) {
        await wait(delayMs);
      }
    }
    return null;
  }

  private async waitForRuntimeServerAbsence(
    runtime: RuntimeContext,
    providerId: string,
    attempts = 10,
    delayMs = 400
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const liveMap = await this.getRuntimeMcpMap(runtime);
      if (!liveMap.has(providerId)) {
        return true;
      }
      if (attempt < attempts - 1) {
        await wait(delayMs);
      }
    }
    return false;
  }

  private buildStatus(input: {
    taskSessionId: string;
    connectorKey: ConnectorKey;
    account: Awaited<ReturnType<typeof userConnectorService.getUserAccount>>;
    profiles: Awaited<ReturnType<typeof userConnectorService.listUserProfiles>>;
    binding?: {
      profileId?: string | null;
      desiredState: string;
      runtimeStatus: string;
      enabledTools?: unknown;
      sessionConfigJson?: unknown;
      runtimeProviderId?: string | null;
      runtimeAttachedToolsJson?: unknown;
      lastUsedAt: Date | null;
      lastError: string | null;
      serverName: string | null;
    } | null;
    live?: SessionMcpProviderStatus;
  }): SessionConnectorStatus {
    const catalogItem = connectorRegistry.getCatalogItem(input.connectorKey);
    const serverName = input.binding?.serverName || serverNameFor(input.connectorKey, input.taskSessionId);
    const liveStatus = input.live ? mapRuntimeStatus(input.live.status) : undefined;
    const persistedRuntimeStatus = asText(input.binding?.runtimeStatus).toLowerCase();
    const runtimeStatus =
      liveStatus ||
      persistedRuntimeStatus ||
      (input.binding?.desiredState === 'attached' ? 'unknown' : 'disconnected');
    const usageStatus: ConnectorUsageStatus = isActive(
      input.binding?.lastUsedAt,
      catalogItem.activityMatcherVerified
    )
      ? 'active'
      : 'idle';
    const connectorProfiles = input.profiles.filter((item) => item.connectorKey === input.connectorKey);
    const selectedProfile =
      connectorProfiles.find((item) => item.profileId === input.binding?.profileId) ||
      connectorProfiles.find((item) => item.profileId === input.account.defaultProfileId) ||
      connectorProfiles.find((item) => item.isDefault) ||
      connectorProfiles[0];
    return {
      connectorKey: input.connectorKey,
      name: catalogItem.name,
      icon: catalogItem.icon,
      authMode: input.account.authMode,
      available: catalogItem.available,
      availabilityReason: catalogItem.availabilityReason,
      globalAuthStatus: selectedProfile?.authStatus || input.account.authStatus,
      attached: input.binding?.desiredState === 'attached',
      desiredState: input.binding?.desiredState || 'detached',
      runtimeStatus,
      usageStatus,
      displayName: selectedProfile?.displayName || input.account.displayName || null,
      selectedProfileId: selectedProfile?.profileId || null,
      selectedProfileName: selectedProfile?.profileName || null,
      selectedProfileLastAuthAt: toIso(selectedProfile?.lastAuthAt),
      attachedProfileId:
        input.binding?.desiredState === 'attached' ? asText(input.binding?.profileId) || null : null,
      attachedProfileName:
        input.binding?.desiredState === 'attached'
          ? connectorProfiles.find((item) => item.profileId === input.binding?.profileId)?.profileName || null
          : null,
      availableProfilesCount: connectorProfiles.length,
      enabledTools: Array.isArray(input.binding?.enabledTools)
        ? input.binding?.enabledTools.map((item) => String(item))
        : [],
      authorizedRepositories: normalizeGithubRepositories(
        pickObject(input.binding?.sessionConfigJson).repositories
      ),
      lastUsedAt: toIso(input.binding?.lastUsedAt),
      lastError: input.binding?.lastError || input.account.lastError || null,
      serverName,
    };
  }

  async listSessionConnectors(taskSessionId: string, userId: string): Promise<SessionConnectorStatus[]> {
    await connectorStorageBootstrap.ensureReady();
    await this.assertSessionOwnership(taskSessionId, userId);
    const [accounts, profiles, bindings] = await Promise.all([
      userConnectorService.listUserAccounts(userId),
      userConnectorService.listUserProfiles(userId),
      taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId),
    ]);
    const requiresRuntimeProbe = bindings.some((item) => {
      const desiredState = asText(item.desiredState).toLowerCase();
      const runtimeProviderId = asText(item.runtimeProviderId);
      const runtimeStatus = asText(item.runtimeStatus).toLowerCase();
      return (
        desiredState === 'attached' ||
        Boolean(runtimeProviderId) ||
        ['connected', 'connecting', 'unknown'].includes(runtimeStatus)
      );
    });
    const runtime = requiresRuntimeProbe ? await this.resolveRuntimeContext(taskSessionId) : null;
    const bindingMap = new Map(bindings.map((item) => [item.connectorKey, item]));
    const liveMap = await this.getRuntimeMcpMap(runtime);
    return connectorRegistry.listVisibleCatalog().map((item) => {
      const account =
        accounts.find((entry) => entry.connectorKey === item.key) ||
        ({
          connectorKey: item.key,
          authMode: item.authMode,
          authStatus: item.available ? 'not_configured' : 'unavailable',
          config: {},
        } as Awaited<ReturnType<typeof userConnectorService.getUserAccount>>);
      const serverName = serverNameFor(item.key, taskSessionId);
      return this.buildStatus({
        taskSessionId,
        connectorKey: item.key,
        account,
        profiles,
        binding: bindingMap.get(item.key) as any,
        live: liveMap.get(asText(bindingMap.get(item.key)?.runtimeProviderId)),
      });
    });
  }

  summarizeStatuses(statuses: SessionConnectorStatus[]) {
    return {
      total: statuses.length,
      attached: statuses.filter((item) => item.attached).length,
      active: statuses.filter((item) => item.usageStatus === 'active').length,
      needsAuth: statuses.filter((item) => item.globalAuthStatus === 'needs_auth').length,
      failed: statuses.filter((item) => item.runtimeStatus === 'failed').length,
    };
  }

  async attachConnector(
    taskSessionId: string,
    userId: string,
    connectorKey: ConnectorKey,
    profileId: string,
    enabledTools: string[] = [],
    sessionConfig: Record<string, unknown> = {},
    orchestratorSessionId?: string
  ) {
    await connectorStorageBootstrap.ensureReady();
    writeConnectorDebugLog('[CONNECTOR_ATTACH_SERVICE_START]', {
      taskSessionId,
      userId,
      connectorKey,
      profileId,
      enabledTools,
      sessionConfigKeys: Object.keys(sessionConfig || {}),
      orchestratorSessionId: asText(orchestratorSessionId) || null,
    });
    await this.assertSessionOwnership(taskSessionId, userId);
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    if (!catalogItem.available) {
      throw new Error(catalogItem.availabilityReason || '当前连接器不可用');
    }
    const profileMaterial = await userConnectorService.getProfileMaterial(userId, profileId);
    if (!profileMaterial || profileMaterial.connectorKey !== connectorKey) {
      throw new Error('连接器 profile 不存在或不属于当前连接器');
    }
    const normalizedSessionConfig = normalizeSessionConfig(connectorKey, sessionConfig);
    if (connectorKey === 'github') {
      await githubConnectorRepositoryService.assertProfileAuthorized(userId, profileId);
      const repositories = normalizedSessionConfig?.repositories || [];
      // 移除必须至少选择一个仓库的限制，允许先开启开关再选仓库
      if (repositories.length > 0) {
        await githubConnectorRepositoryService.assertRepositoriesAccessible(
          userId,
          profileId,
          repositories
        );
      }
    }
    const existingBinding = await taskSessionConnectorBindingDAO.getByTaskSessionAndConnectorKey(taskSessionId, connectorKey);
    if (profileMaterial.authStatus !== 'authorized') {
      await taskSessionConnectorBindingDAO.upsert({
        taskSessionId,
        connectorKey,
        profileId,
        desiredState: 'detached',
        runtimeStatus: 'needs_auth',
        orchestratorSessionId: asText(orchestratorSessionId) || null,
        serverName: serverNameFor(connectorKey, taskSessionId),
        enabledTools,
        sessionConfigJson: normalizedSessionConfig,
        definitionSnapshotJson: catalogItem,
        lastError: '连接器尚未完成授权或配置',
      });
      await connectorGuideService.recomputeSessionGuides(taskSessionId);
      throw new Error('连接器尚未完成授权或配置');
    }
    const runtime = await this.resolveRuntimeContext(taskSessionId, orchestratorSessionId);
    const serverName = serverNameFor(connectorKey, taskSessionId);
    const providerId = providerIdFor(taskSessionId, connectorKey, profileId);
    const runtimeEnvVersion = Number(existingBinding?.runtimeEnvVersion || 0) + 1;
    const providerConfig = this.buildProviderTransport(connectorKey, profileMaterial, normalizedSessionConfig);
    if (!runtime) {
      await taskSessionConnectorBindingDAO.upsert({
        taskSessionId,
        connectorKey,
        profileId,
        desiredState: 'attached',
        runtimeStatus: 'pending_recover',
        orchestratorSessionId: asText(orchestratorSessionId) || null,
        serverName,
        runtimeProviderId: providerId,
        runtimeEnvVersion,
        runtimeTransport: providerConfig.transportName,
        runtimeAttachedToolsJson: [],
        runtimeLastStoppedAt: new Date(),
        recoveryQueuedAt: new Date(),
        recoveryStartedAt: null,
        recoveryCompletedAt: null,
        enabledTools,
        sessionConfigJson: normalizedSessionConfig,
        definitionSnapshotJson: catalogItem,
        lastError: 'sandbox_not_ready_pending_recover',
      });
      await connectorGuideService.recomputeSessionGuides(taskSessionId);
      return (await this.listSessionConnectors(taskSessionId, userId)).find(
        (item) => item.connectorKey === connectorKey
      );
    }
    writeConnectorDebugLog('[CONNECTOR_ATTACH_RUNTIME_READY]', {
      taskSessionId,
      connectorKey,
      providerTransportType: providerConfig.transportName,
      runtimeSessionId: runtime.orchestratorSessionId,
      runtimeBaseUrl: runtime.baseUrl,
    });

    const binding = await taskSessionConnectorBindingDAO.upsert({
      taskSessionId,
      connectorKey,
      profileId,
      desiredState: 'attached',
      runtimeStatus: 'connecting',
      orchestratorSessionId: runtime.orchestratorSessionId,
      serverName,
      runtimeProviderId: providerId,
      runtimeEnvVersion,
      runtimeTransport: providerConfig.transportName,
      runtimeAttachedToolsJson: [],
      runtimeLastStartedAt: new Date(),
      recoveryQueuedAt: null,
      recoveryStartedAt: new Date(),
      recoveryCompletedAt: null,
      enabledTools,
      sessionConfigJson: normalizedSessionConfig,
      definitionSnapshotJson: catalogItem,
      lastError: null,
    });
    await connectorGuideService.recomputeSessionGuides(taskSessionId);
    await taskSessionRunDAO.appendConnectorRuntimeEvent({
      sessionId: taskSessionId,
      bindingId: binding.id,
      providerId,
      eventType: 'provider_register_requested',
      payloadJson: {
        transport: providerConfig.transportName,
      },
    });

    try {
      const retryCountRaw = Number(process.env.CONNECTOR_ATTACH_TIMEOUT_RETRIES || 1);
      const retryDelayRaw = Number(process.env.CONNECTOR_ATTACH_TIMEOUT_RETRY_DELAY_MS || 1000);
      const maxAttempts = 1 + (Number.isFinite(retryCountRaw) ? Math.max(0, Math.floor(retryCountRaw)) : 1);
      const retryDelayMs = Number.isFinite(retryDelayRaw) ? Math.max(100, Math.floor(retryDelayRaw)) : 1000;
      const requestRuntimeWithTimeoutRetry = async (input: {
        stage: 'register_provider' | 'attach_provider_to_session';
        message: OsacMessage;
        match: (message: OsacMessage) => boolean;
      }) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const startedAt = Date.now();
          try {
            const reply = await this.requestRuntime(runtime, input.message, input.match);
            writeConnectorDebugLog('[CONNECTOR_ATTACH_OSAC_STAGE_DONE]', {
              taskSessionId,
              connectorKey,
              providerId,
              stage: input.stage,
              attempt,
              durationMs: Date.now() - startedAt,
            });
            return reply;
          } catch (error) {
            const timeoutError = isOsacRequestTimeoutError(error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            writeConnectorDebugLog('[CONNECTOR_ATTACH_OSAC_STAGE_FAILED]', {
              taskSessionId,
              connectorKey,
              providerId,
              stage: input.stage,
              attempt,
              durationMs: Date.now() - startedAt,
              timeoutError,
              error: errorMessage,
            }, timeoutError ? 'warn' : 'error');
            if (timeoutError && attempt < maxAttempts) {
              writeConnectorDebugLog('[CONNECTOR_ATTACH_OSAC_STAGE_RETRY]', {
                taskSessionId,
                connectorKey,
                providerId,
                stage: input.stage,
                attempt,
                nextAttempt: attempt + 1,
                retryDelayMs,
              }, 'warn');
              await wait(retryDelayMs);
              continue;
            }
            throw error;
          }
        }
        throw new Error('OSAC attach stage exhausted');
      };

      writeConnectorDebugLog('[CONNECTOR_ATTACH_REGISTER_PROVIDER]', {
        taskSessionId,
        connectorKey,
        providerId,
        runtimeSessionId: runtime.orchestratorSessionId,
        transport: providerConfig.transportName,
      });
      await requestRuntimeWithTimeoutRetry({
        stage: 'register_provider',
        message: {
          type: 'REGISTER_MCP_PROVIDER',
          payload: {
            providerId,
            taskSessionId,
            connectorKey,
            providerLabel: catalogItem.name,
            transport: providerConfig.transport,
            overwrite: true,
          },
        },
        match: (message) => {
          const payload = this.asPayloadRecord(message);
          return message.type === 'MCP_PROVIDER_STATUS' && asText(payload.providerId) === providerId;
        },
      });
      writeConnectorDebugLog('[CONNECTOR_ATTACH_PROVIDER_REGISTERED]', {
        taskSessionId,
        connectorKey,
        providerId,
      });
      const attachReply = await requestRuntimeWithTimeoutRetry({
        stage: 'attach_provider_to_session',
        message: {
          type: 'ATTACH_MCP_PROVIDER_TO_SESSION',
          payload: {
            sessionId: runtime.orchestratorSessionId,
            providerId,
            taskSessionId,
            enabledTools,
          },
        },
        match: (message) => {
          const payload = this.asPayloadRecord(message);
          return (
            message.type === 'MCP_PROVIDER_STATUS' &&
            asText(payload.providerId) === providerId &&
            asText(payload.sessionId) === runtime.orchestratorSessionId
          );
        },
      });
      writeConnectorDebugLog('[CONNECTOR_ATTACH_PROVIDER_ATTACHED_REPLY]', {
        taskSessionId,
        connectorKey,
        providerId,
        payload: this.asPayloadRecord(attachReply),
      });
      const attachedProviders = this.normalizeSessionMcpProviders({
        ...attachReply,
        payload: {
          ...this.asPayloadRecord(attachReply),
          providers: [this.asPayloadRecord(attachReply)],
        },
      } as OsacMessage);
      const attached = attachedProviders.get(providerId);
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeAttachedToolsJson: attached?.tools || [],
        runtimeStatus: mapRuntimeStatus(attached?.status || 'connected'),
        recoveryQueuedAt: null,
        recoveryStartedAt: new Date(),
        recoveryCompletedAt: new Date(),
        lastError: null,
      });
      await taskSessionRunDAO.appendConnectorRuntimeEvent({
        sessionId: taskSessionId,
        bindingId: binding.id,
        providerId,
        eventType: 'provider_attached',
        payloadJson: {
          runtimeStatus: attached?.status || 'connected',
          tools: attached?.tools || [],
        },
      });
    } catch (error) {
      writeConnectorDebugLog('[CONNECTOR_ATTACH_PROVIDER_FAILED]', {
        taskSessionId,
        connectorKey,
        providerId,
        runtimeSessionId: runtime.orchestratorSessionId,
        transport: providerConfig.transportName,
        error: error instanceof Error ? error.message : String(error),
      }, 'error');
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'failed',
        runtimeProviderId: providerId,
        runtimeEnvVersion,
        runtimeTransport: providerConfig.transportName,
        recoveryQueuedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      await taskSessionRunDAO.appendConnectorRuntimeEvent({
        sessionId: taskSessionId,
        bindingId: binding.id,
        providerId,
        eventType: 'provider_attach_failed',
        payloadJson: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    const live = await this.waitForRuntimeServer(runtime, providerId);
    if (!live) {
      writeConnectorDebugLog('[CONNECTOR_ATTACH_PROVIDER_MISSING_AFTER_ATTACH]', {
        taskSessionId,
        connectorKey,
        providerId,
        runtimeSessionId: runtime.orchestratorSessionId,
      }, 'error');
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'failed',
        runtimeProviderId: providerId,
        runtimeEnvVersion,
        runtimeTransport: providerConfig.transportName,
        recoveryQueuedAt: new Date(),
        lastError: '运行时未保留已挂载的 MCP provider',
      });
      throw new Error('运行时未保留已挂载的 MCP provider');
    }
    writeConnectorDebugLog('[CONNECTOR_ATTACH_PROVIDER_LIVE]', {
      taskSessionId,
      connectorKey,
      providerId,
      runtimeSessionId: runtime.orchestratorSessionId,
      status: live.status,
      tools: live.tools.map((item) => item.toolName),
    });

    const statuses = await this.listSessionConnectors(taskSessionId, userId);
    const current = statuses.find((item) => item.connectorKey === connectorKey);
    await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
      runtimeStatus: current?.runtimeStatus || 'connected',
      profileId,
      orchestratorSessionId: runtime.orchestratorSessionId,
      serverName,
      runtimeProviderId: providerId,
      runtimeEnvVersion,
      runtimeTransport: providerConfig.transportName,
      runtimeAttachedToolsJson: live.tools,
      recoveryQueuedAt: null,
      recoveryStartedAt: null,
      recoveryCompletedAt: new Date(),
      enabledTools,
      sessionConfigJson: normalizedSessionConfig,
      definitionSnapshotJson: catalogItem,
      lastError: null,
    });
    return (await this.listSessionConnectors(taskSessionId, userId)).find(
      (item) => item.connectorKey === connectorKey
    );
  }

  async detachConnector(
    taskSessionId: string,
    userId: string,
    connectorKey: ConnectorKey,
    orchestratorSessionId?: string
  ) {
    await connectorStorageBootstrap.ensureReady();
    await this.assertSessionOwnership(taskSessionId, userId);
    const runtime = await this.resolveRuntimeContext(taskSessionId, orchestratorSessionId);
    const serverName = serverNameFor(connectorKey, taskSessionId);
    const existingBinding = await taskSessionConnectorBindingDAO.getByTaskSessionAndConnectorKey(taskSessionId, connectorKey);
    const providerId = asText(existingBinding?.runtimeProviderId);
    const binding = await taskSessionConnectorBindingDAO.upsert({
      taskSessionId,
      connectorKey,
      profileId: null,
      desiredState: 'detached',
      runtimeStatus: runtime ? 'connecting' : 'detached',
      orchestratorSessionId: asText(orchestratorSessionId) || runtime?.orchestratorSessionId || null,
      serverName,
      runtimeProviderId: runtime ? providerId || null : null,
      runtimeAttachedToolsJson: [],
      runtimeLastStoppedAt: new Date(),
      recoveryQueuedAt: null,
      recoveryStartedAt: null,
      recoveryCompletedAt: null,
      enabledTools: [],
      sessionConfigJson: null,
      definitionSnapshotJson: connectorRegistry.getCatalogItem(connectorKey),
      lastError: null,
    });
    await connectorGuideService.recomputeSessionGuides(taskSessionId);
    if (runtime) {
      try {
        if (providerId) {
          await this.requestRuntime(
            runtime,
            {
              type: 'DETACH_MCP_PROVIDER_FROM_SESSION',
              payload: {
                sessionId: runtime.orchestratorSessionId,
                providerId,
              },
            },
            (message) => {
              const payload = this.asPayloadRecord(message);
              return (
                message.type === 'MCP_PROVIDER_STATUS' &&
                asText(payload.providerId) === providerId &&
                asText(payload.sessionId) === runtime.orchestratorSessionId
              );
            }
          );
          await this.requestRuntime(
            runtime,
            {
              type: 'REMOVE_MCP_PROVIDER',
              payload: {
                providerId,
              },
            },
            (message) => {
              const payload = this.asPayloadRecord(message);
              return message.type === 'MCP_PROVIDER_STATUS' && asText(payload.providerId) === providerId;
            }
          );
        }
      } catch (error) {
        await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
          runtimeStatus: 'failed',
          orchestratorSessionId: runtime.orchestratorSessionId,
          serverName,
          runtimeProviderId: providerId || null,
          lastError: error instanceof Error ? error.message : String(error),
        });
        await taskSessionRunDAO.appendConnectorRuntimeEvent({
          sessionId: taskSessionId,
          bindingId: binding.id,
          providerId: providerId || null,
          eventType: 'provider_detach_failed',
          payloadJson: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
      const removed = providerId ? await this.waitForRuntimeServerAbsence(runtime, providerId) : true;
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: removed ? 'disconnected' : 'failed',
        profileId: null,
        orchestratorSessionId: runtime.orchestratorSessionId,
        serverName,
        runtimeProviderId: removed ? null : providerId || null,
        runtimeAttachedToolsJson: [],
        runtimeLastStoppedAt: new Date(),
        recoveryQueuedAt: null,
        recoveryStartedAt: null,
        recoveryCompletedAt: null,
        enabledTools: [],
        sessionConfigJson: null,
        lastError: removed ? null : '运行时仍保留已卸载的 MCP provider',
      });
      await taskSessionRunDAO.appendConnectorRuntimeEvent({
        sessionId: taskSessionId,
        bindingId: binding.id,
        providerId: providerId || null,
        eventType: removed ? 'provider_detached' : 'provider_detach_incomplete',
        payloadJson: null,
      });
      if (!removed) {
        throw new Error('运行时仍保留已卸载的 MCP provider');
      }
    }
    if (!runtime) {
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'detached',
        profileId: null,
        orchestratorSessionId: null,
        runtimeProviderId: null,
        runtimeAttachedToolsJson: [],
        runtimeLastStoppedAt: new Date(),
        recoveryQueuedAt: null,
        recoveryStartedAt: null,
        recoveryCompletedAt: null,
        enabledTools: [],
        sessionConfigJson: null,
        lastError: null,
      });
    }
    await connectorGuideService.recomputeSessionGuides(taskSessionId);
    return (await this.listSessionConnectors(taskSessionId, userId)).find(
      (item) => item.connectorKey === connectorKey
    );
  }

  async reconcileByOrchestratorSessionId(orchestratorSessionId: string) {
    await connectorStorageBootstrap.ensureReady();
    const environment = await sandboxExecutionEnvironmentDAO.getBySessionId(orchestratorSessionId);
    const metadata = (environment?.metadata || {}) as Record<string, unknown>;
    const taskSessionId =
      extractTaskSessionId(metadata) ||
      asText((await taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId))?.id);
    if (!taskSessionId) return;
    const session = await taskCreationSessionDAO.getSession(taskSessionId);
    const userId = asText(session?.userId);
    if (!userId) return;
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    for (const binding of bindings) {
      if (binding.desiredState !== 'attached') continue;
      try {
        const profileId = asText(binding.profileId);
        if (!profileId) continue;
        await this.attachConnector(
          taskSessionId,
          userId,
          binding.connectorKey as ConnectorKey,
          profileId,
          Array.isArray(binding.enabledTools) ? binding.enabledTools.map((item: unknown) => String(item)) : [],
          pickObject(binding.sessionConfigJson),
          orchestratorSessionId
        );
      } catch (error) {
        await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, binding.connectorKey as ConnectorKey, {
          runtimeStatus: 'failed',
          orchestratorSessionId,
          serverName: serverNameFor(binding.connectorKey as ConnectorKey, taskSessionId),
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async noteUsageFromEvent(orchestratorSessionId: string, event: Record<string, unknown>) {
    await connectorStorageBootstrap.ensureReady();
    const toolName = pickToolName(event);
    if (!toolName) return;
    const session = await taskCreationFileMemoryStore.findSessionByOrchestratorSessionId(orchestratorSessionId);
    const taskSessionId = asText(session?.id);
    if (!taskSessionId) return;
    const bindings = await taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId);
    for (const binding of bindings) {
      const connectorKey = binding.connectorKey as ConnectorKey;
      const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
      if (!catalogItem.activityMatcherVerified) continue;
      if (!connectorRegistry.matchesToolUsage(connectorKey, toolName)) continue;
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'connected',
        orchestratorSessionId,
        serverName: serverNameFor(connectorKey, taskSessionId),
        lastUsedAt: new Date(),
        lastError: null,
      });
    }
  }

  async refreshAttachedBindingsForProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const bindings = await taskSessionConnectorBindingDAO.listByProfileId(profileId);
    const refreshed: Array<{ taskSessionId: string; connectorKey: ConnectorKey }> = [];
    const failed: Array<{ taskSessionId: string; connectorKey: ConnectorKey; error: string }> = [];

    for (const binding of bindings) {
      if (binding.desiredState !== 'attached') continue;
      const taskSessionId = asText(binding.taskSessionId);
      const connectorKey = binding.connectorKey as ConnectorKey;
      if (!taskSessionId || !connectorKey) continue;
      try {
        await this.attachConnector(
          taskSessionId,
          userId,
          connectorKey,
          profileId,
          Array.isArray(binding.enabledTools)
            ? binding.enabledTools.map((item: unknown) => String(item))
            : [],
          pickObject(binding.sessionConfigJson),
          asText(binding.orchestratorSessionId) || undefined
        );
        refreshed.push({ taskSessionId, connectorKey });
      } catch (error) {
        failed.push({
          taskSessionId,
          connectorKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      refreshed,
      failed,
    };
  }

  async detachBindingsForProfile(userId: string, profileId: string) {
    await connectorStorageBootstrap.ensureReady();
    const bindings = await taskSessionConnectorBindingDAO.listByProfileId(profileId);
    const detached: Array<{ taskSessionId: string; connectorKey: ConnectorKey }> = [];
    const failed: Array<{ taskSessionId: string; connectorKey: ConnectorKey; error: string }> = [];

    const activeBindings = bindings
      .map((binding) => ({
        taskSessionId: asText(binding.taskSessionId),
        connectorKey: binding.connectorKey as ConnectorKey,
        orchestratorSessionId: asText(binding.orchestratorSessionId) || undefined,
        desiredState: asText(binding.desiredState),
      }))
      .filter((binding) => binding.desiredState === 'attached' && binding.taskSessionId && binding.connectorKey);

    const results = await Promise.allSettled(
      activeBindings.map(async (binding) => {
        await this.detachConnector(
          binding.taskSessionId,
          userId,
          binding.connectorKey,
          binding.orchestratorSessionId
        );
        return {
          taskSessionId: binding.taskSessionId,
          connectorKey: binding.connectorKey,
        };
      })
    );

    results.forEach((result, index) => {
      const binding = activeBindings[index];
      if (result.status === 'fulfilled') {
        detached.push(result.value);
        return;
      }
      failed.push({
        taskSessionId: binding.taskSessionId,
        connectorKey: binding.connectorKey,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });

    return {
      detached,
      failed,
    };
  }
}

export const sessionConnectorService = new SessionConnectorService();
