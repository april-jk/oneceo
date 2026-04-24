import { and, asc, desc, eq } from 'drizzle-orm';
import { type ConnectorKey, CONNECTOR_KEYS } from '../../services/connector-registry';
import { db } from '../../config/database';
import { appUserProjects } from '../schema';

export type AppUserProjectRecord = typeof appUserProjects.$inferSelect;
export type ProjectInstructionMemory = {
  instruction: string;
};

export type ProjectDefaultConnectorProfile = {
  connectorKey: ConnectorKey;
  profileId: string;
};

export class AppUserProjectDAO {
  private static readonly PROJECT_NAME_LIMIT = 80;
  private static readonly PROJECT_DESCRIPTION_LIMIT = 500;
  private static readonly PROJECT_INSTRUCTION_LIMIT = 8000;
  private static readonly DEFAULT_CONNECTOR_PROFILE_LIMIT = 20;

  private asText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
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
    const metadata = this.asRecord(metadataJson);
    return Boolean(metadata.pinned);
  }

  private buildLegacyProjectInstruction(value: unknown) {
    const record = this.asRecord(value);
    const sections = [
      { label: '背景', value: this.asText(record.context) },
      { label: '指引', value: this.asText(record.guidelines) },
      { label: '规则', value: this.asText(record.operatingRules) },
      { label: '执行要求', value: this.asText(record.executionManual) },
    ].filter((item) => item.value);
    if (sections.length === 0) return '';
    return sections
      .map((item) => `${item.label}：\n${item.value}`)
      .join('\n\n')
      .slice(0, AppUserProjectDAO.PROJECT_INSTRUCTION_LIMIT);
  }

  readProjectInstruction(metadataJson: unknown): string {
    const metadata = this.asRecord(metadataJson);
    const projectInstruction = this.asText(metadata.projectInstruction);
    if (projectInstruction) {
      return projectInstruction.slice(0, AppUserProjectDAO.PROJECT_INSTRUCTION_LIMIT);
    }
    return this.buildLegacyProjectInstruction(metadata.altusProjectMemory);
  }

  normalizeProjectInstruction(value: unknown) {
    return this.normalizeBoundedText(
      value,
      AppUserProjectDAO.PROJECT_INSTRUCTION_LIMIT,
      '项目指令'
    );
  }

  readDefaultConnectorProfiles(metadataJson: unknown): ProjectDefaultConnectorProfile[] {
    const value =
      this.asRecord(metadataJson).defaultConnectorProfiles ??
      this.asRecord(metadataJson).defaultConnectors;
    if (!Array.isArray(value)) return [];
    const dedup = new Map<string, ProjectDefaultConnectorProfile>();
    for (const item of value) {
      const record = this.asRecord(item);
      const connectorKey = this.asText(record.connectorKey);
      const profileId = this.asText(record.profileId);
      if (!connectorKey || !profileId) continue;
      if (!(CONNECTOR_KEYS as readonly string[]).includes(connectorKey)) continue;
      dedup.set(`${connectorKey}:${profileId}`, {
        connectorKey: connectorKey as ConnectorKey,
        profileId,
      });
    }
    return Array.from(dedup.values()).slice(0, AppUserProjectDAO.DEFAULT_CONNECTOR_PROFILE_LIMIT);
  }

  normalizeDefaultConnectorProfiles(value: unknown): ProjectDefaultConnectorProfile[] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      throw new Error('默认连接器格式不正确');
    }
    const dedup = new Map<string, ProjectDefaultConnectorProfile>();
    for (const item of value) {
      const record = this.asRecord(item);
      const connectorKey = this.asText(record.connectorKey);
      const profileId = this.asText(record.profileId);
      if (!connectorKey || !profileId) continue;
      if (!(CONNECTOR_KEYS as readonly string[]).includes(connectorKey)) continue;
      dedup.set(`${connectorKey}:${profileId}`, {
        connectorKey: connectorKey as ConnectorKey,
        profileId,
      });
    }
    const normalized = Array.from(dedup.values());
    if (normalized.length > AppUserProjectDAO.DEFAULT_CONNECTOR_PROFILE_LIMIT) {
      throw new Error(
        `默认连接器数量不能超过 ${AppUserProjectDAO.DEFAULT_CONNECTOR_PROFILE_LIMIT} 个`
      );
    }
    return normalized;
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
    projectType?: string;
    pinned?: boolean;
    projectInstruction?: string | null;
    defaultConnectorProfiles?: ProjectDefaultConnectorProfile[] | null;
  }) {
    const metadataJson: Record<string, unknown> = {
      pinned: Boolean(input.pinned),
      defaultConnectorProfiles: Array.isArray(input.defaultConnectorProfiles)
        ? input.defaultConnectorProfiles
        : [],
    };
    const projectInstruction = this.asText(input.projectInstruction);
    if (projectInstruction) {
      metadataJson.projectInstruction = projectInstruction;
    }
    const [created] = await db
      .insert(appUserProjects)
      .values({
        userId: input.userId as any,
        name: this.normalizeName(input.name),
        description: '',
        projectType: this.asText(input.projectType) || 'standard',
        status: 'active',
        metadataJson,
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
      pinned?: boolean;
      projectInstruction?: string | null;
      defaultConnectorProfiles?: ProjectDefaultConnectorProfile[] | null;
    }
  ) {
    const current = await this.getOwnedProjectById(projectId, userId);
    if (!current) return null;
    const nextName = patch.name === undefined ? current.name : this.normalizeName(patch.name);
    const nextPinned = patch.pinned === undefined ? this.readPinned(current.metadataJson) : Boolean(patch.pinned);
    const nextProjectInstruction =
      patch.projectInstruction === undefined
        ? this.readProjectInstruction(current.metadataJson)
        : this.asText(patch.projectInstruction);
    const nextDefaultConnectorProfiles =
      patch.defaultConnectorProfiles === undefined
        ? this.readDefaultConnectorProfiles(current.metadataJson)
        : patch.defaultConnectorProfiles;
    const metadataJson = {
      ...this.asRecord(current.metadataJson),
      pinned: nextPinned,
      defaultConnectorProfiles: Array.isArray(nextDefaultConnectorProfiles)
        ? nextDefaultConnectorProfiles
        : [],
    } as Record<string, unknown>;
    if (nextProjectInstruction) {
      metadataJson.projectInstruction = nextProjectInstruction;
    } else {
      delete metadataJson.projectInstruction;
    }
    delete metadataJson.altusProjectMemory;
    delete metadataJson.defaultConnectors;

    const [updated] = await db
      .update(appUserProjects)
      .set({
        name: nextName,
        metadataJson,
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
