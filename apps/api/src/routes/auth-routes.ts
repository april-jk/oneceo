import express from 'express';
import { appUserLegacyIdMappingDAO } from '../db/dao/app-user-legacy-id-mapping.dao';
import { taskCreationSessionDAO } from '../db/dao/task-creation-session.dao';
import { appAuthService } from '../services/app-auth-service';
import { appAuthLoginRateLimitService } from '../services/app-auth-login-rate-limit-service';
import { getPublicErrorMessage } from '../utils/error-response';
import {
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_COOKIE_NAMES,
  APP_SESSION_STATE_COOKIE_NAME,
  APP_SESSION_STATE_COOKIE_NAMES,
} from '../utils/auth-session';
import {
  buildAppSessionClearCookieOptions,
  buildAppSessionCookieOptions,
  buildAppSessionStateCookieOptions,
} from '../utils/app-auth-cookie-policy';
import { clearCookie, readCookieValuesByNames, setCookie } from '../utils/http-cookie';
import { isLegacyClientUserId, normalizeUserId } from '../utils/user-id';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown) {
  return asText(value).toLowerCase();
}

function getClientIpAddress(req: express.Request) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }
  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return String(forwardedFor[0]).split(',')[0]?.trim() || null;
  }
  return req.socket.remoteAddress || null;
}

function buildLoginAttemptIdentity(req: express.Request) {
  return {
    email: normalizeEmail(req.body?.email),
    ipAddress: getClientIpAddress(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

function requireJsonRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.is('application/json') || req.is('application/*+json')) {
    next();
    return;
  }
  return res.status(415).json({
    success: false,
    error: '请求必须使用 application/json',
  });
}

function applyRetryAfter(res: express.Response, retryAfterSeconds: number) {
  if (retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
  }
}

function applyNoStoreAuthHeaders(res: express.Response) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.vary('Origin');
  res.vary('Cookie');
}

function listCookieNames(req: express.Request) {
  const header = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (!header) {
    return [];
  }
  return header
    .split(/;\s*/g)
    .map((part) => part.split('=')[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

function applyAuthDebugHeaders(
  req: express.Request,
  res: express.Response,
  input?: {
    currentUserId?: string | null;
    wroteSessionCookie?: boolean;
  }
) {
  const sessionCookieValues = readCookieValuesByNames(req, APP_SESSION_COOKIE_NAMES);
  const stateCookieValues = readCookieValuesByNames(req, APP_SESSION_STATE_COOKIE_NAMES);
  res.setHeader('X-Oneceo-Auth-Debug-Cookie-Names', listCookieNames(req).join(',') || 'none');
  res.setHeader('X-Oneceo-Auth-Debug-Has-Session-Cookie', sessionCookieValues.length > 0 ? '1' : '0');
  res.setHeader('X-Oneceo-Auth-Debug-Session-Cookie-Count', String(sessionCookieValues.length));
  res.setHeader('X-Oneceo-Auth-Debug-Has-State-Cookie', stateCookieValues.length > 0 ? '1' : '0');
  res.setHeader('X-Oneceo-Auth-Debug-Current-User', input?.currentUserId ? '1' : '0');
  res.setHeader('X-Oneceo-Auth-Debug-Wrote-Session-Cookie', input?.wroteSessionCookie ? '1' : '0');
}

function logAuthDebug(
  route: string,
  req: express.Request,
  input?: {
    currentUserId?: string | null;
    wroteSessionCookie?: boolean;
  }
) {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  const sessionCookieValues = readCookieValuesByNames(req, APP_SESSION_COOKIE_NAMES);
  const stateCookieValues = readCookieValuesByNames(req, APP_SESSION_STATE_COOKIE_NAMES);
  console.info(
    '[APP_AUTH_DEBUG]',
    JSON.stringify({
      route,
      method: req.method,
      origin: req.headers.origin || null,
      referer: req.headers.referer || null,
      cookieNames: listCookieNames(req),
      hasSessionCookie: sessionCookieValues.length > 0,
      sessionCookieCount: sessionCookieValues.length,
      hasStateCookie: stateCookieValues.length > 0,
      currentUser: Boolean(input?.currentUserId),
      wroteSessionCookie: Boolean(input?.wroteSessionCookie),
    })
  );
}

function writeAuthenticatedAppCookies(res: express.Response, req: express.Request, sessionToken: string) {
  setCookie(res, APP_SESSION_COOKIE_NAME, sessionToken, buildAppSessionCookieOptions(req));
  setCookie(res, APP_SESSION_STATE_COOKIE_NAME, 'authenticated', buildAppSessionStateCookieOptions(req));
}

function clearAppAuthCookies(res: express.Response, req: express.Request) {
  const clearOptions = buildAppSessionClearCookieOptions(req);
  for (const cookieName of APP_SESSION_COOKIE_NAMES) {
    clearCookie(res, cookieName, clearOptions);
  }
  for (const cookieName of APP_SESSION_STATE_COOKIE_NAMES) {
    clearCookie(res, cookieName, {
      ...clearOptions,
      httpOnly: false,
    });
  }
}

router.use((_req, res, next) => {
  applyNoStoreAuthHeaders(res);
  next();
});

router.post('/register', requireJsonRequest, async (req, res) => {
  try {
    const result = await appAuthService.register(
      {
        email: req.body?.email,
        password: req.body?.password,
        displayName: req.body?.displayName,
        verificationCode: req.body?.verificationCode,
      },
      req
    );
    writeAuthenticatedAppCookies(res, req, result.token);
    applyAuthDebugHeaders(req, res, {
      currentUserId: result.user?.id || null,
      wroteSessionCookie: true,
    });
    logAuthDebug('/register', req, {
      currentUserId: result.user?.id || null,
      wroteSessionCookie: true,
    });
    return res.json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '注册失败'),
    });
  }
});

