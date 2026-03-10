import https from 'node:https';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const errors = (payload as { errors?: Array<{ message?: unknown }> }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  return asText(errors[0]?.message);
}

export async function requestRailwayGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const endpoint = new URL(process.env.RAILWAY_GRAPHQL_ENDPOINT || 'https://backboard.railway.app/graphql/v2');
  const requestBody = JSON.stringify({
    query,
    variables: variables || {},
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await new Promise<{
        statusCode: number;
        body: string;
      }>((resolve, reject) => {
        const request = https.request(
          {
            protocol: endpoint.protocol,
            hostname: endpoint.hostname,
            port: endpoint.port ? Number(endpoint.port) : undefined,
            path: `${endpoint.pathname}${endpoint.search}`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
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

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Railway API 请求失败: ${response.statusCode}`);
      }

      const payload = response.body
        ? (JSON.parse(response.body) as {
            data?: T;
            errors?: Array<{ message?: string }>;
          })
        : null;

      const errorMessage = pickErrorMessage(payload);
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (!payload?.data) {
        throw new Error('Railway API 响应为空');
      }

      return payload.data;
    } catch (error: any) {
      const message = asText(error?.message);
      const retriable =
        attempt < 2 &&
        (message.includes('ECONNRESET') ||
          message.includes('请求超时') ||
          message.includes('socket hang up'));
      if (!retriable) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw new Error('Railway API 请求失败');
}
