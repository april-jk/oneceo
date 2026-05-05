import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
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
        allowedAgentLevelsJson: Array.isArray(input.allowedAgentLevelsJson) ? input.allowedAgentLevelsJson : [],
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
          allowedAgentLevelsJson: input.allowedAgentLevelsJson === undefined
            ? before.allowedAgentLevelsJson
            : (Array.isArray(input.allowedAgentLevelsJson) ? input.allowedAgentLevelsJson : []),
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
        sourceType: 'register_default',
        assignedReason: '用户注册自动绑定默认会员',
        grantCredits: defaultPlan.defaultCredits,
      },
      null
    );
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
