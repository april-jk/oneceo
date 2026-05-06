import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql, gte, lte } from 'drizzle-orm';
import { db } from '../../config/database';
import { sessionApiTraces } from '../schema';

export type NewSessionApiTrace = typeof sessionApiTraces.$inferInsert;
export type SessionApiTrace = typeof sessionApiTraces.$inferSelect;

export type TraceType = 'llm_request' | 'tool_call' | 'service_api' | 'connector_api';

function createId(id?: string) {
  return id || randomUUID();
}

export class SessionApiTraceDAO {
  async create(data: Partial<NewSessionApiTrace> & { sessionId: string; traceType: string }) {
    const [trace] = await db
      .insert(sessionApiTraces)
      .values({
        id: createId(data.id),
        sessionId: data.sessionId,
        runId: data.runId || null,
        traceType: data.traceType,
        sequence: data.sequence ?? Math.floor(Date.now() / 1000),
        model: data.model || null,
        provider: data.provider || null,
        toolName: data.toolName || null,
        serviceName: data.serviceName || null,
        endpoint: data.endpoint || null,
        requestMethod: data.requestMethod || null,
        requestHeaders: data.requestHeaders || null,
        requestBody: data.requestBody || null,
        requestBodyText: data.requestBodyText || null,
        responseStatus: data.responseStatus || null,
        responseHeaders: data.responseHeaders || null,
        responseBody: data.responseBody || null,
        responseBodyText: data.responseBodyText || null,
        durationMs: data.durationMs || null,
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        promptTokens: data.promptTokens ?? 0,
        completionTokens: data.completionTokens ?? 0,
        cachedPromptTokens: data.cachedPromptTokens ?? 0,
        cacheCreationTokens: data.cacheCreationTokens ?? 0,
        totalTokens: data.totalTokens ?? 0,
        errorMessage: data.errorMessage || null,
        errorStack: data.errorStack || null,
        metadataJson: data.metadataJson || {},
        createdAt: new Date(),
      })
      .returning();
    return trace;
  }

  async findById(id: string) {
    const [trace] = await db
      .select()
      .from(sessionApiTraces)
      .where(eq(sessionApiTraces.id, id))
      .limit(1);
    return trace || null;
  }

