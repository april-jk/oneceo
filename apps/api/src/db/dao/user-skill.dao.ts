import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  userCustomSkills,
  userPlatformSkillBindings,
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
}

export const userSkillDAO = new UserSkillDAO();
