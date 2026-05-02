import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from '../../config/database';
import { taskSessionConnectorBindings, type NewTaskSessionConnectorBinding } from '../schema';

export function buildConnectorInstanceKey(connectorKey: string, profileId?: string | null) {
  const normalizedConnectorKey = String(connectorKey || '').trim();
  const normalizedProfileId = String(profileId || '').trim();
  if (normalizedConnectorKey === 'custom_mcp') {
    if (!normalizedProfileId) {
      throw new Error('custom_mcp_profile_required');
    }
    return `custom_mcp:${normalizedProfileId}`;
  }
  return normalizedConnectorKey;
}

type RuntimePatch = {
  profileId?: string | null;
  desiredState?: string;
  runtimeStatus?: string;
  orchestratorSessionId?: string | null;
  serverName?: string | null;
  runtimeProviderId?: string | null;
  runtimeEnvVersion?: number;
  runtimeTransport?: string | null;
  runtimeAttachedToolsJson?: unknown;
  runtimeLastStartedAt?: Date | null;
  runtimeLastStoppedAt?: Date | null;
  recoveryQueuedAt?: Date | null;
  recoveryStartedAt?: Date | null;
  recoveryCompletedAt?: Date | null;
  enabledTools?: unknown;
  sessionConfigJson?: unknown;
  definitionSnapshotJson?: unknown;
  lastUsedAt?: Date | null;
  lastError?: string | null;
};

type ConnectorBindingUpsertInput = Omit<NewTaskSessionConnectorBinding, 'connectorInstanceKey'> & {
  connectorInstanceKey?: string;
};

function normalizeBindingData(data: ConnectorBindingUpsertInput): NewTaskSessionConnectorBinding {
  const connectorInstanceKey =
    data.connectorInstanceKey || buildConnectorInstanceKey(data.connectorKey, data.profileId);
  return {
    ...data,
    connectorInstanceKey,
  };
}

function runtimePatchSet(patch: RuntimePatch) {
  return {
    profileId: patch.profileId,
    desiredState: patch.desiredState,
    runtimeStatus: patch.runtimeStatus,
    orchestratorSessionId: patch.orchestratorSessionId,
    serverName: patch.serverName,
    runtimeProviderId: patch.runtimeProviderId,
    runtimeEnvVersion: patch.runtimeEnvVersion,
    runtimeTransport: patch.runtimeTransport,
    runtimeAttachedToolsJson: patch.runtimeAttachedToolsJson as any,
    runtimeLastStartedAt: patch.runtimeLastStartedAt,
    runtimeLastStoppedAt: patch.runtimeLastStoppedAt,
    recoveryQueuedAt: patch.recoveryQueuedAt,
    recoveryStartedAt: patch.recoveryStartedAt,
    recoveryCompletedAt: patch.recoveryCompletedAt,
    enabledTools: patch.enabledTools as any,
    sessionConfigJson: patch.sessionConfigJson as any,
    definitionSnapshotJson: patch.definitionSnapshotJson as any,
    lastUsedAt: patch.lastUsedAt,
    lastError: patch.lastError,
    updatedAt: new Date(),
  };
}

export class TaskSessionConnectorBindingDAO {
  async listByTaskSessionId(taskSessionId: string) {
    return db
      .select()
      .from(taskSessionConnectorBindings)
      .where(eq(taskSessionConnectorBindings.taskSessionId, taskSessionId));
  }

  async listByProfileId(profileId: string) {
    return db
      .select()
      .from(taskSessionConnectorBindings)
      .where(eq(taskSessionConnectorBindings.profileId, profileId));
  }

  async listByConnectorKey(connectorKey: string) {
    return db
      .select()
      .from(taskSessionConnectorBindings)
      .where(eq(taskSessionConnectorBindings.connectorKey, connectorKey));
  }

  async getByTaskSessionAndConnectorKey(taskSessionId: string, connectorKey: string) {
    const [row] = await db
      .select()
      .from(taskSessionConnectorBindings)
      .where(
        and(
          eq(taskSessionConnectorBindings.taskSessionId, taskSessionId),
          eq(taskSessionConnectorBindings.connectorKey, connectorKey)
        )
      )
      .limit(1);
    return row;
  }

