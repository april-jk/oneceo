import { and, desc, eq, ilike, inArray, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  connectorGuidePolicies,
  connectorGuideRevisions,
  taskSessionConnectorGuides,
  type NewConnectorGuidePolicy,
  type NewConnectorGuideRevision,
  type NewTaskSessionConnectorGuide,
} from '../schema';

export class ConnectorGuideDAO {
  listPolicies(filters?: { connectorKey?: string; status?: string; query?: string }) {
    const conditions: SQL<unknown>[] = [];
    if (filters?.connectorKey) {
      conditions.push(eq(connectorGuidePolicies.connectorKey, filters.connectorKey));
    }
    if (filters?.status) {
      conditions.push(eq(connectorGuidePolicies.status, filters.status));
    }
    if (filters?.query) {
      conditions.push(ilike(connectorGuidePolicies.connectorKey, `%${filters.query}%`));
    }
    return db
      .select()
      .from(connectorGuidePolicies)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(connectorGuidePolicies.connectorKey);
  }

  async getPolicy(policyId: string) {
    const [row] = await db
      .select()
      .from(connectorGuidePolicies)
      .where(eq(connectorGuidePolicies.id, policyId))
      .limit(1);
    return row;
  }

  async getPolicyByConnectorKey(connectorKey: string) {
    const [row] = await db
      .select()
      .from(connectorGuidePolicies)
      .where(eq(connectorGuidePolicies.connectorKey, connectorKey))
      .limit(1);
    return row;
  }

  async createPolicy(data: NewConnectorGuidePolicy) {
    const [row] = await db.insert(connectorGuidePolicies).values(data).returning();
    return row;
  }

  async updatePolicy(policyId: string, patch: Partial<NewConnectorGuidePolicy>) {
    const [row] = await db
      .update(connectorGuidePolicies)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(connectorGuidePolicies.id, policyId))
      .returning();
    return row;
  }

  listRevisions(policyId: string) {
    return db
      .select()
      .from(connectorGuideRevisions)
      .where(eq(connectorGuideRevisions.policyId, policyId))
      .orderBy(desc(connectorGuideRevisions.versionNumber), desc(connectorGuideRevisions.createdAt));
  }

  async getRevision(policyId: string, revisionId: string) {
    const [row] = await db
      .select()
      .from(connectorGuideRevisions)
      .where(
        and(
          eq(connectorGuideRevisions.id, revisionId),
          eq(connectorGuideRevisions.policyId, policyId)
        )
      )
      .limit(1);
    return row;
  }

  async getLatestRevision(policyId: string) {
    const [row] = await db
      .select()
      .from(connectorGuideRevisions)
      .where(eq(connectorGuideRevisions.policyId, policyId))
      .orderBy(desc(connectorGuideRevisions.versionNumber))
      .limit(1);
    return row;
  }

  async createRevision(data: NewConnectorGuideRevision) {
    const [row] = await db.insert(connectorGuideRevisions).values(data).returning();
    return row;
  }

  async updateRevision(policyId: string, revisionId: string, patch: Partial<NewConnectorGuideRevision>) {
    const [row] = await db
      .update(connectorGuideRevisions)
      .set({
        ...patch,
      })
      .where(
        and(
          eq(connectorGuideRevisions.id, revisionId),
          eq(connectorGuideRevisions.policyId, policyId)
        )
      )
      .returning();
    return row;
  }

  async publishRevision(policyId: string, revisionId: string) {
    return db.transaction(async (tx) => {
      const [revision] = await tx
        .update(connectorGuideRevisions)
        .set({
          status: 'published',
          publishedAt: new Date(),
        })
        .where(
          and(
            eq(connectorGuideRevisions.id, revisionId),
            eq(connectorGuideRevisions.policyId, policyId)
          )
        )
        .returning();

      await tx
        .update(connectorGuideRevisions)
        .set({
          status: 'archived',
        })
        .where(
          and(
            eq(connectorGuideRevisions.policyId, policyId),
            ne(connectorGuideRevisions.id, revisionId),
            eq(connectorGuideRevisions.status, 'published')
          )
        );

      const [policy] = await tx
        .update(connectorGuidePolicies)
        .set({
          status: 'active',
          publishedRevisionId: revisionId,
          updatedAt: new Date(),
        })
        .where(eq(connectorGuidePolicies.id, policyId))
        .returning();

      return {
        policy,
        revision,
      };
    });
  }

  async replaceSessionGuides(taskSessionId: string, guides: NewTaskSessionConnectorGuide[]) {
    return db.transaction(async (tx) => {
      if (guides.length === 0) {
        await tx
          .delete(taskSessionConnectorGuides)
          .where(eq(taskSessionConnectorGuides.taskSessionId, taskSessionId));
        return [];
      }

      const connectorKeys = guides.map((guide) => guide.connectorKey);
      await tx
        .delete(taskSessionConnectorGuides)
        .where(
          and(
            eq(taskSessionConnectorGuides.taskSessionId, taskSessionId),
            notInArray(taskSessionConnectorGuides.connectorKey, connectorKeys)
          )
        );

      await tx
        .insert(taskSessionConnectorGuides)
        .values(guides)
        .onConflictDoUpdate({
          target: [
            taskSessionConnectorGuides.taskSessionId,
            taskSessionConnectorGuides.connectorKey,
          ],
          set: {
            policyId: sql`excluded.policy_id`,
            revisionId: sql`excluded.revision_id`,
            triggerMode: sql`excluded.trigger_mode`,
            resolvedAt: sql`excluded.resolved_at`,
          },
        });

      return tx
        .select()
        .from(taskSessionConnectorGuides)
        .where(eq(taskSessionConnectorGuides.taskSessionId, taskSessionId))
        .orderBy(taskSessionConnectorGuides.connectorKey);
    });
  }

  listSessionGuides(taskSessionId: string) {
    return db
      .select({
        sessionGuide: taskSessionConnectorGuides,
        policy: connectorGuidePolicies,
        revision: connectorGuideRevisions,
      })
      .from(taskSessionConnectorGuides)
      .innerJoin(
        connectorGuidePolicies,
        eq(taskSessionConnectorGuides.policyId, connectorGuidePolicies.id)
      )
      .innerJoin(
        connectorGuideRevisions,
        eq(taskSessionConnectorGuides.revisionId, connectorGuideRevisions.id)
      )
      .where(eq(taskSessionConnectorGuides.taskSessionId, taskSessionId))
      .orderBy(taskSessionConnectorGuides.connectorKey);
  }

  listPublishedPoliciesByConnectorKeys(connectorKeys: string[]) {
    if (connectorKeys.length === 0) return Promise.resolve([]);
    return db
      .select({
        policy: connectorGuidePolicies,
        revision: connectorGuideRevisions,
      })
      .from(connectorGuidePolicies)
      .innerJoin(
        connectorGuideRevisions,
        eq(connectorGuidePolicies.publishedRevisionId, connectorGuideRevisions.id)
      )
      .where(
        and(
          inArray(connectorGuidePolicies.connectorKey, connectorKeys),
          eq(connectorGuidePolicies.status, 'active')
        )
      );
  }
}

export const connectorGuideDAO = new ConnectorGuideDAO();
