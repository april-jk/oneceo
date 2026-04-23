import type { ConnectorDefinition, ConnectorOauthProvider } from './types';

const VERCEL_INTERNAL_MCP_PATH = '/api/internal/connectors/vercel/mcp';

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

function resolveVercelRedirectUri(): string {
  const configured = asText(process.env.VERCEL_CONNECTOR_REDIRECT_URI);
  if (!configured) return '';

  if (/^https?:\/\//i.test(configured)) {
    return configured;
  }

  const frontendBaseUrl = asText(process.env.FRONTEND_URL);
  if (!frontendBaseUrl) return '';

  try {
    const normalizedPath = configured.startsWith('/') ? configured : `/${configured}`;
    return new URL(normalizedPath, frontendBaseUrl).toString();
  } catch {
    return '';
  }
}

function resolveVercelInternalMcpUrl(): string {
  const configured = asText(process.env.VERCEL_INTERNAL_MCP_URL);
  if (configured) return configured;

  const frontendBaseUrl = asText(process.env.FRONTEND_URL);
  if (!frontendBaseUrl) return '';

  try {
    return new URL(VERCEL_INTERNAL_MCP_PATH, frontendBaseUrl).toString();
  } catch {
    return '';
  }
}

export function resolveVercelOauthProvider(): ConnectorOauthProvider | undefined {
  const clientId = asText(process.env.VERCEL_CONNECTOR_CLIENT_ID);
  const clientSecret = asText(process.env.VERCEL_CONNECTOR_CLIENT_SECRET);
  if (!clientId || !clientSecret) return undefined;
  const redirectUri = resolveVercelRedirectUri();
  return {
    provider: 'vercel',
    clientId,
    clientSecret,
    redirectUri: redirectUri || undefined,
    authorizationUrl:
      asText(process.env.VERCEL_CONNECTOR_AUTHORIZE_URL) ||
      'https://vercel.com/oauth/authorize',
    tokenUrl:
      asText(process.env.VERCEL_CONNECTOR_TOKEN_URL) ||
      'https://api.vercel.com/login/oauth/token',
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
  const redirectUriRaw = asText(process.env.VERCEL_CONNECTOR_REDIRECT_URI);
  const oauthClientConfigured = Boolean(oauth);
  const redirectUriConfigured = Boolean(asText(oauth?.redirectUri));
  const internalTokenConfigured = Boolean(asText(process.env.ONECEO_INTERNAL_TOKEN));
  const internalMcpUrl = resolveVercelInternalMcpUrl();
  const internalMcpConfigured = Boolean(internalMcpUrl);
  const oauthConfigured = oauthClientConfigured && redirectUriConfigured;
  const available =
    oauthConfigured && internalTokenConfigured && internalMcpConfigured;
  const availabilityReason = !oauthClientConfigured
    ? '部署环境未配置 Vercel OAuth client'
    : !redirectUriRaw
      ? '部署环境未配置 Vercel OAuth 回调路径'
      : !redirectUriConfigured
        ? 'Vercel OAuth 回调地址解析失败，请检查 FRONTEND_URL 与 VERCEL_CONNECTOR_REDIRECT_URI'
        : !internalTokenConfigured
          ? '部署环境未配置 ONECEO_INTERNAL_TOKEN，无法启用内部 MCP 包装层'
          : !internalMcpConfigured
            ? 'Vercel internal MCP URL 解析失败，请检查 FRONTEND_URL 或 VERCEL_INTERNAL_MCP_URL'
            : undefined;
  return {
    key: 'vercel',
    category: 'app',
    name: 'Vercel',
    description: '通过 oneceo 内部 MCP 包装层接入 Vercel，用户完成 OAuth 授权后，由平台服务端代调 Vercel REST API。',
    icon: 'vercel',
    isNew: true,
    sortOrder: 60,
    authMode: 'oauth',
    available,
    availabilityReason,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: false,
        placeholder: 'Vercel Team',
        description: '可选；不填写时平台会自动创建默认 Vercel profile。',
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
        key: 'projectId',
        label: 'Project ID (Optional)',
        type: 'text',
        placeholder: 'prj_xxx',
        description: '可选，作为 MCP 工具默认项目上下文。',
      },
      {
        key: 'projectSlug',
        label: 'Project Slug (Optional)',
        type: 'text',
        placeholder: 'my-project',
        description: '可选，作为 MCP 工具默认项目上下文。',
      },
    ],
    oauth: {
      supported: available,
      provider: oauth?.provider,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlDefault: internalMcpUrl,
      headerTemplate: 'none',
      transport: 'streamable_http',
    },
  };
}