  async getByTaskSessionAndInstanceKey(taskSessionId: string, connectorInstanceKey: string) {
    const [row] = await db
      .select()
      .from(taskSessionConnectorBindings)
      .where(
        and(
          eq(taskSessionConnectorBindings.taskSessionId, taskSessionId),
          eq(taskSessionConnectorBindings.connectorInstanceKey, connectorInstanceKey)
        )
      )
      .limit(1);
    return row;
  }

  async getByRuntimeProviderId(taskSessionId: string, runtimeProviderId: string) {
    const [row] = await db
      .select()
      .from(taskSessionConnectorBindings)
      .where(
        and(
          eq(taskSessionConnectorBindings.taskSessionId, taskSessionId),
          eq(taskSessionConnectorBindings.runtimeProviderId, runtimeProviderId)
        )
      )
      .limit(1);
    return row;
  }

  async upsert(data: ConnectorBindingUpsertInput) {
    const normalized = normalizeBindingData(data);
    const [row] = await db
      .insert(taskSessionConnectorBindings)
      .values(normalized)
      .onConflictDoUpdate({
        target: [taskSessionConnectorBindings.taskSessionId, taskSessionConnectorBindings.connectorInstanceKey],
        set: {
          connectorKey: normalized.connectorKey,
          profileId: normalized.profileId,
          desiredState: normalized.desiredState,
          runtimeStatus: normalized.runtimeStatus,
          orchestratorSessionId: normalized.orchestratorSessionId,
          serverName: normalized.serverName,
          runtimeProviderId: normalized.runtimeProviderId,
          runtimeEnvVersion: normalized.runtimeEnvVersion,
          runtimeTransport: normalized.runtimeTransport,
          runtimeAttachedToolsJson: normalized.runtimeAttachedToolsJson,
          runtimeLastStartedAt: normalized.runtimeLastStartedAt,
          runtimeLastStoppedAt: normalized.runtimeLastStoppedAt,
          recoveryQueuedAt: normalized.recoveryQueuedAt,
          recoveryStartedAt: normalized.recoveryStartedAt,
          recoveryCompletedAt: normalized.recoveryCompletedAt,
          enabledTools: normalized.enabledTools,
          sessionConfigJson: normalized.sessionConfigJson,
          definitionSnapshotJson: normalized.definitionSnapshotJson,
          lastUsedAt: normalized.lastUsedAt,
          lastError: normalized.lastError,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async updateRuntimeByInstanceKey(taskSessionId: string, connectorInstanceKey: string, patch: RuntimePatch) {
    const [row] = await db
      .update(taskSessionConnectorBindings)
      .set(runtimePatchSet(patch))
      .where(
        and(
          eq(taskSessionConnectorBindings.taskSessionId, taskSessionId),
          eq(taskSessionConnectorBindings.connectorInstanceKey, connectorInstanceKey)
        )
      )
      .returning();
    return row;
  }

  async updateRuntimeByBindingId(bindingId: string, patch: RuntimePatch) {
    const [row] = await db
      .update(taskSessionConnectorBindings)
      .set(runtimePatchSet(patch))
      .where(eq(taskSessionConnectorBindings.id, bindingId))
      .returning();
    return row;
  }

  async updateRuntime(taskSessionId: string, connectorKey: string, patch: RuntimePatch & { profileId?: string | null }) {
    const connectorInstanceKey = buildConnectorInstanceKey(connectorKey, patch.profileId);
    return this.updateRuntimeByInstanceKey(taskSessionId, connectorInstanceKey, patch);
  }

  async listByOrchestratorSessionId(orchestratorSessionId: string) {
    return db
      .select()
      .from(taskSessionConnectorBindings)
      .where(eq(taskSessionConnectorBindings.orchestratorSessionId, orchestratorSessionId));
  }

  async listPendingRecovery(limit = 200) {
    return db
      .select()
      .from(taskSessionConnectorBindings)
      .where(
        and(
          eq(taskSessionConnectorBindings.desiredState, 'attached'),
          or(
            inArray(taskSessionConnectorBindings.runtimeStatus, ['pending_recover', 'recovering']),
            and(
              eq(taskSessionConnectorBindings.runtimeStatus, 'failed'),
              isNotNull(taskSessionConnectorBindings.recoveryQueuedAt)
            )
          )
        )
      )
      .limit(limit);
  }
}

export const taskSessionConnectorBindingDAO = new TaskSessionConnectorBindingDAO();
