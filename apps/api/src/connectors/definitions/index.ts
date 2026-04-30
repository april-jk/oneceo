import { buildFigmaDefinition } from './figma';
import { buildGithubDefinition } from './github';
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
  'vercel',
  'postgres',
] as const;

export function buildConnectorDefinitions(): ConnectorDefinition[] {
  return [
    buildGithubDefinition(),
    buildNotionDefinition(),
    buildSlackDefinition(),
    buildSupabaseDefinition(),
    buildFigmaDefinition(),
    buildVercelDefinition(),
    buildPostgresDefinition(),
  ].sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0));
}

export function resolveOauthProvider(connectorKey: ConnectorKey): ConnectorOauthProvider | undefined {
  if (connectorKey === 'vercel') return resolveVercelOauthProvider();
  return undefined;
}
