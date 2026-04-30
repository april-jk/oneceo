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

export function resolveSupabaseToolkitSlugs(): string[] {
  return parseCsvEnv('COMPOSIO_SUPABASE_TOOLKITS', ['supabase']);
}

export function resolveSupabaseAllowedTools(): string[] {
  return parseCsvEnv('COMPOSIO_SUPABASE_ALLOWED_TOOLS');
}

export function buildSupabaseDefinition(): ConnectorDefinition {
  const toolkitSlugs = resolveSupabaseToolkitSlugs();
  const available = Boolean(asText(process.env.COMPOSIO_API_KEY)) && toolkitSlugs.length > 0;
  const availabilityReason = !asText(process.env.COMPOSIO_API_KEY)
    ? 'COMPOSIO_API_KEY is not configured'
    : toolkitSlugs.length === 0
      ? 'COMPOSIO_SUPABASE_TOOLKITS is empty'
      : undefined;

  return {
    key: 'supabase',
    category: 'app',
    name: 'Supabase',
    description: '通过 Composio 托管 Supabase 授权与 MCP 工具调用，sandbox 只接收 API broker provider。',
    icon: 'supabase',
    isNew: true,
    featured: true,
    sortOrder: 40,
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
      allowedTools: resolveSupabaseAllowedTools(),
      toolNamePrefix: 'supabase',
    },
  };
}
