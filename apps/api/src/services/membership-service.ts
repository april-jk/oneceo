import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  appUsers,
  creditTransactions,
  membershipAuditLogs,
  membershipDailyRestores,
  membershipGrants,
  membershipPlans,
  type NewMembershipAuditLog,
  type NewMembershipGrant,
  type NewMembershipPlan,
  type NewUserMembership,
  userMemberships,
  userCredits,
} from '../db/schema';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type MembershipDbExecutor = typeof db | DbTransaction;
export type MembershipAgentLevel = 'lite' | 'pro' | 'max';

const AGENT_LEVELS: MembershipAgentLevel[] = ['lite', 'pro', 'max'];
const REGISTER_DEFAULT_SOURCE_TYPE = 'register_default';
export const DEFAULT_MEMBERSHIP_PLAN_CODE = 'default';
export const DEFAULT_MEMBERSHIP_PLAN_VALUES = {
  code: DEFAULT_MEMBERSHIP_PLAN_CODE,
  name: '默认会员',
  status: 'active',
  defaultCredits: 500,
  isDefault: true,
  allowedAgentLevelsJson: ['lite'],
  benefitsJson: ['Agent lite'],
  dailyAutoRestoreEnabled: true,
  dailyAutoRestoreCredits: 100,
  description: '系统默认会员类型：注册用户默认获得 500 积分，每日自动恢复 100 积分，仅开放 Agent Lite。',
  sortOrder: 0,
} satisfies Pick<NewMembershipPlan,
  | 'code'
  | 'name'
  | 'status'
  | 'defaultCredits'
  | 'isDefault'
  | 'allowedAgentLevelsJson'
  | 'benefitsJson'
  | 'dailyAutoRestoreEnabled'
  | 'dailyAutoRestoreCredits'
  | 'description'
  | 'sortOrder'
>;

function generateMembershipCode(name: string) {
  const normalized = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefix = normalized || 'MEMBER';
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `${prefix}_${suffix}`;
}

export class MembershipService {
  private normalizeAgentLevel(value: unknown): MembershipAgentLevel {
    const normalized = String(value || '').trim().toLowerCase();
    if (!AGENT_LEVELS.includes(normalized as MembershipAgentLevel)) {
      throw new Error('Agent 等级无效');
    }
    return normalized as MembershipAgentLevel;
  }

  private normalizeAllowedAgentLevels(value: unknown): MembershipAgentLevel[] {
    if (!Array.isArray(value)) return [];
    const results: MembershipAgentLevel[] = [];
    for (const item of value) {
      const normalized = String(item || '').trim().toLowerCase();
      if (!AGENT_LEVELS.includes(normalized as MembershipAgentLevel)) continue;
      if (!results.includes(normalized as MembershipAgentLevel)) {
        results.push(normalized as MembershipAgentLevel);
      }
    }
    return results;
  }

