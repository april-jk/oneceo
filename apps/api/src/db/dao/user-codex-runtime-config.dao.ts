import { eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { userCodexRuntimeConfigs, type NewUserCodexRuntimeConfig } from '../schema';

export class UserCodexRuntimeConfigDAO {
  async getByUserId(userId: string) {
    const [row] = await db
      .select()
      .from(userCodexRuntimeConfigs)
      .where(eq(userCodexRuntimeConfigs.userId, userId))
      .limit(1);
    return row || null;
  }

  async upsert(data: NewUserCodexRuntimeConfig) {
    const [row] = await db
      .insert(userCodexRuntimeConfigs)
      .values(data)
      .onConflictDoUpdate({
        target: [userCodexRuntimeConfigs.userId],
        set: {
          configToml: data.configToml,
          authJson: data.authJson,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
}

export const userCodexRuntimeConfigDAO = new UserCodexRuntimeConfigDAO();
