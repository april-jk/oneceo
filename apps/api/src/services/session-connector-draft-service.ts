import { taskCreationSessionDAO, taskSessionConnectorBindingDAO, taskSessionRunDAO } from '../db/dao';
import { type ConnectorKey, connectorRegistry, CONNECTOR_KEYS } from './connector-registry';
import { redisClientService, type RedisCommandPort } from './redis-client-service';
import { deriveTenantKeyForRedis, redisKeyspace, redisTtlSeconds } from './redis-keyspace';
import { userConnectorService } from './user-connector-service';
import { sessionMcpRecoveryService } from './session-mcp-recovery-service';
import { connectorGuideService } from './connector-guide-service';
import { taskSessionRedisCacheService } from './task-session-redis-cache-service';
import { writeConnectorDebugLog } from '../utils/connector-debug-log';

const CONNECTOR_DRAFT_TTL_SECONDS = 24 * 60 * 60;

type DraftEntry = {
  connectorKey: ConnectorKey;
  profileId?: string | null;
  desiredState?: 'attached' | 'detached';
  enabledTools?: string[];
  sessionConfig?: Record<string, unknown> | null;
  updatedAt?: string;
};

type DraftPayload = {
  draftId: string;
  userId: string;
  entries: DraftEntry[];
  updatedAt: string;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asConnectorKey(value: unknown): ConnectorKey | null {
  const key = asText(value);
  if (!key) return null;
  if (!(CONNECTOR_KEYS as readonly string[]).includes(key)) return null;
  return key as ConnectorKey;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeEntries(entries: unknown): DraftEntry[] {
  if (!Array.isArray(entries)) return [];
  const dedup = new Map<ConnectorKey, DraftEntry>();
  for (const raw of entries) {
    const record = asObject(raw);
    const connectorKey = asConnectorKey(record.connectorKey);
    if (!connectorKey) continue;
    const desiredState = asText(record.desiredState) === 'detached' ? 'detached' : 'attached';
    const profileId = asText(record.profileId) || null;
    const enabledTools = Array.isArray(record.enabledTools)
      ? record.enabledTools.map((item) => asText(item)).filter(Boolean)
      : [];
    const sessionConfig = asObject(record.sessionConfig);
    dedup.set(connectorKey, {
      connectorKey,
      profileId,
      desiredState,
      enabledTools,
      sessionConfig: Object.keys(sessionConfig).length > 0 ? sessionConfig : null,
      updatedAt: new Date().toISOString(),
    });
  }
  return Array.from(dedup.values());
}

function connectorDraftKey(userId: string, draftId: string) {
  return redisKeyspace.connectorDraft({
    tenantKey: deriveTenantKeyForRedis(userId),
    userId,
    draftId,
  });
}

function serverNameFor(connectorKey: ConnectorKey, taskSessionId: string) {
  return `${connectorKey}--${taskSessionId}`;
}

function providerIdFor(taskSessionId: string, connectorKey: ConnectorKey, profileId: string) {
  return `task_session:${taskSessionId}:connector:${connectorKey}:profile:${profileId}`;
}

export class SessionConnectorDraftService {
  constructor(private readonly redis: RedisCommandPort = redisClientService) {}

  isRedisEnabled() {
    return this.redis.isEnabled();
  }

  async getDraft(userId: string, draftId: string): Promise<DraftPayload | null> {
    if (!this.redis.isEnabled()) return null;
    const key = connectorDraftKey(userId, draftId);
    const cached = await this.redis.getJson<DraftPayload>(key);
    if (!cached) return null;
    return {
      draftId,
      userId,
      entries: normalizeEntries(cached.entries),
      updatedAt: asText(cached.updatedAt) || new Date().toISOString(),
    };
  }

  async saveDraft(input: {
    userId: string;
    draftId: string;
    entries: unknown;
  }) {
    const userId = asText(input.userId);
    const draftId = asText(input.draftId);
    if (!userId) throw new Error('userId 不能为空');
    if (!draftId) throw new Error('draftId 不能为空');
    const entries = normalizeEntries(input.entries);
    const payload: DraftPayload = {
      draftId,
      userId,
      entries,
      updatedAt: new Date().toISOString(),
    };

    if (this.redis.isEnabled()) {
      const key = connectorDraftKey(userId, draftId);
      await this.redis.setJson(
        key,
        payload,
        redisTtlSeconds.connectorDraft || CONNECTOR_DRAFT_TTL_SECONDS
      );
    }

    return {
      draftId,
      entryCount: entries.length,
      redisEnabled: this.redis.isEnabled(),
      updatedAt: payload.updatedAt,
    };
  }

  async clearDraft(userId: string, draftId: string) {
    if (!this.redis.isEnabled()) {
      return { deleted: false, redisEnabled: false };
    }
    await this.redis.delete(connectorDraftKey(userId, draftId));
    return { deleted: true, redisEnabled: true };
  }

  async applyDraftToSession(input: {
    userId: string;
    draftId: string;
    taskSessionId: string;
    entries?: unknown;
  }) {
    const userId = asText(input.userId);
    const draftId = asText(input.draftId);
    const taskSessionId = asText(input.taskSessionId);
    if (!userId) throw new Error('userId 不能为空');
    if (!draftId) throw new Error('draftId 不能为空');
    if (!taskSessionId) throw new Error('taskSessionId 不能为空');

    const session = await taskCreationSessionDAO.getSession(taskSessionId);
    if (!session) {
      throw new Error('会话不存在');
    }
    if (!session.userId || asText(session.userId) !== userId) {
      throw new Error('当前用户无权管理该会话连接器');
    }

    const redisDraft = await this.getDraft(userId, draftId);
    const entries = normalizeEntries(redisDraft?.entries || input.entries || []);
    if (entries.length === 0) {
      return {
        taskSessionId,
        draftId,
        accepted: 0,
        redisEnabled: this.redis.isEnabled(),
        runtimeQueued: false,
      };
    }

    const now = new Date();
    let accepted = 0;
    for (const entry of entries) {
      const catalogItem = connectorRegistry.getCatalogItem(entry.connectorKey);
      const desiredState = entry.desiredState === 'detached' ? 'detached' : 'attached';
      if (desiredState === 'detached') {
        await taskSessionConnectorBindingDAO.upsert({
          taskSessionId,
          connectorKey: entry.connectorKey,
          profileId: null,
          desiredState: 'detached',
          runtimeStatus: 'detached',
          orchestratorSessionId: null,
          serverName: serverNameFor(entry.connectorKey, taskSessionId),
          runtimeProviderId: null,
          runtimeAttachedToolsJson: [],
          runtimeLastStoppedAt: now,
          recoveryQueuedAt: null,
          recoveryStartedAt: null,
          recoveryCompletedAt: null,
          enabledTools: [],
          sessionConfigJson: null,
          definitionSnapshotJson: catalogItem,
          lastError: null,
        });
        accepted += 1;
        continue;
      }

      const profileId = asText(entry.profileId);
      if (!profileId) {
        continue;
      }
      const profileMaterial = await userConnectorService.getProfileMaterial(userId, profileId);
      if (!profileMaterial || profileMaterial.connectorKey !== entry.connectorKey) {
        continue;
      }

      await taskSessionConnectorBindingDAO.upsert({
        taskSessionId,
        connectorKey: entry.connectorKey,
        profileId,
        desiredState: 'attached',
        runtimeStatus: 'pending_recover',
        orchestratorSessionId: null,
        serverName: serverNameFor(entry.connectorKey, taskSessionId),
        runtimeProviderId: providerIdFor(taskSessionId, entry.connectorKey, profileId),
        runtimeAttachedToolsJson: [],
        runtimeLastStoppedAt: now,
        recoveryQueuedAt: now,
        recoveryStartedAt: null,
        recoveryCompletedAt: null,
        enabledTools: Array.isArray(entry.enabledTools) ? entry.enabledTools : [],
        sessionConfigJson: entry.sessionConfig || null,
        definitionSnapshotJson: catalogItem,
        lastError: 'sandbox_not_ready_pending_recover',
      });
      accepted += 1;
    }

    await connectorGuideService.recomputeSessionGuides(taskSessionId).catch(() => null);
    await taskSessionRedisCacheService.invalidateConnectorProjectionBySessionId(taskSessionId).catch(() => null);

    const sandboxBinding = await taskSessionRunDAO.getSandboxBindingBySession(taskSessionId).catch(() => null);
    const orchestratorSessionId = asText(sandboxBinding?.sandboxId);
    let runtimeQueued = false;
    if (orchestratorSessionId) {
      runtimeQueued = true;
      void sessionMcpRecoveryService.ensureSessionRecovered(taskSessionId, orchestratorSessionId).catch((error) => {
        writeConnectorDebugLog(
          '[CONNECTOR_DRAFT_APPLY_RECOVERY_FAILED]',
          {
            taskSessionId,
            draftId,
            orchestratorSessionId,
            error: error instanceof Error ? error.message : String(error),
          },
          'error'
        );
      });
    }

    writeConnectorDebugLog('[CONNECTOR_DRAFT_APPLY_ACCEPTED]', {
      taskSessionId,
      draftId,
      accepted,
      runtimeQueued,
      redisEnabled: this.redis.isEnabled(),
    });

    return {
      taskSessionId,
      draftId,
      accepted,
      runtimeQueued,
      redisEnabled: this.redis.isEnabled(),
    };
  }
}

export const sessionConnectorDraftService = new SessionConnectorDraftService();
