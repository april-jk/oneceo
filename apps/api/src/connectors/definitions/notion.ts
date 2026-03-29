import type { ConnectorDefinition, ConnectorOauthProvider } from './types';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseScopes(value: string | undefined, fallback: string[]): string[] {
  const raw = asText(value);
  if (!raw) return fallback;
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveNotionOauthProvider(): ConnectorOauthProvider | undefined {
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

export function buildNotionDefinition(): ConnectorDefinition {
  const oauth = resolveNotionOauthProvider();
  const remoteUrl = asText(process.env.NOTION_MCP_REMOTE_URL);
  return {
    key: 'notion',
    category: 'app',
    name: 'Notion',
    description: '在平台外部管理 Notion 授权，并按 profile 将能力投影到 sandbox 内使用。',
    icon: 'notion',
    featured: true,
    sortOrder: 20,
    authMode: oauth ? 'oauth' : 'token',
    available: Boolean(remoteUrl),
    availabilityReason: remoteUrl ? undefined : '部署环境未配置 Notion MCP remote URL',
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: true,
        placeholder: 'Notion Workspace',
        description: '用于区分不同 Notion workspace 的配置档案。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Product Docs',
        description: '显示名称。',
      },
      {
        key: 'accessToken',
        label: oauth ? 'Notion Token / Secret (Optional)' : 'Notion Access Token',
        type: 'password',
        required: !oauth,
        secret: true,
        placeholder: 'secret_xxx',
        description: '填写 Internal Integration Secret、access token，或由平台 OAuth 回填。',
      },
    ],
    oauth: {
      supported: Boolean(oauth),
      provider: oauth?.provider,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlEnv: 'NOTION_MCP_REMOTE_URL',
      headersEnv: 'NOTION_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
    },
  };
}
