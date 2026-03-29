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

export function resolveSlackOauthProvider(): ConnectorOauthProvider | undefined {
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

export function buildSlackDefinition(): ConnectorDefinition {
  const oauth = resolveSlackOauthProvider();
  const remoteUrl = asText(process.env.SLACK_MCP_REMOTE_URL);
  return {
    key: 'slack',
    category: 'app',
    name: 'Slack',
    description: '在平台外部完成 Slack 配置，runtime 只将已授权 profile 投影到 sandbox 内使用。',
    icon: 'slack',
    featured: true,
    sortOrder: 30,
    authMode: oauth ? 'oauth' : 'token',
    available: Boolean(remoteUrl),
    availabilityReason: remoteUrl ? undefined : '部署环境未配置 Slack MCP remote URL',
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
        label: oauth ? 'Slack Token (Optional)' : 'Slack Access Token',
        type: 'password',
        required: !oauth,
        secret: true,
        placeholder: 'xoxb-...',
        description: '通常填写从 Slack App 获取的 bot token 或平台 OAuth 回填的 access token。',
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
      urlEnv: 'SLACK_MCP_REMOTE_URL',
      headersEnv: 'SLACK_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
    },
  };
}
