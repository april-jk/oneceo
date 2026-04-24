import express from 'express';
import { billingService } from '../services/billing-service';
import { pricingService } from '../services/pricing-service';

const router = express.Router();

/**
 * GET /api/billing/credits
 * 查询当前用户积分余额
 */
router.get('/credits', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    const credits = await billingService.getUserCredits(userId);
    
    if (!credits) {
      return res.json({ balance: 0, totalEarned: 0, totalConsumed: 0 });
    }

    res.json({
      balance: credits.balance,
      totalEarned: credits.totalEarned,
      totalConsumed: credits.totalConsumed,
    });
  } catch (error) {
    console.error('[Billing] 获取积分余额失败:', error);
    res.status(500).json({ error: '获取积分余额失败' });
  }
});

/**
 * GET /api/billing/transactions
 * 查询消费记录（分页）
 */
router.get('/transactions', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const type = req.query.type as string | undefined;

    const result = await billingService.getTransactions(userId, { page, limit, type });

    res.json({
      items: result.items,
      total: result.total,
      page,
      limit,
    });
  } catch (error) {
    console.error('[Billing] 获取交易记录失败:', error);
    res.status(500).json({ error: '获取交易记录失败' });
  }
});

/**
 * GET /api/billing/session/:sessionId/usage
 * 查询单个会话积分消耗
 */
router.get('/session/:sessionId/usage', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: '未登录' });
    }

    const { sessionId } = req.params;
    const usage = await billingService.getSessionUsage(sessionId, userId);

    res.json({
      sessionId,
      totalCredits: usage.totalCredits,
      totalTokens: usage.totalTokens,
      modelBreakdown: usage.modelBreakdown,
    });
  } catch (error) {
    console.error('[Billing] 获取会话使用记录失败:', error);
    res.status(500).json({ error: '获取会话使用记录失败' });
  }
});

/**
 * GET /api/billing/pricing
 * 查询模型定价列表（公开）
 */
router.get('/pricing', async (req, res) => {
  try {
    const pricingList = await pricingService.listActivePricing();
    
    // 添加缓存比例信息
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
    console.error('[Billing] 获取定价列表失败:', error);
    res.status(500).json({ error: '获取定价列表失败' });
  }
});

export default router;
