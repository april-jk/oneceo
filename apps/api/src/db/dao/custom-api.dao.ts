import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  customApiCallAuditLogs,
  customApiConfirmations,
  customApiDefinitions,
  customApiEndpointTools,
  type NewCustomApiCallAuditLog,
  type NewCustomApiConfirmation,
  type NewCustomApiDefinition,
  type NewCustomApiEndpointTool,
} from '../schema';

export class CustomApiDefinitionDAO {
  async listByOwner(ownerUserId: string) {
    return db
      .select()
      .from(customApiDefinitions)
      .where(eq(customApiDefinitions.ownerUserId, ownerUserId))
      .orderBy(desc(customApiDefinitions.updatedAt));
  }

  async getById(id: string) {
    const [row] = await db.select().from(customApiDefinitions).where(eq(customApiDefinitions.id, id)).limit(1);
    return row;
  }

  async getByIdAndOwner(id: string, ownerUserId: string) {
    const [row] = await db
      .select()
      .from(customApiDefinitions)
      .where(and(eq(customApiDefinitions.id, id), eq(customApiDefinitions.ownerUserId, ownerUserId)))
      .limit(1);
    return row;
  }

  async create(data: NewCustomApiDefinition) {
    const [row] = await db.insert(customApiDefinitions).values(data).returning();
    return row;
  }

  async update(id: string, ownerUserId: string, patch: Partial<NewCustomApiDefinition>) {
    const [row] = await db
      .update(customApiDefinitions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(customApiDefinitions.id, id), eq(customApiDefinitions.ownerUserId, ownerUserId)))
      .returning();
    return row;
  }

  async updateStatus(id: string, status: string) {
    const [row] = await db
      .update(customApiDefinitions)
      .set({ status, updatedAt: new Date() })
      .where(eq(customApiDefinitions.id, id))
      .returning();
    return row;
  }
}

export class CustomApiEndpointToolDAO {
  async listByDefinition(definitionId: string) {
    return db
      .select()
      .from(customApiEndpointTools)
      .where(eq(customApiEndpointTools.definitionId, definitionId))
      .orderBy(desc(customApiEndpointTools.updatedAt));
  }

  async listPublishedByDefinitions(definitionIds: string[]) {
    if (definitionIds.length === 0) return [];
    return db
      .select()
      .from(customApiEndpointTools)
      .where(
        and(
          inArray(customApiEndpointTools.definitionId, definitionIds as [string, ...string[]]),
          eq(customApiEndpointTools.reviewStatus, 'published')
        )
      );
  }

  async getById(id: string) {
    const [row] = await db.select().from(customApiEndpointTools).where(eq(customApiEndpointTools.id, id)).limit(1);
    return row;
  }

  async create(data: NewCustomApiEndpointTool) {
    const [row] = await db.insert(customApiEndpointTools).values(data).returning();
    return row;
  }

  async update(id: string, patch: Partial<NewCustomApiEndpointTool>) {
    const [row] = await db
      .update(customApiEndpointTools)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(customApiEndpointTools.id, id))
      .returning();
    return row;
  }

  async updateReviewStatus(
    id: string,
    input: {
      reviewStatus: string;
      reviewedBy?: string | null;
      reviewedAt?: Date | null;
      reviewNotes?: string | null;
    }
  ) {
    const [row] = await db
      .update(customApiEndpointTools)
      .set({
        reviewStatus: input.reviewStatus,
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt,
        reviewNotes: input.reviewNotes,
        updatedAt: new Date(),
      })
      .where(eq(customApiEndpointTools.id, id))
      .returning();
    return row;
  }

  async listReviewQueue() {
    return db
      .select()
      .from(customApiEndpointTools)
      .where(eq(customApiEndpointTools.reviewStatus, 'pending_review'))
      .orderBy(desc(customApiEndpointTools.updatedAt));
  }
}

export class CustomApiAuditLogDAO {
  async create(data: NewCustomApiCallAuditLog) {
    const [row] = await db.insert(customApiCallAuditLogs).values(data).returning();
    return row;
  }

  async update(id: string, patch: Partial<NewCustomApiCallAuditLog>) {
    const [row] = await db
      .update(customApiCallAuditLogs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(customApiCallAuditLogs.id, id))
      .returning();
    return row;
  }

  async list(limit = 100) {
    return db.select().from(customApiCallAuditLogs).orderBy(desc(customApiCallAuditLogs.createdAt)).limit(limit);
  }
}

export class CustomApiConfirmationDAO {
  async create(data: NewCustomApiConfirmation) {
    const [row] = await db.insert(customApiConfirmations).values(data).returning();
    return row;
  }

  async getById(id: string) {
    const [row] = await db.select().from(customApiConfirmations).where(eq(customApiConfirmations.id, id)).limit(1);
    return row;
  }
}

export const customApiDefinitionDAO = new CustomApiDefinitionDAO();
export const customApiEndpointToolDAO = new CustomApiEndpointToolDAO();
export const customApiAuditLogDAO = new CustomApiAuditLogDAO();
export const customApiConfirmationDAO = new CustomApiConfirmationDAO();
