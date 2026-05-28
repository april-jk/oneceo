import express from 'express';
import { adminAuthService } from '../services/admin-auth-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { createRequireInternalToken } from './internal-auth-middleware';

const router = express.Router();
router.use(createRequireInternalToken({
  disabledMessage: '管理员认证内部接口未启用',
}));

router.post('/admin-auth/sync-bootstrap', async (_req, res) => {
  try {
    await adminAuthService.ensureBootstrapAdmin();
    return res.json({
      success: true,
      data: { ok: true },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '管理员默认账号同步失败'),
    });
  }
});

router.post('/admin-auth/login', async (req, res) => {
  try {
    const result = await adminAuthService.login(
      {
        loginName: req.body?.loginName,
        password: req.body?.password,
      },
      req
    );
    return res.json({
      success: true,
      data: {
        sessionToken: result.token,
        adminUser: result.adminUser,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '管理员登录失败'),
    });
  }
});

router.post('/admin-auth/logout', async (req, res) => {
  try {
    await adminAuthService.logout(req.body?.sessionToken || '');
    return res.json({
      success: true,
      data: { ok: true },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '管理员退出失败'),
    });
  }
});

router.post('/admin-auth/resolve', async (req, res) => {
  try {
    const resolved = await adminAuthService.resolveAdminBySessionToken(req.body?.sessionToken || '');
    if (!resolved?.adminUser) {
      return res.status(401).json({
        success: false,
        error: '管理员登录态无效',
      });
    }
    return res.json({
      success: true,
      data: {
        adminUser: resolved.adminUser,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '管理员会话解析失败'),
    });
  }
});

export default router;
