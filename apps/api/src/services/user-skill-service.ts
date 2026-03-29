import { taskCreationSessionDAO, userSkillDAO } from '../db/dao';
import { platformSkillService } from './platform-skill-service';

export type TaskCreationSkillReference = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  revisionNumber: number | null;
};

export type ResolvedUserSkillSelection = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  renderedMarkdown: string;
  revisionNumber: number | null;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSlug(value: string) {
  const normalized = asText(value).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-');
  return normalized.replace(/^-+|-+$/g, '');
}

function assertSlug(value: string) {
  const normalized = normalizeSlug(value);
  if (!normalized || !/^[a-z0-9][a-z0-9-_]{1,63}$/.test(normalized)) {
    throw new Error('skill slug 非法');
  }
  return normalized;
}

function assertStatus(value: unknown): 'active' | 'archived' {
  return asText(value) === 'archived' ? 'archived' : 'active';
}

export class UserSkillService {
  private async ensureDefaultPlatformBindings(userId: string) {
    const bindings = await userSkillDAO.listPlatformBindings(userId);
    if (bindings.length > 0) {
      return bindings;
    }
    const platformSkills = await platformSkillService.listPublicSkills();
    for (const skill of platformSkills) {
      await userSkillDAO.upsertPlatformBinding({
        userId,
        platformSkillId: skill.skillId,
        enabled: true,
      });
    }
    return userSkillDAO.listPlatformBindings(userId);
  }

