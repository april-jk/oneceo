import {
  CONNECTOR_KEYS,
  buildConnectorDefinitions,
  resolveOauthProvider,
  type ConnectorDefinition,
  type ConnectorKey,
  type ConnectorOauthProvider,
  type RemoteMcpTransport,
} from '../connectors/definitions';
import {
  buildSupabaseBridgeEnvironment,
  buildSupabaseStdioBridgeCommand,
} from '../connectors/bridges/supabase-stdio-bridge';

export { CONNECTOR_KEYS, type ConnectorKey };

export type ConnectorAuthMode = 'oauth' | 'token' | 'dsn' | 'none';
export type ConnectorAuthStatus =
  | 'not_configured'
  | 'authorized'
  | 'needs_auth'
  | 'error'
  | 'unavailable';
export type ConnectorDesiredState = 'attached' | 'detached';
export type ConnectorRuntimeStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'needs_auth'
  | 'failed'
  | 'disabled'
  | 'unknown';
export type ConnectorUsageStatus = 'idle' | 'active';

export type ConnectorConfigField = ConnectorDefinition['configFields'][number];

export type ConnectorCatalogItem = ConnectorDefinition;

export type ConnectorAccountSecret = {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  dsn?: string;
};

export type ConnectorProfileMaterial = {
  profileId: string;
  connectorKey: ConnectorKey;
  profileName: string;
  authMode: string;
  authStatus: string;
  displayName?: string | null;
  configJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
  secret?: ConnectorAccountSecret | null;
};

// Backward-compatible alias while the rest of the codebase migrates from account -> profile wording.
export type ConnectorAccountMaterial = ConnectorProfileMaterial;

export type ConnectorRuntimeConfig =
  | {
      type: 'local';
      enabled: boolean;
      command: string[];
      environment?: Record<string, string>;
    }
  | {
      type: 'remote';
      enabled: boolean;
      url: string;
      headers?: Record<string, string>;
      transport: RemoteMcpTransport;
    };

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeRepositoryFullName(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  const parts = text
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length !== 2) return '';
  return `${parts[0]}/${parts[1]}`;
}

function normalizeGithubRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeRepositoryFullName(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseHeadersTemplate(value: string | undefined): Record<string, string> {
  const raw = asText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed || {})) {
      if (!key) continue;
      if (val === null || val === undefined) continue;
      headers[key] = String(val);
    }
    return headers;
  } catch {
    return {};
  }
}

function renderHeaders(
  template: Record<string, string>,
  values: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    let rendered = value;
    for (const [tokenKey, tokenValue] of Object.entries(values)) {
      rendered = rendered.split(`\${${tokenKey}}`).join(tokenValue);
    }
    result[key] = rendered;
  }
  return result;
}

