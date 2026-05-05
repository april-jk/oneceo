import { db } from '../../config/database';
import { apiRequestLogs } from '../schema';
import { and, desc, eq, gte, lte, sql, like } from 'drizzle-orm';

export type NewApiRequestLog = typeof apiRequestLogs.$inferInsert;
export type ApiRequestLog = typeof apiRequestLogs.$inferSelect;

export class ApiRequestLogDAO {
  async create(data: Partial<NewApiRequestLog> & { appUserId: string; method: string; path: string }) {
    const [log] = await db
      .insert(apiRequestLogs)
      .values({
        id: data.id,
        appUserId: data.appUserId,
        method: data.method,
        path: data.path,
        queryString: data.queryString || null,
        requestHeaders: data.requestHeaders || {},
        requestBodySummary: data.requestBodySummary || null,
        responseStatus: data.responseStatus || null,
        responseBodySummary: data.responseBodySummary || null,
        durationMs: data.durationMs || null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        taskSessionId: data.taskSessionId || null,
        metadataJson: data.metadataJson || {},
        createdAt: new Date(),
      })
      .returning();
    return log;
  }

  async findById(id: string) {
    const [log] = await db
      .select()
      .from(apiRequestLogs)
      .where(eq(apiRequestLogs.id, id))
      .limit(1);
    return log || null;
  }

  async list(options: {
    userId?: string;
    method?: string;
    path?: string;
    status?: number;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [];
    if (options.userId) {
      conditions.push(eq(apiRequestLogs.appUserId, options.userId));
    }
    if (options.method) {
      conditions.push(eq(apiRequestLogs.method, options.method));
    }
    if (options.path) {
      conditions.push(like(apiRequestLogs.path, `%${options.path}%`));
    }
    if (options.status !== undefined) {
      conditions.push(eq(apiRequestLogs.responseStatus, options.status));
    }
    if (options.from) {
      conditions.push(gte(apiRequestLogs.createdAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(apiRequestLogs.createdAt, options.to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const entries = await db
      .select()
      .from(apiRequestLogs)
      .where(whereClause)
      .orderBy(desc(apiRequestLogs.createdAt))
      .limit(options.limit || 50)
      .offset(options.offset || 0);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(apiRequestLogs)
      .where(whereClause);

    return {
      entries,
      total: Number(countResult[0]?.count || 0),
    };
  }

  async deleteOlderThan(cutoffDate: Date): Promise<number> {
    const result = await db
      .delete(apiRequestLogs)
      .where(gte(apiRequestLogs.createdAt, cutoffDate));
    return 0; // drizzle pg doesn't return count directly; we just execute
  }
}

export const apiRequestLogDAO = new ApiRequestLogDAO();
