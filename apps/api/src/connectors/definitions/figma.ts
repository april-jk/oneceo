import type { ConnectorDefinition } from './types';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildFigmaDefinition(): ConnectorDefinition {
  const remoteUrl = asText(process.env.FIGMA_MCP_REMOTE_URL);
  return {
    key: 'figma',
    name: 'Figma',
    description: '在平台外部管理 Figma access token，并把对应 MCP 连接投影到 sandbox 内使用。',
    icon: 'figma',
    authMode: 'token',
    available: Boolean(remoteUrl),
    availabilityReason: remoteUrl ? undefined : '部署环境未配置 Figma MCP remote URL',
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: true,
        placeholder: 'Figma Design System',
        description: '用于区分不同 Figma 工作上下文。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Design Team',
        description: '显示名称。',
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'figd_...',
        description: '填写 Figma personal access token，配置在平台外部，sandbox 内只使用投影后的能力。',
      },
    ],
    oauth: {
      supported: false,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlEnv: 'FIGMA_MCP_REMOTE_URL',
      headersEnv: 'FIGMA_MCP_REMOTE_HEADERS_JSON',
      headerTemplate: 'figma',
    },
  };
}