function buildGithubStdioWrapperCommand(): string {
  return [
    "const readline = require('node:readline');",
    "const { spawn } = require('node:child_process');",
    "const allowedRepositories = (() => {",
    "  try {",
    "    const parsed = JSON.parse(process.env.ONECEO_GITHUB_ALLOWED_REPOSITORIES || '[]');",
    "    if (!Array.isArray(parsed)) return new Set();",
    "    return new Set(parsed.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));",
    "  } catch {",
    "    return new Set();",
    "  }",
    "})();",
    "const parseRepository = (value) => {",
    "  const text = String(value || '').trim();",
    "  if (!text) return '';",
    "  const parts = text.split('/').map((part) => part.trim()).filter(Boolean);",
    "  if (parts.length !== 2) return '';",
    "  return `${parts[0]}/${parts[1]}`;",
    "};",
    "const collectRepositories = (value, target = new Set()) => {",
    "  if (!value) return target;",
    "  if (Array.isArray(value)) {",
    "    for (const item of value) collectRepositories(item, target);",
    "    return target;",
    "  }",
    "  if (typeof value !== 'object') return target;",
    "  const record = value;",
    "  const owner = typeof record.owner === 'string' ? record.owner : '';",
    "  const repo = typeof record.repo === 'string' ? record.repo : '';",
    "  const combined = parseRepository(owner && repo ? `${owner}/${repo}` : '');",
    "  if (combined) target.add(combined);",
    "  const directKeys = ['repository', 'repo', 'full_name'];",
    "  for (const key of directKeys) {",
    "    const normalized = parseRepository(record[key]);",
    "    if (normalized) target.add(normalized);",
    "  }",
    "  for (const nested of Object.values(record)) collectRepositories(nested, target);",
    "  return target;",
    "};",
    "const writeMessage = (message) => process.stdout.write(`${JSON.stringify(message)}\\n`);",
    "const child = spawn('npx', ['-y', '@modelcontextprotocol/server-github'], {",
    "  stdio: ['pipe', 'pipe', 'inherit'],",
    "  env: {",
    "    ...process.env,",
    "    NPM_CONFIG_LOGLEVEL: process.env.NPM_CONFIG_LOGLEVEL || 'silent',",
    '  },',
    '});',
    'let skippedBanner = false;',
    "const childOutput = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });",
    "childOutput.on('line', (line) => {",
    "  if (!skippedBanner && line.trim() === 'GitHub MCP Server running on stdio') {",
    '    skippedBanner = true;',
    '    return;',
    '  }',
    '  skippedBanner = true;',
    "  process.stdout.write(`${line}\\n`);",
    '});',
    "const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
    "input.on('line', (line) => {",
    '  if (!line) return;',
    '  try {',
    '    const message = JSON.parse(line);',
    "    if (message && message.method === 'tools/call' && message.params && typeof message.params === 'object') {",
    "      const args = message.params.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {};",
    '      const repositories = Array.from(collectRepositories(args));',
    '      const disallowed = repositories.filter((repo) => allowedRepositories.size > 0 && !allowedRepositories.has(String(repo).toLowerCase()));',
    '      if (disallowed.length > 0) {',
    "        writeMessage({",
    "          jsonrpc: '2.0',",
    '          id: message.id ?? null,',
    "          error: { code: -32000, message: `GitHub repository access denied for this session: ${disallowed.join(', ')}` },",
    '        });',
    '        return;',
    '      }',
    '    }',
    "    child.stdin.write(`${JSON.stringify(message)}\\n`);",
    '  } catch {',
    "    child.stdin.write(`${line}\\n`);",
    '  }',
    '});',
    "input.on('close', () => child.stdin.end());",
    "child.on('exit', (code, signal) => {",
    '  if (signal) {',
    '    process.kill(process.pid, signal);',
    '    return;',
    '  }',
    '  process.exit(code ?? 0);',
    '});',
  ].join('\n');
}

function buildRemoteHeaders(
  connectorKey: ConnectorKey,
  item: ConnectorCatalogItem,
  input: {
    accessToken?: string;
    teamId?: string;
  }
): Record<string, string> {
  const template = item.runtime.headersEnv
    ? parseHeadersTemplate(process.env[item.runtime.headersEnv])
    : {};
  const accessToken = asText(input.accessToken);
  const teamId = asText(input.teamId);
  if (Object.keys(template).length > 0) {
    return renderHeaders(template, {
      token: accessToken,
      teamId,
    });
  }
  if (item.runtime.headerTemplate === 'supabase') {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }
  if (item.runtime.headerTemplate === 'figma') {
    return {
      'X-Figma-Token': accessToken,
    };
  }
  if (item.runtime.headerTemplate === 'bearer-token') {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }
  return {};
}

function buildRemoteUrl(
  item: ConnectorCatalogItem,
  input: {
    connectorKey: ConnectorKey;
    teamId?: string;
  }
): string {
  const configured = item.runtime.urlEnv ? asText(process.env[item.runtime.urlEnv]) : '';
  const baseUrl = configured || asText(item.runtime.urlDefault);
  if (!baseUrl) {
    throw new Error(`${item.name} MCP remote URL 未配置`);
  }
  const url = new URL(baseUrl);
  if (input.connectorKey === 'vercel') {
    const teamId = asText(input.teamId);
    if (teamId) {
      url.searchParams.set('teamId', teamId);
    }
  }
  if (input.connectorKey === 'notion') {
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
    if (!normalizedPath.endsWith('/sse')) {
      throw new Error('Notion MCP remote URL 必须配置为 SSE 端点（/sse）');
    }
  }
  return url.toString();
}

