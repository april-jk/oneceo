import express from 'express';
import { eq, and, sql, desc, count, gte, lte } from 'drizzle-orm';
import { db } from '../config/database';
import { userCredits, creditTransactions, tokenUsageLogs, modelPricing, appUsers } from '../db/schema';
import { billingService } from '../services/billing-service';
import { pricingService } from '../services/pricing-service';
import { conversionService } from '../services/conversion-service';
import { adminAuthMiddleware } from '../middleware/admin-auth-middleware';

const router = express.Router();
const POSTGRES_INTEGER_MAX = 2147483647;

function isPositivePostgresInteger(value: unknown) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= POSTGRES_INTEGER_MAX
  );
}

router.use(adminAuthMiddleware);

/**
 * GET /api/internal/billing/meta
 * 计费规则只读元信息
 */
router.get('/meta', async (_req, res) => {
  try {
    const exchange = conversionService.getExchangeConfig();
    res.json({
      ...exchange,
      cacheRatios: {
        openai: pricingService.getCacheRatios('openai'),
        anthropic: pricingService.getCacheRatios('anthropic'),
      },
    });
  } catch (error) {
    console.error('[Billing Admin] 获取计费元信息失败:', error);
    res.status(500).json({ error: '获取计费元信息失败' });
  }
});

/**
 * GET /api/internal/billing/users
 * 用户积分列表（分页+搜索）
 */
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const query = req.query.query as string | undefined;
    const sortBy = req.query.sortBy as string || 'balance';
    const sortOrder = req.query.sortOrder as string || 'desc';

    const offset = (page - 1) * limit;

    // 构建查询（LEFT JOIN 确保显示所有用户，包括 balance 为 0 或尚未创建积分记录的用户）
    let baseQuery = db
      .select({
        userId: appUsers.id,
        email: appUsers.email,
        displayName: appUsers.displayName,
        balance: sql<number>`COALESCE(${userCredits.balance}, 0)`,
        totalEarned: sql<number>`COALESCE(${userCredits.totalEarned}, 0)`,
        totalConsumed: sql<number>`COALESCE(${userCredits.totalConsumed}, 0)`,
        lastRechargeAt: userCredits.lastRechargeAt,
      })
      .from(appUsers)
      .leftJoin(userCredits, eq(appUsers.id, userCredits.userId));

    if (query) {
      baseQuery = baseQuery.where(
        sql`${appUsers.email} ILIKE ${`%${query}%`} OR ${appUsers.displayName} ILIKE ${`%${query}%`}`
      ) as any;
    }

    // 排序
    const orderColumn = {
      balance: userCredits.balance,
      totalConsumed: userCredits.totalConsumed,
      createdAt: userCredits.createdAt,
    }[sortBy] || userCredits.balance;

    const items = await baseQuery
      .orderBy(sortOrder === 'asc' ? sql`${orderColumn}` : desc(orderColumn))
      .limit(limit)
      .offset(offset);

    // 总数（基于 appUsers，确保统计全部用户）
    let countQuery = db
      .select({ count: count() })
      .from(appUsers)
      .leftJoin(userCredits, eq(appUsers.id, userCredits.userId));

    if (query) {
      countQuery = countQuery.where(
        sql`${appUsers.email} ILIKE ${`%${query}%`} OR ${appUsers.displayName} ILIKE ${`%${query}%`}`
      ) as any;
    }

    const countResult = await countQuery;

    res.json({
      items,
      total: Number(countResult[0].count),
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取用户积分列表失败:', error);
    res.status(500).json({ error: '获取用户积分列表失败' });
  }
});

/**
 * POST /api/internal/billing/users/:userId/adjust
 * 手动调整用户积分
 */
