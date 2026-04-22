import type express from 'express';
import { appAuthService } from '../services/app-auth-service';
import { APP_SESSION_COOKIE_NAMES } from '../utils/auth-session';
import { readCookieValuesByNames } from '../utils/http-cookie';

export async function appAuthMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) {
  try {
    const sessionTokens = readCookieValuesByNames(req, APP_SESSION_COOKIE_NAMES);
    if (sessionTokens.length === 0) {
      next();
      return;
    }

    for (const sessionToken of sessionTokens) {
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
      (req as any).currentAppSession = resolved.session;
      break;
    }
    next();
  } catch (error) {
    next(error);
  }
}
