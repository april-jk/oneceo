import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import type { SkillImportPreview } from '../../services/platform-skill-import-service';
import {
  platformSkills,
  platformSkillRevisions,
  platformSkillRevisionResources,
  platformSkillRevisionEntries,
  platformSkillRevisionResourceIndexes,
  platformSkillRevisionResourceBodies,
  platformSkillRevisionResourceChunks,
  platformSkillRevisionResourceLinks,
  type NewPlatformSkill,
  type NewPlatformSkillRevision,
  type NewPlatformSkillRevisionResource,
  type NewPlatformSkillRevisionEntry,
  type NewPlatformSkillRevisionResourceIndex,
  type NewPlatformSkillRevisionResourceBody,
  type NewPlatformSkillRevisionResourceChunk,
  type NewPlatformSkillRevisionResourceLink,
} from '../schema';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function summarizeText(value: string, limit = 120) {
  const compact = asText(value).replace(/\s+/g, ' ');
  if (!compact) return '';
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function normalizeResourceKey(value: string) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function tokenEstimate(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function splitContentChunks(content: string) {
  const normalized = String(content ?? '').trim();
  if (!normalized) {
    return [
      {
        chunkIndex: 0,
        chunkRole: 'body',
        chunkSummary: '',
        contentText: '',
        tokenEstimate: 1,
      },
    ] as Array<Omit<NewPlatformSkillRevisionResourceChunk, 'id' | 'resourceBodyId' | 'createdAt'>>;
  }
  if (normalized.length <= 2400) {
    return [
      {
        chunkIndex: 0,
        chunkRole: 'body',
        chunkSummary: summarizeText(normalized),
        contentText: normalized,
        tokenEstimate: tokenEstimate(normalized),
      },
    ] as Array<Omit<NewPlatformSkillRevisionResourceChunk, 'id' | 'resourceBodyId' | 'createdAt'>>;
  }
  const chunks: Array<Omit<NewPlatformSkillRevisionResourceChunk, 'id' | 'resourceBodyId' | 'createdAt'>> = [
    {
      chunkIndex: 0,
      chunkRole: 'summary',
      chunkSummary: summarizeText(normalized),
      contentText: normalized.slice(0, 600),
      tokenEstimate: tokenEstimate(normalized.slice(0, 600)),
    },
  ];
  let chunkIndex = 1;
  for (let offset = 0; offset < normalized.length; offset += 2400) {
    const slice = normalized.slice(offset, offset + 2400);
    chunks.push({
      chunkIndex,
      chunkRole: 'body',
      chunkSummary: summarizeText(slice),
      contentText: slice,
      tokenEstimate: tokenEstimate(slice),
    });
    chunkIndex += 1;
  }
  return chunks;
}

export class PlatformSkillDAO {
  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const payload = error as { code?: unknown; cause?: { code?: unknown } };
    return payload.code === '23505' || payload.cause?.code === '23505';
  }

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

  async listRevisionResources(revisionId: string) {
    return db
      .select()
      .from(platformSkillRevisionResources)
      .where(eq(platformSkillRevisionResources.revisionId, revisionId))
      .orderBy(asc(platformSkillRevisionResources.resourcePath));
  }

  async getRevisionResource(revisionId: string, resourcePath: string) {
    const [row] = await db
      .select()
      .from(platformSkillRevisionResources)
      .where(
        and(
          eq(platformSkillRevisionResources.revisionId, revisionId),
          eq(platformSkillRevisionResources.resourcePath, resourcePath)
        )
      )
      .limit(1);
    return row || null;
  }

  private async replaceRevisionResourcesTx(
    tx: any,
    revisionId: string,
    resources: Array<Omit<NewPlatformSkillRevisionResource, 'id' | 'revisionId' | 'createdAt'>>
  ) {
    await tx
      .delete(platformSkillRevisionResources)
      .where(eq(platformSkillRevisionResources.revisionId, revisionId));

    if (resources.length === 0) {
      return [];
    }

    return tx
      .insert(platformSkillRevisionResources)
      .values(
        resources.map((item) => ({
          revisionId,
          resourcePath: asText(item.resourcePath),
          resourceType: asText(item.resourceType) || 'reference',
          contentMarkdown: asText(item.contentMarkdown),
        }))
      )
      .returning();
  }

  private async replaceRevisionLayeredContentTx(
    tx: any,
    revision: { id: string; nameSnapshot: string; descriptionSnapshot: string; bodyMarkdown: string },
    resources: Array<Omit<NewPlatformSkillRevisionResource, 'id' | 'revisionId' | 'createdAt'>>,
    layeredImport?: SkillImportPreview | null
  ) {
    await tx.delete(platformSkillRevisionEntries).where(eq(platformSkillRevisionEntries.revisionId, revision.id));
    await tx
      .delete(platformSkillRevisionResourceLinks)
      .where(eq(platformSkillRevisionResourceLinks.revisionId, revision.id));
    await tx
      .delete(platformSkillRevisionResourceIndexes)
      .where(eq(platformSkillRevisionResourceIndexes.revisionId, revision.id));

    const [entry] = await tx
      .insert(platformSkillRevisionEntries)
      .values({
        revisionId: revision.id,
        entryName: layeredImport?.entry.entryName || revision.nameSnapshot,
        entryDescription: layeredImport?.entry.entryDescription || revision.descriptionSnapshot,
        bodyMarkdown: layeredImport?.entry.bodyMarkdown || revision.bodyMarkdown,
        allowedToolsJson: [],
        renderVersion: 1,
        updatedAt: new Date(),
      } satisfies Omit<NewPlatformSkillRevisionEntry, 'id' | 'createdAt'>)
      .returning();

    const layeredResources = layeredImport?.resources || [];
    const resourcesForLayeredWrite = layeredResources.length
      ? layeredResources.map((resource, index) => ({
          sortOrder: index,
          resourceKey: resource.resourceKey,
          resourcePath: resource.resourcePath,
          resourceKind: resource.resourceKind,
          contentStorage: resource.contentStorage || 'database',
          mimeType: resource.mimeType || 'text/markdown',
          storagePath: resource.storagePath || null,
          storageLocatorJson: resource.storageLocatorJson || null,
          title: resource.title,
          summary: resource.summary,
          contentFormat: resource.contentFormat,
          contentMode: resource.contentMode,
          fullTextHash: resource.fullTextHash,
          contentSize: resource.contentSize,
          chunks: resource.chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            chunkRole: chunk.chunkRole,
            chunkSummary: chunk.chunkSummary,
            contentText: chunk.contentText,
            tokenEstimate: chunk.tokenEstimate,
          })),
        }))
      : resources.map((resource, index) => ({
          sortOrder: index,
          resourceKey: normalizeResourceKey(
            `${resource.resourceType}_${index + 1}_${asText(resource.resourcePath).split('/').pop() || 'resource'}`
          ),
          resourcePath: asText(resource.resourcePath),
          resourceKind: asText(resource.resourceType) || 'reference',
          contentStorage: 'database' as const,
          mimeType: 'text/markdown' as const,
          storagePath: null,
          storageLocatorJson: null,
          title: asText(resource.resourcePath).split('/').pop() || asText(resource.resourcePath),
          summary: summarizeText(asText(resource.contentMarkdown)),
          contentFormat: 'markdown' as const,
          contentMode: asText(resource.contentMarkdown).length > 2400 ? ('chunked' as const) : ('inline' as const),
          fullTextHash: null,
          contentSize: Buffer.byteLength(asText(resource.contentMarkdown), 'utf8'),
          chunks: splitContentChunks(asText(resource.contentMarkdown)),
        }));

    if (!resourcesForLayeredWrite.length) {
      return { entry, resourceIndexes: [] };
    }

    const resourceIndexes = [];
    for (const resource of resourcesForLayeredWrite) {
      const [resourceIndex] = await tx
        .insert(platformSkillRevisionResourceIndexes)
        .values({
          revisionId: revision.id,
          resourceKey: normalizeResourceKey(resource.resourceKey),
          resourcePath: asText(resource.resourcePath),
          resourceKind: asText(resource.resourceKind) || 'reference',
          contentStorage: resource.contentStorage,
          mimeType: resource.mimeType,
          storagePath: resource.storagePath,
          storageLocatorJson: resource.storageLocatorJson,
          title: asText(resource.title),
          summary: asText(resource.summary),
          loadStage: 'on_demand',
          sortOrder: resource.sortOrder,
          updatedAt: new Date(),
        } satisfies Omit<NewPlatformSkillRevisionResourceIndex, 'id' | 'createdAt'>)
        .returning();

      if (resource.contentStorage === 'database') {
        const [resourceBody] = await tx
          .insert(platformSkillRevisionResourceBodies)
          .values({
            resourceIndexId: resourceIndex.id,
            contentFormat: resource.contentFormat,
            contentMode: resource.contentMode,
            fullTextHash: resource.fullTextHash,
            contentSize: resource.contentSize,
            updatedAt: new Date(),
          } satisfies Omit<NewPlatformSkillRevisionResourceBody, 'id' | 'createdAt'>)
          .returning();

        if (resource.chunks.length) {
          await tx.insert(platformSkillRevisionResourceChunks).values(
            resource.chunks.map((chunk) => ({
              resourceBodyId: resourceBody.id,
              chunkIndex: chunk.chunkIndex,
              chunkRole: chunk.chunkRole,
              chunkSummary: chunk.chunkSummary,
              contentText: chunk.contentText,
              tokenEstimate: chunk.tokenEstimate,
            }))
          );
        }
      }

      await tx.insert(platformSkillRevisionResourceLinks).values({
        revisionId: revision.id,
        fromType: 'entry',
        fromId: entry.id,
        toResourceIndexId: resourceIndex.id,
        linkType: 'suggested',
      } satisfies Omit<NewPlatformSkillRevisionResourceLink, 'id' | 'createdAt'>);

      resourceIndexes.push(resourceIndex);
    }

    return { entry, resourceIndexes };
  }

  async createSkillWithRevision(input: {
    skill: Omit<NewPlatformSkill, 'publishedRevisionId' | 'createdAt' | 'updatedAt'>;
    revision: Omit<NewPlatformSkillRevision, 'skillId' | 'revisionNumber' | 'publishedAt' | 'createdAt'>;
    resources?: Array<Omit<NewPlatformSkillRevisionResource, 'id' | 'revisionId' | 'createdAt'>>;
    layeredImport?: SkillImportPreview | null;
  }) {
    return db.transaction(async (tx) => {
      const [skill] = await tx
        .insert(platformSkills)
        .values({
          ...input.skill,
          slug: asText(input.skill.slug).toLowerCase(),
          metadataJson: input.skill.metadataJson || {},
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

      const resources = await this.replaceRevisionResourcesTx(tx, revision.id, Array.isArray(input.resources) ? input.resources : []);
      await this.replaceRevisionLayeredContentTx(
        tx,
        revision,
        Array.isArray(input.resources) ? input.resources : [],
        input.layeredImport || null
      );

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
        resources,
      };
    });
  }

  async createPublishedRevision(
    skillId: string,
    input: {
      name: string;
      description: string;
      category: string;
      metadataJson?: Record<string, unknown> | null;
      bodyMarkdown: string;
      createdBy?: string | null;
      resources?: Array<Omit<NewPlatformSkillRevisionResource, 'id' | 'revisionId' | 'createdAt'>>;
      layeredImport?: SkillImportPreview | null;
    }
  ) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await db.transaction(async (tx) => {
          // Serialize revision allocation for the same skill across concurrent seeders/writers.
          await tx.execute(
            sql`select ${platformSkills.id} from ${platformSkills} where ${platformSkills.id} = ${skillId} for update`
          );

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

          const resources = await this.replaceRevisionResourcesTx(
            tx,
            revision.id,
            Array.isArray(input.resources) ? input.resources : []
          );
          await this.replaceRevisionLayeredContentTx(
            tx,
            revision,
            Array.isArray(input.resources) ? input.resources : [],
            input.layeredImport || null
          );

          const [updatedSkill] = await tx
            .update(platformSkills)
            .set({
              name: input.name,
              description: input.description,
              category: input.category,
              metadataJson: input.metadataJson || {},
              publishedRevisionId: revision.id,
              updatedAt: new Date(),
            })
            .where(eq(platformSkills.id, skillId))
            .returning();

          return {
            skill: updatedSkill,
            revision,
            resources,
          };
        });
      } catch (error) {
        if (this.isUniqueViolation(error) && attempt < maxAttempts) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('createPublishedRevision failed after retries');
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

  async updateSkillMetadata(skillId: string, metadataJson: Record<string, unknown> | null) {
    const [row] = await db
      .update(platformSkills)
      .set({
        metadataJson: metadataJson || {},
        updatedAt: new Date(),
      })
      .where(eq(platformSkills.id, skillId))
      .returning();
    return row || null;
  }

  async getRevisionEntry(revisionId: string) {
    const [row] = await db
      .select()
      .from(platformSkillRevisionEntries)
      .where(eq(platformSkillRevisionEntries.revisionId, revisionId))
      .limit(1);
    return row || null;
  }

  async listRevisionResourceIndexes(revisionId: string) {
    return db
      .select()
      .from(platformSkillRevisionResourceIndexes)
      .where(eq(platformSkillRevisionResourceIndexes.revisionId, revisionId))
      .orderBy(asc(platformSkillRevisionResourceIndexes.sortOrder), asc(platformSkillRevisionResourceIndexes.resourcePath));
  }

  async getRevisionResourceBody(resourceIndexId: string) {
    const [row] = await db
      .select()
      .from(platformSkillRevisionResourceBodies)
      .where(eq(platformSkillRevisionResourceBodies.resourceIndexId, resourceIndexId))
      .limit(1);
    return row || null;
  }

  async listRevisionResourceChunks(resourceBodyId: string) {
    return db
      .select()
      .from(platformSkillRevisionResourceChunks)
      .where(eq(platformSkillRevisionResourceChunks.resourceBodyId, resourceBodyId))
      .orderBy(asc(platformSkillRevisionResourceChunks.chunkIndex));
  }
}

export const platformSkillDAO = new PlatformSkillDAO();