router.post('/users/:userId/adjust', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, reason } = req.body;

    if (!isPositivePostgresInteger(amount)) {
      return res.status(400).json({ error: '调整金额必须是大于 0 的整数' });
    }

    const result = await billingService.addCredits(userId, amount, 'adjust', {
      description: reason || '人工调整',
      adminId: (req as any).adminUser?.id,
    });

    if (!result.success) {
      return res.status(500).json({ error: '调整积分失败' });
    }

    res.json({
      transactionId: result.transactionId,
      balanceAfter: result.balanceAfter,
      amount,
    });
  } catch (error) {
    console.error('[Billing Admin] 调整积分失败:', error);
    res.status(500).json({ error: '调整积分失败' });
  }
});

/**
 * GET /api/internal/billing/users/:userId/transactions
 * 获取指定用户的交易记录（管理后台用）
 */
router.get('/users/:userId/transactions', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const result = await billingService.getTransactions(userId, { page, limit });

    res.json({
      items: result.items,
      total: result.total,
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取用户交易记录失败:', error);
    res.status(500).json({ error: '获取用户交易记录失败' });
  }
});

/**
 * GET /api/internal/billing/pricing
 * 模型定价列表
 */
router.get('/pricing', async (req, res) => {
  try {
    const pricingList = await pricingService.listAllPricing();
    
    const pricingWithCache = pricingList.map((p) => {
      const ratios = pricingService.getCacheRatios(p.modelProvider);
      return {
        ...p,
        cacheHitRatio: ratios?.hit || 0,
        cacheCreationRatio: ratios?.creation || 0,
      };
    });

    res.json({ items: pricingWithCache });
  } catch (error) {
    console.error('[Billing Admin] 获取定价列表失败:', error);
    res.status(500).json({ error: '获取定价列表失败' });
  }
});

/**
 * POST /api/internal/billing/pricing
 * 新增/更新模型定价
 */
router.post('/pricing', async (req, res) => {
  try {
    const { model, modelProvider, promptPricePer1kTokens, completionPricePer1kTokens } = req.body;

    if (!model || !modelProvider) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    if (
      !isPositivePostgresInteger(promptPricePer1kTokens) ||
      !isPositivePostgresInteger(completionPricePer1kTokens)
    ) {
      return res.status(400).json({ error: '模型定价必须是大于 0 的整数' });
    }

    const result = await pricingService.createPricing({
      model,
      modelProvider,
      promptPricePer1kTokens,
      completionPricePer1kTokens,
    });

    res.json(result);
  } catch (error) {
    console.error('[Billing Admin] 创建定价失败:', error);
    res.status(500).json({ error: '创建定价失败' });
  }
});

/**
 * DELETE /api/internal/billing/pricing/:id
 * 停用定价
 */
router.delete('/pricing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pricingService.deactivatePricing(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Billing Admin] 停用定价失败:', error);
    res.status(500).json({ error: '停用定价失败' });
  }
});

/**
 * GET /api/internal/billing/stats
 * 平台统计看板
 */
