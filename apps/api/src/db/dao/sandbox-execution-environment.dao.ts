import { db } from '../../config/database';
import { sandboxExecutionEnvironments, type NewSandboxExecutionEnvironment } from '../schema';
import { eq, desc, sql } from 'drizzle-orm';

type SandboxExecutionEnvironmentRecord = Awaited<ReturnType<SandboxExecutionEnvironmentDAO['getBySessionId']>>;

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalTaskSessionEnvironmentScore(
  environment: SandboxExecutionEnvironmentRecord | undefined | null
) {
  if (!environment) return -1;

  const metadata = (environment.metadata || {}) as Record<string, unknown>;
  const replacementSandboxId = asText(metadata.dedupeReplacementSandboxId);

  if (environment.status === 'ready' && !replacementSandboxId) return 5;
  if (environment.status === 'creating' && !replacementSandboxId) return 4;
  if (environment.status === 'closing' && !replacementSandboxId) return 3;
  if (environment.status !== 'closed' && !replacementSandboxId) return 2;
  if (environment.status === 'closed' && !replacementSandboxId) return 1;
  return 0;
}

export function pickCanonicalTaskSessionEnvironment<T extends {
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}>(environments: T[]): T | null {
  const items = Array.isArray(environments) ? environments : [];
  if (items.length === 0) return null;

  return (
    [...items].sort((left, right) => {
      const scoreDelta =
        canonicalTaskSessionEnvironmentScore(right as SandboxExecutionEnvironmentRecord) -
        canonicalTaskSessionEnvironmentScore(left as SandboxExecutionEnvironmentRecord);
      if (scoreDelta !== 0) return scoreDelta;

      const createdDelta =
        new Date(right.createdAt || 0).getTime() -
        new Date(left.createdAt || 0).getTime();
      if (createdDelta !== 0) return createdDelta;

      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    })[0] || null
  );
}

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

  async findCanonicalByTaskSessionId(taskSessionId: string) {
    const environments = await this.listByTaskSessionId(taskSessionId, 200);
    return pickCanonicalTaskSessionEnvironment(environments);
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