router.post('/register/send-code', requireJsonRequest, async (req, res) => {
  try {
    const result = await appAuthService.sendRegisterVerificationCode({
      email: req.body?.email,
    });
    applyAuthDebugHeaders(req, res, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    logAuthDebug('/register/send-code', req, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '验证码发送失败'),
    });
  }
});

router.post('/login', requireJsonRequest, async (req, res) => {
  const attemptIdentity = buildLoginAttemptIdentity(req);
  const rateLimitDecision = await appAuthLoginRateLimitService.check(attemptIdentity);
  if (!rateLimitDecision.allowed) {
    applyRetryAfter(res, rateLimitDecision.retryAfterSeconds);
    applyAuthDebugHeaders(req, res, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    appAuthLoginRateLimitService.logSecurityEvent('login_blocked', attemptIdentity, {
      stage: 'precheck',
      scope: rateLimitDecision.scope,
      retryAfterSeconds: rateLimitDecision.retryAfterSeconds,
    });
    return res.status(429).json({
      success: false,
      error: '登录尝试过于频繁，请稍后再试',
    });
  }

  try {
    const result = await appAuthService.login(
      {
        email: req.body?.email,
        password: req.body?.password,
      },
      req
    );
    await appAuthLoginRateLimitService.recordSuccess(attemptIdentity);
    writeAuthenticatedAppCookies(res, req, result.token);
    applyAuthDebugHeaders(req, res, {
      currentUserId: result.user?.id || null,
      wroteSessionCookie: true,
    });
    appAuthLoginRateLimitService.logSecurityEvent('login_succeeded', attemptIdentity, {
      userId: result.user?.id || null,
    });
    logAuthDebug('/login', req, {
      currentUserId: result.user?.id || null,
      wroteSessionCookie: true,
    });
    return res.json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error: any) {
    const failureDecision = await appAuthLoginRateLimitService.recordFailure(attemptIdentity);
    applyAuthDebugHeaders(req, res, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    if (!failureDecision.allowed) {
      applyRetryAfter(res, failureDecision.retryAfterSeconds);
      appAuthLoginRateLimitService.logSecurityEvent('login_blocked', attemptIdentity, {
        stage: 'post_failure',
        scope: failureDecision.scope,
        retryAfterSeconds: failureDecision.retryAfterSeconds,
      });
      return res.status(429).json({
        success: false,
        error: '登录尝试过于频繁，请稍后再试',
      });
    }
    appAuthLoginRateLimitService.logSecurityEvent('login_failed', attemptIdentity, {
      message: getPublicErrorMessage(error?.message || '登录失败'),
    });
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '登录失败'),
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const sessionToken = readCookieValuesByNames(req, APP_SESSION_COOKIE_NAMES)[0] || null;
    if (sessionToken) {
      await appAuthService.logout(sessionToken);
    }
    clearAppAuthCookies(res, req);
    applyAuthDebugHeaders(req, res, {
      currentUserId: (req as any).currentAppUser?.id || null,
      wroteSessionCookie: false,
    });
    logAuthDebug('/logout', req, {
      currentUserId: (req as any).currentAppUser?.id || null,
      wroteSessionCookie: false,
    });
    return res.json({
      success: true,
      data: {
        ok: true,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '退出登录失败'),
    });
  }
});

router.get('/session', async (req, res) => {
  const current = (req as any).currentAppUser;
  if (!current?.id) {
    const clearOptions = buildAppSessionClearCookieOptions(req);
    for (const cookieName of APP_SESSION_COOKIE_NAMES) {
      clearCookie(res, cookieName, clearOptions);
    }
    for (const cookieName of APP_SESSION_STATE_COOKIE_NAMES) {
      clearCookie(res, cookieName, {
        ...clearOptions,
        httpOnly: false,
      });
    }
    applyAuthDebugHeaders(req, res, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    logAuthDebug('/session', req, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    return res.json({
      success: true,
      data: {
        authenticated: false,
      },
    });
  }

  setCookie(res, APP_SESSION_STATE_COOKIE_NAME, 'authenticated', buildAppSessionStateCookieOptions(req));
  applyAuthDebugHeaders(req, res, {
    currentUserId: current.id,
    wroteSessionCookie: false,
  });
  logAuthDebug('/session', req, {
    currentUserId: current.id,
    wroteSessionCookie: false,
  });
  return res.json({
    success: true,
    data: {
      authenticated: true,
      user: current,
    },
  });
});

router.get('/me', async (req, res) => {
  const current = (req as any).currentAppUser;
  if (!current?.id) {
    const clearOptions = {
      ...buildAppSessionClearCookieOptions(req),
      httpOnly: false,
    };
    for (const cookieName of APP_SESSION_STATE_COOKIE_NAMES) {
      clearCookie(res, cookieName, clearOptions);
    }
    applyAuthDebugHeaders(req, res, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    logAuthDebug('/me', req, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    return res.status(401).json({
      success: false,
      error: '当前未登录',
    });
  }
  setCookie(res, APP_SESSION_STATE_COOKIE_NAME, 'authenticated', buildAppSessionStateCookieOptions(req));
  applyAuthDebugHeaders(req, res, {
    currentUserId: current.id,
    wroteSessionCookie: false,
  });
  logAuthDebug('/me', req, {
    currentUserId: current.id,
    wroteSessionCookie: false,
  });
  return res.json({
    success: true,
    data: {
      user: current,
    },
  });
});

router.post('/legacy-client-id', requireJsonRequest, async (req, res) => {
  const current = (req as any).currentAppUser;
  if (!current?.id) {
    applyAuthDebugHeaders(req, res, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    logAuthDebug('/legacy-client-id', req, {
      currentUserId: null,
      wroteSessionCookie: false,
    });
    return res.status(401).json({
      success: false,
      error: '当前未登录',
    });
  }

  const legacyUserId = normalizeUserId(req.body?.legacyUserId);
  if (!legacyUserId || !isLegacyClientUserId(legacyUserId)) {
    return res.status(400).json({
      success: false,
      error: 'legacy 用户标识无效',
    });
  }

  try {
    await appUserLegacyIdMappingDAO.upsert({
      appUserId: current.id,
      legacyUserId,
      source: 'auth_bootstrap',
    });

    const reboundSessions = await taskCreationSessionDAO.rebindSessionsFromLegacyUserId(
      current.id,
      legacyUserId,
      5000
    );

    return res.json({
      success: true,
      data: {
        linked: true,
        reboundCount: reboundSessions.length,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || 'legacy 用户标识绑定失败'),
    });
  }
});

router.patch('/profile', requireJsonRequest, async (req, res) => {
  const current = (req as any).currentAppUser;
  if (!current?.id) {
    return res.status(401).json({
      success: false,
      error: '当前未登录',
    });
  }

  try {
    const user = await appAuthService.updateProfile(current.id, {
      displayName: req.body?.displayName,
      personalization: req.body?.personalization,
    });
    return res.json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新用户资料失败'),
    });
  }
});

export default router;
