import { osacConnectionManager } from './osac-connection-manager';
import { auditOsacAction } from '../utils/osac-audit';
import { getPublicErrorMessage } from '../utils/error-response';
import type { OsacMessage } from '../clients/osac-client';

type LlmProxyRequestPayload = {
  requestId?: string;
  method?: string;
  path?: string;
  headers?: Record<string, unknown>;
  body?: string;
  bodyBase64?: boolean;
  bodyEncoding?: string;
  isStream?: boolean;
};

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const bridgeSendConnectTimeoutMs = toPositiveInt(
  process.env.OSAC_LLM_PROXY_BRIDGE_SEND_CONNECT_TIMEOUT_MS,
  1200
);

function normalizeHeaders(input?: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    const lowerKey = key.toLowerCase();
    if (!value) continue;
    if (lowerKey === 'host') continue;
    if (lowerKey === 'content-length') continue;
    if (lowerKey.startsWith('x-oneceo-internal-llm-')) continue;
    headers[key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return headers;
}

function shouldStream(responseContentType: string) {
  return responseContentType.includes('text/event-stream');
}

function buildProxyUrl(path: string) {
  const base = process.env.OSAC_LLM_PROXY_BRIDGE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}/api/llm-proxy`;
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isAllowedLlmPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === '/v1/models' || normalized.startsWith('/v1/');
}

function toOpenAiError(message: string, type: string, code: string) {
  return {
    error: {
      message,
      type,
      code,
    },
  };
}

async function sendError(sessionId: string, requestId: string, status: number, message: string, type: string, code: string) {
  try {
    await osacConnectionManager.send(
      sessionId,
      {
        type: 'LLM_PROXY_ERROR',
        requestId,
        payload: {
          requestId,
          status,
          error: toOpenAiError(message, type, code).error,
        },
      },
      {
        connectAcquireTimeoutMs: bridgeSendConnectTimeoutMs,
      }
    );
  } catch (error) {
    console.warn(
      '[OSAC_LLM_PROXY_SEND_ERROR]',
      sessionId,
      requestId,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function sendBridgeMessage(sessionId: string, message: OsacMessage) {
  await osacConnectionManager.send(sessionId, message, {
    connectAcquireTimeoutMs: bridgeSendConnectTimeoutMs,
  });
}

async function forwardRequest(sessionId: string, payload: LlmProxyRequestPayload) {
  const requestId = payload.requestId;
  if (!requestId) {
    return;
  }
  const debug = String(process.env.OSAC_LLM_PROXY_DEBUG || '').toLowerCase() === 'true';

  // OSAC fix3: acknowledge bridge receipt first to avoid bridge_no_ack timeout.
  try {
    await sendBridgeMessage(sessionId, {
      type: 'LLM_PROXY_ACK',
      requestId,
      payload: {
        requestId,
        sessionId,
      },
    });
  } catch (error) {
    if (debug) {
      console.error('[OSAC_LLM_PROXY_ACK_ERROR]', JSON.stringify({
        sessionId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    await sendError(sessionId, requestId, 503, 'Bridge unavailable', 'bridge_unavailable', 'bridge_unavailable');
    return;
  }

  const method = String(payload.method || 'POST').toUpperCase();
  const path = String(payload.path || '');
  if (!path) {
    await sendError(sessionId, requestId, 400, 'Missing path', 'invalid_request', 'invalid_request');
    return;
  }
  if (!['GET', 'POST', 'HEAD'].includes(method)) {
    await sendError(sessionId, requestId, 405, 'Method not allowed', 'invalid_request', 'invalid_request');
    return;
  }
  if (!isAllowedLlmPath(path)) {
    await sendError(sessionId, requestId, 400, 'Path not allowed', 'invalid_request', 'invalid_request');
    return;
  }

  const headers = normalizeHeaders(payload.headers);
  const timeoutMs = Number(process.env.OSAC_LLM_PROXY_TIMEOUT_MS || process.env.LLM_PROXY_TIMEOUT_MS || 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const targetUrl = buildProxyUrl(path);

  const bodyEncoding = payload.bodyEncoding || (payload.bodyBase64 ? 'base64' : 'utf8');
  let body: Buffer | string | undefined = undefined;
  if (method !== 'GET' && method !== 'HEAD' && payload.body !== undefined) {
    if (bodyEncoding === 'base64') {
      body = Buffer.from(payload.body || '', 'base64');
    } else {
      body = payload.body || '';
    }
  }

  auditOsacAction('LLM_PROXY_REQUEST', {
    sessionId,
    requestId,
    method,
    path,
    stream: Boolean(payload.isStream),
  });

  try {
    if (debug) {
      console.log('[OSAC_LLM_PROXY_BRIDGE]', JSON.stringify({
        sessionId,
        requestId,
        method,
        path,
        targetUrl,
      }));
    }

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const responseHeaders: Record<string, string> = {
      'content-type': contentType,
    };
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) {
      responseHeaders['cache-control'] = cacheControl;
    }

    if (shouldStream(contentType) && response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = Buffer.from(value).toString('utf8');
        await sendBridgeMessage(sessionId, {
          type: 'LLM_PROXY_CHUNK',
          requestId,
          payload: {
            requestId,
            chunk,
            isFinal: false,
          },
        });
      }
      await sendBridgeMessage(sessionId, {
        type: 'LLM_PROXY_END',
        requestId,
        payload: {
          requestId,
          status: response.status,
          headers: responseHeaders,
        },
      });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const bodyText = buffer.toString('utf8');
    await sendBridgeMessage(sessionId, {
      type: 'LLM_PROXY_RESPONSE',
      requestId,
      payload: {
        requestId,
        status: response.status,
        headers: responseHeaders,
        body: bodyText,
      },
    });
  } catch (error: any) {
    if (debug) {
      const errorCause = (error as any)?.cause;
      console.error('[OSAC_LLM_PROXY_BRIDGE_ERROR]', JSON.stringify({
        sessionId,
        requestId,
        method,
        path,
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
        cause: errorCause instanceof Error ? errorCause.message : errorCause ? String(errorCause) : null,
      }));
    }
    if (error?.name === 'AbortError') {
      await sendError(sessionId, requestId, 504, 'Upstream timeout', 'upstream_timeout', 'upstream_timeout');
      return;
    }
    const message = getPublicErrorMessage('Upstream unavailable');
    await sendError(sessionId, requestId, 503, message, 'upstream_unavailable', 'upstream_unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export class OsacLlmProxyBridgeService {
  initialize() {
    osacConnectionManager.registerMessageHandler(async (sessionId, message) => {
      if (message.type !== 'LLM_PROXY_REQUEST') {
        return;
      }
      const payload = (message.payload || {}) as LlmProxyRequestPayload;
      if (!payload.requestId && message.requestId) {
        payload.requestId = message.requestId;
      }
      await forwardRequest(sessionId, payload);
    });
  }
}

export const osacLlmProxyBridgeService = new OsacLlmProxyBridgeService();
