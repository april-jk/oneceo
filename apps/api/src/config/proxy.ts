function normalizeToggle(value: string | undefined, fallback = 'true') {
  return String(value ?? fallback).trim().toLowerCase();
}

function isDisabled(value: string) {
  return ['0', 'false', 'no', 'off'].includes(value);
}

export function isGlobalProxyEnabled(): boolean {
  return !isDisabled(normalizeToggle(process.env.ONECEO_PROXY_ENABLED, 'true'));
}

export function isE2bProxyEnabled(): boolean {
  return !isDisabled(normalizeToggle(process.env.E2B_PROXY_ENABLED, 'true'));
}

export function getProxyEnv() {
  return {
    httpProxy: String(process.env.HTTP_PROXY || process.env.http_proxy || '').trim(),
    httpsProxy: String(process.env.HTTPS_PROXY || process.env.https_proxy || '').trim(),
    noProxy: String(process.env.NO_PROXY || process.env.no_proxy || '').trim(),
  };
}

export function hasAnyProxyUrl(): boolean {
  const { httpProxy, httpsProxy, noProxy } = getProxyEnv();
  return Boolean(httpProxy || httpsProxy || noProxy);
}

