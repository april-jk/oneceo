import type express from 'express';

function splitCookies(input: string) {
  return input.split(/;\s*/g).filter(Boolean);
}

export function readCookie(req: express.Request, name: string): string | null {
  const raw = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (!raw) return null;
  for (const part of splitCookies(raw)) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(index + 1));
  }
  return null;
}

export function setCookie(
  res: express.Response,
  name: string,
  value: string,
  options?: { maxAgeMs?: number; secure?: boolean }
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (typeof options?.maxAgeMs === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`);
  }
  if (options?.secure) {
    parts.push('Secure');
  }
  const next = parts.join('; ');
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', next);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, next]);
    return;
  }
  res.setHeader('Set-Cookie', [String(current), next]);
}

export function clearCookie(res: express.Response, name: string, secure = false) {
  setCookie(res, name, '', {
    maxAgeMs: 0,
    secure,
  });
}
