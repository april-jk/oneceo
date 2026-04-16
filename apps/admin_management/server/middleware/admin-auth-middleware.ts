import type express from 'express';
import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';
import { readCookie } from '../utils/cookies';

export const ADMIN_COOKIE_NAME = 'admin_session_id';

export function createAdminAuthMiddleware(oneceoApi: OneceoApiConnector) {
  return async function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const sessionToken = readCookie(req, ADMIN_COOKIE_NAME);
      if (!sessionToken) {
        return res.status(401).json({
          success: false,
          error: { message: '当前未登录管理员账号' },
        });
      }
      const resolved = await oneceoApi.resolveAdminSession(sessionToken);
      (req as any).adminUser = resolved.adminUser;
      (req as any).adminSessionToken = sessionToken;
      next();
    } catch (error: any) {
      return res.status(401).json({
        success: false,
        error: { message: error instanceof Error ? error.message : '管理员登录已失效，请重新登录' },
      });
    }
  };
}
