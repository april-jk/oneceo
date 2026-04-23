import { billingService } from '../services/billing-service';

/**
 * 余额检查中间件
 * 在创建新会话前检查用户是否有足够积分
 */
export async function creditCheckMiddleware(req: any, res: any, next: any) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: '请先登录',
      });
    }

    const hasEnough = await billingService.hasEnoughCredits(userId, 0);
    
    if (!hasEnough) {
      const credits = await billingService.getUserCredits(userId);
      return res.status(402).json({
        error: 'INSUFFICIENT_CREDITS',
        message: '积分不足，无法创建新会话',
        balance: credits?.balance || 0,
      });
    }

    next();
  } catch (error) {
    console.error('[CreditCheck] 余额检查失败:', error);
    res.status(500).json({
      error: 'BILLING_ERROR',
      message: '计费系统错误',
    });
  }
}
