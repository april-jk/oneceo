import type { ConnectorDefinition, ConnectorOauthProvider } from './types';

const VERCEL_INTERNAL_MCP_PATH = '/api/internal/connectors/vercel/mcp';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveVercelIntegrationMode() {
  const configured = asText(process.env.VERCEL_CONNECTOR_MODE).toLowerCase();
  return !configured || configured === 'integration';
}

function resolveVercelRedirectUri(): string {
  const configured =
    asText(process.env.VERCEL_INTEGRATION_REDIRECT_URI) ||
    asText(process.env.VERCEL_CONNECTOR_REDIRECT_URI);
  if (!configured) return '';

  if (/^https?:\/\//i.test(configured)) {
    return configured;
  }

  const frontendBaseUrl = asText(process.env.FRONTEND_URL);
  if (!frontendBaseUrl) return '';

  try {
    const normalizedPath = configured.startsWith('/') ? configured : `/${configured}`;
    return new URL(normalizedPath, frontendBaseUrl).toString();
  } catch {
    return '';
  }
}

function resolveVercelInternalMcpUrl(): string {
  const configured = asText(process.env.VERCEL_INTERNAL_MCP_URL);
  if (configured) return configured;

  const apiPublicBaseUrl =
    asText(process.env.ONECEO_API_PUBLIC_URL) || asText(process.env.FRONTEND_URL);
  if (!apiPublicBaseUrl) return '';

  try {
    return new URL(VERCEL_INTERNAL_MCP_PATH, apiPublicBaseUrl).toString();
  } catch {
    return '';
  }
}

export function resolveVercelOauthProvider(): ConnectorOauthProvider | undefined {
  if (!resolveVercelIntegrationMode()) return undefined;

  const integrationSlug = asText(process.env.VERCEL_INTEGRATION_SLUG);
  const clientId =
    asText(process.env.VERCEL_INTEGRATION_CLIENT_ID) ||
    asText(process.env.VERCEL_CONNECTOR_CLIENT_ID);
  const clientSecret =
    asText(process.env.VERCEL_INTEGRATION_CLIENT_SECRET) ||
    asText(process.env.VERCEL_CONNECTOR_CLIENT_SECRET);
  const redirectUri = resolveVercelRedirectUri();
  const installUrl =
    asText(process.env.VERCEL_INTEGRATION_INSTALL_URL) ||
    (integrationSlug ? `https://vercel.com/integrations/${integrationSlug}/new` : '');

  if (!integrationSlug || !clientId || !clientSecret || !redirectUri || !installUrl) {
    return undefined;
  }

  return {
    provider: 'vercel',
    authorizationMode: 'vercel_integration',
    integrationSlug,
    clientId,
    clientSecret,
    redirectUri,
    authorizationUrl: installUrl,
    tokenUrl:
      asText(process.env.VERCEL_INTEGRATION_TOKEN_URL) ||
      'https://api.vercel.com/v2/oauth/access_token',
    scopes: [],
    tokenRequestBodyFormat: 'form',
    tokenClientAuth: 'body',
  };
}

export function buildVercelDefinition(): ConnectorDefinition {
  const integrationMode = resolveVercelIntegrationMode();
  const oauth = resolveVercelOauthProvider();
  const integrationSlug = asText(process.env.VERCEL_INTEGRATION_SLUG);
  const redirectUri = resolveVercelRedirectUri();
  const internalTokenConfigured = Boolean(asText(process.env.ONECEO_INTERNAL_TOKEN));
  const internalMcpUrl = resolveVercelInternalMcpUrl();
  const internalMcpConfigured = Boolean(internalMcpUrl);
  const available = Boolean(oauth) && internalTokenConfigured && internalMcpConfigured;

  const availabilityReason = !integrationMode
    ? 'Vercel connector only supports Integration mode. Set VERCEL_CONNECTOR_MODE=integration.'
    : !integrationSlug
      ? 'Deployment is missing VERCEL_INTEGRATION_SLUG.'
      : !oauth
        ? 'Deployment is missing Vercel Integration client credentials or redirect URI.'
        : !redirectUri
          ? 'Deployment is missing Vercel Integration redirect URI.'
          : !internalTokenConfigured
            ? 'Deployment is missing ONECEO_INTERNAL_TOKEN for the internal MCP wrapper.'
            : !internalMcpConfigured
              ? 'Vercel internal MCP URL could not be resolved.'
              : undefined;

  return {
    key: 'vercel',
    category: 'app',
    name: 'Vercel',
    description:
      'Connects Vercel through the OneCEO internal MCP wrapper and a Vercel Integration installation token.',
    icon: 'vercel',
    isNew: true,
    sortOrder: 60,
    authMode: 'oauth',
    available,
    availabilityReason,
    configFields: [
      {
        key: 'profileName',
        label: 'Profile Name',
        type: 'text',
        required: false,
        placeholder: 'Vercel Team',
        description: 'Optional display name for this Vercel Integration profile.',
      },
      {
        key: 'displayName',
        label: 'Display Name',
        type: 'text',
        placeholder: 'Frontend Deployments',
        description: 'Optional UI display name.',
      },
      {
        key: 'teamId',
        label: 'Team ID (Optional)',
        type: 'text',
        placeholder: 'team_xxx',
        description:
          'Optional manual team context. Integration callback teamId takes precedence after installation.',
      },
      {
        key: 'projectId',
        label: 'Project ID (Optional)',
        type: 'text',
        placeholder: 'prj_xxx',
        description: 'Optional default project context for MCP tools.',
      },
      {
        key: 'projectSlug',
        label: 'Project Slug (Optional)',
        type: 'text',
        placeholder: 'my-project',
        description: 'Optional default project slug for MCP tools.',
      },
    ],
    oauth: {
      supported: available,
      provider: oauth?.provider,
    },
    activityMatcherVerified: true,
    visibleInMenu: true,
    runtime: {
      type: 'remote',
      urlDefault: internalMcpUrl,
      headerTemplate: 'none',
      transport: 'streamable_http',
    },
  };
}
