function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const DEFAULT_CODEX_BASE_URL = 'https://llmapi.oneceo.ai';
export const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
export const DEFAULT_CODEX_API_KEY = 'sk-2ea35443a67d931ba178743b155f9627b8e2f81e5bc531d727f53172c3aa5555';
export const DEFAULT_SANDBOX_OPENAI_BASE_URL = `${DEFAULT_CODEX_BASE_URL}/v1`;

export function resolveCodexPlaywrightCdpEndpoint(): string {
  const cdpPort = Number(process.env.NEKO_CDP_PORT || 9222);
  const port = Number.isFinite(cdpPort) && cdpPort > 0 ? Math.floor(cdpPort) : 9222;
  return `http://127.0.0.1:${port}`;
}

export function buildCodexPlaywrightMcpSection(): string {
  const cdpEndpoint = resolveCodexPlaywrightCdpEndpoint();
  const display = asString(process.env.NEKO_DISPLAY) || ':0';
  return [
    '[mcp_servers.playwright]',
    'command = "npx"',
    `args = ["@playwright/mcp@latest", "--cdp-endpoint", ${JSON.stringify(cdpEndpoint)}]`,
    '',
    '[mcp_servers.playwright.env]',
    'PLAYWRIGHT_BROWSERS_PATH = "/opt/ms-playwright"',
    'PLAYWRIGHT_HEADLESS = "false"',
    `DISPLAY = ${JSON.stringify(display)}`,
    'XDG_RUNTIME_DIR = "/tmp"',
    '',
  ].join('\n');
}

export function ensurePlaywrightMcpInConfigToml(source: string): string {
  const raw = typeof source === 'string' ? source.replace(/\r\n/g, '\n').trimEnd() : '';
  if (/\[mcp_servers\.playwright\]/.test(raw)) {
    return raw ? `${raw}\n` : raw;
  }
  const section = buildCodexPlaywrightMcpSection().trimEnd();
  if (!raw) {
    return `${section}\n`;
  }
  return `${raw}\n\n${section}\n`;
}

export function normalizeCodexBaseUrl(value: string | undefined): string {
  const trimmed = asString(value);
  return trimmed || DEFAULT_CODEX_BASE_URL;
}

export function normalizeCodexModel(value: string | undefined): string {
  const trimmed = asString(value);
  return trimmed || DEFAULT_CODEX_MODEL;
}

export function normalizeCodexApiKey(value: string | undefined): string {
  const trimmed = asString(value);
  return trimmed || DEFAULT_CODEX_API_KEY;
}

export function buildCodexConfigToml(input: { baseUrl: string; model: string }): string {
  return ensurePlaywrightMcpInConfigToml([
    'model_provider = "OpenAI"',
    `model = ${JSON.stringify(input.model)}`,
    `review_model = ${JSON.stringify(input.model)}`,
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
    'network_access = "enabled"',
    'windows_wsl_setup_acknowledged = true',
    'model_context_window = 1000000',
    'model_auto_compact_token_limit = 900000',
    '',
    '[model_providers.OpenAI]',
    'name = "OpenAI"',
    `base_url = ${JSON.stringify(input.baseUrl)}`,
    'wire_api = "responses"',
    'supports_websockets = true',
    'requires_openai_auth = true',
    '',
    '[features]',
    'responses_websockets_v2 = true',
    '',
  ].join('\n'));
}

export function buildCodexAuthJson(input: { apiKey: string }): string {
  return JSON.stringify(
    {
      OPENAI_API_KEY: input.apiKey,
    },
    null,
    2
  );
}
