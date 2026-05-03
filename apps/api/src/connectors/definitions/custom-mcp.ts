import type { ConnectorDefinition } from './types';

export function buildCustomMcpDefinition(): ConnectorDefinition {
  return {
    key: 'custom_mcp',
    category: 'custom_mcp',
    name: 'Custom MCP',
    description: 'Connect a remote HTTP, Streamable HTTP, or SSE MCP server through the oneceo broker.',
    icon: 'plug',
    sortOrder: 90,
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
