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

export function resolveSlackToolkitSlugs(): string[] {
  return parseCsvEnv('COMPOSIO_SLACK_TOOLKITS', ['slack']);
}

export function resolveSlackAllowedTools(): string[] {
  return parseCsvEnv('COMPOSIO_SLACK_ALLOWED_TOOLS');
}

export function buildSlackDefinition(): ConnectorDefinition {
  const toolkitSlugs = resolveSlackToolkitSlugs();
  const available = Boolean(asText(process.env.COMPOSIO_API_KEY)) && toolkitSlugs.length > 0;
  const availabilityReason = !asText(process.env.COMPOSIO_API_KEY)
    ? 'COMPOSIO_API_KEY is not configured'
    : toolkitSlugs.length === 0
      ? 'COMPOSIO_SLACK_TOOLKITS is empty'
      : undefined;

  return {
    key: 'slack',
    category: 'app',
    name: 'Slack',
    description: 'Use Slack through Composio managed authorization and oneceo API-brokered MCP tools.',
    icon: 'slack',
    featured: true,
    sortOrder: 30,
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
      allowedTools: resolveSlackAllowedTools(),
      toolNamePrefix: 'slack',
    },
  };
}
