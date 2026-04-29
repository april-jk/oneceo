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

export function resolveNotionToolkitSlugs(): string[] {
  return parseCsvEnv('COMPOSIO_NOTION_TOOLKITS', ['notion']);
}

export function resolveNotionAllowedTools(): string[] {
  return parseCsvEnv('COMPOSIO_NOTION_ALLOWED_TOOLS');
}

export function buildNotionDefinition(): ConnectorDefinition {
  const toolkitSlugs = resolveNotionToolkitSlugs();
  const available = Boolean(asText(process.env.COMPOSIO_API_KEY)) && toolkitSlugs.length > 0;
  const availabilityReason = !asText(process.env.COMPOSIO_API_KEY)
    ? 'COMPOSIO_API_KEY is not configured'
    : toolkitSlugs.length === 0
      ? 'COMPOSIO_NOTION_TOOLKITS is empty'
      : undefined;

  return {
    key: 'notion',
    category: 'app',
    name: 'Notion',
    description: '通过 Composio 托管 Notion 授权与 MCP 工具调用，sandbox 只接收 API broker provider。',
    icon: 'notion',
    featured: true,
    sortOrder: 20,
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
      allowedTools: resolveNotionAllowedTools(),
      toolNamePrefix: 'notion',
    },
  };
}
