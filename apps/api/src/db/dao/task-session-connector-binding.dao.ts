import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { taskSessionConnectorBindings, type NewTaskSessionConnectorBinding } from '../schema';

export class TaskSessionConnectorBindingDAO {
  async listByTaskSessionId(taskSessionId: string) {
    return db
      .select()
      .from(taskSessionConnectorBindings)
      .where(eq(taskSessionConnectorBindings.taskSessionId, taskSessionId));
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
}

export const taskSessionConnectorBindingDAO = new TaskSessionConnectorBindingDAO();
