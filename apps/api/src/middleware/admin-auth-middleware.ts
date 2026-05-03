import type express from 'express';
import { adminAuthService } from '../services/admin-auth-service';
import { ADMIN_SESSION_COOKIE_NAME } from '../utils/auth-session';
import { readCookieValuesByNames } from '../utils/http-cookie';

export async function adminAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const sessionTokens = readCookieValuesByNames(req, [ADMIN_SESSION_COOKIE_NAME]);
    if (sessionTokens.length === 0) {
      res.status(401).json({ error: '未登录，请先登录管理后台' });
      return;
    }

    for (const sessionToken of sessionTokens) {
      const resolved = await adminAuthService.resolveAdminBySessionToken(sessionToken);
      if (!resolved?.adminUser) {
        continue;
      }

      (req as any).adminUser = {
        id: resolved.adminUser.id,
        loginName: resolved.adminUser.loginName,
        displayName: resolved.adminUser.displayName,
        role: resolved.adminUser.role,
      };
      next();
      return;
    }

    res.status(401).json({ error: '会话已过期，请重新登录' });
  } catch (error) {
    console.error('[AdminAuthMiddleware] 鉴权失败:', error);
    res.status(500).json({ error: '鉴权失败' });
  }
}
