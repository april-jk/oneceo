import { taskCreationSessionDAO, userSkillDAO } from '../db/dao';
import { platformSkillService, type PlatformSkillResourceSummary } from './platform-skill-service';

export type TaskCreationSkillReference = {
  sourceType: 'platform' | 'custom';
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  revisionNumber: number | null;
  resourceSummary?: PlatformSkillResourceSummary | null;
};

export type UserCustomSkillDocumentReference = {
  id: string;
  documentKey: string;
  documentPath: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  sortOrder: number;
  updatedAt: string;
};

export type ResolvedUserSkillSelection = {
  sourceType: 'platform' | 'custom';
  userId?: string | null;
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  renderedMarkdown: string;
  revisionNumber: number | null;
  resourceSummary?: PlatformSkillResourceSummary | null;
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

function summarizeText(value: string, limit = 120) {
  const compact = asText(value).replace(/\s+/g, ' ');
  if (!compact) return '';
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function normalizeDocumentPath(value: string) {
  const normalized = asText(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('custom skill document_path 非法');
  }
  return normalized;
}

function normalizeDocumentKey(value: string, fallback: string) {
  const base = asText(value) || fallback;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function summarizeCustomDocuments(
  documents: Array<{ documentPath: string }>
): PlatformSkillResourceSummary | null {
  if (documents.length === 0) return null;
  const paths = documents
    .map((item) => normalizeDocumentPath(item.documentPath))
    .sort((left, right) => left.localeCompare(right));
  return {
    totalCount: documents.length,
    referenceCount: documents.length,
    templateCount: 0,
    paths,
  };
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
    const customDocumentsBySkillId = new Map<string, UserCustomSkillDocumentReference[]>();
    await Promise.all(
      customSkills.map(async (item) => {
        const documents = await userSkillDAO.listCustomSkillDocuments(userId, item.id);
        customDocumentsBySkillId.set(
          item.id,
          documents.map((document) => ({
            id: document.id,
            documentKey: document.documentKey,
            documentPath: document.documentPath,
            title: document.title,
            summary: document.summary,
            bodyMarkdown: document.bodyMarkdown,
            sortOrder: Number(document.sortOrder || 0),
            updatedAt: document.updatedAt instanceof Date ? document.updatedAt.toISOString() : String(document.updatedAt),
          }))
        );
      })
    );

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
        documents: customDocumentsBySkillId.get(item.id) || [],
        resourceSummary: summarizeCustomDocuments(customDocumentsBySkillId.get(item.id) || []),
        updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt),
      })),
      availableSkills: this.toAvailableSkills(platformCatalog, bindings, customSkills, customDocumentsBySkillId),
    };
  }

  private toAvailableSkills(
    platformCatalog: Awaited<ReturnType<typeof platformSkillService.listPublicSkills>>,
    bindings: Awaited<ReturnType<typeof userSkillDAO.listPlatformBindings>>,
    customSkills: Awaited<ReturnType<typeof userSkillDAO.listCustomSkills>>,
    customDocumentsBySkillId: Map<string, UserCustomSkillDocumentReference[]>
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
        resourceSummary: item.resourceSummary,
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
        resourceSummary: summarizeCustomDocuments(customDocumentsBySkillId.get(item.id) || []),
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
    documents?: Array<{
      documentKey?: string;
      documentPath: string;
      title?: string;
      summary?: string;
      bodyMarkdown: string;
    }>;
  }) {
    const slug = assertSlug(input.slug);
    const existing = await userSkillDAO.getCustomSkillBySlug(userId, slug);
    if (existing) {
      throw new Error('自定义 skill slug 已存在');
    }
    const created = await userSkillDAO.createCustomSkill({
      userId,
      slug,
      name: asText(input.name) || slug,
      description: asText(input.description),
      category: asText(input.category) || 'general',
      status: 'active',
      bodyMarkdown: asText(input.bodyMarkdown),
    });
    if (Array.isArray(input.documents) && input.documents.length > 0) {
      await userSkillDAO.replaceCustomSkillDocuments(
        userId,
        created.id,
        input.documents.map((document, index) => ({
          documentKey: normalizeDocumentKey(document.documentKey || document.documentPath, `doc-${index + 1}`),
          documentPath: normalizeDocumentPath(document.documentPath),
          title: asText(document.title) || normalizeDocumentPath(document.documentPath).split('/').pop() || `文档 ${index + 1}`,
          summary: asText(document.summary) || summarizeText(asText(document.bodyMarkdown)),
          bodyMarkdown: asText(document.bodyMarkdown),
          sortOrder: index,
        }))
      );
    }
    return created;
  }

  async updateCustomSkill(userId: string, customSkillId: string, input: {
    name?: string;
    description?: string;
    category?: string;
    bodyMarkdown?: string;
    documents?: Array<{
      documentKey?: string;
      documentPath: string;
      title?: string;
      summary?: string;
      bodyMarkdown: string;
    }>;
  }) {
    const existing = await userSkillDAO.getCustomSkill(userId, customSkillId);
    if (!existing) {
      throw new Error('自定义 skill 不存在');
    }
    const updated = await userSkillDAO.updateCustomSkill(userId, customSkillId, {
      name: asText(input.name) || existing.name,
      description: input.description !== undefined ? asText(input.description) : existing.description,
      category: input.category !== undefined ? asText(input.category) || 'general' : existing.category,
      bodyMarkdown: input.bodyMarkdown !== undefined ? asText(input.bodyMarkdown) : existing.bodyMarkdown,
    });
    if (Array.isArray(input.documents)) {
      await userSkillDAO.replaceCustomSkillDocuments(
        userId,
        customSkillId,
        input.documents.map((document, index) => ({
          documentKey: normalizeDocumentKey(document.documentKey || document.documentPath, `doc-${index + 1}`),
          documentPath: normalizeDocumentPath(document.documentPath),
          title: asText(document.title) || normalizeDocumentPath(document.documentPath).split('/').pop() || `文档 ${index + 1}`,
          summary: asText(document.summary) || summarizeText(asText(document.bodyMarkdown)),
          bodyMarkdown: asText(document.bodyMarkdown),
          sortOrder: index,
        }))
      );
    }
    return updated;
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

  async getCustomSkillDocument(userId: string, customSkillId: string, documentPath: string) {
    const skill = await userSkillDAO.getCustomSkill(userId, customSkillId);
    if (!skill || assertStatus(skill.status) !== 'active') {
      throw new Error('自定义 skill 不存在');
    }
    const document = await userSkillDAO.getCustomSkillDocumentByPath(userId, customSkillId, normalizeDocumentPath(documentPath));
    if (!document) {
      throw new Error('自定义 skill 文档不存在');
    }
    return document;
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
          userId,
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
          resourceSummary: summarizeCustomDocuments(await userSkillDAO.listCustomSkillDocuments(userId, customSkill.id)),
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
        userId,
        skillId: current.skill.id,
        revisionId: current.revision.id,
        slug: current.revision.slugSnapshot,
        name: current.skill.name,
        description: current.skill.description,
        category: current.skill.category,
        renderedMarkdown: current.renderedMarkdown,
        revisionNumber: current.revision.revisionNumber,
        resourceSummary: current.resourceSummary,
      });
    }

    return results;
  }
}

export const userSkillService = new UserSkillService();
