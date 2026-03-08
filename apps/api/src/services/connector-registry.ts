export const CONNECTOR_KEYS = ['github', 'slack', 'notion', 'postgres'] as const;

export type ConnectorKey = (typeof CONNECTOR_KEYS)[number];
export type ConnectorAuthMode = 'oauth' | 'token' | 'dsn';
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

export type ConnectorConfigField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'textarea';
  required?: boolean;
  placeholder?: string;
  description?: string;
  secret?: boolean;
};

export type ConnectorOauthProvider = {
  provider: 'github' | 'slack' | 'notion';
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopeParam?: string;
  scopes: string[];
  tokenRequestBodyFormat?: 'json' | 'form';
  tokenClientAuth?: 'body' | 'basic';
  tokenExtraParams?: Record<string, string>;
  authorizationExtraParams?: Record<string, string>;
};

export type ConnectorCatalogItem = {
  key: ConnectorKey;
  name: string;
  description: string;
  icon: string;
  authMode: ConnectorAuthMode;
  available: boolean;
  availabilityReason?: string;
  configFields: ConnectorConfigField[];
  oauth?: {
    supported: boolean;
    provider?: ConnectorOauthProvider['provider'];
  };
  activityMatcherVerified: boolean;
};

export type ConnectorAccountSecret = {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  dsn?: string;
};

export type ConnectorAccountMaterial = {
  connectorKey: ConnectorKey;
  authMode: string;
  authStatus: string;
  displayName?: string | null;
  configJson?: Record<string, unknown>;
  secret?: ConnectorAccountSecret | null;
};

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

function isEnabled(value: unknown, fallback = true): boolean {
  const text = asText(value).toLowerCase();
  if (!text) return fallback;
  return !['0', 'false', 'no', 'off'].includes(text);
}

