import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  taskSessionDeploymentSyncJobs,
  type NewTaskSessionDeploymentSyncJob,
} from '../schema';

function nextRetryFromAttempt(attemptCount: number) {
  const attempt = Math.max(1, attemptCount);
  if (attempt <= 1) return new Date(Date.now() + 10_000);
  if (attempt === 2) return new Date(Date.now() + 20_000);
  if (attempt === 3) return new Date(Date.now() + 45_000);
  return new Date(Date.now() + 120_000);
}

export class TaskSessionDeploymentSyncJobDAO {
  async upsertPending(data: NewTaskSessionDeploymentSyncJob) {
    const [row] = await db
      .insert(taskSessionDeploymentSyncJobs)
      .values(data)
      .onConflictDoUpdate({
        target: [taskSessionDeploymentSyncJobs.syncKey],
        set: {
          taskSessionId: data.taskSessionId,
          orchestratorSessionId: data.orchestratorSessionId,
          jobType: data.jobType,
          status: 'pending',
          payloadJson: data.payloadJson || {},
          attemptCount: 0,
          lastError: null,
          nextRetryAt: data.nextRetryAt ?? null,
          startedAt: null,
          completedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async listRunnable(limit = 100) {
    return db
      .select()
      .from(taskSessionDeploymentSyncJobs)
      .where(
        or(
          and(
            eq(taskSessionDeploymentSyncJobs.status, 'pending'),
            or(
              isNull(taskSessionDeploymentSyncJobs.nextRetryAt),
              lte(taskSessionDeploymentSyncJobs.nextRetryAt, new Date())
            )
          ),
          and(
            eq(taskSessionDeploymentSyncJobs.status, 'failed'),
            or(
              isNull(taskSessionDeploymentSyncJobs.nextRetryAt),
              lte(taskSessionDeploymentSyncJobs.nextRetryAt, new Date())
            )
          ),
          eq(taskSessionDeploymentSyncJobs.status, 'running')
        )
      )
      .orderBy(asc(taskSessionDeploymentSyncJobs.createdAt))
      .limit(limit);
  }

  async markRunning(id: string, attemptCount: number) {
    const [row] = await db
      .update(taskSessionDeploymentSyncJobs)
      .set({
        status: 'running',
        attemptCount,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionDeploymentSyncJobs.id, id))
      .returning();
    return row || null;
  }

  async markCompleted(id: string) {
    const [row] = await db
      .update(taskSessionDeploymentSyncJobs)
      .set({
        status: 'completed',
        lastError: null,
        nextRetryAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionDeploymentSyncJobs.id, id))
      .returning();
    return row || null;
  }

  async markFailed(id: string, attemptCount: number, lastError: string) {
    const [row] = await db
      .update(taskSessionDeploymentSyncJobs)
      .set({
        status: 'failed',
        attemptCount,
        lastError,
        nextRetryAt: nextRetryFromAttempt(attemptCount),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionDeploymentSyncJobs.id, id))
      .returning();
    return row || null;
  }

  async listActiveByTaskSession(taskSessionId: string) {
    return db
      .select()
      .from(taskSessionDeploymentSyncJobs)
      .where(
        and(
          eq(taskSessionDeploymentSyncJobs.taskSessionId, taskSessionId),
          inArray(taskSessionDeploymentSyncJobs.status, ['pending', 'running', 'failed'])
        )
      )
      .orderBy(asc(taskSessionDeploymentSyncJobs.createdAt));
  }

  async getBySyncKey(syncKey: string) {
    const [row] = await db
      .select()
      .from(taskSessionDeploymentSyncJobs)
      .where(eq(taskSessionDeploymentSyncJobs.syncKey, syncKey))
      .limit(1);
    return row || null;
  }
}

export const taskSessionDeploymentSyncJobDAO = new TaskSessionDeploymentSyncJobDAO();
