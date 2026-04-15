import { and, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  appUserLegacyIdMappings,
  appUserSessions,
  appUsers,
  sandboxExecutionEnvironments,
  taskCreationSessions,
} from '../db/schema';
import { appUserDAO } from '../db/dao';

type AdminAppUserStatus = 'active' | 'disabled' | string;
type AdminAppUserActivityFilter = 'all' | 'active_7d' | 'active_30d' | 'inactive_30d';
type AdminAppUserBinaryFilter = 'all' | 'yes' | 'no';
type AdminAppUserOwnershipHealth = 'healthy' | 'legacy_mapping' | 'anomaly';

type ListAppUsersInput = {
  limit?: number;
  query?: string;
  status?: AdminAppUserStatus | 'all';
  activity?: AdminAppUserActivityFilter;
  hasSession?: AdminAppUserBinaryFilter;
  hasConversation?: AdminAppUserBinaryFilter;
  hasSandbox?: AdminAppUserBinaryFilter;
  ownershipHealth?: AdminAppUserOwnershipHealth | 'all';
};

type UserSessionRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
};

type UserAggregate = {
  sessionCount: number;
  activeSessionCount: number;
  latestSession: UserSessionRow | null;
  conversationCount: number;
  lastConversationAt: Date | null;
  sandboxCount: number;
  lastSandboxAt: Date | null;
  legacyMappingCount: number;
  lastLegacySeenAt: Date | null;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
}

function maxDate(values: Array<Date | null | undefined>) {
  let winner: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!winner || value.getTime() > winner.getTime()) {
      winner = value;
    }
  }
  return winner;
}

function isActiveSession(session: Pick<UserSessionRow, 'expiresAt' | 'revokedAt'>, now = new Date()) {
  return !session.revokedAt && session.expiresAt.getTime() > now.getTime();
}

function buildOwnershipHealth(input: {
  userStatus: string;
  activeSessionCount: number;
  conversationCount: number;
  sandboxCount: number;
  legacyMappingCount: number;
}) {
  if (input.userStatus !== 'active' && input.activeSessionCount > 0) {
    return {
      state: 'anomaly' as const,
      reason: '账号已禁用但仍存在未过期登录态',
    };
  }

  if (input.sandboxCount > 0 && input.conversationCount === 0) {
    return {
      state: 'anomaly' as const,
      reason: '存在 Sandbox 运行记录但未关联到会话记录',
    };
  }

  if (input.legacyMappingCount > 0) {
    return {
      state: 'legacy_mapping' as const,
      reason: '存在 legacy user id 归属映射',
    };
  }

  return {
    state: 'healthy' as const,
    reason: '归属关系正常',
  };
}

function toPublicUser(user: Awaited<ReturnType<typeof appUserDAO.getById>>) {
  if (!user) return null;
  return {
    id: String(user.id),
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
    lastLoginAt: toIso(user.lastLoginAt),
  };
}

function toPublicSession(row: UserSessionRow) {
  return {
    id: row.id,
    expiresAt: toIso(row.expiresAt),
    revokedAt: toIso(row.revokedAt),
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    lastSeenAt: toIso(row.lastSeenAt),
    isActive: isActiveSession(row),
  };
}

export class AdminAppUserService {
  private readonly defaultLimit = 120;

  async listUsers(input: ListAppUsersInput = {}) {
    const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 200) : this.defaultLimit;
    const normalizedQuery = asText(input.query);
    const normalizedStatus = asText(input.status || 'all');
    const activity = asText(input.activity || 'all') as AdminAppUserActivityFilter;
    const hasSession = asText(input.hasSession || 'all') as AdminAppUserBinaryFilter;
    const hasConversation = asText(input.hasConversation || 'all') as AdminAppUserBinaryFilter;
    const hasSandbox = asText(input.hasSandbox || 'all') as AdminAppUserBinaryFilter;
    const ownershipHealth = asText(input.ownershipHealth || 'all') as AdminAppUserOwnershipHealth | 'all';
    const summary = await this.buildSummary();

    let query = db
      .select()
      .from(appUsers)
      .orderBy(desc(appUsers.updatedAt), desc(appUsers.createdAt))
      .limit(Math.min(Math.max(limit * 4, limit), 600));

