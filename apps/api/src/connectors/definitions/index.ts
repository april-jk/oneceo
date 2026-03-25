import { buildFigmaDefinition } from './figma';
import { buildGithubDefinition, resolveGithubOauthProvider } from './github';
import { buildNotionDefinition, resolveNotionOauthProvider } from './notion';
import { buildPostgresDefinition } from './postgres';
import { buildSlackDefinition, resolveSlackOauthProvider } from './slack';
import { buildSupabaseDefinition } from './supabase';
import type { ConnectorDefinition, ConnectorKey, ConnectorOauthProvider } from './types';
import { buildVercelDefinition } from './vercel';

export type { ConnectorDefinition, ConnectorKey, ConnectorOauthProvider } from './types';

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
  ];
}

export function resolveOauthProvider(connectorKey: ConnectorKey): ConnectorOauthProvider | undefined {
  if (connectorKey === 'github') return resolveGithubOauthProvider();
  if (connectorKey === 'notion') return resolveNotionOauthProvider();
  if (connectorKey === 'slack') return resolveSlackOauthProvider();
  return undefined;
}
