import { buildFigmaDefinition } from './figma';
import { buildCustomApiDefinition } from './custom-api';
import { buildCustomMcpDefinition } from './custom-mcp';
import { buildGithubDefinition } from './github';
import { buildGoogleSuperDefinition } from './google-super';
import { buildNotionDefinition } from './notion';
import { buildPostgresDefinition } from './postgres';
import { buildSlackDefinition } from './slack';
import { buildSupabaseDefinition } from './supabase';
import type {
  ConnectorDefinition,
  ConnectorKey,
  ConnectorOauthProvider,
  RemoteMcpTransport,
} from './types';
import { buildVercelDefinition, resolveVercelOauthProvider } from './vercel';

export type {
  ConnectorDefinition,
  ConnectorKey,
  ConnectorOauthProvider,
  RemoteMcpTransport,
} from './types';

export const CONNECTOR_KEYS = [
  'github',
  'notion',
  'slack',
  'supabase',
  'figma',
  'google_super',
  'vercel',
  'postgres',
  'custom_api',
  'custom_mcp',
] as const;

export function buildConnectorDefinitions(): ConnectorDefinition[] {
  return [
    buildGithubDefinition(),
    buildNotionDefinition(),
    buildSlackDefinition(),
    buildSupabaseDefinition(),
    buildFigmaDefinition(),
    buildGoogleSuperDefinition(),
    buildVercelDefinition(),
    buildPostgresDefinition(),
    buildCustomApiDefinition(),
    buildCustomMcpDefinition(),
  ].sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0));
}

export function resolveOauthProvider(connectorKey: ConnectorKey): ConnectorOauthProvider | undefined {
  if (connectorKey === 'vercel') return resolveVercelOauthProvider();
  return undefined;
}
