import https from 'node:https';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type RailwayAuthKind = 'bearer' | 'project';

export type RailwayGraphqlAuth =
  | string
  | {
      token: string;
      kind?: RailwayAuthKind;
    };

function pickErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const errors = (payload as { errors?: Array<{ message?: unknown }> }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  return asText(errors[0]?.message);
}

function extractPlainTextRailwayError(body: string) {
  const text = asText(body);
  if (!text) return '';
  const normalized = text.toLowerCase();
  if (normalized.includes('error code: 1015') || normalized.includes('you are being rate limited')) {
    return 'Railway API 限流，请稍后重试';
  }
  if (text.length <= 240) {
    return text;
  }
  return '';
}

function normalizeAuth(input: RailwayGraphqlAuth): { token: string; kind: RailwayAuthKind } {
  if (typeof input === 'string') {
    return {
      token: asText(input),
      kind: 'bearer',
    };
  }

  return {
    token: asText(input?.token),
    kind: input?.kind === 'project' ? 'project' : 'bearer',
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? asText(value[0]) : asText(value);
  if (!raw) return 0;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return 0;
}

function buildRetryDelayMs(attempt: number, response?: { statusCode: number; headers?: Record<string, string | string[] | undefined> }, message?: string) {
  const retryAfterMs = parseRetryAfterMs(response?.headers?.['retry-after']);
  if (retryAfterMs > 0) {
    return Math.min(retryAfterMs, 30_000);
  }
  const normalized = asText(message).toLowerCase();
  const baseDelayMs = response?.statusCode === 429 || normalized.includes('rate limit')
    ? 1500
    : 1000;
  return Math.min(30_000, baseDelayMs * Math.pow(2, attempt));
}

function isRetriableRailwayError(input: {
  attempt: number;
  maxAttempts: number;
  statusCode?: number;
  message?: string;
}) {
  if (input.attempt >= input.maxAttempts - 1) return false;
  const normalized = asText(input.message).toLowerCase();
  if ([429, 500, 502, 503, 504].includes(input.statusCode || 0)) return true;
  return (
    normalized.includes('econnreset') ||
    normalized.includes('请求超时') ||
    normalized.includes('socket hang up') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('1015') ||
    normalized.includes('cloudflare')
  );
}

export async function requestRailwayGraphql<T>(
  authInput: RailwayGraphqlAuth,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const auth = normalizeAuth(authInput);
  if (!auth.token) {
    throw new Error('Railway API token 为空');
  }
  const endpoint = new URL(process.env.RAILWAY_GRAPHQL_ENDPOINT || 'https://backboard.railway.app/graphql/v2');
  const requestBody = JSON.stringify({
    query,
    variables: variables || {},
  });
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await new Promise<{
        statusCode: number;
        body: string;
        headers: Record<string, string | string[] | undefined>;
      }>((resolve, reject) => {
        const request = https.request(
          {
            protocol: endpoint.protocol,
            hostname: endpoint.hostname,
            port: endpoint.port ? Number(endpoint.port) : undefined,
            path: `${endpoint.pathname}${endpoint.search}`,
            method: 'POST',
            headers: {
              ...(auth.kind === 'project'
                ? { 'Project-Access-Token': auth.token }
                : { Authorization: `Bearer ${auth.token}` }),
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(requestBody),
            },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode || 0,
                body,
                headers: res.headers,
              });
            });
          }
        );

        request.on('error', reject);
        request.setTimeout(30_000, () => {
          request.destroy(new Error('Railway API 请求超时'));
        });
        request.write(requestBody);
        request.end();
      });

      let payload: {
        data?: T;
        errors?: Array<{ message?: string }>;
      } | null = null;
      let payloadParseError = '';
      if (response.body) {
        try {
          payload = JSON.parse(response.body) as {
            data?: T;
            errors?: Array<{ message?: string }>;
          };
        } catch (error: any) {
          payloadParseError = asText(error?.message);
        }
      }
      const errorMessage = pickErrorMessage(payload);
      const plainTextMessage = extractPlainTextRailwayError(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const message = errorMessage || plainTextMessage || `Railway API 请求失败: ${response.statusCode}`;
        if (isRetriableRailwayError({
          attempt,
          maxAttempts,
          statusCode: response.statusCode,
          message,
        })) {
          await sleep(buildRetryDelayMs(attempt, response, message));
          continue;
        }
        throw new Error(message);
      }
      if (payloadParseError) {
        throw new Error(plainTextMessage || `Railway API 返回了非 JSON 响应: ${payloadParseError}`);
      }
      if (errorMessage) {
        if (isRetriableRailwayError({
          attempt,
          maxAttempts,
          statusCode: response.statusCode,
          message: errorMessage,
        })) {
          await sleep(buildRetryDelayMs(attempt, response, errorMessage));
          continue;
        }
        throw new Error(errorMessage);
      }

      if (!payload?.data) {
        throw new Error('Railway API 响应为空');
      }

      return payload.data;
    } catch (error: any) {
      const message = asText(error?.message);
      const retriable = isRetriableRailwayError({
        attempt,
        maxAttempts,
        message,
      });
      if (!retriable) {
        throw error;
      }
      await sleep(buildRetryDelayMs(attempt, undefined, message));
    }
  }

  throw new Error('Railway API 请求失败');
}
