import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  platformSkills,
  platformSkillRevisions,
  type NewPlatformSkill,
  type NewPlatformSkillRevision,
} from '../schema';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export class PlatformSkillDAO {
  async countSkills() {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(platformSkills);
    return Number(row?.total || 0);
  }

  async listSkills(filters?: { query?: string; status?: string; category?: string }) {
    const query = asText(filters?.query);
    const status = asText(filters?.status);
    const category = asText(filters?.category);
    const conditions = [];

    if (status && status !== 'all') {
      conditions.push(eq(platformSkills.status, status));
    }
    if (category && category !== 'all') {
      conditions.push(eq(platformSkills.category, category));
    }
    if (query) {
      const pattern = `%${query}%`;
      conditions.push(
        sql`(
          ${platformSkills.name} ilike ${pattern}
          or ${platformSkills.slug} ilike ${pattern}
          or ${platformSkills.description} ilike ${pattern}
        )`
      );
    }

    return db
      .select()
      .from(platformSkills)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(platformSkills.updatedAt), asc(platformSkills.name));
  }

  async listPublishedActiveSkills() {
    return db
      .select()
      .from(platformSkills)
      .where(
        and(
          eq(platformSkills.status, 'active'),
          sql`${platformSkills.publishedRevisionId} is not null`
        )
      )
      .orderBy(asc(platformSkills.name));
  }

  async getSkill(skillId: string) {
    const [row] = await db
      .select()
      .from(platformSkills)
      .where(eq(platformSkills.id, skillId))
      .limit(1);
    return row || null;
  }

  async getSkillBySlug(slug: string) {
    const normalizedSlug = asText(slug).toLowerCase();
    if (!normalizedSlug) return null;
    const [row] = await db
      .select()
      .from(platformSkills)
      .where(eq(platformSkills.slug, normalizedSlug))
      .limit(1);
    return row || null;
  }

  async getRevision(revisionId: string) {
    const [row] = await db
      .select()
      .from(platformSkillRevisions)
      .where(eq(platformSkillRevisions.id, revisionId))
      .limit(1);
    return row || null;
  }

  async getPublishedRevision(skillId: string) {
    const skill = await this.getSkill(skillId);
    if (!skill?.publishedRevisionId) return null;
    return this.getRevision(skill.publishedRevisionId);
  }

  async listRevisions(skillId: string) {
    return db
      .select()
      .from(platformSkillRevisions)
      .where(eq(platformSkillRevisions.skillId, skillId))
      .orderBy(desc(platformSkillRevisions.revisionNumber), desc(platformSkillRevisions.createdAt));
  }

  async createSkillWithRevision(input: {
    skill: Omit<NewPlatformSkill, 'publishedRevisionId' | 'createdAt' | 'updatedAt'>;
    revision: Omit<NewPlatformSkillRevision, 'skillId' | 'revisionNumber' | 'publishedAt' | 'createdAt'>;
  }) {
    return db.transaction(async (tx) => {
      const [skill] = await tx
        .insert(platformSkills)
        .values({
          ...input.skill,
          slug: asText(input.skill.slug).toLowerCase(),
          updatedAt: new Date(),
        })
        .returning();

      const [revision] = await tx
        .insert(platformSkillRevisions)
        .values({
          ...input.revision,
          skillId: skill.id,
          revisionNumber: 1,
          publishedAt: new Date(),
        })
        .returning();

      const [updatedSkill] = await tx
        .update(platformSkills)
        .set({
          publishedRevisionId: revision.id,
          updatedAt: new Date(),
        })
        .where(eq(platformSkills.id, skill.id))
        .returning();

      return {
        skill: updatedSkill,
        revision,
      };
    });
  }

  async createPublishedRevision(
    skillId: string,
    input: {
      name: string;
      description: string;
      category: string;
      bodyMarkdown: string;
      createdBy?: string | null;
    }
  ) {
    return db.transaction(async (tx) => {
      const [skill] = await tx
        .select()
        .from(platformSkills)
        .where(eq(platformSkills.id, skillId))
        .limit(1);
      if (!skill) {
        throw new Error('skill 不存在');
      }

      const [maxRevision] = await tx
        .select({
          value: sql<number>`coalesce(max(${platformSkillRevisions.revisionNumber}), 0)::int`,
        })
        .from(platformSkillRevisions)
        .where(eq(platformSkillRevisions.skillId, skillId));
      const nextRevisionNumber = Number(maxRevision?.value || 0) + 1;

      const [revision] = await tx
        .insert(platformSkillRevisions)
        .values({
          skillId,
          revisionNumber: nextRevisionNumber,
          slugSnapshot: skill.slug,
          nameSnapshot: input.name,
          descriptionSnapshot: input.description,
          categorySnapshot: input.category,
          bodyMarkdown: input.bodyMarkdown,
          createdBy: input.createdBy || null,
          publishedAt: new Date(),
        })
        .returning();

      const [updatedSkill] = await tx
        .update(platformSkills)
        .set({
          name: input.name,
          description: input.description,
          category: input.category,
          publishedRevisionId: revision.id,
          updatedAt: new Date(),
        })
        .where(eq(platformSkills.id, skillId))
        .returning();

      return {
        skill: updatedSkill,
        revision,
      };
    });
  }

  async updateSkillStatus(skillId: string, status: 'active' | 'archived') {
    const [row] = await db
      .update(platformSkills)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(platformSkills.id, skillId))
      .returning();
    return row || null;
  }
}

export const platformSkillDAO = new PlatformSkillDAO();
