import type express from 'express';

function splitCookies(input: string): string[] {
  return input.split(/;\s*/g).filter(Boolean);
}

export function readCookie(req: express.Request, name: string): string | null {
  const header = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (!header) return null;
  for (const part of splitCookies(header)) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(index + 1));
  }
  return null;
}

export function buildCookie(name: string, value: string, options?: {
  maxAgeMs?: number;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
  path?: string;
}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options?.path || '/'}`);
  if (typeof options?.maxAgeMs === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`);
  }
  if (options?.httpOnly !== false) {
    segments.push('HttpOnly');
  }
  segments.push(`SameSite=${options?.sameSite || 'Lax'}`);
  if (options?.secure) {
    segments.push('Secure');
  }
  return segments.join('; ');
}

export function setCookie(
  res: express.Response,
  name: string,
  value: string,
  options?: Parameters<typeof buildCookie>[2]
) {
  const next = buildCookie(name, value, options);
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

export function clearCookie(res: express.Response, name: string, options?: { secure?: boolean; path?: string }) {
  setCookie(res, name, '', {
    maxAgeMs: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure: options?.secure,
    path: options?.path,
  });
}
