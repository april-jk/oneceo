import express from 'express';
import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';
import { ADMIN_COOKIE_NAME } from '../middleware/admin-auth-middleware';
import { clearCookie, readCookie, setCookie } from '../utils/cookies';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function isSecureCookie(req: express.Request) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
}

export function createAdminAuthRoutes(oneceoApi: OneceoApiConnector) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const result = await oneceoApi.adminLogin({
        loginName: req.body?.loginName,
        password: req.body?.password,
      });
      setCookie(res, ADMIN_COOKIE_NAME, result.sessionToken, {
        maxAgeMs: SESSION_TTL_MS,
        secure: isSecureCookie(req),
      });
      return res.json({
        success: true,
        data: {
          adminUser: result.adminUser,
        },
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: { message: error instanceof Error ? error.message : '管理员登录失败' },
      });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const token = readCookie(req, ADMIN_COOKIE_NAME);
      if (token) {
        await oneceoApi.adminLogout(token);
      }
      clearCookie(res, ADMIN_COOKIE_NAME, isSecureCookie(req));
      return res.json({
        success: true,
        data: { ok: true },
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: { message: error instanceof Error ? error.message : '管理员退出失败' },
      });
    }
  });

  router.get('/me', async (req, res) => {
    try {
      const token = readCookie(req, ADMIN_COOKIE_NAME);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: { message: '当前未登录管理员账号' },
        });
      }
      const result = await oneceoApi.resolveAdminSession(token);
      return res.json({
        success: true,
        data: {
          adminUser: result.adminUser,
        },
      });
    } catch (error: any) {
      return res.status(401).json({
        success: false,
        error: { message: error instanceof Error ? error.message : '管理员登录已失效，请重新登录' },
      });
    }
  });

  return router;
}
