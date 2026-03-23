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

export function resolveGithubOauthProvider(): ConnectorOauthProvider | undefined {
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

export function buildGithubDefinition(): ConnectorDefinition {
  const oauth = resolveGithubOauthProvider();
  return {
    key: 'github',
    name: 'GitHub',
    description: '在平台外部保存 GitHub 授权态，并在 sandbox 内按会话挂载仓库工具。',
    icon: 'github',
    authMode: oauth ? 'oauth' : 'token',
    available: true,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        placeholder: 'GitHub Main',
        description: '可选。留空时平台会自动按授权账号生成名称。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Engineering Org',
        description: '可选。留空时平台会自动回填 GitHub 账号名。',
      },
      {
        key: 'accessToken',
        label: oauth ? 'Personal Access Token (Optional)' : 'Personal Access Token',
        type: 'password',
        required: !oauth,
        secret: true,
        placeholder: 'ghp_xxx',
        description: oauth
          ? '推荐优先走 GitHub OAuth；如已有 PAT，也可以直接粘贴保存。'
          : '从 GitHub Personal Access Token 页面复制 fine-grained PAT。',
      },
    ],
    oauth: {
      supported: Boolean(oauth),
      provider: oauth?.provider,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'local',
    },
  };
}
