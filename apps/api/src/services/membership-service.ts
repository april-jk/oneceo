import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
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
  async listPlans() {
    return db.select().from(membershipPlans).orderBy(desc(membershipPlans.sortOrder), desc(membershipPlans.createdAt));
  }

  async createPlan(input: NewMembershipPlan, actorId?: string | null) {
    return db.transaction(async (trx) => {
      if (input.isDefault) {
        await trx.update(membershipPlans).set({ isDefault: false, updatedAt: new Date() }).where(eq(membershipPlans.isDefault, true));
      }

      const code = String(input.code || '').trim() || generateMembershipCode(String(input.name || ''));
      const [plan] = await trx.insert(membershipPlans).values({ ...input, code }).returning();
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

  async listUserMemberships(userId: string) {
    return db
      .select()
      .from(userMemberships)
      .where(eq(userMemberships.userId, userId))
      .orderBy(desc(userMemberships.createdAt));
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
    return db.transaction(async (trx) => {
      const [plan] = await trx.select().from(membershipPlans).where(eq(membershipPlans.id, input.membershipPlanId)).limit(1);
      if (!plan) {
        throw new Error('会员类型不存在');
      }

      const [membership] = await trx.insert(userMemberships).values({
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
        const creditUpdate = await trx
          .update(userCredits)
          .set({
            balance: sql`balance + ${amount}`,
            totalEarned: sql`total_earned + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(userCredits.userId, input.userId))
          .returning();

        if (creditUpdate.length === 0) {
          const [createdCredit] = await trx.insert(userCredits).values({
            userId: input.userId,
            balance: amount,
            totalEarned: amount,
            totalConsumed: 0,
            lastRechargeAt: new Date(),
          }).returning();
          void createdCredit;
        }

        const [transaction] = await trx.insert(creditTransactions).values({
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

        const [grant] = await trx.insert(membershipGrants).values({
          userId: input.userId,
          membershipPlanId: plan.id,
          grantCredits: amount,
          grantReason: input.assignedReason || `会员 ${plan.name} 默认赠送积分`,
          grantStatus: 'issued',
          creditTransactionId: transaction.id,
        } satisfies NewMembershipGrant).returning();
        grantRecord = grant;
      }

      await trx.insert(membershipAuditLogs).values({
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
    });
  }

  async assignDefaultMembershipForNewUser(userId: string) {
    const [defaultPlan] = await db
      .select()
      .from(membershipPlans)
      .where(and(eq(membershipPlans.status, 'active'), eq(membershipPlans.isDefault, true)))
      .orderBy(desc(membershipPlans.updatedAt))
      .limit(1);
    if (!defaultPlan) return null;

    return this.assignUserMembership(
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
}

export const membershipService = new MembershipService();
