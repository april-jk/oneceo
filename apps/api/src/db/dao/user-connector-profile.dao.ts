import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { userConnectorProfiles, type NewUserConnectorProfile } from '../schema';

export class UserConnectorProfileDAO {
  async listByUserId(userId: string) {
    return db.select().from(userConnectorProfiles).where(eq(userConnectorProfiles.userId, userId));
  }

  async listByUserAndConnectorKey(userId: string, connectorKey: string) {
    return db
      .select()
      .from(userConnectorProfiles)
      .where(and(eq(userConnectorProfiles.userId, userId), eq(userConnectorProfiles.connectorKey, connectorKey)));
  }

  async getById(profileId: string) {
    const [row] = await db
      .select()
      .from(userConnectorProfiles)
      .where(eq(userConnectorProfiles.id, profileId))
      .limit(1);
    return row;
  }

  async getByIdAndUser(profileId: string, userId: string) {
    const [row] = await db
      .select()
      .from(userConnectorProfiles)
      .where(and(eq(userConnectorProfiles.id, profileId), eq(userConnectorProfiles.userId, userId)))
      .limit(1);
    return row;
  }

  async getDefaultByUserAndConnectorKey(userId: string, connectorKey: string) {
    const [row] = await db
      .select()
      .from(userConnectorProfiles)
      .where(
        and(
          eq(userConnectorProfiles.userId, userId),
          eq(userConnectorProfiles.connectorKey, connectorKey),
          eq(userConnectorProfiles.isDefault, true)
        )
      )
      .limit(1);
    return row;
  }

  async create(data: NewUserConnectorProfile) {
    const [row] = await db.insert(userConnectorProfiles).values(data).returning();
    return row;
  }

  async update(profileId: string, userId: string, patch: Partial<NewUserConnectorProfile>) {
    const [row] = await db
      .update(userConnectorProfiles)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(and(eq(userConnectorProfiles.id, profileId), eq(userConnectorProfiles.userId, userId)))
      .returning();
    return row;
  }

  async delete(profileId: string, userId: string) {
    const [row] = await db
      .delete(userConnectorProfiles)
      .where(and(eq(userConnectorProfiles.id, profileId), eq(userConnectorProfiles.userId, userId)))
      .returning();
    return row;
  }

  async clearDefaultForConnector(userId: string, connectorKey: string) {
    await db
      .update(userConnectorProfiles)
      .set({
        isDefault: false,
        updatedAt: new Date(),
      })
      .where(and(eq(userConnectorProfiles.userId, userId), eq(userConnectorProfiles.connectorKey, connectorKey)));
  }
}

export const userConnectorProfileDAO = new UserConnectorProfileDAO();