    const conditions = [];
    if (normalizedQuery) {
      const pattern = `%${normalizedQuery}%`;
      conditions.push(
        or(
          ilike(appUsers.email, pattern),
          ilike(appUsers.displayName, pattern),
          sql`${appUsers.id}::text ilike ${pattern}`
        )
      );
    }
    if (normalizedStatus && normalizedStatus !== 'all') {
      conditions.push(eq(appUsers.status, normalizedStatus));
    }
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const users = await query;
    const userIds = users.map((item) => String(item.id));
    const aggregates = await this.buildUserAggregates(userIds);
    const now = new Date();
    const active7dSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const active30dSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const items = users
      .map((user) => {
        const userId = String(user.id);
        const aggregate = aggregates.get(userId) || this.emptyAggregate();
        const lastActivityAt = maxDate([
          safeDate(user.lastLoginAt),
          safeDate(aggregate.latestSession?.lastSeenAt),
          aggregate.lastConversationAt,
          aggregate.lastSandboxAt,
          aggregate.lastLegacySeenAt,
        ]);
        const ownership = buildOwnershipHealth({
          userStatus: user.status,
          activeSessionCount: aggregate.activeSessionCount,
          conversationCount: aggregate.conversationCount,
          sandboxCount: aggregate.sandboxCount,
          legacyMappingCount: aggregate.legacyMappingCount,
        });

        return {
          ...toPublicUser(user)!,
          latestSession: aggregate.latestSession ? toPublicSession(aggregate.latestSession) : null,
          sessionCount: aggregate.sessionCount,
          activeSessionCount: aggregate.activeSessionCount,
          conversationCount: aggregate.conversationCount,
          lastConversationAt: toIso(aggregate.lastConversationAt),
          sandboxCount: aggregate.sandboxCount,
          lastSandboxAt: toIso(aggregate.lastSandboxAt),
          legacyMappingCount: aggregate.legacyMappingCount,
          lastLegacySeenAt: toIso(aggregate.lastLegacySeenAt),
          lastActivityAt: toIso(lastActivityAt),
          ownershipHealth: ownership.state,
          ownershipReason: ownership.reason,
        };
      })
      .filter((item) => {
        const lastActivityAt = safeDate(item.lastActivityAt);

        if (activity === 'active_7d' && (!lastActivityAt || lastActivityAt.getTime() < active7dSince.getTime())) {
          return false;
        }
        if (activity === 'active_30d' && (!lastActivityAt || lastActivityAt.getTime() < active30dSince.getTime())) {
          return false;
        }
        if (activity === 'inactive_30d' && lastActivityAt && lastActivityAt.getTime() >= active30dSince.getTime()) {
          return false;
        }
        if (hasSession === 'yes' && item.sessionCount === 0) return false;
        if (hasSession === 'no' && item.sessionCount > 0) return false;
        if (hasConversation === 'yes' && item.conversationCount === 0) return false;
        if (hasConversation === 'no' && item.conversationCount > 0) return false;
        if (hasSandbox === 'yes' && item.sandboxCount === 0) return false;
        if (hasSandbox === 'no' && item.sandboxCount > 0) return false;
        if (ownershipHealth !== 'all' && item.ownershipHealth !== ownershipHealth) return false;
        return true;
      })
      .slice(0, limit);

