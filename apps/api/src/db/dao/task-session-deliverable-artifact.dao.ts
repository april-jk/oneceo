import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  taskSessionDeliverableArtifacts,
  type NewTaskSessionDeliverableArtifact,
} from '../schema';

function createId(id?: string) {
  return id || randomUUID();
}

export class TaskSessionDeliverableArtifactDAO {
  async createMany(
    items: Array<Partial<NewTaskSessionDeliverableArtifact> & {
      sessionId: string;
      runId: string;
      sandboxId: string;
      sourcePath: string;
      displayName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      storageKey: string;
    }>
  ) {
    if (!items.length) return [];
    return db
      .insert(taskSessionDeliverableArtifacts)
      .values(
        items.map((item) => ({
          id: createId(item.id),
          sessionId: item.sessionId,
          runId: item.runId,
          sandboxId: item.sandboxId,
          sourcePath: item.sourcePath,
          displayName: item.displayName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          sha256: item.sha256,
          storageKey: item.storageKey,
          createdAt: item.createdAt || new Date(),
        }))
      )
      .returning();
  }

  async listBySession(sessionId: string, options?: { runId?: string | null }) {
    const conditions = [eq(taskSessionDeliverableArtifacts.sessionId, sessionId)];
    if (options?.runId) {
      conditions.push(eq(taskSessionDeliverableArtifacts.runId, options.runId));
    }
    return db
      .select()
      .from(taskSessionDeliverableArtifacts)
      .where(and(...conditions))
      .orderBy(desc(taskSessionDeliverableArtifacts.createdAt), asc(taskSessionDeliverableArtifacts.displayName));
  }

  async getById(id: string) {
    const [record] = await db
      .select()
      .from(taskSessionDeliverableArtifacts)
      .where(eq(taskSessionDeliverableArtifacts.id, id))
      .limit(1);
    return record || null;
  }
}

export const taskSessionDeliverableArtifactDAO = new TaskSessionDeliverableArtifactDAO();