  async listSettings(userId: string) {
    const [platformCatalog, bindings, customSkills] = await Promise.all([
      platformSkillService.listPublicSkills(),
      this.ensureDefaultPlatformBindings(userId),
      userSkillDAO.listCustomSkills(userId),
    ]);

    const bindingMap = new Map(bindings.map((item) => [item.platformSkillId, item]));
    return {
      platformCatalog: platformCatalog.map((item) => ({
        ...item,
        enabled: bindingMap.get(item.skillId)?.enabled ?? false,
      })),
      customSkills: customSkills.map((item) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: item.category,
        status: assertStatus(item.status),
        bodyMarkdown: item.bodyMarkdown,
        updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt),
      })),
      availableSkills: this.toAvailableSkills(platformCatalog, bindings, customSkills),
    };
  }

  private toAvailableSkills(
    platformCatalog: Awaited<ReturnType<typeof platformSkillService.listPublicSkills>>,
    bindings: Awaited<ReturnType<typeof userSkillDAO.listPlatformBindings>>,
    customSkills: Awaited<ReturnType<typeof userSkillDAO.listCustomSkills>>
  ): TaskCreationSkillReference[] {
    const enabledPlatformIds = new Set(
      bindings.filter((item) => item.enabled).map((item) => item.platformSkillId)
    );
    const platformRefs: TaskCreationSkillReference[] = platformCatalog
      .filter((item) => enabledPlatformIds.has(item.skillId))
      .map((item) => ({
        sourceType: 'platform',
        skillId: item.skillId,
        revisionId: item.revisionId,
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: item.category,
        revisionNumber: item.revisionNumber,
      }));

    const customRefs: TaskCreationSkillReference[] = customSkills
      .filter((item) => assertStatus(item.status) === 'active')
      .map((item) => ({
        sourceType: 'custom',
        skillId: item.id,
        revisionId: item.id,
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: item.category,
        revisionNumber: 1,
      }));

    return [...platformRefs, ...customRefs].sort((left, right) => left.name.localeCompare(right.name));
  }

  async listAvailableSkills(userId: string) {
    const settings = await this.listSettings(userId);
    return settings.availableSkills;
  }

  async enablePlatformSkill(userId: string, platformSkillId: string) {
    await platformSkillService.getAdminSkill(platformSkillId);
    return userSkillDAO.upsertPlatformBinding({
      userId,
      platformSkillId,
      enabled: true,
    });
  }

  async disablePlatformSkill(userId: string, platformSkillId: string) {
    return userSkillDAO.upsertPlatformBinding({
      userId,
      platformSkillId,
      enabled: false,
    });
  }

  async createCustomSkill(userId: string, input: {
    slug: string;
    name: string;
    description?: string;
    category?: string;
    bodyMarkdown: string;
  }) {
    const slug = assertSlug(input.slug);
    const existing = await userSkillDAO.getCustomSkillBySlug(userId, slug);
    if (existing) {
      throw new Error('自定义 skill slug 已存在');
    }
    return userSkillDAO.createCustomSkill({
      userId,
      slug,
      name: asText(input.name) || slug,
      description: asText(input.description),
      category: asText(input.category) || 'general',
      status: 'active',
      bodyMarkdown: asText(input.bodyMarkdown),
    });
  }

  async updateCustomSkill(userId: string, customSkillId: string, input: {
    name?: string;
    description?: string;
    category?: string;
    bodyMarkdown?: string;
  }) {
    const existing = await userSkillDAO.getCustomSkill(userId, customSkillId);
    if (!existing) {
      throw new Error('自定义 skill 不存在');
    }
    return userSkillDAO.updateCustomSkill(userId, customSkillId, {
      name: asText(input.name) || existing.name,
      description: input.description !== undefined ? asText(input.description) : existing.description,
      category: input.category !== undefined ? asText(input.category) || 'general' : existing.category,
      bodyMarkdown: input.bodyMarkdown !== undefined ? asText(input.bodyMarkdown) : existing.bodyMarkdown,
    });
  }

  async archiveCustomSkill(userId: string, customSkillId: string) {
    const existing = await userSkillDAO.getCustomSkill(userId, customSkillId);
    if (!existing) {
      throw new Error('自定义 skill 不存在');
    }
    return userSkillDAO.updateCustomSkill(userId, customSkillId, {
      status: 'archived',
    });
  }

  async activateCustomSkill(userId: string, customSkillId: string) {
    const existing = await userSkillDAO.getCustomSkill(userId, customSkillId);
    if (!existing) {
      throw new Error('自定义 skill 不存在');
    }
    return userSkillDAO.updateCustomSkill(userId, customSkillId, {
      status: 'active',
    });
  }

  async resolveSelectionsForSession(taskSessionId: string, value: unknown) {
    const session = await taskCreationSessionDAO.getSession(taskSessionId);
    const userId = asText(session?.userId);
    if (!userId) {
      throw new Error('会话未绑定用户，无法解析用户态 skills');
    }

    const selections = Array.isArray(value) ? value : [];
    const results: ResolvedUserSkillSelection[] = [];

    for (const item of selections) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const sourceType = asText(record.sourceType) === 'custom' ? 'custom' : 'platform';
      const skillId = asText(record.skillId);
      const revisionId = asText(record.revisionId);
      if (!skillId) continue;

      if (sourceType === 'custom') {
        const customSkill = await userSkillDAO.getCustomSkill(userId, skillId);
        if (!customSkill || assertStatus(customSkill.status) !== 'active') {
          continue;
        }
        results.push({
          sourceType,
          skillId: customSkill.id,
          revisionId: customSkill.id,
          slug: customSkill.slug,
          name: customSkill.name,
          description: customSkill.description,
          category: customSkill.category,
          renderedMarkdown: platformSkillService.renderSkillMarkdown({
            slug: customSkill.slug,
            description: customSkill.description,
            bodyMarkdown: customSkill.bodyMarkdown,
          }),
          revisionNumber: 1,
        });
        continue;
      }

      if (!revisionId) continue;
      const resolved = await platformSkillService.resolveSkillSelections([{ skillId, revisionId }]);
      const current = resolved[0];
      if (!current) continue;
      const binding = await userSkillDAO.getPlatformBinding(userId, current.skill.id);
      if (!binding?.enabled) {
        continue;
      }
      results.push({
        sourceType,
        skillId: current.skill.id,
        revisionId: current.revision.id,
        slug: current.revision.slugSnapshot,
        name: current.skill.name,
        description: current.skill.description,
        category: current.skill.category,
        renderedMarkdown: current.renderedMarkdown,
        revisionNumber: current.revision.revisionNumber,
      });
    }

    return results;
  }
}

export const userSkillService = new UserSkillService();
