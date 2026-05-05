import type express from 'express';
import { apiRequestLogService } from '../services/api-request-log-service';

const EXCLUDED_PATHS = [
  '/health',
  '/api/llm-proxy',
];

const EXCLUDED_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico', '.json', '.map'];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
  'x-session-token',
  'proxy-authorization',
]);

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'secret',
  'secret_key',
  'private_key',
  'credential',
  'authorization',
]);

function shouldExclude(req: express.Request): boolean {
  const path = req.path;
  for (const prefix of EXCLUDED_PATHS) {
    if (path.startsWith(prefix)) return true;
  }
  for (const ext of EXCLUDED_EXTENSIONS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

function sanitizeHeaders(headers: express.Request['headers']): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = '***REDACTED***';
    } else if (typeof value === 'string' || Array.isArray(value)) {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[DEPTH_LIMIT]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
      result[key] = '***REDACTED***';
    } else {
      result[key] = sanitizeObject(value, depth + 1);
    }
  }
  return result;
}

function extractBodySummary(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  try {
    const sanitized = sanitizeObject(body);
    return JSON.stringify(sanitized);
  } catch {
    return null;
  }
}

function extractResponseSummary(chunk: unknown): string | null {
  if (!chunk) return null;
  try {
    let text: string;
    if (Buffer.isBuffer(chunk)) {
      text = chunk.toString('utf8');
    } else if (typeof chunk === 'string') {
      text = chunk;
    } else {
      return null;
    }
    // Only keep first 10KB of response
    if (text.length > 10240) {
      text = text.slice(0, 10240) + '...[TRUNCATED]';
    }
    const parsed = JSON.parse(text);
    const sanitized = sanitizeObject(parsed);
    return JSON.stringify(sanitized);
  } catch {
    return null;
  }
}

function sanitizeQueryString(query: express.Request['query']): string | null {
  if (!query || Object.keys(query).length === 0) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
      params.set(key, '***REDACTED***');
    } else if (typeof value === 'string') {
      params.set(key, value);
    } else if (Array.isArray(value)) {
      params.set(key, value.join(','));
    }
  }
  const result = params.toString();
  return result || null;
}

function extractSessionId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const sessionId = b.sessionId || b.taskSessionId || b.task_session_id;
  if (typeof sessionId === 'string') return sessionId;
  return null;
}

export function requestLogMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (shouldExclude(req)) {
    next();
    return;
  }

  const appUserId = (req as any).user?.id;
  if (!appUserId) {
    next();
    return;
  }

  const startTime = Date.now();
  const recordData = {
    appUserId,
    method: req.method,
    path: req.path,
    queryString: sanitizeQueryString(req.query),
    requestHeaders: sanitizeHeaders(req.headers),
    requestBodySummary: extractBodySummary(req.body),
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
    taskSessionId: extractSessionId(req.body),
  };

  const originalEnd = res.end.bind(res);
  (res as any).end = function (chunk?: any, encoding?: any) {
    (res as any).end = originalEnd;
    res.end(chunk, encoding);

    const responseBodySummary = extractResponseSummary(chunk);
    const durationMs = Date.now() - startTime;

    apiRequestLogService.append({
      ...recordData,
      responseStatus: res.statusCode,
      responseBodySummary,
      durationMs,
    }).catch(() => {});
  };

  next();
}
