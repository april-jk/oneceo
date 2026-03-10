import { getPublicErrorMessage } from '../utils/error-response';
import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

type ProxyConfig = {
  upstreamBaseUrl: string;
  upstreamToken?: string | null;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  retryJitterMs: number;
};

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const upstreamMaxSockets = Math.max(1, Math.floor(toNumber(process.env.LLM_PROXY_MAX_SOCKETS, 128)));
const upstreamMaxFreeSockets = Math.max(1, Math.floor(toNumber(process.env.LLM_PROXY_MAX_FREE_SOCKETS, 32)));
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: upstreamMaxSockets,
  maxFreeSockets: upstreamMaxFreeSockets,
});
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: upstreamMaxSockets,
  maxFreeSockets: upstreamMaxFreeSockets,
});

function loadConfig(): ProxyConfig {
  const upstreamBaseUrl = process.env.LLM_PROXY_UPSTREAM_BASE_URL || '';
  if (!upstreamBaseUrl) {
    throw new Error('LLM_PROXY_UPSTREAM_BASE_URL is not configured');
  }
  return {
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/+$/, ''),
    upstreamToken: process.env.LLM_PROXY_UPSTREAM_API_KEY || null,
    timeoutMs: Number(process.env.LLM_PROXY_TIMEOUT_MS || 60000),
    maxRetries: Math.max(0, Number(process.env.LLM_PROXY_RETRIES || 1)),
    retryDelayMs: Math.max(0, Number(process.env.LLM_PROXY_RETRY_DELAY_MS || 250)),
    retryJitterMs: Math.max(0, Number(process.env.LLM_PROXY_RETRY_JITTER_MS || 120)),
  };
}

function buildUpstreamUrl(base: string, path: string, query: string) {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedBase.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
    return `${normalizedBase}${normalizedPath.slice(3)}${query || ''}`;
  }
  return `${normalizedBase}${normalizedPath}${query || ''}`;
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

function copyResponseHeaders(res: any, headers: IncomingHttpHeaders) {
  const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : 'application/json';
  res.setHeader('content-type', contentType);

  const cacheControl = headers['cache-control'];
  if (typeof cacheControl === 'string') {
    res.setHeader('cache-control', cacheControl);
  }
}

function isStreamContentType(headers: IncomingHttpHeaders) {
  const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : '';
  return contentType.includes('text/event-stream');
}

function isTimeoutError(error: any) {
  return error?.code === 'UPSTREAM_TIMEOUT' || error?.name === 'AbortError';
}

