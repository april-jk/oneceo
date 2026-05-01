import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  projectStorageResources,
  type NewProjectStorageResource,
} from '../schema';

const DEFAULT_PROVIDER = 'railway_bucket';

export class ProjectStorageResourceDAO {
  async getByUserAndProjectKey(
    userId: string,
    projectKey: string,
    provider = DEFAULT_PROVIDER
  ) {
    const [row] = await db
      .select()
      .from(projectStorageResources)
      .where(
        and(
          eq(projectStorageResources.userId, userId),
          eq(projectStorageResources.projectKey, projectKey),
          eq(projectStorageResources.provider, provider)
        )
      )
      .limit(1);
    return row || null;
  }

  async getBySessionId(sessionId: string, provider = DEFAULT_PROVIDER) {
    const [row] = await db
      .select()
      .from(projectStorageResources)
      .where(
        and(
          eq(projectStorageResources.sessionId, sessionId),
          eq(projectStorageResources.provider, provider)
        )
      )
      .limit(1);
    return row || null;
  }

  async upsert(data: NewProjectStorageResource) {
    const [row] = await db
      .insert(projectStorageResources)
      .values(data)
      .onConflictDoUpdate({
        target: [
          projectStorageResources.userId,
          projectStorageResources.projectKey,
          projectStorageResources.provider,
        ],
        set: {
          sessionId: data.sessionId,
          railwayBucketId: data.railwayBucketId,
          railwayProjectId: data.railwayProjectId,
          railwayEnvironmentId: data.railwayEnvironmentId,
          bucketName: data.bucketName,
          endpoint: data.endpoint,
          publicUrl: data.publicUrl ?? null,
          accessKeyId: data.accessKeyId,
          secretAccessKeyCiphertext: data.secretAccessKeyCiphertext,
          accessModel: data.accessModel ?? 'public_and_private',
          status: data.status ?? 'ready',
          metadataJson: data.metadataJson ?? {},
          lastCheckedAt: data.lastCheckedAt ?? new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async deleteByUserAndProjectKey(
    userId: string,
    projectKey: string,
    provider = DEFAULT_PROVIDER
  ) {
    const [row] = await db
      .delete(projectStorageResources)
      .where(
        and(
          eq(projectStorageResources.userId, userId),
          eq(projectStorageResources.projectKey, projectKey),
          eq(projectStorageResources.provider, provider)
        )
      )
      .returning();
    return row || null;
  }
}

export const projectStorageResourceDAO = new ProjectStorageResourceDAO();
