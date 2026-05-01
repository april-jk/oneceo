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

export function resolveGithubToolkitSlugs(): string[] {
  return parseCsvEnv('COMPOSIO_GITHUB_TOOLKITS', ['github']);
}

export function resolveGithubAllowedTools(): string[] {
  return parseCsvEnv('COMPOSIO_GITHUB_ALLOWED_TOOLS');
}

export function buildGithubDefinition(): ConnectorDefinition {
  const toolkitSlugs = resolveGithubToolkitSlugs();
  const available = Boolean(asText(process.env.COMPOSIO_API_KEY)) && toolkitSlugs.length > 0;
  const availabilityReason = !asText(process.env.COMPOSIO_API_KEY)
    ? 'COMPOSIO_API_KEY is not configured'
    : toolkitSlugs.length === 0
      ? 'COMPOSIO_GITHUB_TOOLKITS is empty'
      : undefined;

  return {
    key: 'github',
    category: 'app',
    name: 'GitHub',
    description: 'Use GitHub through Composio managed authorization and oneceo API-brokered MCP tools.',
    icon: 'github',
    featured: true,
    sortOrder: 10,
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
      allowedTools: resolveGithubAllowedTools(),
      toolNamePrefix: 'github',
    },
  };
}
