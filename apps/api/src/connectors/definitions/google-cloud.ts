import type { ConnectorDefinition } from './types';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCsvEnv(name: string, fallback: string[] = []): string[] {
  const raw = asText(process.env[name]);
  const source = raw ? raw.split(',') : fallback;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const value = item.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function resolveGoogleCloudToolkitSlugs(): string[] {
  return parseCsvEnv('COMPOSIO_GOOGLE_CLOUD_TOOLKITS', ['googlebigquery']);
}

export function resolveGoogleCloudAllowedTools(): string[] {
  return parseCsvEnv('COMPOSIO_GOOGLE_CLOUD_ALLOWED_TOOLS');
}

export function buildGoogleCloudDefinition(): ConnectorDefinition {
  const toolkitSlugs = resolveGoogleCloudToolkitSlugs();
  const available = Boolean(asText(process.env.COMPOSIO_API_KEY)) && toolkitSlugs.length > 0;
  return {
    key: 'google_cloud',
    category: 'app',
    name: 'Google Cloud',
    description: 'Use Google Cloud tools through Composio MCP with OAuth.',
    icon: 'google-cloud',
    featured: true,
    isNew: true,
    sortOrder: 80,
    authMode: 'oauth',
    available,
    availabilityReason: !asText(process.env.COMPOSIO_API_KEY)
      ? 'COMPOSIO_API_KEY is not configured'
      : toolkitSlugs.length === 0
        ? 'COMPOSIO_GOOGLE_CLOUD_TOOLKITS is empty'
        : undefined,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: false,
        placeholder: 'Google Cloud',
        description: 'Optional profile name for this Google Cloud connection.',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: false,
        placeholder: 'Production GCP',
        description: 'Optional UI display name.',
      },
    ],
    oauth: {
      supported: available,
      provider: 'composio',
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      transport: 'streamable_http',
      headerTemplate: 'none',
    },
    composio: {
      provider: 'composio',
      toolkitSlugs,
      authStrategy: 'composio_connect_link',
      brokerMode: 'api_only',
      allowTokenInSandbox: false,
      allowedTools: resolveGoogleCloudAllowedTools(),
      toolNamePrefix: 'google_cloud',
    },
  };
}
