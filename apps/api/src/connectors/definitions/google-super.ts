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

export function resolveGoogleSuperToolkitSlugs(): string[] {
  return parseCsvEnv('COMPOSIO_GOOGLE_SUPER_TOOLKITS', ['googlesuper']);
}

export function resolveGoogleSuperAllowedTools(): string[] {
  return parseCsvEnv('COMPOSIO_GOOGLE_SUPER_ALLOWED_TOOLS');
}

export function buildGoogleSuperDefinition(): ConnectorDefinition {
  const toolkitSlugs = resolveGoogleSuperToolkitSlugs();
  const available = Boolean(asText(process.env.COMPOSIO_API_KEY)) && toolkitSlugs.length > 0;
  const availabilityReason = !asText(process.env.COMPOSIO_API_KEY)
    ? 'COMPOSIO_API_KEY is not configured'
    : toolkitSlugs.length === 0
      ? 'COMPOSIO_GOOGLE_SUPER_TOOLKITS is empty'
      : undefined;

  return {
    key: 'google_super',
    category: 'app',
    name: 'Google Workspace',
    description: 'Use Google Workspace through Composio Google Super and oneceo API-brokered MCP tools.',
    icon: 'google',
    isNew: true,
    sortOrder: 55,
    authMode: 'oauth',
    available,
    availabilityReason,
    configFields: [],
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
      allowedTools: resolveGoogleSuperAllowedTools(),
      toolNamePrefix: 'google_super',
    },
  };
}
