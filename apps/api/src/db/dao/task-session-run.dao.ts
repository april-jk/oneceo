import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql, gt, asc } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  taskSessionRuns,
  taskSessionRunEvents,
  taskSessionSandboxBindings,
  taskSessionConnectorSnapshots,
  type NewTaskSessionRun,
} from '../schema';

export type ManagedRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'streaming'
  | 'waiting_tool'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'stopped';

function createId(id?: string) {
  return id || randomUUID();
}

export class TaskSessionRunDAO {
  async createRun(data: Partial<NewTaskSessionRun> & { sessionId: string }) {
    const [run] = await db
      .insert(taskSessionRuns)
      .values({
        id: createId(data.id),
        sessionId: data.sessionId,
        mode: data.mode || 'managed',
        status: (data.status as ManagedRunStatus | undefined) || 'queued',
        model: data.model || null,
        stopReason: data.stopReason || null,
        sandboxBindingId: data.sandboxBindingId || null,
        connectorSnapshotId: data.connectorSnapshotId || null,
        metadataJson: data.metadataJson || {},
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        updatedAt: new Date(),
      })
      .returning();
    return run;
  }

  async getRun(runId: string) {
    const [run] = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.id, runId))
      .limit(1);
    return run || null;
  }

  async getLatestRun(sessionId: string) {
    const [run] = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.sessionId, sessionId))
      .orderBy(desc(taskSessionRuns.createdAt), desc(taskSessionRuns.id))
      .limit(1);
    return run || null;
  }

  async findActiveRun(sessionId: string) {
    const [run] = await db
      .select()
      .from(taskSessionRuns)
      .where(
        and(
          eq(taskSessionRuns.sessionId, sessionId),
          inArray(taskSessionRuns.status, ['queued', 'starting', 'running', 'streaming', 'waiting_tool'])
        )
      )
      .orderBy(desc(taskSessionRuns.createdAt), desc(taskSessionRuns.id))
      .limit(1);
    return run || null;
  }

  async updateRunStatus(
    runId: string,
    status: ManagedRunStatus,
    input?: {
      stopReason?: string | null;
      metadataJson?: Record<string, unknown> | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
    }
  ) {
    const [run] = await db
      .update(taskSessionRuns)
      .set({
        status,
        stopReason: input?.stopReason ?? undefined,
        metadataJson: input?.metadataJson ?? undefined,
        startedAt: input?.startedAt ?? undefined,
        completedAt: input?.completedAt ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(taskSessionRuns.id, runId))
      .returning();
    return run || null;
  }

  async appendRunEvent(input: {
    runId: string;
    sessionId: string;
    eventType: string;
    payloadJson?: Record<string, unknown> | null;
  }) {
    const created = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          maxSequence: sql<number>`COALESCE(MAX(${taskSessionRunEvents.sequence}), 0)`,
        })
        .from(taskSessionRunEvents)
        .where(eq(taskSessionRunEvents.runId, input.runId));

      const nextSequence = Number(current?.maxSequence || 0) + 1;
      const [event] = await tx
        .insert(taskSessionRunEvents)
        .values({
          id: createId(),
          runId: input.runId,
          sessionId: input.sessionId,
          eventType: input.eventType,
          sequence: nextSequence,
          payloadJson: input.payloadJson || {},
        })
        .returning();

      return event;
    });
    return created;
  }

  async listRunEvents(runId: string, options?: { afterSequence?: number | null }) {
    const conditions = [eq(taskSessionRunEvents.runId, runId)];
    if (typeof options?.afterSequence === 'number' && Number.isFinite(options.afterSequence)) {
      conditions.push(gt(taskSessionRunEvents.sequence, Math.floor(options.afterSequence)));
    }
    return db
      .select()
      .from(taskSessionRunEvents)
      .where(and(...conditions))
      .orderBy(asc(taskSessionRunEvents.sequence), asc(taskSessionRunEvents.createdAt));
  }

  async getLatestRunEventSequence(runId: string) {
    const [row] = await db
      .select({
        maxSequence: sql<number>`COALESCE(MAX(${taskSessionRunEvents.sequence}), 0)`,
      })
      .from(taskSessionRunEvents)
      .where(eq(taskSessionRunEvents.runId, runId));
    return Number(row?.maxSequence || 0);
  }

  async upsertSandboxBinding(input: {
    sessionId: string;
    sandboxId: string;
    workspaceRoot: string;
    status?: string;
    metadataJson?: Record<string, unknown> | null;
  }) {
    const [binding] = await db
      .insert(taskSessionSandboxBindings)
      .values({
        id: createId(),
        sessionId: input.sessionId,
        sandboxId: input.sandboxId,
        workspaceRoot: input.workspaceRoot,
        status: input.status || 'ready',
        metadataJson: input.metadataJson || {},
        updatedAt: new Date(),
        lastActiveAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [taskSessionSandboxBindings.sessionId],
        set: {
          sandboxId: sql`excluded.sandbox_id`,
          workspaceRoot: sql`excluded.workspace_root`,
          status: sql`excluded.status`,
          metadataJson: sql`excluded.metadata_json`,
          updatedAt: sql`NOW()`,
          lastActiveAt: sql`NOW()`,
        },
      })
      .returning();
    return binding;
  }

  async getSandboxBindingBySession(sessionId: string) {
    const [binding] = await db
      .select()
      .from(taskSessionSandboxBindings)
      .where(eq(taskSessionSandboxBindings.sessionId, sessionId))
      .limit(1);
    return binding || null;
  }

  async touchSandboxBinding(sessionId: string, status?: string) {
    const [binding] = await db
      .update(taskSessionSandboxBindings)
      .set({
        ...(status ? { status } : {}),
        updatedAt: new Date(),
        lastActiveAt: new Date(),
      })
      .where(eq(taskSessionSandboxBindings.sessionId, sessionId))
      .returning();
    return binding || null;
  }

  async createConnectorSnapshot(input: {
    sessionId: string;
    snapshotJson: Record<string, unknown>;
  }) {
    const [snapshot] = await db
      .insert(taskSessionConnectorSnapshots)
      .values({
        id: createId(),
        sessionId: input.sessionId,
        snapshotJson: input.snapshotJson,
      })
      .returning();
    return snapshot;
  }

  async getConnectorSnapshot(snapshotId: string) {
    const [snapshot] = await db
      .select()
      .from(taskSessionConnectorSnapshots)
      .where(eq(taskSessionConnectorSnapshots.id, snapshotId))
      .limit(1);
    return snapshot || null;
  }
}

export const taskSessionRunDAO = new TaskSessionRunDAO();
