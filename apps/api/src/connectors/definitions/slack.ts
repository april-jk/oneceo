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
  const available = oauth ? oauthConfigured : true;
  const availabilityReason =
    oauth && !available
      ? !redirectUriRaw
        ? '部署环境未配置 Slack OAuth 回调路径'
        : 'Slack OAuth 回调地址解析失败，请检查 FRONTEND_URL 与 SLACK_CONNECTOR_REDIRECT_URI'
      : undefined;
  return {
    key: 'slack',
    category: 'app',
    name: 'Slack',
    description: '在平台外部完成 Slack 配置，runtime 只将已授权 profile 投影到 sandbox 内使用。',
    icon: 'slack',
    featured: true,
    sortOrder: 30,
    authMode: oauth ? 'oauth' : 'token',
    available,
    availabilityReason,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: true,
        placeholder: 'Slack Workspace',
        description: '用于区分不同 Slack workspace 的配置档案。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Marketing Workspace',
        description: '显示名称。',
      },
      {
        key: 'accessToken',
        label: oauth ? 'Slack User Token (Optional)' : 'Slack User Access Token',
        type: 'password',
        required: !oauth,
        secret: true,
        placeholder: 'xoxp-...',
        description: '填写 Slack user token，或留空后通过平台 OAuth 获取并回填 user token。',
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
      urlDefault: 'https://mcp.slack.com/mcp',
      headersEnv: 'SLACK_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
    },
  };
}
