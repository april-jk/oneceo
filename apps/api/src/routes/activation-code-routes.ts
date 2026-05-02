import express from 'express';
import { ActivationCodeService } from '../services/activation-code-service';
import { appAuthMiddleware } from '../middleware/app-auth-middleware';

const router = express.Router();
const activationCodeService = new ActivationCodeService();

/**
 * POST /api/activation-codes/redeem
 * 兑换激活码（需要用户登录）
 */
router.post('/redeem', appAuthMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = (req as any).auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: '请先登录' });
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ error: '请输入激活码' });
    }

    const result = await activationCodeService.redeemActivationCode(code.trim(), userId);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({
      success: true,
      creditsGranted: result.creditsGranted,
      newBalance: result.newBalance,
      message: result.message,
    });
  } catch (error: any) {
    console.error('[ActivationCode] 兑换激活码失败:', error);
    res.status(500).json({ error: error.message || '兑换激活码失败' });
  }
});

export default router;
