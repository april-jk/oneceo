import type express from 'express';
import { appAuthService } from '../services/app-auth-service';
import { APP_SESSION_COOKIE_NAME } from '../utils/auth-session';
import { readCookie } from '../utils/http-cookie';

export async function appAuthMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) {
  try {
    const sessionToken = readCookie(req, APP_SESSION_COOKIE_NAME);
    if (!sessionToken) {
      next();
      return;
    }
    const resolved = await appAuthService.resolveUserBySessionToken(sessionToken);
    if (resolved?.user) {
      (req as any).user = {
        id: resolved.user.id,
        userId: resolved.user.id,
        email: resolved.user.email,
        displayName: resolved.user.displayName,
      };
      (req as any).auth = {
        userId: resolved.user.id,
      };
      (req as any).currentAppUser = resolved.user;
    }
    next();
  } catch (error) {
    next(error);
  }
}
