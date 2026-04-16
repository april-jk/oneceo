import type { ConnectorDefinition, ConnectorOauthProvider } from './types';

const NOTION_DEFAULT_MCP_REMOTE_URL = 'https://mcp.notion.com/sse';

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

function resolveNotionRedirectUri(): string {
  const configured = asText(process.env.NOTION_CONNECTOR_REDIRECT_URI);
  if (!configured) return '';

  // Backward-compatible: allow full URL, but prefer path + FRONTEND_URL.
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

export function resolveNotionOauthProvider(): ConnectorOauthProvider | undefined {
  const clientId = asText(process.env.NOTION_CONNECTOR_CLIENT_ID);
  const clientSecret = asText(process.env.NOTION_CONNECTOR_CLIENT_SECRET);
  if (!clientId || !clientSecret) return undefined;
  const redirectUri = resolveNotionRedirectUri();
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
  const redirectUriRaw = asText(process.env.NOTION_CONNECTOR_REDIRECT_URI);
  const configuredRemoteUrl = asText(process.env.NOTION_MCP_REMOTE_URL);
  const oauthClientConfigured = Boolean(oauth);
  const redirectUriConfigured = Boolean(asText(oauth?.redirectUri));
  const oauthConfigured = oauthClientConfigured && redirectUriConfigured;
  let remoteUrlValid = true;
  let remoteAvailabilityReason: string | undefined;

  try {
    const parsed = new URL(configuredRemoteUrl || NOTION_DEFAULT_MCP_REMOTE_URL);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    if (!normalizedPath.endsWith('/sse')) {
      remoteUrlValid = false;
      remoteAvailabilityReason = 'Notion MCP remote URL 必须配置为 SSE 端点（/sse），不能继续使用 /mcp';
    }
  } catch {
    remoteUrlValid = false;
    remoteAvailabilityReason = 'Notion MCP remote URL 非法，请检查 NOTION_MCP_REMOTE_URL';
  }

  const available = remoteUrlValid && oauthConfigured;
  const availabilityReason = !remoteUrlValid
    ? remoteAvailabilityReason
    : !oauthClientConfigured
      ? '部署环境未配置 Notion OAuth client'
      : !redirectUriRaw
        ? '部署环境未配置 Notion OAuth 回调路径'
        : !redirectUriConfigured
          ? 'Notion OAuth 回调地址解析失败，请检查 FRONTEND_URL 与 NOTION_CONNECTOR_REDIRECT_URI'
          : undefined;

  return {
    key: 'notion',
    category: 'app',
    name: 'Notion',
    description: '在平台外完成 Notion OAuth 授权，并将可访问内容范围投影到 sandbox 内使用。',
    icon: 'notion',
    featured: true,
    sortOrder: 20,
    authMode: 'oauth',
    available,
    availabilityReason,
    configFields: [],
    oauth: {
      supported: oauthConfigured,
      provider: oauth?.provider,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlEnv: 'NOTION_MCP_REMOTE_URL',
      urlDefault: NOTION_DEFAULT_MCP_REMOTE_URL,
      headersEnv: 'NOTION_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
      transport: 'remote_sse',
    },
  };
}
