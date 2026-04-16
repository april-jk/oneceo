import express from 'express';
import { adminAppUserService } from '../services/admin-app-user-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';

const router = express.Router();

router.use(createRequireInternalToken({
  disabledMessage: '用户管理内部接口未启用',
}));

function pickQueryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

router.get('/admin/app-users', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(String(req.query.limit || '120'), 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 120;
    const data = await adminAppUserService.listUsers({
      limit,
      query: pickQueryValue(req.query.query),
      status: pickQueryValue(req.query.status),
      activity: pickQueryValue(req.query.activity) as any,
      hasSession: pickQueryValue(req.query.hasSession) as any,
      hasConversation: pickQueryValue(req.query.hasConversation) as any,
      hasSandbox: pickQueryValue(req.query.hasSandbox) as any,
      ownershipHealth: pickQueryValue(req.query.ownershipHealth) as any,
    });
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('内部获取 app 用户列表失败:', error);
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 app 用户列表失败'),
    });
  }
});

router.get('/admin/app-users/:userId', async (req, res) => {
  try {
    const data = await adminAppUserService.getUserDetail(req.params.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const isNotFound = error?.message === '用户不存在';
    return res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 app 用户详情失败'),
    });
  }
});

router.post('/admin/app-users/:userId/status', async (req, res) => {
  try {
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({
        success: false,
        error: getPublicErrorMessage('状态仅支持 active 或 disabled'),
      });
    }

    const data = await adminAppUserService.updateUserStatus(req.params.userId, status);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const isNotFound = error?.message === '用户不存在';
    return res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新 app 用户状态失败'),
    });
  }
});

router.post('/admin/app-users/:userId/revoke-sessions', async (req, res) => {
  try {
    const data = await adminAppUserService.revokeUserSessions(req.params.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    const isNotFound = error?.message === '用户不存在';
    return res.status(isNotFound ? 404 : 400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '强制下线 app 用户会话失败'),
    });
  }
});

export default router;