function createTimeoutError() {
  const error = new Error('Upstream timeout');
  (error as any).code = 'UPSTREAM_TIMEOUT';
  return error;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(headers: IncomingHttpHeaders): number {
  const value = headers['retry-after'];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return 0;
}

async function readResponseBody(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function delay(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt: number, retryDelayMs: number, retryJitterMs: number) {
  const base = Math.max(0, retryDelayMs * Math.max(1, attempt));
  if (retryJitterMs <= 0) {
    return base;
  }
  return base + Math.floor(Math.random() * (retryJitterMs + 1));
}

export class LlmProxyConnector {
  async forward(req: any, res: any) {
    let config: ProxyConfig;
    let upstreamUrl = '';
    const debug = String(process.env.LLM_PROXY_DEBUG || '').toLowerCase() === 'true';
    try {
      config = loadConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM 代理未配置';
      res.status(500).json(toOpenAiError(getPublicErrorMessage(message), 'config_error', 'config_error'));
      return;
    }

    try {
      upstreamUrl = buildUpstreamUrl(
        config.upstreamBaseUrl,
        req.path,
        req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
      );

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers || {})) {
        if (!value) continue;
        if (key.toLowerCase() === 'host') continue;
        if (key.toLowerCase() === 'content-length') continue;
        headers[key] = Array.isArray(value) ? value.join(',') : String(value);
      }
      // Keep upstream response body readable for downstream callers (curl/opencode).
      headers['accept-encoding'] = 'identity';
      if (config.upstreamToken) {
        headers['Authorization'] = `Bearer ${config.upstreamToken}`;
      }

      const targetUrl = new URL(upstreamUrl);
      const client = targetUrl.protocol === 'https:' ? https : http;
      const requestHeaders: Record<string, string> = { ...headers };
      if (!requestHeaders.connection) {
        requestHeaders.connection = 'keep-alive';
      }

      let finalResponse: IncomingMessage | null = null;
      let finalError: unknown = null;
      const maxAttempts = Math.max(1, config.maxRetries + 1);
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let upstreamResponse: IncomingMessage | null = null;
        let upstreamRequest: http.ClientRequest | null = null;
        const requestTimeout = setTimeout(() => {
          const timeoutError = createTimeoutError();
          upstreamRequest?.destroy(timeoutError);
          upstreamResponse?.destroy(timeoutError);
        }, config.timeoutMs);

        try {
          upstreamResponse = await new Promise<IncomingMessage>((resolve, reject) => {
            upstreamRequest = client.request(
              {
                protocol: targetUrl.protocol,
                hostname: targetUrl.hostname,
                port: targetUrl.port || undefined,
                path: `${targetUrl.pathname}${targetUrl.search}`,
                method: req.method,
                headers: requestHeaders,
                agent: targetUrl.protocol === 'https:' ? httpsKeepAliveAgent : httpKeepAliveAgent,
              },
              (response) => resolve(response)
            );

            upstreamRequest.on('error', (error) => reject(error));

            if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
              upstreamRequest.write(req.body);
            }

            upstreamRequest.end();
          });

          const status = upstreamResponse.statusCode || 502;
          if (debug) {
            console.log('[LLM_PROXY_UPSTREAM_STATUS]', JSON.stringify({
              method: req.method,
              path: req.path,
              upstreamUrl,
              attempt,
              status,
            }));
          }

          if (attempt < maxAttempts && isRetryableStatus(status)) {
            const retryAfterMs = status === 429 ? parseRetryAfterMs(upstreamResponse.headers) : 0;
            const waitMs = Math.max(
              computeRetryDelayMs(attempt, config.retryDelayMs, config.retryJitterMs),
              retryAfterMs
            );
            upstreamResponse.resume();
            await delay(waitMs);
            continue;
          }

          finalResponse = upstreamResponse;
          break;
        } catch (error) {
          finalError = error;
          if (attempt >= maxAttempts || !isTimeoutError(error)) {
            break;
          }
          await delay(computeRetryDelayMs(attempt, config.retryDelayMs, config.retryJitterMs));
        } finally {
          clearTimeout(requestTimeout);
        }
      }

      if (!finalResponse) {
        throw (finalError instanceof Error ? finalError : new Error(String(finalError || 'upstream_error')));
      }

      res.status(finalResponse.statusCode || 502);
      copyResponseHeaders(res, finalResponse.headers);

      if (isStreamContentType(finalResponse.headers)) {
        await new Promise<void>((resolve, reject) => {
          finalResponse!.on('error', reject);
          res.on('error', reject);
          res.on('finish', resolve);
          res.on('close', resolve);
          finalResponse!.pipe(res);
        });
        return;
      }

      const buffer = await readResponseBody(finalResponse);
      res.send(buffer);
    } catch (error: any) {
      if (debug) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCause = (error as any)?.cause;
        console.error('[LLM_PROXY_ERROR]', JSON.stringify({
          method: req.method,
          path: req.path,
          upstreamUrl,
          error: errorMessage,
          cause: errorCause instanceof Error ? errorCause.message : errorCause ? String(errorCause) : null,
        }));
      }
      if (isTimeoutError(error)) {
        res.status(504).json(toOpenAiError('Upstream timeout', 'upstream_timeout', 'upstream_timeout'));
        return;
      }
      res.status(503).json(toOpenAiError('Upstream unavailable', 'upstream_unavailable', 'upstream_unavailable'));
    }
  }
}

export const llmProxyConnector = new LlmProxyConnector();
