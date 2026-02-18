import { getPublicErrorMessage } from '../utils/error-response';
import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

type ProxyConfig = {
  upstreamBaseUrl: string;
  upstreamToken?: string | null;
  timeoutMs: number;
};

function loadConfig(): ProxyConfig {
  const upstreamBaseUrl = process.env.LLM_PROXY_UPSTREAM_BASE_URL || '';
  if (!upstreamBaseUrl) {
    throw new Error('LLM_PROXY_UPSTREAM_BASE_URL is not configured');
  }
  return {
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/+$/, ''),
    upstreamToken: process.env.LLM_PROXY_UPSTREAM_API_KEY || null,
    timeoutMs: Number(process.env.LLM_PROXY_TIMEOUT_MS || 60000),
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

async function readResponseBody(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
            },
            (response) => resolve(response)
          );

          upstreamRequest.on('error', (error) => reject(error));

          if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
            upstreamRequest.write(req.body);
          }

          upstreamRequest.end();
        });

        if (debug) {
          console.log('[LLM_PROXY_UPSTREAM_STATUS]', JSON.stringify({
            method: req.method,
            path: req.path,
            upstreamUrl,
            status: upstreamResponse.statusCode || 502,
          }));
        }

        res.status(upstreamResponse.statusCode || 502);
        copyResponseHeaders(res, upstreamResponse.headers);

        if (isStreamContentType(upstreamResponse.headers)) {
          await new Promise<void>((resolve, reject) => {
            upstreamResponse!.on('error', reject);
            res.on('error', reject);
            res.on('finish', resolve);
            res.on('close', resolve);
            upstreamResponse!.pipe(res);
          });
          return;
        }

        const buffer = await readResponseBody(upstreamResponse);
        res.send(buffer);
      } finally {
        clearTimeout(requestTimeout);
      }
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
