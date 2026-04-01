import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  platformRuntimeArtifactChannels,
  platformRuntimeArtifactReleases,
  type NewPlatformRuntimeArtifactChannel,
  type NewPlatformRuntimeArtifactRelease,
} from '../schema';

export class PlatformRuntimeArtifactDAO {
  listReleases(filters?: {
    artifactType?: string;
    platform?: string;
    arch?: string;
    channel?: string;
    status?: string;
    query?: string;
  }) {
    const conditions: SQL<unknown>[] = [];
    if (filters?.artifactType) {
      conditions.push(eq(platformRuntimeArtifactReleases.artifactType, filters.artifactType));
    }
    if (filters?.platform) {
      conditions.push(eq(platformRuntimeArtifactReleases.platform, filters.platform));
    }
    if (filters?.arch) {
      conditions.push(eq(platformRuntimeArtifactReleases.arch, filters.arch));
    }
    if (filters?.channel) {
      conditions.push(eq(platformRuntimeArtifactReleases.channel, filters.channel));
    }
    if (filters?.status) {
      conditions.push(eq(platformRuntimeArtifactReleases.status, filters.status));
    }
    if (filters?.query) {
      conditions.push(ilike(platformRuntimeArtifactReleases.version, `%${filters.query}%`));
    }
    return db
      .select()
      .from(platformRuntimeArtifactReleases)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(platformRuntimeArtifactReleases.uploadedAt), desc(platformRuntimeArtifactReleases.createdAt));
  }

  async getReleaseById(releaseId: string) {
    const [row] = await db
      .select()
      .from(platformRuntimeArtifactReleases)
      .where(eq(platformRuntimeArtifactReleases.id, releaseId))
      .limit(1);
    return row;
  }

  async getReleaseByVersion(input: { artifactType: string; platform: string; arch: string; version: string }) {
    const [row] = await db
      .select()
      .from(platformRuntimeArtifactReleases)
      .where(
        and(
          eq(platformRuntimeArtifactReleases.artifactType, input.artifactType),
          eq(platformRuntimeArtifactReleases.platform, input.platform),
          eq(platformRuntimeArtifactReleases.arch, input.arch),
          eq(platformRuntimeArtifactReleases.version, input.version)
        )
      )
      .limit(1);
    return row;
  }

  async createRelease(data: NewPlatformRuntimeArtifactRelease) {
    const [row] = await db.insert(platformRuntimeArtifactReleases).values(data).returning();
    return row;
  }

  async updateRelease(releaseId: string, patch: Partial<NewPlatformRuntimeArtifactRelease>) {
    const [row] = await db
      .update(platformRuntimeArtifactReleases)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(platformRuntimeArtifactReleases.id, releaseId))
      .returning();
    return row;
  }

  async getChannel(input: { artifactType: string; platform: string; arch: string; channel: string }) {
    const [row] = await db
      .select()
      .from(platformRuntimeArtifactChannels)
      .where(
        and(
          eq(platformRuntimeArtifactChannels.artifactType, input.artifactType),
          eq(platformRuntimeArtifactChannels.platform, input.platform),
          eq(platformRuntimeArtifactChannels.arch, input.arch),
          eq(platformRuntimeArtifactChannels.channel, input.channel)
        )
      )
      .limit(1);
    return row;
  }

  async getPublishedRelease(input: { artifactType: string; platform: string; arch: string; channel: string }) {
    const [row] = await db
      .select({
        channel: platformRuntimeArtifactChannels,
        release: platformRuntimeArtifactReleases,
      })
      .from(platformRuntimeArtifactChannels)
      .innerJoin(
        platformRuntimeArtifactReleases,
        eq(platformRuntimeArtifactChannels.publishedReleaseId, platformRuntimeArtifactReleases.id)
      )
      .where(
        and(
          eq(platformRuntimeArtifactChannels.artifactType, input.artifactType),
          eq(platformRuntimeArtifactChannels.platform, input.platform),
          eq(platformRuntimeArtifactChannels.arch, input.arch),
          eq(platformRuntimeArtifactChannels.channel, input.channel)
        )
      )
      .limit(1);
    return row;
  }

  async publishRelease(input: {
    releaseId: string;
    artifactType: string;
    platform: string;
    arch: string;
    channel: string;
    updatedBy?: string | null;
  }) {
    return db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(platformRuntimeArtifactChannels)
        .where(
          and(
            eq(platformRuntimeArtifactChannels.artifactType, input.artifactType),
            eq(platformRuntimeArtifactChannels.platform, input.platform),
            eq(platformRuntimeArtifactChannels.arch, input.arch),
            eq(platformRuntimeArtifactChannels.channel, input.channel)
          )
        )
        .limit(1);
      const currentChannel = currentRows[0] || null;

      if (currentChannel?.publishedReleaseId && currentChannel.publishedReleaseId !== input.releaseId) {
        await tx
          .update(platformRuntimeArtifactReleases)
          .set({
            status: 'validated',
            updatedAt: new Date(),
          })
          .where(eq(platformRuntimeArtifactReleases.id, currentChannel.publishedReleaseId));
      }

      const [release] = await tx
        .update(platformRuntimeArtifactReleases)
        .set({
          status: 'published',
          publishedAt: new Date(),
          publishedBy: input.updatedBy || null,
          updatedAt: new Date(),
        })
        .where(eq(platformRuntimeArtifactReleases.id, input.releaseId))
        .returning();

      if (currentChannel) {
        await tx
          .update(platformRuntimeArtifactChannels)
          .set({
            publishedReleaseId: input.releaseId,
            updatedBy: input.updatedBy || null,
            updatedAt: new Date(),
          })
          .where(eq(platformRuntimeArtifactChannels.id, currentChannel.id));
      } else {
        await tx.insert(platformRuntimeArtifactChannels).values({
          artifactType: input.artifactType,
          platform: input.platform,
          arch: input.arch,
          channel: input.channel,
          publishedReleaseId: input.releaseId,
          updatedBy: input.updatedBy || null,
        } satisfies NewPlatformRuntimeArtifactChannel);
      }

      return {
        previousPublishedReleaseId: currentChannel?.publishedReleaseId || null,
        release,
      };
    });
  }

  async restorePublication(input: {
    releaseId: string;
    previousPublishedReleaseId?: string | null;
    artifactType: string;
    platform: string;
    arch: string;
    channel: string;
    updatedBy?: string | null;
  }) {
    return db.transaction(async (tx) => {
      await tx
        .update(platformRuntimeArtifactReleases)
        .set({
          status: 'validated',
          publishedAt: null,
          publishedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(platformRuntimeArtifactReleases.id, input.releaseId));

      if (input.previousPublishedReleaseId) {
        await tx
          .update(platformRuntimeArtifactReleases)
          .set({
            status: 'published',
            updatedAt: new Date(),
          })
          .where(eq(platformRuntimeArtifactReleases.id, input.previousPublishedReleaseId));

        const channel = await tx
          .select()
          .from(platformRuntimeArtifactChannels)
          .where(
            and(
              eq(platformRuntimeArtifactChannels.artifactType, input.artifactType),
              eq(platformRuntimeArtifactChannels.platform, input.platform),
              eq(platformRuntimeArtifactChannels.arch, input.arch),
              eq(platformRuntimeArtifactChannels.channel, input.channel)
            )
          )
          .limit(1);

        if (channel[0]) {
          await tx
            .update(platformRuntimeArtifactChannels)
            .set({
              publishedReleaseId: input.previousPublishedReleaseId,
              updatedBy: input.updatedBy || null,
              updatedAt: new Date(),
            })
            .where(eq(platformRuntimeArtifactChannels.id, channel[0].id));
        }
      } else {
        await tx
          .delete(platformRuntimeArtifactChannels)
          .where(
            and(
              eq(platformRuntimeArtifactChannels.artifactType, input.artifactType),
              eq(platformRuntimeArtifactChannels.platform, input.platform),
              eq(platformRuntimeArtifactChannels.arch, input.arch),
              eq(platformRuntimeArtifactChannels.channel, input.channel)
            )
          );
      }
    });
  }
}

export const platformRuntimeArtifactDAO = new PlatformRuntimeArtifactDAO();
