import { createHash } from 'node:crypto';
import { platformSkillDAO } from '../db/dao';
import type {
  PlatformSkill,
  PlatformSkillRevision,
  PlatformSkillRevisionEntry,
  PlatformSkillRevisionResource,
  PlatformSkillRevisionResourceIndex,
} from '../db/schema';
import { ensurePlatformSkillGovernanceSchema } from '../db/migrate';
import { platformSkillImportService } from './platform-skill-import-service';
import type { SkillImportPreview } from './platform-skill-import-service';
import { PLATFORM_SKILL_SEEDS } from './platform-skill-seeds';
import { skillObjectStorageService } from './skill-object-storage-service';

export type PlatformSkillResourceSummary = {
  totalCount: number;
  referenceCount: number;
  templateCount: number;
  paths: string[];
};

export type PlatformSkillGovernance = {
  systemRole: string | null;
  adminManaged: boolean;
  required: boolean;
  autoActivation: {
    enabled: boolean;
    triggers: string[];
    toolNames: string[];
  };
};

export type PlatformSkillReference = {
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  revisionNumber: number;
  resourceSummary: PlatformSkillResourceSummary;
  governance: PlatformSkillGovernance;
};

export type AdminPlatformSkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'archived';
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  publishedAt: string | null;
  updatedAt: string;
  governance: PlatformSkillGovernance;
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
    throw new Error('skill slug 非法，只允许小写字母、数字、-、_');
  }
  return normalized;
}

function assertStatus(value: unknown): 'active' | 'archived' {
  return asText(value) === 'archived' ? 'archived' : 'active';
}

