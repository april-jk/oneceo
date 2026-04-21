import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { appUserProjects } from '../schema';

export type AppUserProjectRecord = typeof appUserProjects.$inferSelect;

export class AppUserProjectDAO {
  private static readonly PROJECT_NAME_LIMIT = 80;
  private static readonly PROJECT_DESCRIPTION_LIMIT = 500;

  private asText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  normalizeName(value: unknown) {
    return this.asText(value).slice(0, AppUserProjectDAO.PROJECT_NAME_LIMIT);
  }

  normalizeDescription(value: unknown) {
    return this.asText(value).slice(0, AppUserProjectDAO.PROJECT_DESCRIPTION_LIMIT);
  }

  async listByUser(userId: string, options?: { projectType?: string; status?: string }) {
    const projectType = this.asText(options?.projectType) || 'standard';
    const status = this.asText(options?.status) || 'active';
    return db
      .select()
      .from(appUserProjects)
      .where(
        and(
          eq(appUserProjects.userId, userId as any),
          eq(appUserProjects.projectType, projectType),
          eq(appUserProjects.status, status)
        )
      )
      .orderBy(desc(appUserProjects.updatedAt), asc(appUserProjects.createdAt));
  }

  async getOwnedProjectById(projectId: string, userId: string) {
    const [record] = await db
      .select()
      .from(appUserProjects)
      .where(
        and(
          eq(appUserProjects.id, projectId as any),
          eq(appUserProjects.userId, userId as any)
        )
      )
      .limit(1);
    return record || null;
  }

  async getOwnedProjectByName(userId: string, name: string) {
    const normalizedName = this.normalizeName(name);
    if (!normalizedName) return null;
    const records = await db
      .select()
      .from(appUserProjects)
      .where(eq(appUserProjects.userId, userId as any));
    return (
      records.find(
        (record) =>
          record.projectType === 'standard' &&
          record.status === 'active' &&
          this.normalizeName(record.name).toLowerCase() === normalizedName.toLowerCase()
      ) || null
    );
  }

  async create(input: {
    userId: string;
    name: string;
    description?: string | null;
    projectType?: string;
  }) {
    const [created] = await db
      .insert(appUserProjects)
      .values({
        userId: input.userId as any,
        name: this.normalizeName(input.name),
        description: this.normalizeDescription(input.description),
        projectType: this.asText(input.projectType) || 'standard',
        status: 'active',
        metadataJson: {},
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }
}

export const appUserProjectDAO = new AppUserProjectDAO();
