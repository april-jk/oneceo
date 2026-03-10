import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';

export type RemoteAttachmentProvider = 'website' | 'google-drive' | 'onedrive';

export type RemoteAttachmentTarget = {
  provider: RemoteAttachmentProvider;
  sourceUrl: string;
  fetchUrl: string;
  suggestedName: string;
};

type ResolveRemoteAttachmentOptions = {
  allowPrivateHosts?: boolean;
};

const ALLOWED_GOOGLE_DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
]);

const ALLOWED_ONEDRIVE_HOST_SUFFIXES = [
  '1drv.ms',
  'onedrive.live.com',
  'sharepoint.com',
];

const MIME_EXTENSION_MAP: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/css': 'css',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/javascript': 'js',
  'text/markdown': 'md',
  'text/plain': 'txt',
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '');
}

function hasAllowedSuffix(hostname: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function assertHttpUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('请输入有效的链接');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http 或 https 链接');
  }
  return parsed;
}

function isPrivateIpv4(hostname: string): boolean {
  const segments = hostname.split('.').map((segment) => Number.parseInt(segment, 10));
  if (segments.length !== 4 || segments.some((segment) => Number.isNaN(segment))) {
    return false;
  }
  if (segments[0] === 10) return true;
  if (segments[0] === 127) return true;
  if (segments[0] === 169 && segments[1] === 254) return true;
  if (segments[0] === 172 && segments[1] >= 16 && segments[1] <= 31) return true;
  if (segments[0] === 192 && segments[1] === 168) return true;
  if (segments[0] === 0) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function assertSafeHostname(hostname: string, allowPrivateHosts: boolean) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error('链接缺少主机名');
  }
  if (allowPrivateHosts) return;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    throw new Error('当前环境不允许从本地地址导入文件');
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4 && isPrivateIpv4(normalized)) {
    throw new Error('当前环境不允许从私有网络地址导入文件');
  }
  if (ipVersion === 6 && isPrivateIpv6(normalized)) {
    throw new Error('当前环境不允许从私有网络地址导入文件');
  }
}

function getLastPathToken(pathname: string): string {
  const token = pathname.split('/').filter(Boolean).pop() || '';
  return token.trim();
}

function sanitizeFilename(input: string): string {
  const token = input.split(/[\\/]/).pop() || 'attachment';
  const dotIndex = token.lastIndexOf('.');
  const rawBase = dotIndex > 0 ? token.slice(0, dotIndex) : token;
  const rawExt = dotIndex > 0 ? token.slice(dotIndex + 1) : '';
  const base = rawBase
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^\.+/, '')
    .slice(0, 100);
  const ext = rawExt.replace(/[^A-Za-z0-9-]+/g, '').slice(0, 16);
  if (base && ext) return `${base}.${ext}`;
  if (base) return base;
  if (ext) return `attachment.${ext}`;
  return 'attachment';
}

function inferFilenameFromUrl(parsed: URL, fallbackBase: string): string {
  const lastToken = getLastPathToken(parsed.pathname);
  if (lastToken && lastToken.includes('.')) {
    return sanitizeFilename(lastToken);
  }
  return sanitizeFilename(fallbackBase);
}

function extractGoogleDriveFileId(parsed: URL): string {
  const fromQuery = parsed.searchParams.get('id');
  if (fromQuery) return fromQuery.trim();
  const match = parsed.pathname.match(/\/file\/d\/([^/]+)/);
  if (match?.[1]) return match[1].trim();
  const docMatch = parsed.pathname.match(/\/document\/d\/([^/]+)/);
  if (docMatch?.[1]) return docMatch[1].trim();
  return '';
}

export function resolveRemoteAttachmentTarget(
  provider: RemoteAttachmentProvider,
  url: string,
  options: ResolveRemoteAttachmentOptions = {}
): RemoteAttachmentTarget {
  const parsed = assertHttpUrl(url);
  const allowPrivateHosts = Boolean(options.allowPrivateHosts);
  const hostname = normalizeHostname(parsed.hostname);

  if (provider === 'website') {
    assertSafeHostname(hostname, allowPrivateHosts);
    return {
      provider,
      sourceUrl: parsed.toString(),
      fetchUrl: parsed.toString(),
      suggestedName: inferFilenameFromUrl(parsed, 'website-file'),
    };
  }

  if (provider === 'google-drive') {
    if (!ALLOWED_GOOGLE_DRIVE_HOSTS.has(hostname)) {
      throw new Error('Google Drive 链接无效');
    }
    const fileId = extractGoogleDriveFileId(parsed);
    if (!fileId) {
      throw new Error('无法识别 Google Drive 文件链接');
    }
    return {
      provider,
      sourceUrl: parsed.toString(),
      fetchUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      suggestedName: sanitizeFilename(`google-drive-${fileId}`),
    };
  }

  if (!hasAllowedSuffix(hostname, ALLOWED_ONEDRIVE_HOST_SUFFIXES)) {
    throw new Error('OneDrive 链接无效');
  }
  const encoded = Buffer.from(parsed.toString(), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return {
    provider,
    sourceUrl: parsed.toString(),
    fetchUrl: `https://api.onedrive.com/v1.0/shares/u!${encoded}/root/content`,
    suggestedName: inferFilenameFromUrl(parsed, 'onedrive-file'),
  };
}

export function filenameFromContentDisposition(contentDisposition?: string | null): string {
  const raw = typeof contentDisposition === 'string' ? contentDisposition.trim() : '';
  if (!raw) return '';
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(utf8Match[1]));
    } catch {
      return sanitizeFilename(utf8Match[1]);
    }
  }
  const plainMatch = raw.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return sanitizeFilename(plainMatch[1]);
  }
  return '';
}

export function inferFilenameFromResponse(input: {
  contentDisposition?: string | null;
  responseUrl?: string | null;
  fallbackName?: string;
  mimeType?: string | null;
}): string {
  const fromDisposition = filenameFromContentDisposition(input.contentDisposition);
  if (fromDisposition) return fromDisposition;

  const responseUrl = input.responseUrl ? assertHttpUrl(input.responseUrl) : null;
  if (responseUrl) {
    const fromUrl = getLastPathToken(responseUrl.pathname);
    if (fromUrl && fromUrl.includes('.')) {
      return sanitizeFilename(fromUrl);
    }
  }

  const fallbackName = sanitizeFilename(input.fallbackName || 'attachment');
  if (fallbackName.includes('.')) {
    return fallbackName;
  }

  const normalizedMimeType = (input.mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_EXTENSION_MAP[normalizedMimeType];
  if (!ext) {
    return fallbackName;
  }
  return `${fallbackName}.${ext}`;
}
