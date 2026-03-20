function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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
