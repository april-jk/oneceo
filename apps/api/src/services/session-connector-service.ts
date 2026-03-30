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
import type { OsacMessage } from '../clients/osac-client';

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
    return {
      transport: {
        type: 'remote_sse' as const,
        url: runtimeConfig.url,
        headers: runtimeConfig.headers || {},
        env: {},
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
      session = await taskCreationSessionDAO.bindUserIfMissing(taskSessionId, userId);
    }
    if (!session) {
      throw new Error('会话不存在');
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
    const runtimeStatus =
      liveStatus ||
      mapRuntimeStatus(input.binding?.runtimeStatus) ||
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
    const [accounts, profiles, bindings, runtime] = await Promise.all([
      userConnectorService.listUserAccounts(userId),
      userConnectorService.listUserProfiles(userId),
      taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId),
      this.resolveRuntimeContext(taskSessionId),
    ]);
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
      throw new Error('连接器尚未完成授权或配置');
    }
    const runtime = await this.resolveRuntimeContext(taskSessionId, orchestratorSessionId);
    if (!runtime) {
      throw new Error('执行环境未就绪，请先启动 runtime');
    }
    const serverName = serverNameFor(connectorKey, taskSessionId);
    const providerId = providerIdFor(taskSessionId, connectorKey, profileId);
    const runtimeEnvVersion = Number(existingBinding?.runtimeEnvVersion || 0) + 1;
    const providerConfig = this.buildProviderTransport(connectorKey, profileMaterial, normalizedSessionConfig);

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
      enabledTools,
      sessionConfigJson: normalizedSessionConfig,
      definitionSnapshotJson: catalogItem,
      lastError: null,
    });
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
      await this.requestRuntime(
        runtime,
        {
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
        (message) => {
          const payload = this.asPayloadRecord(message);
          return message.type === 'MCP_PROVIDER_STATUS' && asText(payload.providerId) === providerId;
        }
      );
      const attachReply = await this.requestRuntime(
        runtime,
        {
          type: 'ATTACH_MCP_PROVIDER_TO_SESSION',
          payload: {
            sessionId: runtime.orchestratorSessionId,
            providerId,
            taskSessionId,
            enabledTools,
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
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'failed',
        runtimeProviderId: providerId,
        runtimeEnvVersion,
        runtimeTransport: providerConfig.transportName,
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
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'failed',
        runtimeProviderId: providerId,
        runtimeEnvVersion,
        runtimeTransport: providerConfig.transportName,
        lastError: '运行时未保留已挂载的 MCP provider',
      });
      throw new Error('运行时未保留已挂载的 MCP provider');
    }

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
      runtimeStatus: runtime ? 'connecting' : 'disconnected',
      orchestratorSessionId: asText(orchestratorSessionId) || runtime?.orchestratorSessionId || null,
      serverName,
      runtimeProviderId: providerId || null,
      enabledTools: [],
      sessionConfigJson: null,
      definitionSnapshotJson: connectorRegistry.getCatalogItem(connectorKey),
      lastError: null,
    });
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
}

export const sessionConnectorService = new SessionConnectorService();
