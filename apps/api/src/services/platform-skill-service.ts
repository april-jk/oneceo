import { createHash } from 'node:crypto';
import { platformSkillDAO } from '../db/dao';
import type { PlatformSkill, PlatformSkillRevision } from '../db/schema';
import { PLATFORM_SKILL_SEEDS } from './platform-skill-seeds';

export type PlatformSkillReference = {
  skillId: string;
  revisionId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  revisionNumber: number;
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

  async ensureSeeded() {
    if (this.seeded) return;
    const count = await platformSkillDAO.countSkills();
    if (count === 0) {
      for (const seed of PLATFORM_SKILL_SEEDS) {
        await platformSkillDAO.createSkillWithRevision({
          skill: {
            slug: seed.slug,
            name: seed.name,
            description: seed.description,
            category: seed.category,
            status: 'active',
          },
          revision: {
            slugSnapshot: seed.slug,
            nameSnapshot: seed.name,
            descriptionSnapshot: seed.description,
            categorySnapshot: seed.category,
            bodyMarkdown: seed.bodyMarkdown,
            createdBy: 'seed',
          },
        });
      }
    }
    this.seeded = true;
  }

  private async resolvePublishedRevision(skill: PlatformSkill) {
    if (!skill.publishedRevisionId) return null;
    return platformSkillDAO.getRevision(skill.publishedRevisionId);
  }

  private toPublicReference(skill: PlatformSkill, revision: PlatformSkillRevision): PlatformSkillReference {
    return {
      skillId: skill.id,
      revisionId: revision.id,
      slug: revision.slugSnapshot,
      name: revision.nameSnapshot,
      description: revision.descriptionSnapshot,
      category: revision.categorySnapshot || skill.category,
      revisionNumber: revision.revisionNumber,
    };
  }

  async listPublicSkills() {
    await this.ensureSeeded();
    const skills = await platformSkillDAO.listPublishedActiveSkills();
    const results: PlatformSkillReference[] = [];
    for (const skill of skills) {
      const revision = await this.resolvePublishedRevision(skill);
      if (!revision) continue;
      results.push(this.toPublicReference(skill, revision));
    }
    return results;
  }

  async listAdminSkills(filters?: { query?: string; status?: string; category?: string }) {
    await this.ensureSeeded();
    const skills = await platformSkillDAO.listSkills(filters);
    const results: AdminPlatformSkillSummary[] = [];
    for (const skill of skills) {
      const revision = skill.publishedRevisionId
        ? await platformSkillDAO.getRevision(skill.publishedRevisionId)
        : null;
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
    return {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      status: assertStatus(skill.status),
      publishedRevisionId: skill.publishedRevisionId || null,
      latestBodyMarkdown: publishedRevision?.bodyMarkdown || '',
      renderedSkillMarkdown: publishedRevision
        ? this.renderSkillMarkdown({
            slug: publishedRevision.slugSnapshot,
            description: publishedRevision.descriptionSnapshot,
            bodyMarkdown: publishedRevision.bodyMarkdown,
          })
        : null,
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
    const renderedMarkdown = this.renderSkillMarkdown({
      slug: revision.slugSnapshot,
      description: revision.descriptionSnapshot,
      bodyMarkdown: revision.bodyMarkdown,
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
    bodyMarkdown: string;
    createdBy?: string | null;
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
      },
      revision: {
        slugSnapshot: slug,
        nameSnapshot: assertNonEmpty(input.name, 'skill 名称'),
        descriptionSnapshot: asText(input.description),
        categorySnapshot: asText(input.category) || 'general',
        bodyMarkdown: assertNonEmpty(input.bodyMarkdown, 'skill 正文'),
        createdBy: asText(input.createdBy) || null,
      },
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
    bodyMarkdown: string;
    createdBy?: string | null;
  }) {
    await this.ensureSeeded();
    return platformSkillDAO.createPublishedRevision(skillId, {
      name: assertNonEmpty(input.name, 'skill 名称'),
      description: asText(input.description),
      category: asText(input.category) || 'general',
      bodyMarkdown: assertNonEmpty(input.bodyMarkdown, 'skill 正文'),
      createdBy: asText(input.createdBy) || null,
    });
  }

  async archiveSkill(skillId: string) {
    await this.ensureSeeded();
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

  async resolveSkillSelections(
    selections: Array<{ skillId: string; revisionId: string }>
  ) {
    await this.ensureSeeded();
    const results: Array<{
      skill: PlatformSkill;
      revision: PlatformSkillRevision;
      renderedMarkdown: string;
      signature: string;
    }> = [];
    for (const selection of selections) {
      const rendered = await this.renderRevisionById(selection.skillId, selection.revisionId);
      results.push(rendered);
    }
    return results;
  }
}

export const platformSkillService = new PlatformSkillService();
