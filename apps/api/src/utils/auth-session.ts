import { createHash, randomBytes } from 'node:crypto';

export const APP_SESSION_COOKIE_NAME = 'app_session_v2_id';
export const APP_SESSION_STATE_COOKIE_NAME = 'app_session_v2_state';
export const LEGACY_APP_SESSION_COOKIE_NAME = 'app_session_id';
export const LEGACY_APP_SESSION_STATE_COOKIE_NAME = 'app_session_state';
export const APP_SESSION_COOKIE_NAMES = [APP_SESSION_COOKIE_NAME, LEGACY_APP_SESSION_COOKIE_NAME] as const;
export const APP_SESSION_STATE_COOKIE_NAMES = [
  APP_SESSION_STATE_COOKIE_NAME,
  LEGACY_APP_SESSION_STATE_COOKIE_NAME,
] as const;
export const ADMIN_SESSION_COOKIE_NAME = 'admin_session_id';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function resolveSessionExpiry(now = Date.now()) {
  return new Date(now + SESSION_TTL_MS);
}
