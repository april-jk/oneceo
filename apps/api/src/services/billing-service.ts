import { eq, and, sql, desc, count } from 'drizzle-orm';
import { db } from '../config/database';
import { userCredits, creditTransactions, tokenUsageLogs, modelPricing } from '../db/schema';
import type { UserCredit, CreditTransaction, TokenUsageLog } from '../db/schema';

export class BillingService {
  /**
   * 获取用户积分余额
   */
  async getUserCredits(userId: string): Promise<UserCredit | null> {
    const result = await db.select().from(userCredits).where(eq(userCredits.userId, userId as any)).limit(1);
    return result[0] || null;
  }

  /**
   * 初始化用户积分（注册时调用）
   */
  async initUserCredits(userId: string, initialBalance: number = 500): Promise<UserCredit> {
    const result = await db.insert(userCredits).values({
      userId: userId as any,
      balance: initialBalance,
      totalEarned: initialBalance,
      totalConsumed: 0,
    }).returning();
    
    // 记录初始赠送交易
    await db.insert(creditTransactions).values({
      userId: userId as any,
      type: 'adjust',
      amount: initialBalance,
      balanceAfter: initialBalance,
      sourceType: 'manual',
      description: '新用户注册赠送积分',
    });
    
    return result[0];
  }

  /**
   * 扣减积分（LLM 调用消费）
   * 使用 CAS 保证并发安全
   */
  async deductCredits(
    userId: string,
    amount: number,
    source: { sessionId?: string; runId?: string; model?: string; description?: string }
  ): Promise<{ success: boolean; balanceAfter: number; transactionId?: string }> {
    if (!amount || amount <= 0 || !Number.isFinite(amount)) {
      return { success: false, balanceAfter: 0 };
    }

    return await db.transaction(async (trx) => {
      // CAS 更新：确保余额充足
      const updateResult = await trx
        .update(userCredits)
        .set({
          balance: sql`balance - ${amount}`,
          totalConsumed: sql`total_consumed + ${amount}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userCredits.userId, userId as any),
          sql`balance >= ${amount}`
        ))
        .returning();

      if (updateResult.length === 0) {
        return { success: false, balanceAfter: 0 };
      }

      const newBalance = updateResult[0].balance;

      // 记录交易
      const transactionResult = await trx.insert(creditTransactions).values({
        userId: userId as any,
        type: 'consume',
        amount: -amount,
        balanceAfter: newBalance,
        sourceId: source.sessionId as any,
        sourceType: 'session',
        description: source.description || `LLM调用: ${source.model || 'unknown'}`,
      }).returning();

      return {
        success: true,
        balanceAfter: newBalance,
        transactionId: transactionResult[0].id,
      };
    });
  }

  /**
   * 增加积分（充值、人工调整）
   */
  async addCredits(
    userId: string,
    amount: number,
    type: 'recharge' | 'adjust',
    source: { sourceId?: string; sourceType?: string; description?: string; adminId?: string }
  ): Promise<{ success: boolean; balanceAfter: number; transactionId?: string }> {
    if (!amount || amount <= 0 || !Number.isFinite(amount)) {
      return { success: false, balanceAfter: 0 };
    }

    return await db.transaction(async (trx) => {
      const updateResult = await trx
        .update(userCredits)
        .set({
          balance: sql`balance + ${amount}`,
          totalEarned: sql`total_earned + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(userCredits.userId, userId as any))
        .returning();

      if (updateResult.length === 0) {
        // 如果用户没有积分记录，创建一条
        const newCredit = await trx.insert(userCredits).values({
          userId: userId as any,
          balance: amount,
          totalEarned: amount,
          totalConsumed: 0,
        }).returning();
        
        const transactionResult = await trx.insert(creditTransactions).values({
          userId: userId as any,
          type,
          amount,
          balanceAfter: amount,
          sourceId: source.sourceId as any,
          sourceType: source.sourceType || 'manual',
          description: source.description || (type === 'recharge' ? '积分充值' : '人工调整'),
          metadataJson: source.adminId ? { adminId: source.adminId } : {},
        }).returning();

        return {
          success: true,
          balanceAfter: amount,
          transactionId: transactionResult[0].id,
        };
      }

      const newBalance = updateResult[0].balance;

      const transactionResult = await trx.insert(creditTransactions).values({
        userId: userId as any,
        type,
        amount,
        balanceAfter: newBalance,
        sourceId: source.sourceId as any,
        sourceType: source.sourceType || 'manual',
        description: source.description || (type === 'recharge' ? '积分充值' : '人工调整'),
        metadataJson: source.adminId ? { adminId: source.adminId } : {},
      }).returning();

      return {
        success: true,
        balanceAfter: newBalance,
        transactionId: transactionResult[0].id,
      };
    });
  }

  /**
   * 查询用户交易记录
   */
  async getTransactions(
    userId: string,
    options: { page?: number; limit?: number; type?: string } = {}
  ): Promise<{ items: CreditTransaction[]; total: number }> {
    const { page = 1, limit = 20, type } = options;
    const offset = (page - 1) * limit;

    let conditions = [eq(creditTransactions.userId, userId as any)];
    
    if (type) {
      conditions.push(eq(creditTransactions.type, type));
    }

    const query = db.select().from(creditTransactions).where(and(...conditions));

    const items = await query
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: count() })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId as any));

    return {
      items,
      total: Number(countResult[0].count),
    };
  }

  /**
   * 查询会话积分使用情况
   */
  async getSessionUsage(sessionId: string, userId: string): Promise<{
    totalCredits: number;
    totalTokens: number;
    modelBreakdown: Array<{
      model: string;
      promptTokens: number;
      completionTokens: number;
      credits: number;
    }>;
  }> {
    const logs = await db
      .select()
      .from(tokenUsageLogs)
      .where(and(eq(tokenUsageLogs.sessionId, sessionId as any), eq(tokenUsageLogs.userId, userId as any)))
      .orderBy(tokenUsageLogs.createdAt);

    const totalCredits = logs.reduce((sum, log) => sum + log.creditsConsumed, 0);
    const totalTokens = logs.reduce((sum, log) => sum + log.totalTokens, 0);

    // 按模型聚合
    const modelMap = new Map<string, { model: string; promptTokens: number; completionTokens: number; credits: number }>();
    
    for (const log of logs) {
      const existing = modelMap.get(log.model);
      if (existing) {
        existing.promptTokens += log.promptTokens;
        existing.completionTokens += log.completionTokens;
        existing.credits += log.creditsConsumed;
      } else {
        modelMap.set(log.model, {
          model: log.model,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          credits: log.creditsConsumed,
        });
      }
    }

    return {
      totalCredits,
      totalTokens,
      modelBreakdown: Array.from(modelMap.values()),
    };
  }

  /**
   * 记录 Token 使用日志
   */
  async logTokenUsage(data: {
    userId: string;
    sessionId?: string;
    runId?: string;
    model: string;
    promptTokens: number;
    cachedPromptTokens: number;
    nonCachedPromptTokens: number;
    cacheCreationTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsConsumed: number;
    pricingSnapshot: any;
  }): Promise<TokenUsageLog> {
    const result = await db.insert(tokenUsageLogs).values({
      userId: data.userId as any,
      sessionId: data.sessionId as any,
      runId: data.runId as any,
      model: data.model,
      promptTokens: data.promptTokens,
      cachedPromptTokens: data.cachedPromptTokens,
      nonCachedPromptTokens: data.nonCachedPromptTokens,
      cacheCreationTokens: data.cacheCreationTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      creditsConsumed: data.creditsConsumed,
      pricingSnapshot: data.pricingSnapshot,
    }).returning();

    return result[0];
  }

  /**
   * 检查用户余额是否充足
   */
  async hasEnoughCredits(userId: string, minBalance: number = 0): Promise<boolean> {
    const credit = await this.getUserCredits(userId);
    return !!credit && credit.balance > minBalance;
  }
}

export const billingService = new BillingService();