  async findBySessionId(sessionId: string, options?: {
    type?: string;
    toolName?: string;
    model?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [eq(sessionApiTraces.sessionId, sessionId)];
    if (options?.type) {
      conditions.push(eq(sessionApiTraces.traceType, options.type));
    }
    if (options?.toolName) {
      conditions.push(eq(sessionApiTraces.toolName, options.toolName));
    }
    if (options?.model) {
      conditions.push(eq(sessionApiTraces.model, options.model));
    }

    const limit = Math.min(options?.limit ?? 100, 500);
    const offset = options?.offset ?? 0;

    return db
      .select()
      .from(sessionApiTraces)
      .where(and(...conditions))
      .orderBy(asc(sessionApiTraces.sequence), asc(sessionApiTraces.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async findByRunId(runId: string) {
    return db
      .select()
      .from(sessionApiTraces)
      .where(eq(sessionApiTraces.runId, runId))
      .orderBy(asc(sessionApiTraces.sequence), asc(sessionApiTraces.createdAt));
  }

  async countBySessionId(sessionId: string, options?: {
    type?: string;
    toolName?: string;
    model?: string;
  }) {
    const conditions = [eq(sessionApiTraces.sessionId, sessionId)];
    if (options?.type) {
      conditions.push(eq(sessionApiTraces.traceType, options.type));
    }
    if (options?.toolName) {
      conditions.push(eq(sessionApiTraces.toolName, options.toolName));
    }
    if (options?.model) {
      conditions.push(eq(sessionApiTraces.model, options.model));
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sessionApiTraces)
      .where(and(...conditions));
    return result?.count ?? 0;
  }

  async aggregate(options: {
    type?: string;
    toolName?: string;
    model?: string;
    sessionId?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    groupBy?: 'tool_name' | 'model' | 'service_name' | 'trace_type';
    limit?: number;
    offset?: number;
  }) {
    const conditions: any[] = [];

    if (options.type) {
      conditions.push(eq(sessionApiTraces.traceType, options.type));
    }
    if (options.toolName) {
      conditions.push(eq(sessionApiTraces.toolName, options.toolName));
    }
    if (options.model) {
      conditions.push(eq(sessionApiTraces.model, options.model));
    }
    if (options.sessionId) {
      conditions.push(eq(sessionApiTraces.sessionId, options.sessionId));
    }
    if (options.from) {
      conditions.push(gte(sessionApiTraces.createdAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(sessionApiTraces.createdAt, options.to));
    }

    const groupByColumn = options.groupBy || 'trace_type';
    const limit = Math.min(options.limit ?? 100, 500);
    const offset = options.offset ?? 0;

    const dimensionColumn =
      groupByColumn === 'tool_name'
        ? sessionApiTraces.toolName
        : groupByColumn === 'model'
          ? sessionApiTraces.model
          : groupByColumn === 'service_name'
            ? sessionApiTraces.serviceName
            : sessionApiTraces.traceType;

    return db
      .select({
        dimension: dimensionColumn,
        count: sql<number>`count(*)`,
        avgDurationMs: sql<number>`COALESCE(AVG(${sessionApiTraces.durationMs}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${sessionApiTraces.totalTokens}), 0)`,
        errorCount: sql<number>`count(CASE WHEN ${sessionApiTraces.errorMessage} IS NOT NULL THEN 1 END)`,
      })
      .from(sessionApiTraces)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(dimensionColumn)
      .orderBy(desc(sql`count`))
      .limit(limit)
      .offset(offset);
  }

  async stats(options: {
    type?: string;
    from?: Date;
    to?: Date;
  }) {
    const conditions: any[] = [];

    if (options.type) {
      conditions.push(eq(sessionApiTraces.traceType, options.type));
    }
    if (options.from) {
      conditions.push(gte(sessionApiTraces.createdAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(sessionApiTraces.createdAt, options.to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [overall] = await db
      .select({
        totalCalls: sql<number>`count(*)`,
        avgDurationMs: sql<number>`COALESCE(AVG(${sessionApiTraces.durationMs}), 0)`,
        errorCount: sql<number>`count(CASE WHEN ${sessionApiTraces.errorMessage} IS NOT NULL THEN 1 END)`,
        totalTokens: sql<number>`COALESCE(SUM(${sessionApiTraces.totalTokens}), 0)`,
      })
      .from(sessionApiTraces)
      .where(whereClause);

    const byType = await db
      .select({
        type: sessionApiTraces.traceType,
        count: sql<number>`count(*)`,
      })
      .from(sessionApiTraces)
      .where(whereClause)
      .groupBy(sessionApiTraces.traceType)
      .orderBy(desc(sql`count`));

    const byTool = await db
      .select({
        toolName: sessionApiTraces.toolName,
        count: sql<number>`count(*)`,
        avgDurationMs: sql<number>`COALESCE(AVG(${sessionApiTraces.durationMs}), 0)`,
      })
      .from(sessionApiTraces)
      .where(whereClause)
      .groupBy(sessionApiTraces.toolName)
      .orderBy(desc(sql`count`))
      .limit(20);

    const byModel = await db
      .select({
        model: sessionApiTraces.model,
        count: sql<number>`count(*)`,
        totalTokens: sql<number>`COALESCE(SUM(${sessionApiTraces.totalTokens}), 0)`,
      })
      .from(sessionApiTraces)
      .where(whereClause)
      .groupBy(sessionApiTraces.model)
      .orderBy(desc(sql`count`))
      .limit(20);

    return {
      totalCalls: overall?.totalCalls ?? 0,
      avgDurationMs: overall?.avgDurationMs ?? 0,
      errorCount: overall?.errorCount ?? 0,
      totalTokens: overall?.totalTokens ?? 0,
      byType: byType.filter((item) => item.type != null),
      byTool: byTool.filter((item) => item.toolName != null),
      byModel: byModel.filter((item) => item.model != null),
    };
  }

  async trend(options: {
    type?: string;
    from?: Date;
    to?: Date;
    interval?: 'hour' | 'day';
  }) {
    const conditions: any[] = [];
    if (options.type) {
      conditions.push(eq(sessionApiTraces.traceType, options.type));
    }
    if (options.from) {
      conditions.push(gte(sessionApiTraces.createdAt, options.from));
    }
    if (options.to) {
      conditions.push(lte(sessionApiTraces.createdAt, options.to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const interval = options.interval || 'hour';
    const timeBucket = interval === 'day'
      ? sql`DATE_TRUNC('day', ${sessionApiTraces.createdAt})`
      : sql`DATE_TRUNC('hour', ${sessionApiTraces.createdAt})`;

    return db
      .select({
        bucket: sql<string>`${timeBucket}::text`,
        count: sql<number>`count(*)`,
        avgDurationMs: sql<number>`COALESCE(AVG(${sessionApiTraces.durationMs}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${sessionApiTraces.totalTokens}), 0)`,
        errorCount: sql<number>`count(CASE WHEN ${sessionApiTraces.errorMessage} IS NOT NULL THEN 1 END)`,
      })
      .from(sessionApiTraces)
      .where(whereClause)
      .groupBy(timeBucket)
      .orderBy(asc(timeBucket))
      .limit(168); // max 7 days hourly
  }

  async deleteBySessionId(sessionId: string) {
    await db
      .delete(sessionApiTraces)
      .where(eq(sessionApiTraces.sessionId, sessionId));
  }

  async deleteOlderThan(date: Date) {
    await db
      .delete(sessionApiTraces)
      .where(lte(sessionApiTraces.createdAt, date));
  }

  async updateById(
    id: string,
    data: Partial<Pick<NewSessionApiTrace,
      | 'responseStatus'
      | 'responseHeaders'
      | 'responseBody'
      | 'responseBodyText'
      | 'durationMs'
      | 'completedAt'
      | 'promptTokens'
      | 'completionTokens'
      | 'cachedPromptTokens'
      | 'cacheCreationTokens'
      | 'totalTokens'
      | 'errorMessage'
      | 'errorStack'
      | 'metadataJson'
    >>
  ) {
    const [trace] = await db
      .update(sessionApiTraces)
      .set({
        ...data,
      })
      .where(eq(sessionApiTraces.id, id))
      .returning();
    return trace || null;
  }
}

export const sessionApiTraceDAO = new SessionApiTraceDAO();
