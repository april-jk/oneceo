import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { connectorAuthRequests, type NewConnectorAuthRequest } from '../schema';

export class ConnectorAuthRequestDAO {
  async create(data: NewConnectorAuthRequest) {
    const [row] = await db.insert(connectorAuthRequests).values(data).returning();
    return row;
  }

  async getByState(state: string) {
    const [row] = await db
      .select()
      .from(connectorAuthRequests)
      .where(eq(connectorAuthRequests.state, state))
      .limit(1);
    return row;
  }

  async markCompleted(requestId: string, status: string) {
    const [row] = await db
      .update(connectorAuthRequests)
      .set({
        status,
        completedAt: new Date(),
      })
      .where(eq(connectorAuthRequests.requestId, requestId))
      .returning();
    return row;
  }

  async markFailedByState(state: string, status: string) {
    const [row] = await db
      .update(connectorAuthRequests)
      .set({
        status,
        completedAt: new Date(),
      })
      .where(eq(connectorAuthRequests.state, state))
      .returning();
    return row;
  }

  async getPendingByRequestIdAndUser(requestId: string, userId: string) {
    const [row] = await db
      .select()
      .from(connectorAuthRequests)
      .where(
        and(
          eq(connectorAuthRequests.requestId, requestId),
          eq(connectorAuthRequests.userId, userId),
          eq(connectorAuthRequests.status, 'pending')
        )
      )
      .limit(1);
    return row;
  }
}

export const connectorAuthRequestDAO = new ConnectorAuthRequestDAO();