function assertNonEmpty(value: unknown, label: string) {
  const text = asText(value);
  if (!text) {
    throw new Error(`${label} 不能为空`);
  }
  return text;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function summarizeText(value: string, limit = 120) {
  const compact = asText(value).replace(/\s+/g, ' ');
  if (!compact) return '';
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function buildSkillMarkdown(input: { slug: string; description: string; bodyMarkdown: string }) {
  return [
    '---',
    `name: ${input.slug}`,
    `description: ${input.description || ''}`,
    'compatibility: opencode',
    '---',
    '',
    input.bodyMarkdown.trim(),
    '',
  ].join('\n');
}

function normalizeResourcePath(value: unknown) {
  const normalized = asText(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('resource_path 不能为空');
  }
  if (normalized.includes('..')) {
    throw new Error('resource_path 非法');
  }
  return normalized;
}

function assertResourceType(value: unknown): 'reference' | 'template' {
  return asText(value) === 'template' ? 'template' : 'reference';
}

function summarizeResources(resources: PlatformSkillRevisionResource[]): PlatformSkillResourceSummary {
  const paths = resources
    .map((item) => normalizeResourcePath(item.resourcePath))
    .sort((left, right) => left.localeCompare(right));
  const referenceCount = resources.filter((item) => assertResourceType(item.resourceType) === 'reference').length;
  const templateCount = resources.filter((item) => assertResourceType(item.resourceType) === 'template').length;
  return {
    totalCount: resources.length,
    referenceCount,
    templateCount,
    paths,
  };
}

function summarizeResourceIndexes(resources: PlatformSkillRevisionResourceIndex[]): PlatformSkillResourceSummary {
  const paths = resources
    .map((item) => normalizeResourcePath(item.resourcePath))
    .sort((left, right) => left.localeCompare(right));
  const referenceCount = resources.filter((item) => asText(item.resourceKind) === 'reference').length;
  const templateCount = resources.filter((item) => asText(item.resourceKind) === 'template').length;
  return {
    totalCount: resources.length,
    referenceCount,
    templateCount,
    paths,
  };
}

function inferMimeType(resourcePath: string) {
  const normalized = normalizeResourcePath(resourcePath).toLowerCase();
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'text/markdown';
  if (normalized.endsWith('.json')) return 'application/json';
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) return 'text/javascript';
  if (normalized.endsWith('.ts')) return 'text/x-typescript';
  if (normalized.endsWith('.py')) return 'text/x-python';
  if (normalized.endsWith('.sh') || normalized.endsWith('.bash') || normalized.endsWith('.zsh')) return 'text/x-shellscript';
  return 'text/plain';
}

function readObjectKey(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  return asText((value as Record<string, unknown>).objectKey);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizePlatformSkillGovernance(input: unknown): PlatformSkillGovernance {
  const metadata = asObject(input);
  const autoActivation = asObject(metadata.autoActivation);
  const triggers = Array.isArray(autoActivation.triggers)
    ? autoActivation.triggers
        .map((item) => asText(item).toLowerCase())
        .filter(Boolean)
    : [];
  const toolNames = Array.isArray(autoActivation.toolNames)
    ? autoActivation.toolNames
        .map((item) => asText(item).toLowerCase())
        .filter(Boolean)
    : [];
  return {
    systemRole: asText(metadata.systemRole) || null,
    adminManaged: Boolean(metadata.adminManaged),
    required: Boolean(metadata.required),
    autoActivation: {
      enabled: Boolean(autoActivation.enabled),
      triggers: Array.from(new Set(triggers)),
      toolNames: Array.from(new Set(toolNames)),
    },
  };
}

function governanceToMetadataJson(value: PlatformSkillGovernance | Partial<PlatformSkillGovernance> | null | undefined) {
  const normalized = normalizePlatformSkillGovernance(value);
  return {
    systemRole: normalized.systemRole,
    adminManaged: normalized.adminManaged,
    required: normalized.required,
    autoActivation: {
      enabled: normalized.autoActivation.enabled,
      triggers: normalized.autoActivation.triggers,
      toolNames: normalized.autoActivation.toolNames,
    },
  };
}

function shouldSyncSeedGovernance(seedMetadata: unknown, existingMetadata: unknown) {
  const expected = governanceToMetadataJson(seedMetadata as any);
  const current = governanceToMetadataJson(existingMetadata as any);
  if (expected.adminManaged || current.adminManaged) {
    return false;
  }
  return JSON.stringify(expected) !== JSON.stringify(current);
}

function isMissingPlatformSkillGovernanceColumnError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const payload = error as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code = payload.code ?? payload.cause?.code;
  const message = String(payload.message ?? payload.cause?.message ?? '');
  return code === '42703' && message.includes('metadata_json');
}

let platformSkillGovernanceRepairPromise: Promise<void> | null = null;

async function ensurePlatformSkillGovernanceSchemaReady() {
  if (!platformSkillGovernanceRepairPromise) {
    platformSkillGovernanceRepairPromise = ensurePlatformSkillGovernanceSchema().finally(() => {
      platformSkillGovernanceRepairPromise = null;
    });
  }
  await platformSkillGovernanceRepairPromise;
}

export function computeSkillSignature(markdown: string) {
  return createHash('sha256').update(markdown).digest('hex');
}

export function normalizePlatformSkillSelections(value: unknown): Array<{ skillId: string; revisionId: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const results: Array<{ skillId: string; revisionId: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const skillId = asText((item as Record<string, unknown>).skillId);
    const revisionId = asText((item as Record<string, unknown>).revisionId);
    if (!skillId || !revisionId) continue;
    const key = `${skillId}:${revisionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ skillId, revisionId });
  }
  return results;
}

export class PlatformSkillService {
  private seeded = false;

  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const payload = error as { code?: unknown; cause?: { code?: unknown } };
    return payload.code === '23505' || payload.cause?.code === '23505';
  }

  private async ensureGovernanceSchemaReady() {
    await ensurePlatformSkillGovernanceSchemaReady();
  }

  async ensureSeeded() {
    if (this.seeded) return;
    let repairedGovernanceSchema = false;

    while (!this.seeded) {
      try {
        for (const seed of PLATFORM_SKILL_SEEDS) {
          const existed = await platformSkillDAO.getSkillBySlug(seed.slug);
          if (existed) {
            if (shouldSyncSeedGovernance(seed.metadataJson, existed.metadataJson)) {
              await platformSkillDAO.updateSkillMetadata(existed.id, governanceToMetadataJson(seed.metadataJson as any));
            }
            continue;
          }
          try {
            await platformSkillDAO.createSkillWithRevision({
              skill: {
                slug: seed.slug,
                name: seed.name,
                description: seed.description,
                category: seed.category,
                status: 'active',
                metadataJson: governanceToMetadataJson(seed.metadataJson as any),
              },
              revision: {
                slugSnapshot: seed.slug,
                nameSnapshot: seed.name,
                descriptionSnapshot: seed.description,
                categorySnapshot: seed.category,
                bodyMarkdown: seed.bodyMarkdown,
                createdBy: 'seed',
              },
              resources: Array.isArray(seed.resources)
                ? seed.resources.map((item) => ({
                    resourcePath: normalizeResourcePath(item.resourcePath),
                    resourceType: assertResourceType(item.resourceType),
                    contentMarkdown: assertNonEmpty(item.contentMarkdown, 'skill resource 正文'),
                  }))
                : [],
            });
          } catch (error) {
            if (this.isUniqueViolation(error)) {
              // 并发启动时可能同时写入同一个 seed，唯一键冲突可安全忽略。
              continue;
            }
            throw error;
          }
        }
        this.seeded = true;
      } catch (error) {
        if (!repairedGovernanceSchema && isMissingPlatformSkillGovernanceColumnError(error)) {
          repairedGovernanceSchema = true;
          await this.ensureGovernanceSchemaReady();
          continue;
        }
        throw error;
      }
    }
  }

  parseFolderImport(input: { rootFolderName?: string; files: Array<{ relativePath: string; content: string }> }) {
    return platformSkillImportService.parseFolderImport(input);
  }

  private async resolvePublishedRevision(skill: PlatformSkill) {
    if (!skill.publishedRevisionId) return null;
    return platformSkillDAO.getRevision(skill.publishedRevisionId);
  }

  private async getEffectiveEntry(revision: PlatformSkillRevision) {
    return (await platformSkillDAO.getRevisionEntry(revision.id)) || null;
  }

  private async getEffectiveBodyMarkdown(revision: PlatformSkillRevision, entry?: PlatformSkillRevisionEntry | null) {
    return asText(entry?.bodyMarkdown) || revision.bodyMarkdown;
  }

  private async listEffectiveResourceIndexes(revisionId: string) {
    const layered = await platformSkillDAO.listRevisionResourceIndexes(revisionId);
    if (layered.length > 0) {
      return layered;
    }
    const legacy = await platformSkillDAO.listRevisionResources(revisionId);
    return legacy.map((item, index) => ({
      id: item.id,
      revisionId: item.revisionId,
      resourceKey: `${item.resourceType}_${index + 1}_${normalizeSlug(item.resourcePath)}`,
      resourcePath: item.resourcePath,
      resourceKind: item.resourceType,
      title: item.resourcePath.split('/').pop() || item.resourcePath,
      summary: summarizeText(item.contentMarkdown),
      loadStage: 'on_demand',
      sortOrder: index,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
    })) as PlatformSkillRevisionResourceIndex[];
  }

  private async readLayeredResourceText(resourceIndexId: string) {
    const body = await platformSkillDAO.getRevisionResourceBody(resourceIndexId);
    if (!body) {
      return null;
    }
    const chunks = await platformSkillDAO.listRevisionResourceChunks(body.id);
    if (!chunks.length) {
      return '';
    }
    return chunks
      .filter((item) => item.chunkRole === 'body' || chunks.length === 1)
      .sort((left, right) => left.chunkIndex - right.chunkIndex)
      .map((item) => item.contentText)
      .join('');
  }

  private async toRevisionResources(revisionId: string) {
    const layered = await this.listEffectiveResourceIndexes(revisionId);
    if (!layered.length) {
      return {
        resources: [] as PlatformSkillRevisionResource[],
        resourceSummary: summarizeResources([]),
      };
    }

    const resources = await Promise.all(
      layered.map(async (item) => ({
        id: item.id,
        revisionId: item.revisionId,
        resourcePath: item.resourcePath,
        resourceType: asText(item.resourceKind) === 'template' ? 'template' : 'reference',
        contentMarkdown:
          item.contentStorage === 'object_storage'
            ? await skillObjectStorageService.downloadTextResource(readObjectKey(item.storageLocatorJson))
            : (await this.readLayeredResourceText(item.id)) ??
              (await platformSkillDAO.getRevisionResource(revisionId, item.resourcePath))?.contentMarkdown ??
              '',
        createdAt: item.createdAt,
      }))
    );

    return {
      resources,
      resourceSummary: summarizeResourceIndexes(layered),
    };
  }

  private toPublicReference(
    skill: PlatformSkill,
    revision: PlatformSkillRevision,
    resourceSummary: PlatformSkillResourceSummary
  ): PlatformSkillReference {
    return {
      skillId: skill.id,
      revisionId: revision.id,
      slug: revision.slugSnapshot,
      name: revision.nameSnapshot,
      description: revision.descriptionSnapshot,
      category: revision.categorySnapshot || skill.category,
      revisionNumber: revision.revisionNumber,
      resourceSummary,
      governance: normalizePlatformSkillGovernance(skill.metadataJson),
    };
  }

  async listPublicSkills() {
    await this.ensureSeeded();
    const skills = await platformSkillDAO.listPublishedActiveSkills();
    const results: PlatformSkillReference[] = [];
    for (const skill of skills) {
      const revision = await this.resolvePublishedRevision(skill);
      if (!revision) continue;
      const resourceIndexes = await this.listEffectiveResourceIndexes(revision.id);
      results.push(this.toPublicReference(skill, revision, summarizeResourceIndexes(resourceIndexes)));
    }
    return results;
  }

  async listAdminSkills(filters?: { query?: string; status?: string; category?: string }) {
    await this.ensureSeeded();
    const skills = await platformSkillDAO.listSkills(filters);
    const results: AdminPlatformSkillSummary[] = [];
    for (const skill of skills) {
      const revision = skill.publishedRevisionId ? await platformSkillDAO.getRevision(skill.publishedRevisionId) : null;
      results.push({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        status: assertStatus(skill.status),
        publishedRevisionId: skill.publishedRevisionId || null,
        publishedRevisionNumber: revision?.revisionNumber ?? null,
        publishedAt: toIso(revision?.publishedAt),
        updatedAt: toIso(skill.updatedAt) || new Date().toISOString(),
        governance: normalizePlatformSkillGovernance(skill.metadataJson),
      });
    }
    return results;
  }

  async getAdminSkill(skillId: string) {
    await this.ensureSeeded();
    const skill = await platformSkillDAO.getSkill(skillId);
    if (!skill) {
      throw new Error('skill 不存在');
    }
    const revisions = await platformSkillDAO.listRevisions(skillId);
    const publishedRevision =
      (skill.publishedRevisionId && revisions.find((item) => item.id === skill.publishedRevisionId)) || revisions[0] || null;
    const entry = publishedRevision ? await this.getEffectiveEntry(publishedRevision) : null;
    const { resources, resourceSummary } = publishedRevision
      ? await this.toRevisionResources(publishedRevision.id)
      : { resources: [] as PlatformSkillRevisionResource[], resourceSummary: summarizeResources([]) };
    return {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      status: assertStatus(skill.status),
      publishedRevisionId: skill.publishedRevisionId || null,
      latestBodyMarkdown: publishedRevision ? await this.getEffectiveBodyMarkdown(publishedRevision, entry) : '',
      renderedSkillMarkdown: publishedRevision
        ? this.renderSkillMarkdown({
            slug: publishedRevision.slugSnapshot,
            description: publishedRevision.descriptionSnapshot,
            bodyMarkdown: await this.getEffectiveBodyMarkdown(publishedRevision, entry),
          })
        : null,
      resourceSummary,
      governance: normalizePlatformSkillGovernance(skill.metadataJson),
      resources: resources.map((item) => ({
        id: item.id,
        resourcePath: item.resourcePath,
        resourceType: assertResourceType(item.resourceType),
        createdAt: toIso(item.createdAt) || new Date().toISOString(),
      })),
      updatedAt: toIso(skill.updatedAt) || new Date().toISOString(),
    };
  }

  async listSkillRevisions(skillId: string) {
    await this.ensureSeeded();
    const revisions = await platformSkillDAO.listRevisions(skillId);
    const skill = await platformSkillDAO.getSkill(skillId);
    return revisions.map((revision) => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      createdAt: toIso(revision.createdAt) || new Date().toISOString(),
      createdBy: revision.createdBy || null,
      publishedAt: toIso(revision.publishedAt),
      isPublished: skill?.publishedRevisionId === revision.id,
    }));
  }

  async listRevisionResources(skillId: string, revisionId: string) {
    await this.ensureSeeded();
    const skill = await platformSkillDAO.getSkill(skillId);
    const revision = await platformSkillDAO.getRevision(revisionId);
    if (!skill || !revision || revision.skillId !== skill.id) {
      throw new Error('revision 不存在');
    }
    const layered = await this.listEffectiveResourceIndexes(revision.id);
    const { resources, resourceSummary } = await this.toRevisionResources(revision.id);
    const resourceByPath = new Map(resources.map((item) => [normalizeResourcePath(item.resourcePath), item]));
    return {
      skill,
      revision,
      resources: layered.map((item) => {
        const normalizedPath = normalizeResourcePath(item.resourcePath);
        const resource = resourceByPath.get(normalizedPath);
        return {
          id: item.id,
          resourceKey: item.resourceKey,
          resourcePath: normalizedPath,
          resourceType: assertResourceType(asText(item.resourceKind)),
          title: asText(item.title),
          summary: asText(item.summary),
          contentStorage: asText(item.contentStorage) || 'database',
          mimeType: asText(item.mimeType) || 'text/markdown',
          storagePath: asText(item.storagePath) || null,
          storageLocatorJson: item.storageLocatorJson ?? null,
          loadStage: asText(item.loadStage) || 'on_demand',
          sortOrder: Number(item.sortOrder || 0),
          contentMarkdown: resource?.contentMarkdown || '',
          createdAt: toIso(resource?.createdAt || item.createdAt) || new Date().toISOString(),
          updatedAt: toIso(item.updatedAt) || new Date().toISOString(),
        };
      }),
      resourceSummary,
    };
  }

  async getRevisionResource(skillId: string, revisionId: string, resourcePath: string) {
    const normalizedResourcePath = normalizeResourcePath(resourcePath);
    const listed = await this.listRevisionResources(skillId, revisionId);
    const resource = listed.resources.find((item) => item.resourcePath === normalizedResourcePath);
    if (!resource) {
      throw new Error('skill resource 不存在');
    }
    return {
      ...listed,
      resource,
    };
  }

  renderSkillMarkdown(input: { slug: string; description: string; bodyMarkdown: string }) {
    return buildSkillMarkdown({
      slug: assertSlug(input.slug),
      description: asText(input.description),
      bodyMarkdown: assertNonEmpty(input.bodyMarkdown, 'skill 正文'),
    });
  }

  async renderRevisionById(skillId: string, revisionId: string) {
    await this.ensureSeeded();
    const skill = await platformSkillDAO.getSkill(skillId);
    const revision = await platformSkillDAO.getRevision(revisionId);
    if (!skill || !revision || revision.skillId !== skill.id) {
      throw new Error('revision 不存在');
    }
    const entry = await this.getEffectiveEntry(revision);
    const renderedMarkdown = this.renderSkillMarkdown({
      slug: revision.slugSnapshot,
      description: revision.descriptionSnapshot,
      bodyMarkdown: await this.getEffectiveBodyMarkdown(revision, entry),
    });
    return {
      skill,
      revision,
      renderedMarkdown,
      signature: computeSkillSignature(renderedMarkdown),
    };
  }

  async createSkill(input: {
    slug: string;
    name: string;
    description?: string;
    category?: string;
    governance?: Partial<PlatformSkillGovernance> | null;
    bodyMarkdown: string;
    createdBy?: string | null;
    resources?: Array<{ resourcePath: string; resourceType?: 'reference' | 'template'; contentMarkdown: string }>;
    layeredImport?: SkillImportPreview | null;
  }) {
    await this.ensureSeeded();
    const slug = assertSlug(input.slug);
    const existing = await platformSkillDAO.getSkillBySlug(slug);
    if (existing) {
      throw new Error('skill slug 已存在');
    }
    const created = await platformSkillDAO.createSkillWithRevision({
      skill: {
        slug,
        name: assertNonEmpty(input.name, 'skill 名称'),
        description: asText(input.description),
        category: asText(input.category) || 'general',
        status: 'active',
        metadataJson: governanceToMetadataJson(input.governance),
      },
      revision: {
        slugSnapshot: slug,
        nameSnapshot: assertNonEmpty(input.name, 'skill 名称'),
        descriptionSnapshot: asText(input.description),
        categorySnapshot: asText(input.category) || 'general',
        bodyMarkdown: assertNonEmpty(input.bodyMarkdown, 'skill 正文'),
        createdBy: asText(input.createdBy) || null,
      },
      resources: Array.isArray(input.resources)
        ? input.resources.map((item) => ({
            resourcePath: normalizeResourcePath(item.resourcePath),
            resourceType: assertResourceType(item.resourceType),
            contentMarkdown: assertNonEmpty(item.contentMarkdown, 'skill resource 正文'),
          }))
        : [],
      layeredImport: input.layeredImport || null,
    });
    return {
      skill: created.skill,
      revision: created.revision,
    };
  }

  async updateSkill(skillId: string, input: {
    name: string;
    description?: string;
    category?: string;
    governance?: Partial<PlatformSkillGovernance> | null;
    bodyMarkdown: string;
    createdBy?: string | null;
    resources?: Array<{ resourcePath: string; resourceType?: 'reference' | 'template'; contentMarkdown: string }>;
    layeredImport?: SkillImportPreview | null;
  }) {
    await this.ensureSeeded();
    const existing = await platformSkillDAO.getSkill(skillId);
    if (!existing) {
      throw new Error('skill 不存在');
    }
    return platformSkillDAO.createPublishedRevision(skillId, {
      name: assertNonEmpty(input.name, 'skill 名称'),
      description: asText(input.description),
      category: asText(input.category) || 'general',
      metadataJson:
        input.governance === undefined
          ? governanceToMetadataJson(existing.metadataJson as any)
          : governanceToMetadataJson(input.governance),
      bodyMarkdown: assertNonEmpty(input.bodyMarkdown, 'skill 正文'),
      createdBy: asText(input.createdBy) || null,
      resources: Array.isArray(input.resources)
        ? input.resources.map((item) => ({
            resourcePath: normalizeResourcePath(item.resourcePath),
            resourceType: assertResourceType(item.resourceType),
            contentMarkdown: assertNonEmpty(item.contentMarkdown, 'skill resource 正文'),
          }))
        : [],
      layeredImport: input.layeredImport || null,
    });
  }

  async importSkillFolder(input: {
    rootFolderName?: string;
    files: Array<{ relativePath: string; content: string }>;
    createdBy?: string | null;
    skillId?: string | null;
    onFileProgress?: (event: {
      relativePath: string;
      processingState: 'processing' | 'success' | 'failed';
      error?: string | null;
    }) => void;
  }) {
    await this.ensureSeeded();
    const preview = this.parseFolderImport({
      rootFolderName: input.rootFolderName,
      files: input.files,
    });
    const previewFilesByPath = new Map(preview.files.map((item) => [item.relativePath, item]));
    for (const resource of preview.resources) {
      const file = previewFilesByPath.get(resource.resourcePath);
      const storageTarget = file?.storageTarget || 'database';
      resource.contentStorage = storageTarget;
      resource.mimeType = inferMimeType(resource.resourcePath);
      input.onFileProgress?.({ relativePath: resource.resourcePath, processingState: 'processing' });
      try {
        if (storageTarget === 'object_storage') {
          const uploaded = await skillObjectStorageService.uploadTextResource({
            skillSlug: preview.slug,
            revisionHint: input.skillId ? `skill-${input.skillId}` : 'create',
            resourcePath: resource.resourcePath,
            content: resource.chunks
              .filter((chunk) => chunk.chunkRole === 'body' || resource.chunks.length === 1)
              .map((chunk) => chunk.contentText)
              .join(''),
            mimeType: resource.mimeType,
          });
          resource.storagePath = uploaded.storagePath;
          resource.storageLocatorJson = uploaded.storageLocatorJson;
        }
        input.onFileProgress?.({ relativePath: resource.resourcePath, processingState: 'success' });
      } catch (error) {
        input.onFileProgress?.({
          relativePath: resource.resourcePath,
          processingState: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    const normalizedResources = preview.resources.map((item) => ({
      resourcePath: normalizeResourcePath(item.resourcePath),
      resourceType: item.resourceKind === 'template' ? ('template' as const) : ('reference' as const),
      contentMarkdown: item.chunks
        .filter((chunk) => chunk.chunkRole === 'body' || item.chunks.length === 1)
        .map((chunk) => chunk.contentText)
        .join(''),
    })).filter((item) => (previewFilesByPath.get(item.resourcePath)?.storageTarget || 'database') === 'database');

    if (input.skillId) {
      const updated = await this.updateSkill(input.skillId, {
        name: assertNonEmpty(preview.name, 'skill 名称'),
        description: asText(preview.discoveryDescription),
        category: 'general',
        bodyMarkdown: assertNonEmpty(preview.entry.bodyMarkdown, 'skill 正文'),
        createdBy: asText(input.createdBy) || null,
        resources: normalizedResources,
        layeredImport: preview,
      });
      return {
        mode: 'revision' as const,
        preview,
        skill: updated.skill,
        revision: updated.revision,
      };
    }

    const slug = assertSlug(preview.slug);
    const created = await this.createSkill({
      slug,
      name: assertNonEmpty(preview.name, 'skill 名称'),
      description: asText(preview.discoveryDescription),
      category: 'general',
      bodyMarkdown: assertNonEmpty(preview.entry.bodyMarkdown, 'skill 正文'),
      createdBy: asText(input.createdBy) || null,
      resources: normalizedResources,
      layeredImport: preview,
    });
    return {
      mode: 'create' as const,
      preview,
      skill: created.skill,
      revision: created.revision,
    };
  }

  async archiveSkill(skillId: string) {
    await this.ensureSeeded();
    const skill = await platformSkillDAO.getSkill(skillId);
    if (!skill) {
      throw new Error('skill 不存在');
    }
    if (normalizePlatformSkillGovernance(skill.metadataJson).required) {
      throw new Error('系统必需 skill 不允许归档');
    }
    const updated = await platformSkillDAO.updateSkillStatus(skillId, 'archived');
    if (!updated) {
      throw new Error('skill 不存在');
    }
    return updated;
  }

  async activateSkill(skillId: string) {
    await this.ensureSeeded();
    const updated = await platformSkillDAO.updateSkillStatus(skillId, 'active');
    if (!updated) {
      throw new Error('skill 不存在');
    }
    return updated;
  }

  async resolveSkillSelections(selections: Array<{ skillId: string; revisionId: string }>) {
    await this.ensureSeeded();
    const results: Array<{
      skill: PlatformSkill;
      revision: PlatformSkillRevision;
      renderedMarkdown: string;
      signature: string;
      resources: PlatformSkillRevisionResource[];
      resourceSummary: PlatformSkillResourceSummary;
    }> = [];
    for (const selection of selections) {
      const rendered = await this.renderRevisionById(selection.skillId, selection.revisionId);
      const { resources, resourceSummary } = await this.toRevisionResources(rendered.revision.id);
      results.push({
        ...rendered,
        resources,
        resourceSummary,
      });
    }
    return results;
  }
}

export const platformSkillService = new PlatformSkillService();
