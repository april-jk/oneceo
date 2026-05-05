import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  taskSessionMcpToolConfirmations,
  type NewTaskSessionMcpToolConfirmation,
} from '../schema';

export type McpToolConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'consumed';

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

  async findReusablePending(input: {
    appUserId: string;
    taskSessionId: string;
    agentRunId?: string | null;
    connectorKey: string;
    toolName: string;
    argumentsHash: string;
    now?: Date;
  }) {
    const now = input.now || new Date();
    const [row] = await db
      .select()
      .from(taskSessionMcpToolConfirmations)
      .where(
        and(
          eq(taskSessionMcpToolConfirmations.appUserId, input.appUserId),
          eq(taskSessionMcpToolConfirmations.taskSessionId, input.taskSessionId),
          input.agentRunId
            ? eq(taskSessionMcpToolConfirmations.agentRunId, input.agentRunId)
            : isNull(taskSessionMcpToolConfirmations.agentRunId),
          eq(taskSessionMcpToolConfirmations.connectorKey, input.connectorKey),
          eq(taskSessionMcpToolConfirmations.toolName, input.toolName),
          eq(taskSessionMcpToolConfirmations.argumentsHash, input.argumentsHash),
          eq(taskSessionMcpToolConfirmations.status, 'pending'),
          gt(taskSessionMcpToolConfirmations.expiresAt, now)
        )
      )
      .limit(1);
    return row;
  }

  async updateStatus(
    id: string,
    patch: {
      status: McpToolConfirmationStatus;
      confirmationTokenHash?: string | null;
      approvedAt?: Date | null;
      consumedAt?: Date | null;
      expiresAt?: Date;
    }
  ) {
    const [row] = await db
      .update(taskSessionMcpToolConfirmations)
      .set({
        status: patch.status,
        ...(patch.confirmationTokenHash !== undefined
          ? { confirmationTokenHash: patch.confirmationTokenHash }
          : {}),
        ...(patch.approvedAt !== undefined ? { approvedAt: patch.approvedAt } : {}),
        ...(patch.consumedAt !== undefined ? { consumedAt: patch.consumedAt } : {}),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(taskSessionMcpToolConfirmations.id, id))
      .returning();
    return row;
  }

  async consumeApprovedToken(input: {
    tokenHash: string;
    appUserId: string;
    taskSessionId: string;
    agentRunId?: string | null;
    connectorKey: string;
    toolName: string;
    argumentsHash: string;
    now?: Date;
  }) {
    const now = input.now || new Date();
    const [row] = await db
      .update(taskSessionMcpToolConfirmations)
      .set({
        status: 'consumed',
        consumedAt: now,
        confirmationTokenHash: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskSessionMcpToolConfirmations.confirmationTokenHash, input.tokenHash),
          eq(taskSessionMcpToolConfirmations.status, 'approved'),
          eq(taskSessionMcpToolConfirmations.appUserId, input.appUserId),
          eq(taskSessionMcpToolConfirmations.taskSessionId, input.taskSessionId),
          input.agentRunId
            ? eq(taskSessionMcpToolConfirmations.agentRunId, input.agentRunId)
            : isNull(taskSessionMcpToolConfirmations.agentRunId),
          eq(taskSessionMcpToolConfirmations.connectorKey, input.connectorKey),
          eq(taskSessionMcpToolConfirmations.toolName, input.toolName),
          eq(taskSessionMcpToolConfirmations.argumentsHash, input.argumentsHash),
          gt(taskSessionMcpToolConfirmations.expiresAt, now)
        )
      )
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