  private normalizePlanStatus(status: string) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!['active', 'inactive'].includes(normalized)) {
      throw new Error('会员类型状态无效');
    }
    return normalized;
  }

  private sanitizeNonNegativeInteger(value: unknown, fieldName: string) {
    const num = Math.max(0, Math.floor(Number(value || 0)));
    if (!Number.isFinite(num)) {
      throw new Error(`${fieldName}无效`);
    }
    return num;
  }

  private async assignUserMembershipWithExecutor(
    executor: MembershipDbExecutor,
    input: {
      userId: string;
      membershipPlanId: string;
      expiresAt?: Date | null;
      sourceType?: string;
      sourceId?: string | null;
      assignedReason?: string;
      grantCredits?: number;
    },
    actorId?: string | null
  ) {
    if (!input.userId) throw new Error('用户ID不能为空');
    if (!input.membershipPlanId) throw new Error('会员类型不能为空');

    const [plan] = await executor.select().from(membershipPlans).where(eq(membershipPlans.id, input.membershipPlanId)).limit(1);
    if (!plan) {
      throw new Error('会员类型不存在');
    }
    if (plan.status !== 'active') {
      throw new Error('会员类型未启用');
    }

    await executor
      .update(userMemberships)
      .set({
        status: 'expired',
        updatedAt: new Date(),
      })
      .where(and(eq(userMemberships.userId, input.userId), eq(userMemberships.status, 'active')));

    const [membership] = await executor.insert(userMemberships).values({
      userId: input.userId,
      membershipPlanId: input.membershipPlanId,
      status: 'active',
      startedAt: new Date(),
      expiresAt: input.expiresAt || null,
      sourceType: input.sourceType || 'manual',
      sourceId: input.sourceId || null,
      assignedBy: actorId || null,
      assignedReason: input.assignedReason || '',
    } satisfies NewUserMembership).returning();

    const shouldGrantCredits = Number.isFinite(input.grantCredits ?? plan.defaultCredits) && (input.grantCredits ?? plan.defaultCredits) > 0;
    let grantRecord = null;
    let transactionId: string | null = null;

    if (shouldGrantCredits) {
      const amount = Math.max(0, Math.floor(input.grantCredits ?? plan.defaultCredits));
      const creditUpdate = await executor
        .update(userCredits)
        .set({
          balance: sql`balance + ${amount}`,
          totalEarned: sql`total_earned + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(userCredits.userId, input.userId))
        .returning();

      if (creditUpdate.length === 0) {
        await executor.insert(userCredits).values({
          userId: input.userId,
          balance: amount,
          totalEarned: amount,
          totalConsumed: 0,
          lastRechargeAt: new Date(),
        }).returning();
      }

      const [transaction] = await executor.insert(creditTransactions).values({
        userId: input.userId,
        type: 'adjust',
        amount,
        balanceAfter: (creditUpdate[0]?.balance ?? amount),
        sourceId: membership.id,
        sourceType: 'membership',
        description: input.assignedReason || `会员 ${plan.name} 默认赠送积分`,
        metadataJson: {
          membershipPlanId: plan.id,
          membershipCode: plan.code,
          actorId,
        },
      }).returning();
      transactionId = transaction.id;

      const [grant] = await executor.insert(membershipGrants).values({
        userId: input.userId,
        membershipPlanId: plan.id,
        grantCredits: amount,
        grantReason: input.assignedReason || `会员 ${plan.name} 默认赠送积分`,
        grantStatus: 'issued',
        creditTransactionId: transaction.id,
      } satisfies NewMembershipGrant).returning();
      grantRecord = grant;
    }

    await executor.insert(membershipAuditLogs).values({
      actorId: actorId || null,
      action: 'user_membership.assign',
      targetType: 'user_membership',
      targetId: membership.id,
      beforeJson: {},
      afterJson: {
        membership,
        grantTransactionId: transactionId,
        grantRecord,
      },
      reason: input.assignedReason || '',
    } satisfies NewMembershipAuditLog);

    return {
      membership,
      grantRecord,
      grantTransactionId: transactionId,
    };
  }

  async listPlans() {
    return db.select().from(membershipPlans).orderBy(desc(membershipPlans.sortOrder), desc(membershipPlans.createdAt));
  }

  async getPlanById(planId: string) {
    const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, planId)).limit(1);
    if (!plan) throw new Error('会员类型不存在');
    return plan;
  }

  async createPlan(input: NewMembershipPlan, actorId?: string | null) {
    return db.transaction(async (trx) => {
      const planName = String(input.name || '').trim();
      if (!planName) throw new Error('会员名称不能为空');
      const status = this.normalizePlanStatus(String(input.status || 'active'));
      const defaultCredits = this.sanitizeNonNegativeInteger(input.defaultCredits, '默认积分');
      const dailyAutoRestoreEnabled = Boolean(input.dailyAutoRestoreEnabled);
      const dailyAutoRestoreCredits = dailyAutoRestoreEnabled
        ? this.sanitizeNonNegativeInteger(input.dailyAutoRestoreCredits, '每日自动恢复积分')
        : 0;
      const allowedAgentLevels = this.normalizeAllowedAgentLevels(input.allowedAgentLevelsJson);
      if (input.isDefault && status !== 'active') {
        throw new Error('默认会员类型必须保持启用');
      }
      if (input.isDefault && allowedAgentLevels.length === 0) {
        throw new Error('默认会员类型至少需要开放一个 Agent 等级');
      }

      if (input.isDefault) {
        await trx.update(membershipPlans).set({ isDefault: false, updatedAt: new Date() }).where(eq(membershipPlans.isDefault, true));
      }

      const code = String(input.code || '').trim() || generateMembershipCode(planName);
      const [plan] = await trx.insert(membershipPlans).values({
        ...input,
        code,
        name: planName,
        status,
        defaultCredits,
        dailyAutoRestoreEnabled,
        dailyAutoRestoreCredits,
        allowedAgentLevelsJson: allowedAgentLevels,
        benefitsJson: Array.isArray(input.benefitsJson) ? input.benefitsJson : [],
      }).returning();
      await trx.insert(membershipAuditLogs).values({
        actorId: actorId || null,
        action: 'membership_plan.create',
        targetType: 'membership_plan',
        targetId: plan.id,
        beforeJson: {},
        afterJson: plan as any,
        reason: input.description || '',
      });
      return plan;
    });
  }

  async updatePlan(
    planId: string,
    input: Partial<NewMembershipPlan>,
    actorId?: string | null
  ) {
    return db.transaction(async (trx) => {
      const [before] = await trx.select().from(membershipPlans).where(eq(membershipPlans.id, planId)).limit(1);
      if (!before) throw new Error('会员类型不存在');

      const nextStatus = input.status === undefined ? before.status : this.normalizePlanStatus(String(input.status));
      const nextName = input.name === undefined ? before.name : String(input.name || '').trim();
      if (!nextName) throw new Error('会员名称不能为空');
      const nextDefaultCredits = input.defaultCredits === undefined
        ? before.defaultCredits
        : this.sanitizeNonNegativeInteger(input.defaultCredits, '默认积分');
      const nextDailyEnabled = input.dailyAutoRestoreEnabled === undefined
        ? before.dailyAutoRestoreEnabled
        : Boolean(input.dailyAutoRestoreEnabled);
      const nextDailyCredits = input.dailyAutoRestoreCredits === undefined
        ? before.dailyAutoRestoreCredits
        : this.sanitizeNonNegativeInteger(input.dailyAutoRestoreCredits, '每日自动恢复积分');

      const nextIsDefault = input.isDefault === undefined ? before.isDefault : Boolean(input.isDefault);
      const nextAllowedAgentLevels = input.allowedAgentLevelsJson === undefined
        ? this.normalizeAllowedAgentLevels(before.allowedAgentLevelsJson)
        : this.normalizeAllowedAgentLevels(input.allowedAgentLevelsJson);
      if (before.isDefault && !nextIsDefault) {
        throw new Error('默认会员类型不能直接取消，请先将其他会员类型设为默认');
      }
      if (nextIsDefault && nextStatus !== 'active') {
        throw new Error('默认会员类型必须保持启用');
      }
      if (nextIsDefault && nextAllowedAgentLevels.length === 0) {
        throw new Error('默认会员类型至少需要开放一个 Agent 等级');
      }

      const previousDefaultPlans = nextIsDefault
        ? await trx
            .select({ id: membershipPlans.id })
            .from(membershipPlans)
            .where(and(eq(membershipPlans.isDefault, true), sql`${membershipPlans.id} <> ${planId}`))
        : [];
      if (nextIsDefault) {
        await trx
          .update(membershipPlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(membershipPlans.isDefault, true), sql`${membershipPlans.id} <> ${planId}`));
      }

      const [after] = await trx
        .update(membershipPlans)
        .set({
          name: nextName,
          status: nextStatus,
          defaultCredits: nextDefaultCredits,
          isDefault: nextIsDefault,
          allowedAgentLevelsJson: nextAllowedAgentLevels,
          benefitsJson: input.benefitsJson === undefined
            ? before.benefitsJson
            : (Array.isArray(input.benefitsJson) ? input.benefitsJson : []),
          dailyAutoRestoreEnabled: nextDailyEnabled,
          dailyAutoRestoreCredits: nextDailyEnabled ? nextDailyCredits : 0,
          description: input.description === undefined ? before.description : String(input.description || '').trim(),
          sortOrder: input.sortOrder === undefined ? before.sortOrder : this.sanitizeNonNegativeInteger(input.sortOrder, '排序值'),
          effectiveFrom: input.effectiveFrom === undefined ? before.effectiveFrom : input.effectiveFrom,
          effectiveUntil: input.effectiveUntil === undefined ? before.effectiveUntil : input.effectiveUntil,
          updatedAt: new Date(),
        })
        .where(eq(membershipPlans.id, planId))
        .returning();

      await trx.insert(membershipAuditLogs).values({
        actorId: actorId || null,
        action: 'membership_plan.update',
        targetType: 'membership_plan',
        targetId: planId,
        beforeJson: before as any,
        afterJson: after as any,
        reason: String(input.description || '').trim(),
      });

      if (after.isDefault && previousDefaultPlans.length > 0) {
        await this.syncDefaultMembershipAssignmentsWithExecutor(
          trx,
          after.id,
          previousDefaultPlans.map((item) => item.id),
          actorId || null,
          '默认会员类型切换后同步注册默认用户'
        );
      }

      return after;
    });
  }

  async updatePlanStatus(planId: string, status: string, actorId?: string | null) {
    const normalized = this.normalizePlanStatus(status);
    return this.updatePlan(planId, { status: normalized }, actorId);
  }

  async listUserMemberships(userId: string) {
    return db
      .select()
      .from(userMemberships)
      .where(eq(userMemberships.userId, userId))
      .orderBy(desc(userMemberships.createdAt));
  }

  async listMemberships(input: {
    userId?: string;
    membershipPlanId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(Number(input.page || 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize || 20))));
    const whereParts = [];
    if (input.userId) whereParts.push(eq(userMemberships.userId, input.userId));
    if (input.membershipPlanId) whereParts.push(eq(userMemberships.membershipPlanId, input.membershipPlanId));
    if (input.status) whereParts.push(eq(userMemberships.status, String(input.status).trim()));
    const whereExpr = whereParts.length > 0 ? and(...whereParts) : undefined;

    const rows = await db
      .select({
        membership: userMemberships,
        user: {
          id: appUsers.id,
          email: appUsers.email,
          displayName: appUsers.displayName,
          status: appUsers.status,
        },
        plan: {
          id: membershipPlans.id,
          code: membershipPlans.code,
          name: membershipPlans.name,
          status: membershipPlans.status,
        },
      })
      .from(userMemberships)
      .innerJoin(appUsers, eq(userMemberships.userId, appUsers.id))
      .innerJoin(membershipPlans, eq(userMemberships.membershipPlanId, membershipPlans.id))
      .where(whereExpr)
      .orderBy(desc(userMemberships.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userMemberships)
      .where(whereExpr);

    return {
      page,
      pageSize,
      total: totalRow?.count || 0,
      items: rows,
    };
  }

  async assignUserMembership(
    input: {
      userId: string;
      membershipPlanId: string;
      expiresAt?: Date | null;
      sourceType?: string;
      sourceId?: string | null;
      assignedReason?: string;
      grantCredits?: number;
    },
    actorId?: string | null
  ) {
    return db.transaction(async (trx) => this.assignUserMembershipWithExecutor(trx, input, actorId));
  }

  async updateUserMembershipStatus(
    membershipId: string,
    status: string,
    actorId?: string | null,
    reason?: string
  ) {
    return db.transaction(async (trx) => {
      const [before] = await trx.select().from(userMemberships).where(eq(userMemberships.id, membershipId)).limit(1);
      if (!before) throw new Error('用户会员不存在');

      const normalized = String(status || '').trim().toLowerCase();
      if (!['active', 'expired', 'cancelled'].includes(normalized)) {
        throw new Error('用户会员状态无效');
      }

      if (normalized === 'active') {
        await trx
          .update(userMemberships)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(eq(userMemberships.userId, before.userId), eq(userMemberships.status, 'active'), sql`${userMemberships.id} <> ${membershipId}`));
      }

      const [after] = await trx
        .update(userMemberships)
        .set({
          status: normalized,
          updatedAt: new Date(),
        })
        .where(eq(userMemberships.id, membershipId))
        .returning();

      await trx.insert(membershipAuditLogs).values({
        actorId: actorId || null,
        action: 'user_membership.status.update',
        targetType: 'user_membership',
        targetId: membershipId,
        beforeJson: before as any,
        afterJson: after as any,
        reason: reason || '',
      });
      return after;
    });
  }

  async updateUserMembershipExpireAt(
    membershipId: string,
    expiresAt: Date | null,
    actorId?: string | null,
    reason?: string
  ) {
    return db.transaction(async (trx) => {
      const [before] = await trx.select().from(userMemberships).where(eq(userMemberships.id, membershipId)).limit(1);
      if (!before) throw new Error('用户会员不存在');

      const [after] = await trx
        .update(userMemberships)
        .set({
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(userMemberships.id, membershipId))
        .returning();

      await trx.insert(membershipAuditLogs).values({
        actorId: actorId || null,
        action: 'user_membership.expire_at.update',
        targetType: 'user_membership',
        targetId: membershipId,
        beforeJson: before as any,
        afterJson: after as any,
        reason: reason || '',
      });
      return after;
    });
  }

  async assignDefaultMembershipForNewUser(userId: string, executor: MembershipDbExecutor = db) {
    const [defaultPlan] = await executor
      .select()
      .from(membershipPlans)
      .where(and(eq(membershipPlans.status, 'active'), eq(membershipPlans.isDefault, true)))
      .orderBy(desc(membershipPlans.updatedAt))
      .limit(1);
    if (!defaultPlan) return null;

    return this.assignUserMembershipWithExecutor(
      executor,
      {
        userId,
        membershipPlanId: defaultPlan.id,
        sourceType: REGISTER_DEFAULT_SOURCE_TYPE,
        assignedReason: '用户注册自动绑定默认会员',
        grantCredits: defaultPlan.defaultCredits,
      },
      null
    );
  }

  private async syncDefaultMembershipAssignmentsWithExecutor(
    executor: MembershipDbExecutor,
    defaultPlanId: string,
    previousDefaultPlanIds: string[],
    actorId?: string | null,
    reason = '同步默认会员用户'
  ) {
    const uniquePreviousIds = Array.from(new Set(previousDefaultPlanIds.filter((item) => item && item !== defaultPlanId)));
    if (uniquePreviousIds.length === 0) {
      return { updatedCount: 0 };
    }

    const rows = await executor
      .update(userMemberships)
      .set({
        membershipPlanId: defaultPlanId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userMemberships.status, 'active'),
          eq(userMemberships.sourceType, REGISTER_DEFAULT_SOURCE_TYPE),
          inArray(userMemberships.membershipPlanId, uniquePreviousIds)
        )
      )
      .returning();

    if (rows.length > 0) {
      await executor.insert(membershipAuditLogs).values({
        actorId: actorId || null,
        action: 'user_membership.default.sync',
        targetType: 'membership_plan',
        targetId: defaultPlanId,
        beforeJson: {
          previousDefaultPlanIds: uniquePreviousIds,
        },
        afterJson: {
          defaultPlanId,
          updatedMembershipIds: rows.map((item) => item.id),
          updatedCount: rows.length,
        },
        reason,
      } satisfies NewMembershipAuditLog);
    }

    return { updatedCount: rows.length };
  }

  async syncDefaultMembershipAssignments(defaultPlanId: string, previousDefaultPlanIds: string[], actorId?: string | null) {
    return db.transaction(async (trx) =>
      this.syncDefaultMembershipAssignmentsWithExecutor(trx, defaultPlanId, previousDefaultPlanIds, actorId || null)
    );
  }

  async ensureSystemDefaultPlan() {
    return db.transaction(async (trx) => {
      const existingDefaultPlans = await trx
        .select({ id: membershipPlans.id, code: membershipPlans.code })
        .from(membershipPlans)
        .where(eq(membershipPlans.isDefault, true));
      const [beforeCanonical] = await trx
        .select()
        .from(membershipPlans)
        .where(eq(membershipPlans.code, DEFAULT_MEMBERSHIP_PLAN_CODE))
        .limit(1);
      const shouldPromoteCanonical = !beforeCanonical || existingDefaultPlans.length === 0;
      const previousDefaultPlanIds = shouldPromoteCanonical
        ? existingDefaultPlans
            .filter((item) => item.code !== DEFAULT_MEMBERSHIP_PLAN_CODE)
            .map((item) => item.id)
        : [];

      if (shouldPromoteCanonical) {
        await trx
          .update(membershipPlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(membershipPlans.isDefault, true), sql`${membershipPlans.code} <> ${DEFAULT_MEMBERSHIP_PLAN_CODE}`));
      }

      const [plan] = await trx
        .insert(membershipPlans)
        .values({
          ...DEFAULT_MEMBERSHIP_PLAN_VALUES,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: membershipPlans.code,
          set: {
            name: beforeCanonical?.name || DEFAULT_MEMBERSHIP_PLAN_VALUES.name,
            status: shouldPromoteCanonical ? DEFAULT_MEMBERSHIP_PLAN_VALUES.status : beforeCanonical?.status || DEFAULT_MEMBERSHIP_PLAN_VALUES.status,
            defaultCredits: beforeCanonical?.defaultCredits ?? DEFAULT_MEMBERSHIP_PLAN_VALUES.defaultCredits,
            isDefault: shouldPromoteCanonical ? true : beforeCanonical?.isDefault ?? true,
            allowedAgentLevelsJson: beforeCanonical?.allowedAgentLevelsJson ?? DEFAULT_MEMBERSHIP_PLAN_VALUES.allowedAgentLevelsJson,
            benefitsJson: beforeCanonical?.benefitsJson ?? DEFAULT_MEMBERSHIP_PLAN_VALUES.benefitsJson,
            dailyAutoRestoreEnabled: beforeCanonical?.dailyAutoRestoreEnabled ?? DEFAULT_MEMBERSHIP_PLAN_VALUES.dailyAutoRestoreEnabled,
            dailyAutoRestoreCredits: beforeCanonical?.dailyAutoRestoreCredits ?? DEFAULT_MEMBERSHIP_PLAN_VALUES.dailyAutoRestoreCredits,
            description: beforeCanonical?.description || DEFAULT_MEMBERSHIP_PLAN_VALUES.description,
            sortOrder: beforeCanonical?.sortOrder ?? DEFAULT_MEMBERSHIP_PLAN_VALUES.sortOrder,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!beforeCanonical || previousDefaultPlanIds.length > 0) {
        await trx.insert(membershipAuditLogs).values({
          actorId: null,
          action: 'membership_plan.default.ensure',
          targetType: 'membership_plan',
          targetId: plan.id,
          beforeJson: {
            canonicalPlanExisted: Boolean(beforeCanonical),
            previousDefaultPlanIds,
          },
          afterJson: plan as any,
          reason: '系统启动确保默认会员类型存在',
        } satisfies NewMembershipAuditLog);
      }

      const syncResult = await this.syncDefaultMembershipAssignmentsWithExecutor(
        trx,
        plan.id,
        previousDefaultPlanIds,
        null,
        '系统默认会员初始化后同步注册默认用户'
      );

      return {
        plan,
        syncedDefaultMemberships: syncResult.updatedCount,
      };
    });
  }

  async getActiveMembershipEntitlement(userId: string) {
    const [row] = await db
      .select({
        membership: userMemberships,
        plan: membershipPlans,
      })
      .from(userMemberships)
      .innerJoin(membershipPlans, eq(userMemberships.membershipPlanId, membershipPlans.id))
      .where(
        and(
          eq(userMemberships.userId, userId),
          eq(userMemberships.status, 'active'),
          eq(membershipPlans.status, 'active')
        )
      )
      .orderBy(desc(userMemberships.updatedAt))
      .limit(1);
    if (!row) return null;
    return {
      membership: row.membership,
      plan: row.plan,
      allowedAgentLevels: this.normalizeAllowedAgentLevels(row.plan.allowedAgentLevelsJson),
    };
  }

  async assertUserCanUseAgentLevel(userId: string, agentLevel: unknown) {
    const level = this.normalizeAgentLevel(agentLevel);
    const entitlement = await this.getActiveMembershipEntitlement(userId);
    if (!entitlement) {
      throw new Error('当前用户没有启用中的会员类型，无法使用 Agent');
    }
    if (!entitlement.allowedAgentLevels.includes(level)) {
      const allowed = entitlement.allowedAgentLevels.length > 0
        ? entitlement.allowedAgentLevels.map((item) => `agent ${item}`).join('、')
        : '无';
      throw new Error(`当前会员类型仅允许使用 ${allowed}`);
    }
    return {
      level,
      entitlement,
    };
  }

  async runDailyAutoRestore(targetDate = new Date()) {
    const restoreDate = targetDate.toISOString().slice(0, 10);
    return db.transaction(async (trx) => {
      const activeMemberships = await trx
        .select({
          userId: userMemberships.userId,
          membershipPlanId: userMemberships.membershipPlanId,
          membershipId: userMemberships.id,
          planName: membershipPlans.name,
          restoreCredits: membershipPlans.dailyAutoRestoreCredits,
          planCode: membershipPlans.code,
        })
        .from(userMemberships)
        .innerJoin(membershipPlans, eq(userMemberships.membershipPlanId, membershipPlans.id))
        .where(
          and(
            eq(userMemberships.status, 'active'),
            eq(membershipPlans.status, 'active'),
            eq(membershipPlans.dailyAutoRestoreEnabled, true)
          )
        );

      let restoredCount = 0;
      for (const item of activeMemberships) {
        const amount = Math.max(0, Number(item.restoreCredits || 0));
        if (amount <= 0) continue;

        const existed = await trx
          .select({ id: membershipDailyRestores.id })
          .from(membershipDailyRestores)
          .where(
            and(
              eq(membershipDailyRestores.userId, item.userId),
              eq(membershipDailyRestores.membershipPlanId, item.membershipPlanId),
              eq(membershipDailyRestores.restoreDate, restoreDate)
            )
          )
          .limit(1);
        if (existed.length > 0) continue;

        const creditUpdate = await trx
          .update(userCredits)
          .set({
            balance: sql`balance + ${amount}`,
            totalEarned: sql`total_earned + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(userCredits.userId, item.userId))
          .returning();

        if (creditUpdate.length === 0) {
          await trx.insert(userCredits).values({
            userId: item.userId,
            balance: amount,
            totalEarned: amount,
            totalConsumed: 0,
            lastRechargeAt: new Date(),
          });
        }

        const [transaction] = await trx.insert(creditTransactions).values({
          userId: item.userId,
          type: 'adjust',
          amount,
          balanceAfter: creditUpdate[0]?.balance ?? amount,
          sourceId: item.membershipId,
          sourceType: 'membership_daily_restore',
          description: `会员 ${item.planName} 每日自动恢复积分`,
          metadataJson: {
            membershipPlanId: item.membershipPlanId,
            membershipCode: item.planCode,
            restoreDate,
          },
        }).returning();

        await trx.insert(membershipDailyRestores).values({
          userId: item.userId,
          membershipPlanId: item.membershipPlanId,
          restoreDate,
          restoreCredits: amount,
          creditTransactionId: transaction.id,
        });

        restoredCount += 1;
      }

      return { restoreDate, restoredCount };
    });
  }

  async listDailyRestoreHistory(input: {
    page?: number;
    pageSize?: number;
    userId?: string;
    membershipPlanId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const page = Math.max(1, Math.floor(Number(input.page || 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize || 20))));
    const whereParts = [];
    if (input.userId) whereParts.push(eq(membershipDailyRestores.userId, input.userId));
    if (input.membershipPlanId) whereParts.push(eq(membershipDailyRestores.membershipPlanId, input.membershipPlanId));
    if (input.startDate) whereParts.push(gte(membershipDailyRestores.restoreDate, input.startDate));
    if (input.endDate) whereParts.push(lte(membershipDailyRestores.restoreDate, input.endDate));
    const whereExpr = whereParts.length > 0 ? and(...whereParts) : undefined;

    const rows = await db
      .select({
        restore: membershipDailyRestores,
        user: {
          id: appUsers.id,
          email: appUsers.email,
          displayName: appUsers.displayName,
        },
        plan: {
          id: membershipPlans.id,
          code: membershipPlans.code,
          name: membershipPlans.name,
        },
      })
      .from(membershipDailyRestores)
      .innerJoin(appUsers, eq(membershipDailyRestores.userId, appUsers.id))
      .innerJoin(membershipPlans, eq(membershipDailyRestores.membershipPlanId, membershipPlans.id))
      .where(whereExpr)
      .orderBy(desc(membershipDailyRestores.restoreDate), desc(membershipDailyRestores.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipDailyRestores)
      .where(whereExpr);

    return {
      page,
      pageSize,
      total: totalRow?.count || 0,
      items: rows,
    };
  }
}

export const membershipService = new MembershipService();
