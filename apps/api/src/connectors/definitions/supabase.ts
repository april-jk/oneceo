import type { ConnectorDefinition } from './types';

export function buildSupabaseDefinition(): ConnectorDefinition {
  return {
    key: 'supabase',
    category: 'app',
    name: 'Supabase',
    description: '独立的 Supabase 连接器，在平台外部保存 project/token 配置，并在 sandbox 内通过 MCP 使用。',
    icon: 'supabase',
    isNew: true,
    featured: true,
    sortOrder: 40,
    authMode: 'token',
    available: true,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: true,
        placeholder: 'Supabase Prod',
        description: '用于区分不同 Supabase 项目配置。',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Production Project',
        description: '显示名称。',
      },
      {
        key: 'projectRef',
        label: 'Project Ref',
        type: 'text',
        required: true,
        placeholder: 'abcdefghijklmnop',
        description: 'Supabase project ref，用于限定当前 MCP 连接的项目。',
      },
      {
        key: 'accessToken',
        label: 'Personal Access Token',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'sbp_...',
        description: '从 Supabase Account Token 页面生成的 personal access token。',
      },
    ],
    oauth: {
      supported: false,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlDefault: 'https://mcp.supabase.com/mcp',
      headerTemplate: 'supabase',
    },
  };
}
