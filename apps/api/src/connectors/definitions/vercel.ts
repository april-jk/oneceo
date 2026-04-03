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

export function resolveVercelOauthProvider(): ConnectorOauthProvider | undefined {
  const clientId = asText(process.env.VERCEL_CONNECTOR_CLIENT_ID);
  const clientSecret = asText(process.env.VERCEL_CONNECTOR_CLIENT_SECRET);
  if (!clientId || !clientSecret) return undefined;
  return {
    provider: 'vercel',
    clientId,
    clientSecret,
    authorizationUrl:
      asText(process.env.VERCEL_CONNECTOR_AUTHORIZE_URL) ||
      'https://vercel.com/oauth/authorize',
    tokenUrl:
      asText(process.env.VERCEL_CONNECTOR_TOKEN_URL) ||
      'https://api.vercel.com/v2/oauth/access_token',
    pkceMethod: 'S256',
    scopeParam: 'scope',
    scopes: parseScopes(process.env.VERCEL_CONNECTOR_SCOPES, []),
    tokenRequestBodyFormat: 'form',
    tokenClientAuth: 'body',
    tokenExtraParams: {
      grant_type: 'authorization_code',
    },
  };
}

export function buildVercelDefinition(): ConnectorDefinition {
  const oauth = resolveVercelOauthProvider();
  return {
    key: 'vercel',
    category: 'app',
    name: 'Vercel',
    description: '直接接入 Vercel 官方 MCP（mcp.vercel.com），在平台外部管理授权，在 sandbox 内按 profile 使用。',
    icon: 'vercel',
    isNew: true,
    sortOrder: 60,
    authMode: oauth ? 'oauth' : 'token',
    available: true,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: true,
        placeholder: 'Vercel Team',
        description: '用于区分不同 Vercel 组织或项目上下文。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Frontend Deployments',
        description: '显示名称。',
      },
      {
        key: 'teamId',
        label: 'Team ID (Optional)',
        type: 'text',
        placeholder: 'team_xxx',
        description: '可选，用于限定团队上下文。',
      },
      {
        key: 'accessToken',
        label: oauth ? 'Access Token (Optional)' : 'Access Token',
        type: 'password',
        required: !oauth,
        secret: true,
        placeholder: 'vercel_xxx',
        description: oauth
          ? '优先走 Vercel OAuth；如已有 Personal Access Token，也可直接粘贴保存。'
          : '填写 Vercel Personal Access Token，平台将直接用它访问官方 MCP。',
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
      urlDefault: 'https://mcp.vercel.com',
      headersEnv: 'VERCEL_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
    },
  };
}
