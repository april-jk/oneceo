import {
  CONNECTOR_KEYS,
  buildConnectorDefinitions,
  resolveOauthProvider,
  type ConnectorDefinition,
  type ConnectorKey,
  type ConnectorOauthProvider,
  type RemoteMcpTransport,
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
  source?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
  dsn?: string;
  composioMcpUrl?: string;
  composioMcpHeaders?: Record<string, string>;
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
      type: 'hosted';
      enabled: boolean;
      provider: ConnectorKey;
      capabilities?: string[];
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

function buildRemoteHeaders(
  item: ConnectorCatalogItem,
  input: {
    accessToken?: string;
    teamId?: string;
    projectUrl?: string;
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
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    const projectUrl = asText(input.projectUrl);
    if (projectUrl) {
      headers['x-supabase-url'] = projectUrl;
    }
    return headers;
  }
  if (item.runtime.headerTemplate === 'bearer-token') {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }
  return {};
}

function buildRemoteUrl(item: ConnectorCatalogItem): string {
  const configured = item.runtime.urlEnv ? asText(process.env[item.runtime.urlEnv]) : '';
  const baseUrl = configured || asText(item.runtime.urlDefault);
  if (!baseUrl) {
    throw new Error(`${item.name} MCP remote URL is not configured`);
  }
  const url = new URL(baseUrl);
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
      throw new Error(`Unknown connector: ${connectorKey}`);
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
    runtimeContext?: {
      taskSessionId?: string;
      userId?: string;
    };
  }): ConnectorRuntimeConfig {
    const { connectorKey, account } = input;
    const item = this.getCatalogItem(connectorKey);
    const secret = account.secret || {};
    const configJson = account.configJson || {};

    if (connectorKey === 'postgres') {
      const dsn = asText(secret.dsn);
      if (!dsn) {
        throw new Error('Postgres connector requires DSN');
      }
      return {
        type: 'local',
        enabled: true,
        command: ['npx', '-y', '@modelcontextprotocol/server-postgres', dsn],
      };
    }

    const accessToken = asText(secret.accessToken);
    const refreshToken = asText(secret.refreshToken);
    if (connectorKey === 'vercel') {
      if (!accessToken && !refreshToken) {
        throw new Error('Vercel connector requires access token or refresh token');
      }
      return {
        type: 'hosted',
        enabled: true,
        provider: 'vercel',
        capabilities: ['initialize', 'tools/list', 'tools/call'],
      };
    }
    if (item.composio?.provider === 'composio') {
      if (account.authStatus !== 'authorized') {
        throw new Error(`${item.name} connector is not authorized`);
      }
      if (
        asText(account.metadataJson?.provider) !== 'composio' ||
        !asText(secret.composioMcpUrl)
      ) {
        throw new Error(`${item.name} connector must be reconnected through Composio`);
      }
      return {
        type: 'hosted',
        enabled: true,
        provider: connectorKey,
        capabilities: ['initialize', 'tools/list', 'tools/call'],
      };
    }
    if (!accessToken) {
      throw new Error(`${item.name} connector requires access token`);
    }
    const url =
      connectorKey === 'supabase' && asText(configJson.mcpUrl)
        ? new URL(asText(configJson.mcpUrl)).toString()
        : buildRemoteUrl(item);
    const headers = buildRemoteHeaders(item, {
      accessToken,
      teamId: asText(configJson.teamId),
      projectUrl: asText(configJson.projectUrl) || asText(configJson.supabaseUrl),
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
