import { db } from '../../config/database';
import { sandboxExecutionEnvironments, type NewSandboxExecutionEnvironment } from '../schema';
import { eq, desc } from 'drizzle-orm';

export class SandboxExecutionEnvironmentDAO {
  async createEnvironment(data: NewSandboxExecutionEnvironment) {
    const [row] = await db.insert(sandboxExecutionEnvironments).values(data).returning();
    return row;
  }

  async getBySessionId(sessionId: string) {
    const [row] = await db
      .select()
      .from(sandboxExecutionEnvironments)
      .where(eq(sandboxExecutionEnvironments.sessionId, sessionId));
    return row;
  }

  async listRecent(limit: number = 20) {
    return db
      .select()
      .from(sandboxExecutionEnvironments)
      .orderBy(desc(sandboxExecutionEnvironments.createdAt))
      .limit(limit);
  }

  async listByStatus(status: 'creating' | 'ready' | 'closing' | 'closed' | 'failed', limit: number = 200) {
    return db
      .select()
      .from(sandboxExecutionEnvironments)
      .where(eq(sandboxExecutionEnvironments.status, status))
      .orderBy(desc(sandboxExecutionEnvironments.updatedAt))
      .limit(limit);
  }

  async findLatestByVmName(vmName: string) {
    const [row] = await db
      .select()
      .from(sandboxExecutionEnvironments)
      .where(eq(sandboxExecutionEnvironments.vmName, vmName))
      .orderBy(desc(sandboxExecutionEnvironments.updatedAt))
      .limit(1);
    return row;
  }

  async updateStatus(
    sessionId: string,
    status: 'creating' | 'ready' | 'closing' | 'closed' | 'failed',
    vmName?: string | null
  ) {
    const [row] = await db
      .update(sandboxExecutionEnvironments)
      .set({
        status,
        vmName: vmName === undefined ? undefined : vmName,
        updatedAt: new Date(),
        closedAt: status === 'closed' ? new Date() : null,
      })
      .where(eq(sandboxExecutionEnvironments.sessionId, sessionId))
      .returning();

    return row;
  }

  async updateMetadata(sessionId: string, metadata: Record<string, unknown>) {
    const [row] = await db
      .update(sandboxExecutionEnvironments)
      .set({
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(sandboxExecutionEnvironments.sessionId, sessionId))
      .returning();

    return row;
  }
}

export const sandboxExecutionEnvironmentDAO = new SandboxExecutionEnvironmentDAO();
