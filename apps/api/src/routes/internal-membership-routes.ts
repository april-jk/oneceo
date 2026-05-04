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

router.get('/membership/plans/:planId', async (req, res) => {
  try {
    const planId = String(req.params?.planId || '').trim();
    if (!planId) throw new Error('会员类型ID不能为空');
    const data = await membershipService.getPlanById(planId);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 获取会员类型详情失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取会员类型详情失败'),
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

router.put('/membership/plans/:planId', async (req, res) => {
  try {
    const planId = String(req.params?.planId || '').trim();
    if (!planId) throw new Error('会员类型ID不能为空');
    const adminUser = (req as any).adminUser?.id || null;
    const data = await membershipService.updatePlan(
      planId,
      {
        name: req.body?.name === undefined ? undefined : String(req.body.name || '').trim(),
        status: req.body?.status === undefined ? undefined : String(req.body.status || '').trim(),
        defaultCredits: req.body?.defaultCredits === undefined ? undefined : Number(req.body.defaultCredits),
        isDefault: req.body?.isDefault === undefined ? undefined : Boolean(req.body.isDefault),
        allowedAgentLevelsJson: req.body?.allowedAgentLevels === undefined
          ? undefined
          : (Array.isArray(req.body.allowedAgentLevels) ? req.body.allowedAgentLevels : []),
        benefitsJson: req.body?.benefits === undefined
          ? undefined
          : (Array.isArray(req.body.benefits) ? req.body.benefits : []),
        dailyAutoRestoreEnabled: req.body?.dailyAutoRestoreEnabled === undefined
          ? undefined
          : Boolean(req.body.dailyAutoRestoreEnabled),
        dailyAutoRestoreCredits: req.body?.dailyAutoRestoreCredits === undefined
          ? undefined
          : Number(req.body.dailyAutoRestoreCredits),
        description: req.body?.description === undefined ? undefined : String(req.body.description || '').trim(),
        sortOrder: req.body?.sortOrder === undefined ? undefined : Number(req.body.sortOrder),
        effectiveFrom: req.body?.effectiveFrom === undefined
          ? undefined
          : (req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null),
        effectiveUntil: req.body?.effectiveUntil === undefined
          ? undefined
          : (req.body.effectiveUntil ? new Date(req.body.effectiveUntil) : null),
      },
      adminUser
    );
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 更新会员类型失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新会员类型失败'),
    });
  }
});

router.patch('/membership/plans/:planId/status', async (req, res) => {
  try {
    const planId = String(req.params?.planId || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!planId) throw new Error('会员类型ID不能为空');
    if (!status) throw new Error('状态不能为空');
    const adminUser = (req as any).adminUser?.id || null;
    const data = await membershipService.updatePlanStatus(planId, status, adminUser);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 更新会员类型状态失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新会员类型状态失败'),
    });
  }
});

router.get('/membership/users', async (req, res) => {
  try {
    const data = await membershipService.listMemberships({
      userId: req.query?.userId ? String(req.query.userId).trim() : undefined,
      membershipPlanId: req.query?.membershipPlanId ? String(req.query.membershipPlanId).trim() : undefined,
      status: req.query?.status ? String(req.query.status).trim() : undefined,
      page: req.query?.page ? Number(req.query.page) : undefined,
      pageSize: req.query?.pageSize ? Number(req.query.pageSize) : undefined,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 分页获取用户会员失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '分页获取用户会员失败'),
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

router.patch('/membership/user-memberships/:membershipId/status', async (req, res) => {
  try {
    const membershipId = String(req.params?.membershipId || '').trim();
    const status = String(req.body?.status || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!membershipId) throw new Error('用户会员ID不能为空');
    if (!status) throw new Error('状态不能为空');
    const adminUser = (req as any).adminUser?.id || null;
    const data = await membershipService.updateUserMembershipStatus(membershipId, status, adminUser, reason);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 更新用户会员状态失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新用户会员状态失败'),
    });
  }
});

router.patch('/membership/user-memberships/:membershipId/expire', async (req, res) => {
  try {
    const membershipId = String(req.params?.membershipId || '').trim();
    if (!membershipId) throw new Error('用户会员ID不能为空');
    const expiresAtText = req.body?.expiresAt;
    const expiresAt = expiresAtText ? new Date(String(expiresAtText)) : null;
    if (expiresAtText && Number.isNaN(expiresAt?.getTime?.())) {
      throw new Error('过期时间格式无效');
    }
    const adminUser = (req as any).adminUser?.id || null;
    const reason = String(req.body?.reason || '').trim();
    const data = await membershipService.updateUserMembershipExpireAt(membershipId, expiresAt, adminUser, reason);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 更新用户会员过期时间失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新用户会员过期时间失败'),
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

router.get('/membership/daily-restore/history', async (req, res) => {
  try {
    const data = await membershipService.listDailyRestoreHistory({
      page: req.query?.page ? Number(req.query.page) : undefined,
      pageSize: req.query?.pageSize ? Number(req.query.pageSize) : undefined,
      userId: req.query?.userId ? String(req.query.userId).trim() : undefined,
      membershipPlanId: req.query?.membershipPlanId ? String(req.query.membershipPlanId).trim() : undefined,
      startDate: req.query?.startDate ? String(req.query.startDate).trim() : undefined,
      endDate: req.query?.endDate ? String(req.query.endDate).trim() : undefined,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[Membership Admin] 获取每日恢复历史失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取每日恢复历史失败'),
    });
  }
});

export default router;
