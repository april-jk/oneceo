import type express from 'express';
import { appAuthService } from '../services/app-auth-service';
import { APP_SESSION_COOKIE_NAME } from '../utils/auth-session';
import { readCookieValues } from '../utils/http-cookie';

export async function appAuthMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) {
  try {
    const sessionTokens = readCookieValues(req, APP_SESSION_COOKIE_NAME);
    if (sessionTokens.length === 0) {
      next();
      return;
    }

    for (let index = sessionTokens.length - 1; index >= 0; index -= 1) {
      const sessionToken = sessionTokens[index];
      const resolved = await appAuthService.resolveUserBySessionToken(sessionToken);
      if (!resolved?.user) {
        continue;
      }
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
      break;
    }
    next();
  } catch (error) {
    next(error);
  }
}
