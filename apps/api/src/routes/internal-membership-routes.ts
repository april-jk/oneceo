import express from 'express';
import { createRequireInternalToken } from './internal-auth-middleware';
import { membershipService } from '../services/membership-service';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();
router.use(createRequireInternalToken({
  disabledMessage: '会员管理内部接口未启用',
}));

router.get('/membership/plans', async (_req, res) => {
  try {
    const data = await membershipService.listPlans();
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 获取会员类型失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取会员类型失败'),
    });
  }
});

router.post('/membership/plans', async (req, res) => {
  try {
    const adminUser = (req as any).adminUser?.id || null;
    const data = await membershipService.createPlan(
      {
        code: '',
        name: String(req.body?.name || '').trim(),
        status: String(req.body?.status || 'active').trim(),
        defaultCredits: Number(req.body?.defaultCredits || 0),
        isDefault: Boolean(req.body?.isDefault),
        allowedAgentLevelsJson: Array.isArray(req.body?.allowedAgentLevels)
          ? req.body.allowedAgentLevels
          : [],
        benefitsJson: Array.isArray(req.body?.benefits)
          ? req.body.benefits
          : [],
        dailyAutoRestoreEnabled: Boolean(req.body?.dailyAutoRestoreEnabled),
        dailyAutoRestoreCredits: Number(req.body?.dailyAutoRestoreCredits || 0),
        description: String(req.body?.description || '').trim(),
        sortOrder: Number(req.body?.sortOrder || 0),
        effectiveFrom: req.body?.effectiveFrom ? new Date(req.body.effectiveFrom) : undefined,
        effectiveUntil: req.body?.effectiveUntil ? new Date(req.body.effectiveUntil) : undefined,
        createdBy: adminUser,
      },
      adminUser
    );
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 创建会员类型失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '创建会员类型失败'),
    });
  }
});

router.get('/membership/users/:userId', async (req, res) => {
  try {
    const data = await membershipService.listUserMemberships(req.params.userId);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 获取用户会员失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取用户会员失败'),
    });
  }
});

router.put('/membership/users/:userId/assign', async (req, res) => {
  try {
    const adminUser = (req as any).adminUser?.id || null;
    const data = await membershipService.assignUserMembership(
      {
        userId: req.params.userId,
        membershipPlanId: String(req.body?.membershipPlanId || '').trim(),
        expiresAt: req.body?.expiresAt ? new Date(req.body.expiresAt) : undefined,
        sourceType: String(req.body?.sourceType || 'manual'),
        sourceId: req.body?.sourceId ? String(req.body.sourceId).trim() : null,
        assignedReason: String(req.body?.assignedReason || '').trim(),
        grantCredits: req.body?.grantCredits === undefined ? undefined : Number(req.body.grantCredits),
      },
      adminUser
    );
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 分配用户会员失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '分配用户会员失败'),
    });
  }
});

router.post('/membership/daily-restore/run', async (req, res) => {
  try {
    const dateText = String(req.body?.date || '').trim();
    const targetDate = dateText ? new Date(dateText) : new Date();
    if (Number.isNaN(targetDate.getTime())) {
      throw new Error('日期格式无效');
    }
    const data = await membershipService.runDailyAutoRestore(targetDate);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 手动执行每日恢复积分失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '手动执行每日恢复积分失败'),
    });
  }
});

export default router;
