import type express from 'express';

function splitCookies(input: string): string[] {
  return input.split(/;\s*/g).filter(Boolean);
}

export function readCookieValuesFromHeader(cookieHeader: string, name: string): string[] {
  const header = typeof cookieHeader === 'string' ? cookieHeader : '';
  if (!header) return [];
  const values: string[] = [];
  for (const part of splitCookies(header)) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    const rawValue = part.slice(index + 1);
    try {
      values.push(decodeURIComponent(rawValue));
    } catch {
      values.push(rawValue);
    }
  }
  return values;
}

export function readCookieValuesFromHeaderByNames(cookieHeader: string, names: readonly string[]): string[] {
  const values: string[] = [];
  for (const name of names) {
    const matched = readCookieValuesFromHeader(cookieHeader, name);
    for (let index = matched.length - 1; index >= 0; index -= 1) {
      values.push(matched[index]);
    }
  }
  return values;
}

export function readCookieValues(req: express.Request, name: string): string[] {
  const header = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  return readCookieValuesFromHeader(header, name);
}

export function readCookieValuesByNames(req: express.Request, names: readonly string[]): string[] {
  const header = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  return readCookieValuesFromHeaderByNames(header, names);
}

export function readCookie(req: express.Request, name: string): string | null {
  const values = readCookieValues(req, name);
  return values.length > 0 ? values[0] : null;
}

export function buildCookie(name: string, value: string, options?: {
  maxAgeMs?: number;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
  path?: string;
  expiresAt?: Date;
  domain?: string;
  priority?: 'Low' | 'Medium' | 'High';
}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options?.path || '/'}`);
  if (options?.domain) {
    segments.push(`Domain=${options.domain}`);
  }
  if (typeof options?.maxAgeMs === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`);
  }
  if (options?.expiresAt instanceof Date && Number.isFinite(options.expiresAt.getTime())) {
    segments.push(`Expires=${options.expiresAt.toUTCString()}`);
  }
  if (options?.httpOnly !== false) {
    segments.push('HttpOnly');
  }
  segments.push(`SameSite=${options?.sameSite || 'Lax'}`);
  if (options?.secure) {
    segments.push('Secure');
  }
  if (options?.priority) {
    segments.push(`Priority=${options.priority}`);
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

export function clearCookie(
  res: express.Response,
  name: string,
  options?: {
    secure?: boolean;
    path?: string;
    sameSite?: 'Lax' | 'Strict' | 'None';
    domain?: string;
    httpOnly?: boolean;
    priority?: 'Low' | 'Medium' | 'High';
  }
) {
  setCookie(res, name, '', {
    maxAgeMs: 0,
    expiresAt: new Date(0),
    httpOnly: options?.httpOnly,
    sameSite: options?.sameSite || 'Lax',
    secure: options?.secure,
    path: options?.path,
    domain: options?.domain,
    priority: options?.priority,
  });
}
