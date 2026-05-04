import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  taskSessionMcpToolConfirmations,
  type NewTaskSessionMcpToolConfirmation,
} from '../schema';

export class TaskSessionMcpToolConfirmationDAO {
  async create(data: NewTaskSessionMcpToolConfirmation) {
    const [row] = await db.insert(taskSessionMcpToolConfirmations).values(data).returning();
    return row;
  }

  async getById(id: string) {
    const [row] = await db
      .select()
      .from(taskSessionMcpToolConfirmations)
      .where(eq(taskSessionMcpToolConfirmations.id, id))
      .limit(1);
    return row;
  }

  async getByTokenHash(tokenHash: string) {
    const [row] = await db
      .select()
      .from(taskSessionMcpToolConfirmations)
      .where(eq(taskSessionMcpToolConfirmations.confirmationTokenHash, tokenHash))
      .limit(1);
    return row;
  }

  async updateStatus(
    id: string,
    patch: {
      status: string;
      confirmationTokenHash?: string | null;
      approvedAt?: Date | null;
      consumedAt?: Date | null;
    }
  ) {
    const [row] = await db
      .update(taskSessionMcpToolConfirmations)
      .set({
        status: patch.status,
        confirmationTokenHash: patch.confirmationTokenHash,
        approvedAt: patch.approvedAt,
        consumedAt: patch.consumedAt,
        updatedAt: new Date(),
      })
      .where(eq(taskSessionMcpToolConfirmations.id, id))
      .returning();
    return row;
  }

  async markRejected(id: string, appUserId: string, taskSessionId: string) {
    const [row] = await db
      .update(taskSessionMcpToolConfirmations)
      .set({
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taskSessionMcpToolConfirmations.id, id),
          eq(taskSessionMcpToolConfirmations.appUserId, appUserId),
          eq(taskSessionMcpToolConfirmations.taskSessionId, taskSessionId)
        )
      )
      .returning();
    return row;
  }
}

export const taskSessionMcpToolConfirmationDAO = new TaskSessionMcpToolConfirmationDAO();
