import express from 'express';
import { adminAuthService } from '../services/admin-auth-service';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireInternalToken(req: express.Request) {
  const configured = asText(process.env.ONECEO_INTERNAL_TOKEN);
  if (!configured) return;
  const incoming = asText(req.header('x-oneceo-internal-token'));
  if (!incoming || incoming !== configured) {
    throw new Error('forbidden');
  }
}

router.post('/admin-auth/login', async (req, res) => {
  try {
    requireInternalToken(req);
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
    const forbidden = error?.message === 'forbidden';
    return res.status(forbidden ? 403 : 400).json({
      success: false,
      error: getPublicErrorMessage(forbidden ? '无权访问内部管理员认证接口' : error?.message || '管理员登录失败'),
    });
  }
});

router.post('/admin-auth/logout', async (req, res) => {
  try {
    requireInternalToken(req);
    await adminAuthService.logout(req.body?.sessionToken || '');
    return res.json({
      success: true,
      data: { ok: true },
    });
  } catch (error: any) {
    const forbidden = error?.message === 'forbidden';
    return res.status(forbidden ? 403 : 400).json({
      success: false,
      error: getPublicErrorMessage(forbidden ? '无权访问内部管理员认证接口' : error?.message || '管理员退出失败'),
    });
  }
});

router.post('/admin-auth/resolve', async (req, res) => {
  try {
    requireInternalToken(req);
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
    const forbidden = error?.message === 'forbidden';
    return res.status(forbidden ? 403 : 400).json({
      success: false,
      error: getPublicErrorMessage(forbidden ? '无权访问内部管理员认证接口' : error?.message || '管理员会话解析失败'),
    });
  }
});

export default router;
