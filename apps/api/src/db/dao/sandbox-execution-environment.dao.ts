import { db } from '../../config/database';
import { sandboxExecutionEnvironments, type NewSandboxExecutionEnvironment } from '../schema';
import { eq, desc, sql } from 'drizzle-orm';

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
      .select({
        id: sandboxExecutionEnvironments.id,
        sessionId: sandboxExecutionEnvironments.sessionId,
        orchestratorSessionId: sandboxExecutionEnvironments.orchestratorSessionId,
        vmName: sandboxExecutionEnvironments.vmName,
        baseImage: sandboxExecutionEnvironments.baseImage,
        status: sandboxExecutionEnvironments.status,
        metadata: sandboxExecutionEnvironments.metadata,
        createdAt: sandboxExecutionEnvironments.createdAt,
        updatedAt: sandboxExecutionEnvironments.updatedAt,
        closedAt: sandboxExecutionEnvironments.closedAt,
      })
      .from(sandboxExecutionEnvironments)
      .orderBy(desc(sandboxExecutionEnvironments.createdAt))
      .limit(limit);
  }

  async listByTaskSessionId(taskSessionId: string, limit: number = 200) {
    return db
      .select()
      .from(sandboxExecutionEnvironments)
      .where(sql`${sandboxExecutionEnvironments.metadata} ->> 'taskSessionId' = ${taskSessionId}`)
      .orderBy(desc(sandboxExecutionEnvironments.updatedAt), desc(sandboxExecutionEnvironments.createdAt))
      .limit(limit);
  }

  async listRecentRegistry(limit: number = 20) {
    const metadata = sql<Record<string, unknown>>`
      jsonb_strip_nulls(
        jsonb_build_object(
          'taskSessionId', ${sandboxExecutionEnvironments.metadata} -> 'taskSessionId',
          'sandboxExecutor', ${sandboxExecutionEnvironments.metadata} -> 'sandboxExecutor',
          'executor', ${sandboxExecutionEnvironments.metadata} -> 'executor',
          'driver', ${sandboxExecutionEnvironments.metadata} -> 'driver',
          'codexExecutionMode', ${sandboxExecutionEnvironments.metadata} -> 'codexExecutionMode',
          'codexMode', ${sandboxExecutionEnvironments.metadata} -> 'codexMode',
          'archiveStatus', ${sandboxExecutionEnvironments.metadata} -> 'archiveStatus',
          'archiveDirty', ${sandboxExecutionEnvironments.metadata} -> 'archiveDirty',
          'pendingArchiveUpdate', ${sandboxExecutionEnvironments.metadata} -> 'pendingArchiveUpdate',
          'lastActiveAt', ${sandboxExecutionEnvironments.metadata} -> 'lastActiveAt',
          'lastActiveReason', ${sandboxExecutionEnvironments.metadata} -> 'lastActiveReason',
          'dedupeReplacedAt', ${sandboxExecutionEnvironments.metadata} -> 'dedupeReplacedAt',
          'dedupeReason', ${sandboxExecutionEnvironments.metadata} -> 'dedupeReason',
          'dedupeReplacementSandboxId', ${sandboxExecutionEnvironments.metadata} -> 'dedupeReplacementSandboxId',
          'opencodeBaseUrl', ${sandboxExecutionEnvironments.metadata} -> 'opencodeBaseUrl',
          'osacEndpoint', ${sandboxExecutionEnvironments.metadata} -> 'osacEndpoint',
          'osacHostPort', ${sandboxExecutionEnvironments.metadata} -> 'osacHostPort',
          'osacPort', ${sandboxExecutionEnvironments.metadata} -> 'osacPort',
          'trafficAccessToken', ${sandboxExecutionEnvironments.metadata} -> 'trafficAccessToken',
          'e2b',
            jsonb_strip_nulls(
              jsonb_build_object(
                'template', ${sandboxExecutionEnvironments.metadata} -> 'e2b' -> 'template',
                'trafficAccessToken', ${sandboxExecutionEnvironments.metadata} -> 'e2b' -> 'trafficAccessToken'
              )
            )
        )
      )
    `;

    return db
      .select({
        id: sandboxExecutionEnvironments.id,
        sessionId: sandboxExecutionEnvironments.sessionId,
        orchestratorSessionId: sandboxExecutionEnvironments.orchestratorSessionId,
        vmName: sandboxExecutionEnvironments.vmName,
        baseImage: sandboxExecutionEnvironments.baseImage,
        status: sandboxExecutionEnvironments.status,
        metadata,
        createdAt: sandboxExecutionEnvironments.createdAt,
        updatedAt: sandboxExecutionEnvironments.updatedAt,
        closedAt: sandboxExecutionEnvironments.closedAt,
      })
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
