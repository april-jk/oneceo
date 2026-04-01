import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../../config/database';
import { taskSessionMcpRecoveryJobs, type NewTaskSessionMcpRecoveryJob } from '../schema';

function nextRetryFromAttempt(attemptCount: number) {
  const attempt = Math.max(1, attemptCount);
  if (attempt <= 1) return new Date(Date.now() + 30_000);
  if (attempt === 2) return new Date(Date.now() + 2 * 60_000);
  if (attempt === 3) return new Date(Date.now() + 5 * 60_000);
  return new Date(Date.now() + 15 * 60_000);
}

export class TaskSessionMcpRecoveryJobDAO {
  async upsertPending(data: NewTaskSessionMcpRecoveryJob) {
    const [row] = await db
      .insert(taskSessionMcpRecoveryJobs)
      .values(data)
      .onConflictDoUpdate({
        target: [taskSessionMcpRecoveryJobs.recoveryKey],
        set: {
          taskSessionId: data.taskSessionId,
          orchestratorSessionId: data.orchestratorSessionId,
          jobType: data.jobType,
          status: 'pending',
          payloadJson: data.payloadJson || {},
          lastError: null,
          nextRetryAt: null,
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
      .from(taskSessionMcpRecoveryJobs)
      .where(
        or(
          eq(taskSessionMcpRecoveryJobs.status, 'pending'),
          and(
            eq(taskSessionMcpRecoveryJobs.status, 'failed'),
            or(
              isNull(taskSessionMcpRecoveryJobs.nextRetryAt),
              lte(taskSessionMcpRecoveryJobs.nextRetryAt, new Date())
            )
          ),
          eq(taskSessionMcpRecoveryJobs.status, 'running')
        )
      )
      .orderBy(asc(taskSessionMcpRecoveryJobs.createdAt))
      .limit(limit);
  }

  async markRunning(id: string, attemptCount: number) {
    const [row] = await db
      .update(taskSessionMcpRecoveryJobs)
      .set({
        status: 'running',
        attemptCount,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionMcpRecoveryJobs.id, id))
      .returning();
    return row || null;
  }

  async markCompleted(id: string) {
    const [row] = await db
      .update(taskSessionMcpRecoveryJobs)
      .set({
        status: 'completed',
        lastError: null,
        nextRetryAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionMcpRecoveryJobs.id, id))
      .returning();
    return row || null;
  }

  async markFailed(id: string, attemptCount: number, lastError: string) {
    const [row] = await db
      .update(taskSessionMcpRecoveryJobs)
      .set({
        status: 'failed',
        attemptCount,
        lastError,
        nextRetryAt: nextRetryFromAttempt(attemptCount),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionMcpRecoveryJobs.id, id))
      .returning();
    return row || null;
  }

  async listActiveByTaskSession(taskSessionId: string) {
    return db
      .select()
      .from(taskSessionMcpRecoveryJobs)
      .where(
        and(
          eq(taskSessionMcpRecoveryJobs.taskSessionId, taskSessionId),
          inArray(taskSessionMcpRecoveryJobs.status, ['pending', 'running', 'failed'])
        )
      )
      .orderBy(asc(taskSessionMcpRecoveryJobs.createdAt));
  }
}

export const taskSessionMcpRecoveryJobDAO = new TaskSessionMcpRecoveryJobDAO();
