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

function resolveSlackRedirectUri(): string {
  const configuredPath = asText(process.env.SLACK_CONNECTOR_REDIRECT_URI);
  const frontendBaseUrl = asText(process.env.FRONTEND_URL);
  if (!configuredPath || !frontendBaseUrl) return '';

  try {
    const normalizedPath = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`;
    return new URL(normalizedPath, frontendBaseUrl).toString();
  } catch {
    return '';
  }
}

export function resolveSlackOauthProvider(): ConnectorOauthProvider | undefined {
  const clientId = asText(process.env.SLACK_CONNECTOR_CLIENT_ID);
  const clientSecret = asText(process.env.SLACK_CONNECTOR_CLIENT_SECRET);
  if (!clientId || !clientSecret) return undefined;
  const redirectUri = resolveSlackRedirectUri();
  return {
    provider: 'slack',
    clientId,
    clientSecret,
    redirectUri: redirectUri || undefined,
    authorizationUrl:
      asText(process.env.SLACK_CONNECTOR_AUTHORIZE_URL) ||
      'https://slack.com/oauth/v2/authorize',
    tokenUrl:
      asText(process.env.SLACK_CONNECTOR_TOKEN_URL) ||
      'https://slack.com/api/oauth.v2.access',
    scopeParam: 'user_scope',
    scopes: parseScopes(process.env.SLACK_CONNECTOR_USER_SCOPES, [
      'channels:history',
      'groups:history',
      'mpim:history',
      'im:history',
      'chat:write',
    ]),
    tokenRequestBodyFormat: 'form',
    tokenClientAuth: 'body',
  };
}

export function buildSlackDefinition(): ConnectorDefinition {
  const oauth = resolveSlackOauthProvider();
  const redirectUriRaw = asText(process.env.SLACK_CONNECTOR_REDIRECT_URI);
  const oauthClientConfigured = Boolean(oauth);
  const redirectUriConfigured = Boolean(asText(oauth?.redirectUri));
  const oauthConfigured = oauthClientConfigured && redirectUriConfigured;
  const availabilityReason = !oauthClientConfigured
    ? '部署环境未配置 Slack OAuth client'
    : !redirectUriRaw
      ? '部署环境未配置 Slack OAuth 回调路径'
      : !redirectUriConfigured
        ? 'Slack OAuth 回调地址解析失败，请检查 FRONTEND_URL 与 SLACK_CONNECTOR_REDIRECT_URI'
        : undefined;

  return {
    key: 'slack',
    category: 'app',
    name: 'Slack',
    description: '在平台外完成 Slack OAuth 授权，runtime 仅将已授权 profile 投影到 sandbox 内使用。',
    icon: 'slack',
    featured: true,
    sortOrder: 30,
    authMode: 'oauth',
    available: oauthConfigured,
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
      urlDefault: 'https://mcp.slack.com/mcp',
      headersEnv: 'SLACK_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
    },
  };
}