export class ConnectorRegistry {
  listCatalog(): ConnectorCatalogItem[] {
    return buildConnectorDefinitions();
  }

  listVisibleCatalog(): ConnectorCatalogItem[] {
    return this.listCatalog().filter((item) => item.visibleInMenu);
  }

  getCatalogItem(connectorKey: string): ConnectorCatalogItem {
    const item = this.listCatalog().find((entry) => entry.key === connectorKey);
    if (!item) {
      throw new Error(`未知连接器: ${connectorKey}`);
    }
    return item;
  }

  getOauthProvider(connectorKey: ConnectorKey): ConnectorOauthProvider | undefined {
    return resolveOauthProvider(connectorKey);
  }

  materializeRuntimeConfig(input: {
    connectorKey: ConnectorKey;
    account: ConnectorProfileMaterial;
    sessionConfig?: Record<string, unknown> | null;
  }): ConnectorRuntimeConfig {
    const { connectorKey, account } = input;
    const item = this.getCatalogItem(connectorKey);
    const secret = account.secret || {};
    const configJson = account.configJson || {};
    const sessionConfig = input.sessionConfig || {};

    if (connectorKey === 'github') {
      const accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('GitHub 连接器缺少 access token');
      }
      const repositories = normalizeGithubRepositories(
        (sessionConfig as Record<string, unknown>).repositories
      );
      return {
        type: 'local',
        enabled: true,
        command: ['node', '-e', buildGithubStdioWrapperCommand()],
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: accessToken,
          GITHUB_TOKEN: accessToken,
          GH_TOKEN: accessToken,
          ONECEO_GITHUB_ALLOWED_REPOSITORIES: JSON.stringify(repositories),
          NPM_CONFIG_LOGLEVEL: 'silent',
          NPM_CONFIG_YES: 'true',
        },
      };
    }

    if (connectorKey === 'postgres') {
      const dsn = asText(secret.dsn);
      if (!dsn) {
        throw new Error('Postgres 连接器缺少 DSN');
      }
      return {
        type: 'local',
        enabled: true,
        command: ['npx', '-y', '@modelcontextprotocol/server-postgres', dsn],
      };
    }

    if (connectorKey === 'supabase') {
      const accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('Supabase 连接器缺少 access token');
      }
      const proxyEnabled = toBool(
        process.env.ONECEO_PROXY_ENABLED ?? process.env.E2B_PROXY_ENABLED ?? 'true',
        true
      );
      return {
        type: 'local',
        enabled: true,
        command: ['node', '-e', buildSupabaseStdioBridgeCommand()],
        environment: buildSupabaseBridgeEnvironment({
          accessToken,
          projectUrl: asText(configJson.projectUrl) || asText(configJson.supabaseUrl),
          mcpUrl: asText(configJson.mcpUrl),
          proxyEnabled,
        }),
      };
    }

    const accessToken = asText(secret.accessToken);
    if (!accessToken) {
      throw new Error(`${item.name} 连接器缺少 access token`);
    }
    const url = buildRemoteUrl(item, {
      connectorKey,
      teamId: asText(configJson.teamId),
    });
    const headers = buildRemoteHeaders(connectorKey, item, {
      accessToken,
      teamId: asText(configJson.teamId),
    });
    return {
      type: 'remote',
      enabled: true,
      url,
      headers,
      transport: item.runtime.transport || 'remote_sse',
    };
  }

  matchesToolUsage(connectorKey: ConnectorKey, toolName: string): boolean {
    const normalized = asText(toolName).toLowerCase();
    if (!normalized) return false;
    switch (connectorKey) {
      case 'github':
        return normalized.includes('github');
      case 'slack':
        return normalized.includes('slack');
      case 'notion':
        return normalized.includes('notion');
      case 'supabase':
        return normalized.includes('supabase');
      case 'figma':
        return normalized.includes('figma');
      case 'vercel':
        return normalized.includes('vercel');
      case 'postgres':
        return normalized.includes('postgres');
      default:
        return false;
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();
