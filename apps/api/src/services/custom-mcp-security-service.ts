import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type CustomMcpTransportType = 'streamable_http' | 'http' | 'sse';

const ALLOWED_TRANSPORTS = new Set<CustomMcpTransportType>(['streamable_http', 'http', 'sse']);
const LOCAL_TRANSPORTS = new Set(['stdio', 'local', 'command', 'npx', 'node', 'python', 'docker']);
const FORBIDDEN_KEYS = new Set(['command', 'args', 'env', 'cwd', 'stdio']);
const FORBIDDEN_HEADERS = new Set(['host']);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((item) => Number(item));
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedIp(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4(normalized.slice('::ffff:'.length));
  }
  return isIP(value) === 4 ? isPrivateIpv4(value) : false;
}

function scanForbiddenLocalConfig(value: unknown, errors: string[], path = 'config') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenLocalConfig(item, errors, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim().toLowerCase();
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      errors.push(`${path}.${key} is not supported for custom MCP`);
    }
    const textValue = asText(item).toLowerCase();
    if ((normalizedKey === 'type' || normalizedKey === 'transport') && LOCAL_TRANSPORTS.has(textValue)) {
      errors.push('stdio/local custom MCP is not supported');
    }
    scanForbiddenLocalConfig(item, errors, `${path}.${key}`);
  }
}

export class CustomMcpSecurityService {
  normalizeTransport(value: unknown): CustomMcpTransportType {
    const text = asText(value).toLowerCase();
    if (text === 'streamable-http' || text === 'streamable_http') return 'streamable_http';
    if (text === 'http') return 'http';
    if (text === 'sse' || text === 'remote_sse') return 'sse';
    return text as CustomMcpTransportType;
  }

  validateServerConfig(input: {
    name?: unknown;
    transportType?: unknown;
    serverUrl?: unknown;
    iconUrl?: unknown;
    description?: unknown;
    headers?: unknown;
    rawConfig?: unknown;
  }) {
    const errors: string[] = [];
    scanForbiddenLocalConfig(input.rawConfig || input, errors);

    const name = asText(input.name);
    if (!name) errors.push('server name is required');

    const transportType = this.normalizeTransport(input.transportType);
    if (!ALLOWED_TRANSPORTS.has(transportType)) {
      errors.push('custom MCP only supports remote HTTP, Streamable HTTP, or SSE transport');
    }

    const serverUrl = asText(input.serverUrl);
    let url: URL | null = null;
    try {
      url = new URL(serverUrl);
    } catch {
      errors.push('serverUrl must be a valid URL');
    }
    if (url) {
      if (url.protocol !== 'https:') {
        errors.push('serverUrl must use https');
      }
      if (url.username || url.password) {
        errors.push('serverUrl must not include username or password');
      }
      const host = url.hostname.toLowerCase();
      if (['localhost', 'metadata.google.internal'].includes(host)) {
        errors.push('serverUrl host is blocked');
      }
      if (isIP(host) && isBlockedIp(host)) {
        errors.push('serverUrl private IP is blocked');
      }
    }

    const headersInput = pickObject(input.headers);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(headersInput)) {
      const headerName = asText(key);
      const headerValue = asText(value);
      if (!headerName) {
        errors.push('header name cannot be empty');
        continue;
      }
      if (/[\r\n:]/.test(headerName)) {
        errors.push(`header ${headerName} has invalid name`);
        continue;
      }
      if (FORBIDDEN_HEADERS.has(headerName.toLowerCase())) {
        errors.push(`header ${headerName} is forbidden`);
        continue;
      }
      if (/[\r\n]/.test(headerValue)) {
        errors.push(`header ${headerName} has invalid value`);
        continue;
      }
      if (headerValue) {
        headers[headerName] = headerValue;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      normalized: {
        name,
        transportType,
        serverUrl: url?.toString() || serverUrl,
        iconUrl: asText(input.iconUrl),
        description: asText(input.description),
        headers,
      },
    };
  }

  async assertResolvedUrlSafe(serverUrl: string) {
    const check = this.validateServerConfig({
      name: 'check',
      transportType: 'streamable_http',
      serverUrl,
      headers: {},
    });
    if (!check.valid) {
      throw new Error(check.errors.join(','));
    }
    const url = new URL(check.normalized.serverUrl);
    const records = await lookup(url.hostname, { all: true });
    if (records.some((record) => isBlockedIp(record.address))) {
      throw new Error('custom_mcp_resolved_private_ip_blocked');
    }
  }
}

export const customMcpSecurityService = new CustomMcpSecurityService();
