import type { ConnectorDefinition } from './types';
import { isCustomApiEnabled } from '../../services/custom-api-feature-flag';

export function buildCustomApiDefinition(): ConnectorDefinition {
  const enabled = isCustomApiEnabled();
  return {
    key: 'custom_api',
    category: 'custom_api',
    name: 'Custom API',
    description: 'Expose approved external API endpoints as brokered MCP tools.',
    icon: 'plug',
    sortOrder: 80,
    authMode: 'token',
    available: enabled,
    availabilityReason: enabled ? undefined : 'ONECEO_CUSTOM_API_ENABLED is not enabled',
    configFields: [],
    activityMatcherVerified: true,
    visibleInMenu: false,
    runtime: {
      type: 'hosted',
      transport: 'streamable_http',
      headerTemplate: 'none',
    },
  };
}
