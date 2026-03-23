import {
  CONNECTOR_KEYS,
  buildConnectorDefinitions,
  resolveOauthProvider,
  type ConnectorDefinition,
  type ConnectorKey,
  type ConnectorOauthProvider,
} from '../connectors/definitions';

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
    };

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    "const { spawn } = require('node:child_process');",
    "const child = spawn('npx', ['-y', '@modelcontextprotocol/server-github'], {",
    "  stdio: ['pipe', 'pipe', 'inherit'],",
    "  env: {",
    "    ...process.env,",
    "    NPM_CONFIG_LOGLEVEL: process.env.NPM_CONFIG_LOGLEVEL || 'silent',",
    '  },',
    '});',
    'let buffer = Buffer.alloc(0);',
    'let filtered = false;',
    'const flushChunk = (chunk) => {',
    '  const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);',
    '  if (filtered) {',
    '    process.stdout.write(data);',
    '    return;',
    '  }',
    '  buffer = Buffer.concat([buffer, data]);',
    '  const newlineIndex = buffer.indexOf(0x0a);',
    '  if (newlineIndex === -1) return;',
    "  const firstLine = buffer.subarray(0, newlineIndex).toString('utf8').trim();",
    '  const rest = buffer.subarray(newlineIndex + 1);',
    "  if (firstLine && firstLine !== 'GitHub MCP Server running on stdio') {",
    "    process.stdout.write(Buffer.from(`${firstLine}\\n`));",
    '  }',
    '  if (rest.length > 0) {',
    '    process.stdout.write(rest);',
    '  }',
    '  filtered = true;',
    '};',
    "child.stdout.on('data', flushChunk);",
    "child.stdout.on('end', () => {",
    '  if (!filtered && buffer.length > 0) {',
    '    process.stdout.write(buffer);',
    '    filtered = true;',
    '  }',
    '});',
    'process.stdin.pipe(child.stdin);',
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
    projectRef?: string;
    teamId?: string;
  }
): Record<string, string> {
  const template = item.runtime.headersEnv
    ? parseHeadersTemplate(process.env[item.runtime.headersEnv])
    : {};
  const accessToken = asText(input.accessToken);
  const projectRef = asText(input.projectRef);
  const teamId = asText(input.teamId);
  if (Object.keys(template).length > 0) {
    return renderHeaders(template, {
      token: accessToken,
      projectRef,
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
    projectRef?: string;
    teamId?: string;
  }
): string {
  const configured = item.runtime.urlEnv ? asText(process.env[item.runtime.urlEnv]) : '';
  const baseUrl = configured || asText(item.runtime.urlDefault);
  if (!baseUrl) {
    throw new Error(`${item.name} MCP remote URL 未配置`);
  }
  const url = new URL(baseUrl);
  if (input.connectorKey === 'supabase') {
    const projectRef = asText(input.projectRef);
    if (!projectRef) {
      throw new Error('Supabase 连接器缺少 project ref');
    }
    url.searchParams.set('project_ref', projectRef);
  }
  if (input.connectorKey === 'vercel') {
    const teamId = asText(input.teamId);
    if (teamId) {
      url.searchParams.set('teamId', teamId);
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
  }): ConnectorRuntimeConfig {
    const { connectorKey, account } = input;
    const item = this.getCatalogItem(connectorKey);
    const secret = account.secret || {};
    const configJson = account.configJson || {};

    if (connectorKey === 'github') {
      const accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('GitHub 连接器缺少 access token');
      }
      return {
        type: 'local',
        enabled: true,
        command: ['node', '-e', buildGithubStdioWrapperCommand()],
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: accessToken,
          NPM_CONFIG_LOGLEVEL: 'silent',
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

    const accessToken = asText(secret.accessToken);
    if (!accessToken) {
      throw new Error(`${item.name} 连接器缺少 access token`);
    }
    const url = buildRemoteUrl(item, {
      connectorKey,
      projectRef: asText(configJson.projectRef),
      teamId: asText(configJson.teamId),
    });
    const headers = buildRemoteHeaders(connectorKey, item, {
      accessToken,
      projectRef: asText(configJson.projectRef),
      teamId: asText(configJson.teamId),
    });
    return {
      type: 'remote',
      enabled: true,
      url,
      headers,
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
