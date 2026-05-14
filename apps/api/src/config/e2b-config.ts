export type E2bConfig = {
  apiKey: string | null;
  template: string;
  codexTemplate: string;
  codexWsTemplate: string;
  timeoutMs: number;
  allowInternetAccess: boolean;
  allowPublicTraffic: boolean;
  opencodePort: number;
  opencodeHost: string;
};

const DEFAULT_E2B_TEMPLATE = 'opencode-browseruse-playwright-mcp-stable';
const DEFAULT_E2B_CODEX_WS_TEMPLATE = 'codex-ws-browseruse-playwright-sandbox-v1-20260426';

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const e2bConfig: E2bConfig = {
  apiKey: process.env.E2B_API_KEY ? process.env.E2B_API_KEY.trim() : null,
  template: (process.env.E2B_TEMPLATE || DEFAULT_E2B_TEMPLATE).trim() || DEFAULT_E2B_TEMPLATE,
  codexTemplate:
    (process.env.E2B_CODEX_TEMPLATE || process.env.E2B_TEMPLATE_CODEX || 'codex').trim() || 'codex',
  codexWsTemplate:
    (process.env.E2B_CODEX_WS_TEMPLATE || process.env.E2B_TEMPLATE_CODEX_WS || DEFAULT_E2B_CODEX_WS_TEMPLATE).trim() ||
    DEFAULT_E2B_CODEX_WS_TEMPLATE,
  timeoutMs: Math.max(10_000, toNumber(process.env.E2B_TIMEOUT_MS, 30 * 60 * 1000)),
  allowInternetAccess: toBool(process.env.E2B_ALLOW_INTERNET, true),
  allowPublicTraffic: toBool(process.env.E2B_ALLOW_PUBLIC_TRAFFIC, true),
  opencodePort: Math.max(1, Math.min(65535, toNumber(process.env.OPENCODE_SERVER_PORT, 4096))),
  opencodeHost: (process.env.OPENCODE_SERVER_HOST || '0.0.0.0').trim() || '0.0.0.0',
};

export function requireE2bApiKey(): string {
  if (!e2bConfig.apiKey) {
    throw new Error('E2B_API_KEY 未配置');
  }
  return e2bConfig.apiKey;
}
