import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { appUserProjects } from '../schema';

export type AppUserProjectRecord = typeof appUserProjects.$inferSelect;
export type AltusProjectMemory = {
  context: string;
  guidelines: string;
  operatingRules: string;
  executionManual: string;
  updatedAt: string | null;
};

export class AppUserProjectDAO {
  private static readonly PROJECT_NAME_LIMIT = 80;
  private static readonly PROJECT_DESCRIPTION_LIMIT = 500;
  private static readonly ALTUS_PROJECT_MEMORY_MAX_LENGTH = {
    context: 2000,
    guidelines: 2000,
    operatingRules: 2000,
    executionManual: 3000,
  } as const;

  private asText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  normalizeName(value: unknown) {
    return this.asText(value).slice(0, AppUserProjectDAO.PROJECT_NAME_LIMIT);
  }

  normalizeDescription(value: unknown) {
    return this.asText(value).slice(0, AppUserProjectDAO.PROJECT_DESCRIPTION_LIMIT);
  }

  private normalizeBoundedText(value: unknown, maxLength: number, label: string) {
    const text = this.asText(value);
    if (text.length > maxLength) {
      throw new Error(`${label}长度不能超过 ${maxLength} 个字符`);
    }
    return text;
  }

  private readPinned(metadataJson: unknown) {
    const metadata =
      metadataJson && typeof metadataJson === 'object'
        ? (metadataJson as Record<string, unknown>)
        : {};
    return Boolean(metadata.pinned);
  }

  readAltusProjectMemory(metadataJson: unknown): AltusProjectMemory {
    const metadata =
      metadataJson && typeof metadataJson === 'object'
        ? (metadataJson as Record<string, unknown>)
        : {};
    const raw = metadata.altusProjectMemory;
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      context: this.asText(record.context),
      guidelines: this.asText(record.guidelines),
      operatingRules: this.asText(record.operatingRules),
      executionManual: this.asText(record.executionManual),
      updatedAt: this.asText(record.updatedAt) || null,
    };
  }

  normalizeAltusProjectMemory(value: unknown): AltusProjectMemory {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return {
      context: this.normalizeBoundedText(
        record.context,
        AppUserProjectDAO.ALTUS_PROJECT_MEMORY_MAX_LENGTH.context,
        '项目背景'
      ),
      guidelines: this.normalizeBoundedText(
        record.guidelines,
        AppUserProjectDAO.ALTUS_PROJECT_MEMORY_MAX_LENGTH.guidelines,
        '项目指引'
      ),
      operatingRules: this.normalizeBoundedText(
        record.operatingRules,
        AppUserProjectDAO.ALTUS_PROJECT_MEMORY_MAX_LENGTH.operatingRules,
        '操作规范'
      ),
      executionManual: this.normalizeBoundedText(
        record.executionManual,
        AppUserProjectDAO.ALTUS_PROJECT_MEMORY_MAX_LENGTH.executionManual,
        '执行手册'
      ),
      updatedAt: null,
    };
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
    pinned?: boolean;
    altusProjectMemory?: AltusProjectMemory | null;
  }) {
    const altusProjectMemory =
      input.altusProjectMemory === undefined || input.altusProjectMemory === null
        ? undefined
        : {
            ...input.altusProjectMemory,
            updatedAt: new Date().toISOString(),
          };
    const [created] = await db
      .insert(appUserProjects)
      .values({
        userId: input.userId as any,
        name: this.normalizeName(input.name),
        description: this.normalizeDescription(input.description),
        projectType: this.asText(input.projectType) || 'standard',
        status: 'active',
        metadataJson: {
          pinned: Boolean(input.pinned),
          ...(altusProjectMemory ? { altusProjectMemory } : {}),
        },
        updatedAt: new Date(),
      })
      .returning();
    return created;
  }

  async updateOwnedProject(
    projectId: string,
    userId: string,
    patch: {
      name?: string;
      description?: string | null;
      pinned?: boolean;
      altusProjectMemory?: AltusProjectMemory | null;
    }
  ) {
    const current = await this.getOwnedProjectById(projectId, userId);
    if (!current) return null;
    const nextName = patch.name === undefined ? current.name : this.normalizeName(patch.name);
    const nextDescription =
      patch.description === undefined ? current.description : this.normalizeDescription(patch.description);
    const nextPinned = patch.pinned === undefined ? this.readPinned(current.metadataJson) : Boolean(patch.pinned);
    const currentAltusProjectMemory = this.readAltusProjectMemory(current.metadataJson);
    const nextAltusProjectMemory =
      patch.altusProjectMemory === undefined
        ? currentAltusProjectMemory
        : {
            ...patch.altusProjectMemory,
            updatedAt: new Date().toISOString(),
          };

    const [updated] = await db
      .update(appUserProjects)
      .set({
        name: nextName,
        description: nextDescription,
        metadataJson: {
          ...(current.metadataJson && typeof current.metadataJson === 'object'
            ? (current.metadataJson as Record<string, unknown>)
            : {}),
          pinned: nextPinned,
          altusProjectMemory: nextAltusProjectMemory,
        },
        updatedAt: new Date(),
      })
      .where(
        and(eq(appUserProjects.id, projectId as any), eq(appUserProjects.userId, userId as any))
      )
      .returning();

    return updated || null;
  }

  async deleteOwnedProject(projectId: string, userId: string) {
    const [deleted] = await db
      .delete(appUserProjects)
      .where(
        and(eq(appUserProjects.id, projectId as any), eq(appUserProjects.userId, userId as any))
      )
      .returning();
    return deleted || null;
  }
}

export const appUserProjectDAO = new AppUserProjectDAO();
