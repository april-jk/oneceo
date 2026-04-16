import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { userConnectorAccounts, type NewUserConnectorAccount } from '../schema';

export class UserConnectorAccountDAO {
  async listByUserId(userId: string) {
    return db.select().from(userConnectorAccounts).where(eq(userConnectorAccounts.userId, userId));
  }

  async getByUserAndConnectorKey(userId: string, connectorKey: string) {
    const [row] = await db
      .select()
      .from(userConnectorAccounts)
      .where(and(eq(userConnectorAccounts.userId, userId), eq(userConnectorAccounts.connectorKey, connectorKey)))
      .limit(1);
    return row;
  }

  async upsert(data: NewUserConnectorAccount) {
    const [row] = await db
      .insert(userConnectorAccounts)
      .values(data)
      .onConflictDoUpdate({
        target: [userConnectorAccounts.userId, userConnectorAccounts.connectorKey],
        set: {
          authMode: data.authMode,
          authStatus: data.authStatus,
          displayName: data.displayName,
          configJson: data.configJson,
          secretCiphertext: data.secretCiphertext,
          lastAuthAt: data.lastAuthAt,
          lastError: data.lastError,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async deleteByUserAndConnectorKey(userId: string, connectorKey: string) {
    const [row] = await db
      .delete(userConnectorAccounts)
      .where(and(eq(userConnectorAccounts.userId, userId), eq(userConnectorAccounts.connectorKey, connectorKey)))
      .returning();
    return row;
  }
}

export const userConnectorAccountDAO = new UserConnectorAccountDAO();
