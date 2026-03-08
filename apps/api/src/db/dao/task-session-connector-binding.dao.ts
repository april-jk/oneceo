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
          desiredState: data.desiredState,
          runtimeStatus: data.runtimeStatus,
          orchestratorSessionId: data.orchestratorSessionId,
          serverName: data.serverName,
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
      desiredState?: string;
      runtimeStatus?: string;
      orchestratorSessionId?: string | null;
      serverName?: string | null;
      lastUsedAt?: Date | null;
      lastError?: string | null;
    }
  ) {
    const [row] = await db
      .update(taskSessionConnectorBindings)
      .set({
        desiredState: patch.desiredState,
        runtimeStatus: patch.runtimeStatus,
        orchestratorSessionId: patch.orchestratorSessionId,
        serverName: patch.serverName,
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
