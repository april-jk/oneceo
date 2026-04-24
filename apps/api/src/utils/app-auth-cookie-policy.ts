import type express from 'express';
import {
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_STATE_COOKIE_NAME,
  SESSION_TTL_MS,
} from './auth-session';

type CookieProtocol = 'http' | 'https';

function resolveBrowserVisibleProtocol(req: express.Request): CookieProtocol | null {
  const candidates = [req.headers.origin, req.headers.referer];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue;
    }
    try {
      const protocol = new URL(candidate).protocol;
      if (protocol === 'http:' || protocol === 'https:') {
        return protocol.slice(0, -1) as CookieProtocol;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function isSecureAppCookieRequest(req: express.Request) {
  const browserVisibleProtocol = resolveBrowserVisibleProtocol(req);
  if (browserVisibleProtocol) {
    return browserVisibleProtocol === 'https';
  }

  return (
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')
      .some((value) => value.trim().toLowerCase() === 'https')
  );
}

function buildBaseCookieOptions(req: express.Request, maxAgeMs = SESSION_TTL_MS) {
  return {
    path: '/',
    sameSite: 'Lax' as const,
    secure: isSecureAppCookieRequest(req),
    maxAgeMs,
    expiresAt: new Date(Date.now() + maxAgeMs),
  };
}

export function buildAppSessionCookieOptions(req: express.Request) {
  return {
    ...buildBaseCookieOptions(req),
    httpOnly: true,
    priority: 'High' as const,
  };
}

export function buildAppSessionStateCookieOptions(req: express.Request) {
  return {
    ...buildBaseCookieOptions(req),
    httpOnly: false,
    priority: 'High' as const,
  };
}

export function buildAppSessionClearCookieOptions(req: express.Request) {
  return {
    path: '/',
    sameSite: 'Lax' as const,
    secure: isSecureAppCookieRequest(req),
  };
}

export function getAppSessionCookieNames() {
  return [APP_SESSION_COOKIE_NAME, APP_SESSION_STATE_COOKIE_NAME] as const;
}
