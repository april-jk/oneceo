import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

const candidates = [
  path.resolve(process.cwd(), 'apps', '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(process.cwd(), '..', '..', 'apps', '.env'),
];

let loaded = false;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    loaded = true;
    break;
  }
}

if (!loaded) {
  console.warn('[ENV] 未找到 apps/.env，将继续使用当前进程环境变量');
}

const insecureTls = String(process.env.E2B_INSECURE_TLS || '').trim().toLowerCase() === 'true';
const caFile = String(process.env.E2B_TLS_CA_FILE || '').trim();
const httpProxy = String(process.env.HTTP_PROXY || process.env.http_proxy || '').trim();
const httpsProxy = String(process.env.HTTPS_PROXY || process.env.https_proxy || '').trim();
const noProxy = String(process.env.NO_PROXY || process.env.no_proxy || '').trim();
const proxyToggleRaw = String(process.env.E2B_PROXY_ENABLED ?? process.env.ONECEO_PROXY_ENABLED ?? 'true')
  .trim()
  .toLowerCase();
const proxyEnabled = !['0', 'false', 'no', 'off'].includes(proxyToggleRaw);

const shouldConfigureTls = Boolean(insecureTls || caFile);
const shouldConfigureProxy = proxyEnabled && Boolean(httpProxy || httpsProxy || noProxy);

if (shouldConfigureTls || shouldConfigureProxy) {
  try {
    let ca: string | Buffer | undefined;
    if (caFile) {
      if (fs.existsSync(caFile)) {
        ca = fs.readFileSync(caFile);
      } else {
        console.warn('[E2B_TLS] 指定的 CA 文件不存在:', caFile);
      }
    }

    const connectTimeoutMs = Math.max(
      5000,
      Number(process.env.E2B_CONNECT_TIMEOUT_MS || 30000)
    );

    if (shouldConfigureProxy) {
      setGlobalDispatcher(
        new EnvHttpProxyAgent({
          httpProxy: httpProxy || undefined,
          httpsProxy: httpsProxy || undefined,
          noProxy: noProxy || undefined,
          connectTimeout: connectTimeoutMs,
          connect: shouldConfigureTls
            ? {
                rejectUnauthorized: !insecureTls,
                ca,
              }
            : undefined,
        })
      );
      console.warn('[E2B_PROXY] 已启用代理转发');
    } else if (!proxyEnabled && (httpProxy || httpsProxy)) {
      console.warn('[E2B_PROXY] 代理已通过开关禁用');
    } else {
      setGlobalDispatcher(
        new Agent({
          connectTimeout: connectTimeoutMs,
          connect: {
            rejectUnauthorized: !insecureTls,
            ca,
          },
        })
      );
      console.warn(
        insecureTls
          ? '[E2B_TLS] 已启用不安全 TLS（仅用于本地/受控环境）'
          : '[E2B_TLS] 已加载自定义 CA'
      );
    }

    // Override global fetch to use undici with the custom dispatcher.
    const wrappedFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input instanceof Request) {
        const headers: Record<string, string> = {};
        input.headers.forEach((value, key) => {
          headers[key] = value;
        });
        const body = input.body ? Buffer.from(await input.arrayBuffer()) : undefined;
        return undiciFetch(input.url, {
          method: input.method,
          headers,
          body,
          redirect: input.redirect as RequestRedirect,
        });
      }
      return undiciFetch(input as string, init as RequestInit);
    }) as typeof fetch;

    globalThis.fetch = wrappedFetch;
    (globalThis as any).__ONECEO_HTTP_DISPATCHER_READY = true;
  } catch (error) {
    console.warn('[E2B_TLS] TLS/代理配置失败:', error);
  }
}
