import type { ConnectorDefinition } from './types';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildVercelDefinition(): ConnectorDefinition {
  const remoteUrl = asText(process.env.VERCEL_MCP_REMOTE_URL);
  return {
    key: 'vercel',
    name: 'Vercel',
    description: '在平台外部管理 Vercel token / team 上下文，并在 sandbox 内按 profile 使用。',
    icon: 'vercel',
    authMode: 'token',
    available: Boolean(remoteUrl),
    availabilityReason: remoteUrl ? undefined : '部署环境未配置 Vercel MCP remote URL',
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
        label: 'Access Token',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'vercel_xxx',
        description: '填写 Vercel access token，配置在平台外部。',
      },
    ],
    oauth: {
      supported: false,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlEnv: 'VERCEL_MCP_REMOTE_URL',
      headersEnv: 'VERCEL_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'bearer-token',
    },
  };
}
