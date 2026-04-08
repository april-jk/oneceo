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
  const redirectUri = asText(process.env.NOTION_CONNECTOR_REDIRECT_URI);
  return {
    provider: 'notion',
    clientId,
    clientSecret,
    redirectUri: redirectUri || undefined,
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
  const oauthClientConfigured = Boolean(oauth);
  const redirectUriConfigured = Boolean(asText(oauth?.redirectUri));
  const oauthConfigured = oauthClientConfigured && redirectUriConfigured;
  const hasRemoteUrl = Boolean(remoteUrl);
  const available = hasRemoteUrl && oauthConfigured;
  const availabilityReason = !hasRemoteUrl
    ? '部署环境未配置 Notion MCP remote URL'
    : !oauthClientConfigured
      ? '部署环境未配置 Notion OAuth client'
      : !redirectUriConfigured
        ? '部署环境未配置 Notion OAuth 固定回调地址'
      : undefined;
  return {
    key: 'notion',
    category: 'app',
    name: 'Notion',
    description: '在平台外部管理 Notion 授权，并按 profile 将能力投影到 sandbox 内使用。',
    icon: 'notion',
    featured: true,
    sortOrder: 20,
    authMode: 'oauth',
    available,
    availabilityReason,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: false,
        placeholder: 'Notion Default',
        description: '可选。留空时系统会自动生成默认 profile 名称。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Workspace Alias',
        description: '可选。OAuth 成功后会优先用 Notion workspace 信息自动回填。',
      },
    ],
    oauth: {
      supported: oauthConfigured,
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