router.get('/stats', async (req, res) => {
  try {
    const period = req.query.period as string || 'today';
    
    // 计算时间范围
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'today':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
    }

    // 统计积分消耗
    const creditsResult = await db
      .select({
        totalCredits: sql`COALESCE(SUM(${creditTransactions.amount}), 0)`,
        totalCount: count(),
      })
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.type, 'consume'),
        gte(creditTransactions.createdAt, startDate)
      ));

    // 统计 Token 使用
    const tokensResult = await db
      .select({
        totalTokens: sql`COALESCE(SUM(${tokenUsageLogs.totalTokens}), 0)`,
        totalCredits: sql`COALESCE(SUM(${tokenUsageLogs.creditsConsumed}), 0)`,
        cachedTokens: sql`COALESCE(SUM(${tokenUsageLogs.cachedPromptTokens}), 0)`,
        cacheCreationTokens: sql`COALESCE(SUM(${tokenUsageLogs.cacheCreationTokens}), 0)`,
      })
      .from(tokenUsageLogs)
      .where(gte(tokenUsageLogs.createdAt, startDate));

    // Top 10 消费用户
    const topUsers = await db
      .select({
        userId: creditTransactions.userId,
        totalConsumed: sql`SUM(ABS(${creditTransactions.amount}))`,
      })
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.type, 'consume'),
        gte(creditTransactions.createdAt, startDate)
      ))
      .groupBy(creditTransactions.userId)
      .orderBy(desc(sql`SUM(ABS(${creditTransactions.amount}))`))
      .limit(10);

    // Top 10 使用模型
    const topModels = await db
      .select({
        model: tokenUsageLogs.model,
        creditsConsumed: sql`SUM(${tokenUsageLogs.creditsConsumed})`,
        tokensUsed: sql`SUM(${tokenUsageLogs.totalTokens})`,
        cachedTokens: sql`SUM(${tokenUsageLogs.cachedPromptTokens})`,
      })
      .from(tokenUsageLogs)
      .where(gte(tokenUsageLogs.createdAt, startDate))
      .groupBy(tokenUsageLogs.model)
      .orderBy(desc(sql`SUM(${tokenUsageLogs.creditsConsumed})`))
      .limit(10);

    // 积分余额分布
    const balanceDistribution = await db
      .select({
        range: sql`CASE
          WHEN ${userCredits.balance} = 0 THEN '0'
          WHEN ${userCredits.balance} BETWEEN 1 AND 100 THEN '1-100'
          WHEN ${userCredits.balance} BETWEEN 101 AND 1000 THEN '100-1000'
          ELSE '1000+'
        END`,
        count: count(),
      })
      .from(userCredits)
      .groupBy(sql`CASE
        WHEN ${userCredits.balance} = 0 THEN '0'
        WHEN ${userCredits.balance} BETWEEN 1 AND 100 THEN '1-100'
        WHEN ${userCredits.balance} BETWEEN 101 AND 1000 THEN '100-1000'
        ELSE '1000+'
      END`);

    const totalTokens = Number(tokensResult[0]?.totalTokens || 0);
    const cachedTokens = Number(tokensResult[0]?.cachedTokens || 0);
    
    res.json({
      period,
      totalCreditsConsumed: Math.abs(Number(creditsResult[0]?.totalCredits || 0)),
      totalTokensUsed: totalTokens,
      totalSessions: Number(creditsResult[0]?.totalCount || 0),
      cacheStats: {
        totalCacheHitTokens: cachedTokens,
        totalCacheCreationTokens: Number(tokensResult[0]?.cacheCreationTokens || 0),
        totalCacheSavings: cachedTokens * 0.5, // 简化估算：假设平均节省50%
        cacheHitRate: totalTokens > 0 
          ? `${((cachedTokens / totalTokens) * 100).toFixed(1)}%`
          : '0%',
      },
      topUsers,
      topModels,
      balanceDistribution,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取平台统计失败:', error);
    res.status(500).json({ error: '获取平台统计失败' });
  }
});

/**
 * GET /api/internal/billing/usage-logs
 * Token 使用明细
 */
router.get('/usage-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const userId = req.query.userId as string | undefined;
    const model = req.query.model as string | undefined;
    const sessionId = req.query.sessionId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const offset = (page - 1) * limit;

    let conditions = [];
    
    if (userId) conditions.push(eq(tokenUsageLogs.userId, userId as any));
    if (model) conditions.push(eq(tokenUsageLogs.model, model));
    if (sessionId) conditions.push(eq(tokenUsageLogs.sessionId, sessionId as any));
    if (startDate) conditions.push(gte(tokenUsageLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(tokenUsageLogs.createdAt, new Date(endDate)));

    let query = db.select().from(tokenUsageLogs);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const items = await query
      .orderBy(desc(tokenUsageLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // 总数
    let countQuery = db.select({ count: count() }).from(tokenUsageLogs);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as any;
    }
    const totalResult = await countQuery;

    res.json({
      items,
      total: Number(totalResult[0].count),
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing Admin] 获取使用明细失败:', error);
    res.status(500).json({ error: '获取使用明细失败' });
  }
});

export default router;
