import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from '../../config/database';
import { taskSessionConnectorBindings, type NewTaskSessionConnectorBinding } from '../schema';

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

  async upsert(data: NewTaskSessionConnectorBinding) {
    const [row] = await db
      .insert(taskSessionConnectorBindings)
      .values(data)
      .onConflictDoUpdate({
        target: [taskSessionConnectorBindings.taskSessionId, taskSessionConnectorBindings.connectorKey],
        set: {
          profileId: data.profileId,
          desiredState: data.desiredState,
        runtimeStatus: data.runtimeStatus,
        orchestratorSessionId: data.orchestratorSessionId,
        serverName: data.serverName,
        runtimeProviderId: data.runtimeProviderId,
        runtimeEnvVersion: data.runtimeEnvVersion,
        runtimeTransport: data.runtimeTransport,
        runtimeAttachedToolsJson: data.runtimeAttachedToolsJson,
        runtimeLastStartedAt: data.runtimeLastStartedAt,
        runtimeLastStoppedAt: data.runtimeLastStoppedAt,
        recoveryQueuedAt: data.recoveryQueuedAt,
        recoveryStartedAt: data.recoveryStartedAt,
        recoveryCompletedAt: data.recoveryCompletedAt,
        enabledTools: data.enabledTools,
        sessionConfigJson: data.sessionConfigJson,
        definitionSnapshotJson: data.definitionSnapshotJson,
          lastUsedAt: data.lastUsedAt,
          lastError: data.lastError,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async updateRuntime(
    taskSessionId: string,
    connectorKey: string,
    patch: {
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
    }
  ) {
    const [row] = await db
      .update(taskSessionConnectorBindings)
      .set({
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
      })
      .where(
        and(
          eq(taskSessionConnectorBindings.taskSessionId, taskSessionId),
          eq(taskSessionConnectorBindings.connectorKey, connectorKey)
        )
      )
      .returning();
    return row;
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
