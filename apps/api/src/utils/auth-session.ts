import { createHash, randomBytes } from 'node:crypto';

export const APP_SESSION_COOKIE_NAME = 'app_session_id';
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
