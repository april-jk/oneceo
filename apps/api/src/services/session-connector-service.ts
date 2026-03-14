import { taskCreationFileMemoryStore } from '../agents/task-creation/file-memory-store';
import {
  sandboxExecutionEnvironmentDAO,
  taskCreationSessionDAO,
  taskSessionConnectorBindingDAO,
} from '../db/dao';
import { opencodeHttpClient } from '../connectors/opencode-http-client';
import {
  type ConnectorKey,
  type ConnectorRuntimeStatus,
  type ConnectorUsageStatus,
  connectorRegistry,
} from './connector-registry';
import { userConnectorService } from './user-connector-service';
import { connectorStorageBootstrap } from './connector-storage-bootstrap';
import { sandboxAgentProvisionService } from './sandbox-agent-provision-service';
import { ensureSandboxRuntimeMetadata } from './sandbox-runtime-metadata-service';

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
  lastUsedAt?: string | null;
  lastError?: string | null;
  serverName?: string | null;
};

type RuntimeContext = {
  orchestratorSessionId: string;
  baseUrl: string;
  trafficAccessToken?: string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function parseMcpList(body: string): Map<string, Record<string, unknown>> {
  if (!body) return new Map();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const directEntries = Object.entries(record).filter(([, value]) => value && typeof value === 'object');
      if (directEntries.length > 0) {
        return new Map(
          directEntries.map(([name, value]) => [
            name,
            {
              name,
              ...(value as Record<string, unknown>),
            },
          ])
        );
      }
    }
    const items = (() => {
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record.data)) return record.data;
        if (Array.isArray(record.servers)) return record.servers;
        if (record.mcp && typeof record.mcp === 'object') {
          if (Array.isArray((record.mcp as Record<string, unknown>).servers)) {
            return (record.mcp as Record<string, unknown>).servers as unknown[];
          }
        }
      }
      return [];
    })();
    const result = new Map<string, Record<string, unknown>>();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name =
        asText(record.name) ||
        asText(record.serverName) ||
        asText(record.id);
      if (!name) continue;
      result.set(name, record);
    }
    return result;
  } catch {
    return new Map();
  }
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
    if (!runtime) return new Map<string, Record<string, unknown>>();
    const response = await opencodeHttpClient.doRequest(
      runtime.baseUrl,
      {
        method: 'GET',
        path: '/mcp',
      },
      runtime.trafficAccessToken
    );
    if (response.status < 200 || response.status >= 300) {
      return new Map<string, Record<string, unknown>>();
    }
    return parseMcpList(response.body);
  }

  private async waitForRuntimeServer(
    runtime: RuntimeContext,
    serverName: string,
    attempts = 12,
    delayMs = 500
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const liveMap = await this.getRuntimeMcpMap(runtime);
      const live = liveMap.get(serverName);
      const status = mapRuntimeStatus(
        live?.status || live?.runtimeStatus || live?.state || (live?.connected ? 'connected' : undefined)
      );
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
    serverName: string,
    attempts = 10,
    delayMs = 400
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const liveMap = await this.getRuntimeMcpMap(runtime);
      if (!liveMap.has(serverName)) {
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
    binding?: {
      desiredState: string;
      runtimeStatus: string;
      lastUsedAt: Date | null;
      lastError: string | null;
      serverName: string | null;
    } | null;
    live?: Record<string, unknown>;
  }): SessionConnectorStatus {
    const catalogItem = connectorRegistry.getCatalogItem(input.connectorKey);
    const serverName = input.binding?.serverName || serverNameFor(input.connectorKey, input.taskSessionId);
    const liveStatus = input.live
      ? mapRuntimeStatus(
          input.live.status ||
            input.live.runtimeStatus ||
            input.live.state ||
            (input.live.connected ? 'connected' : undefined)
        )
      : undefined;
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
    return {
      connectorKey: input.connectorKey,
      name: catalogItem.name,
      icon: catalogItem.icon,
      authMode: input.account.authMode,
      available: catalogItem.available,
      availabilityReason: catalogItem.availabilityReason,
      globalAuthStatus: input.account.authStatus,
      attached: input.binding?.desiredState === 'attached',
      desiredState: input.binding?.desiredState || 'detached',
      runtimeStatus,
      usageStatus,
      displayName: input.account.displayName || null,
      lastUsedAt: toIso(input.binding?.lastUsedAt),
      lastError: input.binding?.lastError || input.account.lastError || null,
      serverName,
    };
  }

  async listSessionConnectors(taskSessionId: string, userId: string): Promise<SessionConnectorStatus[]> {
    await connectorStorageBootstrap.ensureReady();
    await this.assertSessionOwnership(taskSessionId, userId);
    const [accounts, bindings, runtime] = await Promise.all([
      userConnectorService.listUserAccounts(userId),
      taskSessionConnectorBindingDAO.listByTaskSessionId(taskSessionId),
      this.resolveRuntimeContext(taskSessionId),
    ]);
    const bindingMap = new Map(bindings.map((item) => [item.connectorKey, item]));
    const liveMap = await this.getRuntimeMcpMap(runtime);
    return connectorRegistry.listCatalog().map((item) => {
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
        binding: bindingMap.get(item.key) as any,
        live: liveMap.get(serverName),
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
    orchestratorSessionId?: string
  ) {
    await connectorStorageBootstrap.ensureReady();
    await this.assertSessionOwnership(taskSessionId, userId);
    const catalogItem = connectorRegistry.getCatalogItem(connectorKey);
    if (!catalogItem.available) {
      throw new Error(catalogItem.availabilityReason || '当前连接器不可用');
    }
    const accountMaterial = await userConnectorService.getAccountMaterial(userId, connectorKey);
    if (!accountMaterial || accountMaterial.authStatus !== 'authorized') {
      await taskSessionConnectorBindingDAO.upsert({
        taskSessionId,
        connectorKey,
        desiredState: 'detached',
        runtimeStatus: 'needs_auth',
        orchestratorSessionId: asText(orchestratorSessionId) || null,
        serverName: serverNameFor(connectorKey, taskSessionId),
        lastError: '连接器尚未完成授权或配置',
      });
      throw new Error('连接器尚未完成授权或配置');
    }
    const runtime = await this.resolveRuntimeContext(taskSessionId, orchestratorSessionId);
    if (!runtime) {
      throw new Error('执行环境未就绪，请先启动 runtime');
    }
    const serverName = serverNameFor(connectorKey, taskSessionId);
    connectorRegistry.materializeRuntimeConfig({
      connectorKey,
      account: accountMaterial,
    });

    await taskSessionConnectorBindingDAO.upsert({
      taskSessionId,
      connectorKey,
      desiredState: 'attached',
      runtimeStatus: 'connecting',
      orchestratorSessionId: runtime.orchestratorSessionId,
      serverName,
      lastError: null,
    });

    try {
      await sandboxAgentProvisionService.syncOpencodeRuntimeConfig({
        orchestratorSessionId: runtime.orchestratorSessionId,
        taskSessionId,
      });
    } catch (error) {
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const live = await this.waitForRuntimeServer(runtime, serverName);
    if (!live) {
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: 'failed',
        lastError: '运行时未保留已注册的 MCP 服务',
      });
      throw new Error('运行时未保留已注册的 MCP 服务');
    }

    const statuses = await this.listSessionConnectors(taskSessionId, userId);
    const current = statuses.find((item) => item.connectorKey === connectorKey);
    await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
      runtimeStatus: current?.runtimeStatus || 'connected',
      orchestratorSessionId: runtime.orchestratorSessionId,
      serverName,
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
    await taskSessionConnectorBindingDAO.upsert({
      taskSessionId,
      connectorKey,
      desiredState: 'detached',
      runtimeStatus: runtime ? 'connecting' : 'disconnected',
      orchestratorSessionId: asText(orchestratorSessionId) || runtime?.orchestratorSessionId || null,
      serverName,
      lastError: null,
    });
    if (runtime) {
      try {
        await sandboxAgentProvisionService.syncOpencodeRuntimeConfig({
          orchestratorSessionId: runtime.orchestratorSessionId,
          taskSessionId,
        });
      } catch (error) {
        await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
          runtimeStatus: 'failed',
          orchestratorSessionId: runtime.orchestratorSessionId,
          serverName,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const removed = await this.waitForRuntimeServerAbsence(runtime, serverName);
      await taskSessionConnectorBindingDAO.updateRuntime(taskSessionId, connectorKey, {
        runtimeStatus: removed ? 'disconnected' : 'failed',
        orchestratorSessionId: runtime.orchestratorSessionId,
        serverName,
        lastError: removed ? null : '运行时仍保留已卸载的 MCP 服务',
      });
      if (!removed) {
        throw new Error('运行时仍保留已卸载的 MCP 服务');
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
        await this.attachConnector(taskSessionId, userId, binding.connectorKey as ConnectorKey, orchestratorSessionId);
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
