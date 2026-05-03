import type { ConnectorDefinition } from './types';

export function buildCustomApiDefinition(): ConnectorDefinition {
  return {
    key: 'custom_api',
    category: 'custom_api',
    name: 'Custom API',
    description: 'Expose approved external API endpoints as brokered MCP tools.',
    icon: 'plug',
    sortOrder: 80,
    authMode: 'token',
    available: true,
    configFields: [],
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'hosted',
      transport: 'streamable_http',
      headerTemplate: 'none',
    },
  };
}