function parseScopes(value: string | undefined, fallback: string[]): string[] {
  const raw = asText(value);
  if (!raw) return fallback;
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function resolveOauthProvider(key: ConnectorKey): ConnectorOauthProvider | undefined {
  if (key === 'github') {
    const clientId = asText(process.env.GITHUB_CONNECTOR_CLIENT_ID);
    const clientSecret = asText(process.env.GITHUB_CONNECTOR_CLIENT_SECRET);
    if (!clientId || !clientSecret) return undefined;
    return {
      provider: 'github',
      clientId,
      clientSecret,
      authorizationUrl:
        asText(process.env.GITHUB_CONNECTOR_AUTHORIZE_URL) ||
        'https://github.com/login/oauth/authorize',
      tokenUrl:
        asText(process.env.GITHUB_CONNECTOR_TOKEN_URL) ||
        'https://github.com/login/oauth/access_token',
      scopeParam: 'scope',
      scopes: parseScopes(process.env.GITHUB_CONNECTOR_SCOPES, ['repo', 'read:user']),
      tokenRequestBodyFormat: 'form',
      tokenClientAuth: 'body',
    };
  }

  if (key === 'slack') {
    const clientId = asText(process.env.SLACK_CONNECTOR_CLIENT_ID);
    const clientSecret = asText(process.env.SLACK_CONNECTOR_CLIENT_SECRET);
    if (!clientId || !clientSecret) return undefined;
    return {
      provider: 'slack',
      clientId,
      clientSecret,
      authorizationUrl:
        asText(process.env.SLACK_CONNECTOR_AUTHORIZE_URL) ||
        'https://slack.com/oauth/v2/authorize',
      tokenUrl:
        asText(process.env.SLACK_CONNECTOR_TOKEN_URL) ||
        'https://slack.com/api/oauth.v2.access',
      scopeParam: 'scope',
      scopes: parseScopes(process.env.SLACK_CONNECTOR_SCOPES, ['channels:history', 'chat:write']),
      tokenRequestBodyFormat: 'form',
      tokenClientAuth: 'body',
    };
  }

  if (key === 'notion') {
    const clientId = asText(process.env.NOTION_CONNECTOR_CLIENT_ID);
    const clientSecret = asText(process.env.NOTION_CONNECTOR_CLIENT_SECRET);
    if (!clientId || !clientSecret) return undefined;
    return {
      provider: 'notion',
      clientId,
      clientSecret,
      authorizationUrl:
        asText(process.env.NOTION_CONNECTOR_AUTHORIZE_URL) ||
        'https://api.notion.com/v1/oauth/authorize',
      tokenUrl:
        asText(process.env.NOTION_CONNECTOR_TOKEN_URL) ||
        'https://api.notion.com/v1/oauth/token',
      scopeParam: 'scope',
      scopes: parseScopes(process.env.NOTION_CONNECTOR_SCOPES, []),
      tokenRequestBodyFormat: 'json',
      tokenClientAuth: 'basic',
      tokenExtraParams: {
        grant_type: 'authorization_code',
      },
      authorizationExtraParams: {
        owner: 'user',
      },
    };
  }

  return undefined;
}

export class ConnectorRegistry {
  listCatalog(): ConnectorCatalogItem[] {
    const githubOauth = resolveOauthProvider('github');
    const slackOauth = resolveOauthProvider('slack');
    const notionOauth = resolveOauthProvider('notion');
    const slackUrl = asText(process.env.SLACK_MCP_REMOTE_URL);
    const notionUrl = asText(process.env.NOTION_MCP_REMOTE_URL);

    return [
      {
        key: 'github',
        name: 'GitHub',
        description: '统一保存 GitHub 登录态，并在会话中热挂载仓库工具。',
        icon: 'github',
        authMode: githubOauth ? 'oauth' : 'token',
        available: isEnabled(process.env.GITHUB_CONNECTOR_ENABLED, true),
        configFields: [
          {
            key: 'accessToken',
            label: githubOauth ? 'Personal Access Token (Optional)' : 'Personal Access Token',
            type: 'password',
            required: !githubOauth,
            secret: true,
            placeholder: 'ghp_xxx',
            description: githubOauth
              ? '推荐优先走 GitHub OAuth；如已有 PAT，也可以直接粘贴保存。'
              : '从 GitHub Personal Access Token 页面复制 fine-grained PAT。',
          },
        ],
        oauth: {
          supported: Boolean(githubOauth),
          provider: githubOauth?.provider,
        },
        activityMatcherVerified: true,
      },
      {
        key: 'slack',
        name: 'Slack',
        description: '复用用户授权态，把 Slack MCP 挂到当前会话。',
        icon: 'slack',
        authMode: slackOauth ? 'oauth' : 'token',
        available: Boolean(slackUrl),
        availabilityReason: slackUrl ? undefined : '部署环境未配置 Slack MCP adapter',
        configFields: [
          {
            key: 'accessToken',
            label: slackOauth ? 'Slack Token (Optional)' : 'Slack Access Token',
            type: 'password',
            required: !slackOauth,
            secret: true,
            placeholder: 'xoxb-...',
            description: '通常填写从 Slack App -> OAuth & Permissions 获取的 Bot token。',
          },
        ],
        oauth: {
          supported: Boolean(slackOauth),
          provider: slackOauth?.provider,
        },
        activityMatcherVerified: true,
      },
      {
        key: 'notion',
        name: 'Notion',
        description: '统一管理 Notion 授权，并按会话动态装载。',
        icon: 'notion',
        authMode: notionOauth ? 'oauth' : 'token',
        available: Boolean(notionUrl),
        availabilityReason: notionUrl ? undefined : '部署环境未配置 Notion MCP adapter',
        configFields: [
          {
            key: 'accessToken',
            label: notionOauth ? 'Notion Token / Secret (Optional)' : 'Notion Access Token',
            type: 'password',
            required: !notionOauth,
            secret: true,
            placeholder: 'secret_xxx',
            description: '从 Notion integration 配置页复制 Internal Integration Secret 或 access token。',
          },
        ],
        oauth: {
          supported: Boolean(notionOauth),
          provider: notionOauth?.provider,
        },
        activityMatcherVerified: true,
      },
      {
        key: 'postgres',
        name: 'Postgres',
        description: '保存数据库连接串，并把 Postgres MCP 热加载到当前执行器。',
        icon: 'database',
        authMode: 'dsn',
        available: isEnabled(process.env.POSTGRES_CONNECTOR_ENABLED, true),
        configFields: [
          {
            key: 'displayName',
            label: 'Display Name',
            type: 'text',
            placeholder: 'Production DB',
            description: '用于 UI 展示，非敏感。',
          },
          {
            key: 'dsn',
            label: 'Connection String',
            type: 'password',
            required: true,
            secret: true,
            placeholder: 'postgresql://user:pass@host:5432/db',
            description: '从数据库控制台复制完整 DSN，保留 sslmode 等 query 参数。',
          },
        ],
        oauth: {
          supported: false,
        },
        activityMatcherVerified: true,
      },
    ];
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
    account: ConnectorAccountMaterial;
  }): ConnectorRuntimeConfig {
    const { connectorKey, account } = input;
    const secret = account.secret || {};

    if (connectorKey === 'github') {
      const accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('GitHub 连接器缺少 access token');
      }
      return {
        type: 'local',
        enabled: true,
        command: ['npx', '-y', '@modelcontextprotocol/server-github'],
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: accessToken,
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

    if (connectorKey === 'slack') {
      const url = asText(process.env.SLACK_MCP_REMOTE_URL);
      if (!url) {
        throw new Error('Slack MCP adapter 未配置');
      }
      const accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('Slack 连接器缺少 access token');
      }
      const headersTemplate =
        parseHeadersTemplate(process.env.SLACK_MCP_REMOTE_HEADERS_JSON) || {};
      const headers = Object.keys(headersTemplate).length
        ? renderHeaders(headersTemplate, { token: accessToken })
        : { Authorization: `Bearer ${accessToken}` };
      return {
        type: 'remote',
        enabled: true,
        url,
        headers,
      };
    }

    if (connectorKey === 'notion') {
      const url = asText(process.env.NOTION_MCP_REMOTE_URL);
      if (!url) {
        throw new Error('Notion MCP adapter 未配置');
      }
      const accessToken = asText(secret.accessToken);
      if (!accessToken) {
        throw new Error('Notion 连接器缺少 access token');
      }
      const headersTemplate =
        parseHeadersTemplate(process.env.NOTION_MCP_REMOTE_HEADERS_JSON) || {};
      const headers = Object.keys(headersTemplate).length
        ? renderHeaders(headersTemplate, { token: accessToken })
        : { Authorization: `Bearer ${accessToken}` };
      return {
        type: 'remote',
        enabled: true,
        url,
        headers,
      };
    }

    throw new Error(`不支持的连接器: ${connectorKey}`);
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
      case 'postgres':
        return normalized.includes('postgres');
      default:
        return false;
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();
