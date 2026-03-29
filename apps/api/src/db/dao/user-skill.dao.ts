import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  userCustomSkillDocuments,
  userCustomSkills,
  userPlatformSkillBindings,
  type NewUserCustomSkillDocument,
  type NewUserCustomSkill,
  type NewUserPlatformSkillBinding,
} from '../schema';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export class UserSkillDAO {
  async listPlatformBindings(userId: string) {
    return db
      .select()
      .from(userPlatformSkillBindings)
      .where(eq(userPlatformSkillBindings.userId, userId))
      .orderBy(asc(userPlatformSkillBindings.createdAt));
  }

  async getPlatformBinding(userId: string, platformSkillId: string) {
    const [row] = await db
      .select()
      .from(userPlatformSkillBindings)
      .where(
        and(
          eq(userPlatformSkillBindings.userId, userId),
          eq(userPlatformSkillBindings.platformSkillId, platformSkillId)
        )
      )
      .limit(1);
    return row || null;
  }

  async upsertPlatformBinding(input: {
    userId: string;
    platformSkillId: string;
    enabled: boolean;
  }) {
    const existing = await this.getPlatformBinding(input.userId, input.platformSkillId);
    if (existing) {
      const [updated] = await db
        .update(userPlatformSkillBindings)
        .set({
          enabled: input.enabled,
          updatedAt: new Date(),
        })
        .where(eq(userPlatformSkillBindings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(userPlatformSkillBindings)
      .values({
        userId: input.userId,
        platformSkillId: input.platformSkillId,
        enabled: input.enabled,
      } satisfies NewUserPlatformSkillBinding)
      .returning();
    return created;
  }

  async listCustomSkills(userId: string) {
    return db
      .select()
      .from(userCustomSkills)
      .where(eq(userCustomSkills.userId, userId))
      .orderBy(desc(userCustomSkills.updatedAt), asc(userCustomSkills.name));
  }

  async getCustomSkill(userId: string, customSkillId: string) {
    const [row] = await db
      .select()
      .from(userCustomSkills)
      .where(and(eq(userCustomSkills.userId, userId), eq(userCustomSkills.id, customSkillId)))
      .limit(1);
    return row || null;
  }

  async getCustomSkillBySlug(userId: string, slug: string) {
    const normalizedSlug = asText(slug).toLowerCase();
    if (!normalizedSlug) return null;
    const [row] = await db
      .select()
      .from(userCustomSkills)
      .where(and(eq(userCustomSkills.userId, userId), eq(userCustomSkills.slug, normalizedSlug)))
      .limit(1);
    return row || null;
  }

  async createCustomSkill(data: NewUserCustomSkill) {
    const [row] = await db.insert(userCustomSkills).values(data).returning();
    return row;
  }

  async updateCustomSkill(userId: string, customSkillId: string, patch: Partial<NewUserCustomSkill>) {
    const [row] = await db
      .update(userCustomSkills)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(and(eq(userCustomSkills.userId, userId), eq(userCustomSkills.id, customSkillId)))
      .returning();
    return row || null;
  }

  async listCustomSkillDocuments(userId: string, customSkillId: string) {
    return db
      .select({
        id: userCustomSkillDocuments.id,
        customSkillId: userCustomSkillDocuments.customSkillId,
        documentKey: userCustomSkillDocuments.documentKey,
        documentPath: userCustomSkillDocuments.documentPath,
        title: userCustomSkillDocuments.title,
        summary: userCustomSkillDocuments.summary,
        bodyMarkdown: userCustomSkillDocuments.bodyMarkdown,
        sortOrder: userCustomSkillDocuments.sortOrder,
        createdAt: userCustomSkillDocuments.createdAt,
        updatedAt: userCustomSkillDocuments.updatedAt,
      })
      .from(userCustomSkillDocuments)
      .innerJoin(userCustomSkills, eq(userCustomSkillDocuments.customSkillId, userCustomSkills.id))
      .where(and(eq(userCustomSkills.userId, userId), eq(userCustomSkillDocuments.customSkillId, customSkillId)))
      .orderBy(asc(userCustomSkillDocuments.sortOrder), asc(userCustomSkillDocuments.documentPath));
  }

  async getCustomSkillDocumentByPath(userId: string, customSkillId: string, documentPath: string) {
    const [row] = await db
      .select({
        id: userCustomSkillDocuments.id,
        customSkillId: userCustomSkillDocuments.customSkillId,
        documentKey: userCustomSkillDocuments.documentKey,
        documentPath: userCustomSkillDocuments.documentPath,
        title: userCustomSkillDocuments.title,
        summary: userCustomSkillDocuments.summary,
        bodyMarkdown: userCustomSkillDocuments.bodyMarkdown,
        sortOrder: userCustomSkillDocuments.sortOrder,
        createdAt: userCustomSkillDocuments.createdAt,
        updatedAt: userCustomSkillDocuments.updatedAt,
      })
      .from(userCustomSkillDocuments)
      .innerJoin(userCustomSkills, eq(userCustomSkillDocuments.customSkillId, userCustomSkills.id))
      .where(
        and(
          eq(userCustomSkills.userId, userId),
          eq(userCustomSkillDocuments.customSkillId, customSkillId),
          eq(userCustomSkillDocuments.documentPath, documentPath)
        )
      )
      .limit(1);
    return row || null;
  }

  async replaceCustomSkillDocuments(
    userId: string,
    customSkillId: string,
    documents: Array<Omit<NewUserCustomSkillDocument, 'id' | 'customSkillId' | 'createdAt' | 'updatedAt'>>
  ) {
    return db.transaction(async (tx) => {
      const [skill] = await tx
        .select()
        .from(userCustomSkills)
        .where(and(eq(userCustomSkills.userId, userId), eq(userCustomSkills.id, customSkillId)))
        .limit(1);
      if (!skill) {
        throw new Error('自定义 skill 不存在');
      }

      await tx.delete(userCustomSkillDocuments).where(eq(userCustomSkillDocuments.customSkillId, customSkillId));
      if (!documents.length) {
        return [];
      }

      return tx
        .insert(userCustomSkillDocuments)
        .values(
          documents.map((item) => ({
            customSkillId,
            documentKey: item.documentKey,
            documentPath: item.documentPath,
            title: item.title,
            summary: item.summary,
            bodyMarkdown: item.bodyMarkdown,
            sortOrder: item.sortOrder,
            updatedAt: new Date(),
          }))
        )
        .returning();
    });
  }
}

export const userSkillDAO = new UserSkillDAO();
