import type { ConnectorDefinition } from './types';

export function buildPostgresDefinition(): ConnectorDefinition {
  return {
    key: 'postgres',
    name: 'Postgres',
    description: '历史遗留 Postgres 连接器；当前仅为兼容旧数据保留，不出现在菜单中。',
    icon: 'database',
    authMode: 'dsn',
    available: true,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: true,
        placeholder: 'Legacy Postgres',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Legacy Database',
      },
      {
        key: 'dsn',
        label: 'Connection String',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'postgresql://user:pass@host:5432/db',
      },
    ],
    oauth: {
      supported: false,
    },
    activityMatcherVerified: true,
    visibleInMenu: false,
    deprecated: true,
    runtime: {
      type: 'local',
    },
  };
}