    return {
      summary,
      filters: {
        limit,
        query: normalizedQuery || null,
        status: normalizedStatus || 'all',
        activity,
        hasSession,
        hasConversation,
        hasSandbox,
        ownershipHealth,
      },
      items,
    };
  }

  async getUserDetail(userId: string) {
    const normalizedUserId = asText(userId);
    const user = await appUserDAO.getById(normalizedUserId);
    if (!user) {
      throw new Error('用户不存在');
    }

    const [aggregateMap, sessionRows, conversationRows, sandboxRows, mappingRows] = await Promise.all([
      this.buildUserAggregates([normalizedUserId]),
      db
        .select({
          id: appUserSessions.id,
          userId: appUserSessions.userId,
          expiresAt: appUserSessions.expiresAt,
          revokedAt: appUserSessions.revokedAt,
          userAgent: appUserSessions.userAgent,
          ipAddress: appUserSessions.ipAddress,
          createdAt: appUserSessions.createdAt,
          updatedAt: appUserSessions.updatedAt,
          lastSeenAt: appUserSessions.lastSeenAt,
        })
        .from(appUserSessions)
        .where(eq(appUserSessions.userId, normalizedUserId as any))
        .orderBy(desc(appUserSessions.lastSeenAt), desc(appUserSessions.createdAt))
        .limit(20),
      db
        .select({
          id: taskCreationSessions.id,
          userId: taskCreationSessions.userId,
          status: taskCreationSessions.status,
          createdAt: taskCreationSessions.createdAt,
          updatedAt: taskCreationSessions.updatedAt,
          completedAt: taskCreationSessions.completedAt,
        })
        .from(taskCreationSessions)
        .where(sql`btrim(coalesce(${taskCreationSessions.userId}, '')) = ${normalizedUserId}`)
        .orderBy(desc(taskCreationSessions.updatedAt), desc(taskCreationSessions.createdAt))
        .limit(12),
      db
        .select({
          sandboxId: sandboxExecutionEnvironments.id,
          sessionId: sandboxExecutionEnvironments.sessionId,
          taskSessionId: taskCreationSessions.id,
          orchestratorSessionId: sandboxExecutionEnvironments.orchestratorSessionId,
          vmName: sandboxExecutionEnvironments.vmName,
          baseImage: sandboxExecutionEnvironments.baseImage,
          status: sandboxExecutionEnvironments.status,
          metadata: sandboxExecutionEnvironments.metadata,
          createdAt: sandboxExecutionEnvironments.createdAt,
          updatedAt: sandboxExecutionEnvironments.updatedAt,
          closedAt: sandboxExecutionEnvironments.closedAt,
        })
        .from(taskCreationSessions)
        .innerJoin(
          sandboxExecutionEnvironments,
          sql`${sandboxExecutionEnvironments.metadata} ->> 'taskSessionId' = (${taskCreationSessions.id})::text`
        )
        .where(sql`btrim(coalesce(${taskCreationSessions.userId}, '')) = ${normalizedUserId}`)
        .orderBy(desc(sandboxExecutionEnvironments.updatedAt), desc(sandboxExecutionEnvironments.createdAt))
        .limit(12),
      db
        .select({
          id: appUserLegacyIdMappings.id,
          legacyUserId: appUserLegacyIdMappings.legacyUserId,
          source: appUserLegacyIdMappings.source,
          firstSeenAt: appUserLegacyIdMappings.firstSeenAt,
          lastSeenAt: appUserLegacyIdMappings.lastSeenAt,
          createdAt: appUserLegacyIdMappings.createdAt,
          updatedAt: appUserLegacyIdMappings.updatedAt,
        })
        .from(appUserLegacyIdMappings)
        .where(eq(appUserLegacyIdMappings.appUserId, normalizedUserId as any))
        .orderBy(desc(appUserLegacyIdMappings.lastSeenAt), desc(appUserLegacyIdMappings.createdAt))
        .limit(20),
    ]);

    const aggregate = aggregateMap.get(normalizedUserId) || this.emptyAggregate();
    const ownership = buildOwnershipHealth({
      userStatus: user.status,
      activeSessionCount: aggregate.activeSessionCount,
      conversationCount: aggregate.conversationCount,
      sandboxCount: aggregate.sandboxCount,
      legacyMappingCount: aggregate.legacyMappingCount,
    });
    const lastActivityAt = maxDate([
      safeDate(user.lastLoginAt),
      safeDate(aggregate.latestSession?.lastSeenAt),
      aggregate.lastConversationAt,
      aggregate.lastSandboxAt,
      aggregate.lastLegacySeenAt,
    ]);

    return {
      user: toPublicUser(user),
      stats: {
        sessionCount: aggregate.sessionCount,
        activeSessionCount: aggregate.activeSessionCount,
        conversationCount: aggregate.conversationCount,
        sandboxCount: aggregate.sandboxCount,
        legacyMappingCount: aggregate.legacyMappingCount,
        lastActivityAt: toIso(lastActivityAt),
        lastConversationAt: toIso(aggregate.lastConversationAt),
        lastSandboxAt: toIso(aggregate.lastSandboxAt),
        lastLegacySeenAt: toIso(aggregate.lastLegacySeenAt),
        ownershipHealth: ownership.state,
        ownershipReason: ownership.reason,
      },
      recentSessions: sessionRows.map((row) => toPublicSession(row)),
      recentConversations: conversationRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        title: `会话 ${String(row.id).slice(-6)}`,
        status: row.status,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        completedAt: toIso(row.completedAt),
      })),
      recentSandboxes: sandboxRows.map((row) => ({
        sandboxId: row.sandboxId,
        sessionId: row.sessionId,
        taskSessionId: row.taskSessionId,
        orchestratorSessionId: row.orchestratorSessionId,
        vmName: row.vmName,
        baseImage: row.baseImage,
        status: row.status,
        metadata: row.metadata,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        closedAt: toIso(row.closedAt),
      })),
      legacyMappings: mappingRows.map((row) => ({
        id: row.id,
        legacyUserId: row.legacyUserId,
        source: row.source,
        firstSeenAt: toIso(row.firstSeenAt),
        lastSeenAt: toIso(row.lastSeenAt),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
    };
  }

  async updateUserStatus(userId: string, status: 'active' | 'disabled') {
    const normalizedUserId = asText(userId);
    const normalizedStatus = status === 'disabled' ? 'disabled' : 'active';
    const [updatedUser] = await db
      .update(appUsers)
      .set({
        status: normalizedStatus,
        updatedAt: new Date(),
      })
      .where(eq(appUsers.id, normalizedUserId as any))
      .returning();

    if (!updatedUser) {
      throw new Error('用户不存在');
    }

    let revokedSessionCount = 0;
    if (normalizedStatus === 'disabled') {
      revokedSessionCount = await this.revokeUserSessionsInternal(normalizedUserId);
    }

    const detail = await this.getUserDetail(normalizedUserId);
    return {
      ...detail,
      revokedSessionCount,
    };
  }

  async revokeUserSessions(userId: string) {
    const normalizedUserId = asText(userId);
    const user = await appUserDAO.getById(normalizedUserId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const revokedSessionCount = await this.revokeUserSessionsInternal(normalizedUserId);
    const detail = await this.getUserDetail(normalizedUserId);
    return {
      ...detail,
      revokedSessionCount,
    };
  }

  private async revokeUserSessionsInternal(userId: string) {
    const now = new Date();
    const revokedRows = await db
      .update(appUserSessions)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(and(eq(appUserSessions.userId, userId as any), sql`${appUserSessions.revokedAt} is null`))
      .returning({ id: appUserSessions.id });

    return revokedRows.length;
  }

  private async buildSummary() {
    const now = new Date();
    const active7dSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalRow, disabledRow, active7dRow, mappingRow] = await Promise.all([
      db.select({ value: sql<number>`count(*)::int` }).from(appUsers),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(appUsers)
        .where(eq(appUsers.status, 'disabled')),
      db
        .select({ value: sql<number>`count(distinct ${appUserSessions.userId})::int` })
        .from(appUserSessions)
        .where(gt(appUserSessions.lastSeenAt, active7dSince)),
      db
        .select({ value: sql<number>`count(distinct ${appUserLegacyIdMappings.appUserId})::int` })
        .from(appUserLegacyIdMappings),
    ]);

    return {
      totalUsers: asNumber(totalRow[0]?.value),
      activeUsers7d: asNumber(active7dRow[0]?.value),
      disabledUsers: asNumber(disabledRow[0]?.value),
      ownershipAlertUsers: asNumber(mappingRow[0]?.value),
      generatedAt: new Date().toISOString(),
    };
  }

  private emptyAggregate(): UserAggregate {
    return {
      sessionCount: 0,
      activeSessionCount: 0,
      latestSession: null,
      conversationCount: 0,
      lastConversationAt: null,
      sandboxCount: 0,
      lastSandboxAt: null,
      legacyMappingCount: 0,
      lastLegacySeenAt: null,
    };
  }

  private async buildUserAggregates(userIds: string[]) {
    const normalizedIds = Array.from(new Set(userIds.map((item) => asText(item)).filter(Boolean)));
    const result = new Map<string, UserAggregate>();

    if (normalizedIds.length === 0) {
      return result;
    }

    const [sessionRows, conversationRows, sandboxRows, mappingRows] = await Promise.all([
      db
        .select({
          id: appUserSessions.id,
          userId: appUserSessions.userId,
          expiresAt: appUserSessions.expiresAt,
          revokedAt: appUserSessions.revokedAt,
          userAgent: appUserSessions.userAgent,
          ipAddress: appUserSessions.ipAddress,
          createdAt: appUserSessions.createdAt,
          updatedAt: appUserSessions.updatedAt,
          lastSeenAt: appUserSessions.lastSeenAt,
        })
        .from(appUserSessions)
        .where(inArray(appUserSessions.userId, normalizedIds as any))
        .orderBy(desc(appUserSessions.lastSeenAt), desc(appUserSessions.createdAt)),
      db
        .select({
          userId: taskCreationSessions.userId,
          conversationCount: sql<number>`count(*)::int`,
          lastConversationAt: sql<Date | null>`max(${taskCreationSessions.updatedAt})`,
        })
        .from(taskCreationSessions)
        .where(inArray(taskCreationSessions.userId, normalizedIds as any))
        .groupBy(taskCreationSessions.userId),
      db
        .select({
          userId: taskCreationSessions.userId,
          sandboxCount: sql<number>`count(${sandboxExecutionEnvironments.id})::int`,
          lastSandboxAt: sql<Date | null>`max(${sandboxExecutionEnvironments.updatedAt})`,
        })
        .from(taskCreationSessions)
        .innerJoin(
          sandboxExecutionEnvironments,
          sql`${sandboxExecutionEnvironments.metadata} ->> 'taskSessionId' = (${taskCreationSessions.id})::text`
        )
        .where(inArray(taskCreationSessions.userId, normalizedIds as any))
        .groupBy(taskCreationSessions.userId),
      db
        .select({
          appUserId: appUserLegacyIdMappings.appUserId,
          mappingCount: sql<number>`count(*)::int`,
          lastSeenAt: sql<Date | null>`max(${appUserLegacyIdMappings.lastSeenAt})`,
        })
        .from(appUserLegacyIdMappings)
        .where(inArray(appUserLegacyIdMappings.appUserId, normalizedIds as any))
        .groupBy(appUserLegacyIdMappings.appUserId),
    ]);

    for (const userId of normalizedIds) {
      result.set(userId, this.emptyAggregate());
    }

    const now = new Date();
    for (const row of sessionRows) {
      const userId = String(row.userId);
      const aggregate = result.get(userId) || this.emptyAggregate();
      aggregate.sessionCount += 1;
      if (isActiveSession(row, now)) {
        aggregate.activeSessionCount += 1;
      }
      if (!aggregate.latestSession) {
        aggregate.latestSession = row;
      }
      result.set(userId, aggregate);
    }

    for (const row of conversationRows) {
      const userId = asText(row.userId);
      if (!userId) continue;
      const aggregate = result.get(userId) || this.emptyAggregate();
      aggregate.conversationCount = asNumber(row.conversationCount);
      aggregate.lastConversationAt = safeDate(row.lastConversationAt);
      result.set(userId, aggregate);
    }

    for (const row of sandboxRows) {
      const userId = asText(row.userId);
      if (!userId) continue;
      const aggregate = result.get(userId) || this.emptyAggregate();
      aggregate.sandboxCount = asNumber(row.sandboxCount);
      aggregate.lastSandboxAt = safeDate(row.lastSandboxAt);
      result.set(userId, aggregate);
    }

    for (const row of mappingRows) {
      const userId = String(row.appUserId);
      const aggregate = result.get(userId) || this.emptyAggregate();
      aggregate.legacyMappingCount = asNumber(row.mappingCount);
      aggregate.lastLegacySeenAt = safeDate(row.lastSeenAt);
      result.set(userId, aggregate);
    }

    return result;
  }
}

export const adminAppUserService = new AdminAppUserService();
