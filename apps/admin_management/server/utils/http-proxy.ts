import fs from 'node:fs';
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const DISPATCHER_FLAG = '__ONECEO_ADMIN_HTTP_DISPATCHER_READY';

function toBool(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

export function ensureProxyDispatcher() {
  if ((globalThis as any)[DISPATCHER_FLAG]) return;

  const httpProxy = String(process.env.HTTP_PROXY || process.env.http_proxy || '').trim();
  const httpsProxy = String(process.env.HTTPS_PROXY || process.env.https_proxy || '').trim();
  const noProxy = String(process.env.NO_PROXY || process.env.no_proxy || '').trim();
  const proxyEnabled = toBool(process.env.E2B_PROXY_ENABLED ?? process.env.ONECEO_PROXY_ENABLED ?? 'true', true);
  const insecureTls = toBool(process.env.E2B_INSECURE_TLS || '');
  const caFile = String(process.env.E2B_TLS_CA_FILE || '').trim();

  const shouldConfigureProxy = proxyEnabled && Boolean(httpProxy || httpsProxy || noProxy);
  const shouldConfigureTls = Boolean(insecureTls || caFile);
  if (!shouldConfigureProxy && !shouldConfigureTls) {
    (globalThis as any)[DISPATCHER_FLAG] = true;
    return;
  }

  let ca: string | Buffer | undefined;
  if (caFile) {
    if (fs.existsSync(caFile)) {
      ca = fs.readFileSync(caFile);
    } else {
      console.warn('[admin-management][proxy] 指定的 CA 文件不存在:', caFile);
    }
  }

  const connectTimeoutMs = Math.max(5000, Number(process.env.E2B_CONNECT_TIMEOUT_MS || 30000));
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
    console.warn('[admin-management][proxy] 已启用代理转发');
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
        ? '[admin-management][proxy] 已启用不安全 TLS（仅用于本地/受控环境）'
        : '[admin-management][proxy] 已加载自定义 CA'
    );
  }

  (globalThis as any)[DISPATCHER_FLAG] = true;
}
