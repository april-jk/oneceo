import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  connectorRegistry,
  type ConnectorAccountMaterial,
} from '../src/services/connector-registry';

const envBackup = {
  GITHUB_CONNECTOR_CLIENT_ID: process.env.GITHUB_CONNECTOR_CLIENT_ID,
  GITHUB_CONNECTOR_CLIENT_SECRET: process.env.GITHUB_CONNECTOR_CLIENT_SECRET,
  NOTION_MCP_REMOTE_URL: process.env.NOTION_MCP_REMOTE_URL,
  NOTION_MCP_REMOTE_HEADERS_JSON: process.env.NOTION_MCP_REMOTE_HEADERS_JSON,
  NOTION_CONNECTOR_CLIENT_ID: process.env.NOTION_CONNECTOR_CLIENT_ID,
  NOTION_CONNECTOR_CLIENT_SECRET: process.env.NOTION_CONNECTOR_CLIENT_SECRET,
  NOTION_CONNECTOR_REDIRECT_URI: process.env.NOTION_CONNECTOR_REDIRECT_URI,
  FRONTEND_URL: process.env.FRONTEND_URL,
  ONECEO_API_PUBLIC_URL: process.env.ONECEO_API_PUBLIC_URL,
  VERCEL_MCP_REMOTE_HEADERS_JSON: process.env.VERCEL_MCP_REMOTE_HEADERS_JSON,
  VERCEL_INTEGRATION_SLUG: process.env.VERCEL_INTEGRATION_SLUG,
  VERCEL_INTEGRATION_CLIENT_ID: process.env.VERCEL_INTEGRATION_CLIENT_ID,
  VERCEL_INTEGRATION_CLIENT_SECRET: process.env.VERCEL_INTEGRATION_CLIENT_SECRET,
  VERCEL_INTEGRATION_REDIRECT_URI: process.env.VERCEL_INTEGRATION_REDIRECT_URI,
  ONECEO_INTERNAL_TOKEN: process.env.ONECEO_INTERNAL_TOKEN,
  CONNECTOR_SECRET_KEY: process.env.CONNECTOR_SECRET_KEY,
  ONECEO_PROXY_ENABLED: process.env.ONECEO_PROXY_ENABLED,
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
  COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
  COMPOSIO_SLACK_TOOLKITS: process.env.COMPOSIO_SLACK_TOOLKITS,
};

beforeEach(() => {
  process.env.GITHUB_CONNECTOR_CLIENT_ID = 'github-client';
  process.env.GITHUB_CONNECTOR_CLIENT_SECRET = 'github-secret';
  process.env.NOTION_MCP_REMOTE_URL = 'https://notion-mcp.example.com/sse';
  process.env.NOTION_MCP_REMOTE_HEADERS_JSON = '{"Authorization":"Bearer ${token}"}';
  process.env.NOTION_CONNECTOR_CLIENT_ID = 'notion-client';
  process.env.NOTION_CONNECTOR_CLIENT_SECRET = 'notion-secret';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.NOTION_CONNECTOR_REDIRECT_URI = '/notion/callback';
  delete process.env.ONECEO_API_PUBLIC_URL;
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  process.env.VERCEL_INTEGRATION_REDIRECT_URI = 'https://dev.oneceo.ai/vercel/callback';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-token';
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-secret';
  process.env.ONECEO_PROXY_ENABLED = 'true';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.NO_PROXY = 'localhost,127.0.0.1';
  process.env.COMPOSIO_API_KEY = 'composio-test-key';
  process.env.COMPOSIO_SLACK_TOOLKITS = 'slack';
});

afterEach(() => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function buildAccount(
  connectorKey: ConnectorAccountMaterial['connectorKey'],
  secret: ConnectorAccountMaterial['secret']
): ConnectorAccountMaterial {
  return {
    profileId: `${connectorKey}-profile`,
    connectorKey,
    authMode: connectorKey === 'postgres' ? 'dsn' : 'oauth',
    authStatus: 'authorized',
    configJson: {},
    secret,
  };
}

function buildComposioAccount(
  connectorKey: ConnectorAccountMaterial['connectorKey']
): ConnectorAccountMaterial {
  return {
    ...buildAccount(connectorKey, {
      source: 'composio',
      composioMcpUrl: 'https://composio.example.com/mcp',
      composioMcpHeaders: { 'x-api-key': 'test-composio-key' },
    }),
    metadataJson: { provider: 'composio' },
  };
}

test('connector registry exposes built-in connectors with availability metadata', () => {
  const catalog = connectorRegistry.listCatalog();
  const notionProvider = connectorRegistry.getOauthProvider('notion');
  const slackProvider = connectorRegistry.getOauthProvider('slack');
  const slack = catalog.find((item) => item.key === 'slack');
  const notion = catalog.find((item) => item.key === 'notion');
  assert.equal(catalog.length, 8);
  assert.equal(connectorRegistry.listVisibleCatalog().length, 7);
  assert.equal(catalog.find((item) => item.key === 'github')?.oauth?.supported, true);
  assert.equal(slack?.available, true);
  assert.equal(slack?.authMode, 'oauth');
  assert.deepEqual(slack?.configFields, []);
  assert.equal(slack?.oauth?.provider, 'composio');
  assert.equal(slackProvider, undefined);
  assert.equal(notion?.available, true);
  assert.equal(notion?.authMode, 'oauth');
  assert.deepEqual(notion?.configFields, []);
  assert.equal(notionProvider, undefined);
  assert.equal(catalog.find((item) => item.key === 'supabase')?.authMode, 'oauth');
  assert.deepEqual(catalog.find((item) => item.key === 'supabase')?.configFields, []);
  assert.equal(catalog.find((item) => item.key === 'vercel')?.available, true);
  assert.equal(catalog.find((item) => item.key === 'vercel')?.oauth?.supported, true);
  assert.equal(
    catalog.find((item) => item.key === 'vercel')?.configFields.find((field) => field.key === 'profileName')?.required,
    false
  );
  assert.equal(catalog.find((item) => item.key === 'postgres')?.visibleInMenu, false);
});

test('connector registry materializes local and remote MCP configs', () => {
  const githubConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'github',
    account: buildAccount('github', { accessToken: 'gh-token' }),
  });
  assert.equal(githubConfig.type, 'local');
  assert.equal(githubConfig.command[0], 'node');
  assert.equal(githubConfig.command[1], '-e');
  assert.match(githubConfig.command[2], /server-github/);
  assert.equal(githubConfig.environment?.GITHUB_PERSONAL_ACCESS_TOKEN, 'gh-token');

  const postgresConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'postgres',
    account: buildAccount('postgres', {
      dsn: 'postgresql://user:pass@db.example.com:5432/prod',
    }),
  });
  assert.equal(postgresConfig.type, 'local');
  assert.equal(postgresConfig.command[3], 'postgresql://user:pass@db.example.com:5432/prod');

  const slackConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'slack',
    account: buildComposioAccount('slack'),
  });
  assert.equal(slackConfig.type, 'hosted');
  assert.equal(slackConfig.provider, 'slack');

  const notionConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'notion',
    account: buildComposioAccount('notion'),
  });
  assert.equal(notionConfig.type, 'hosted');
  assert.equal(notionConfig.provider, 'notion');

  const vercelConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'vercel',
    account: {
      ...buildAccount('vercel', { accessToken: 'vercel-token' }),
      configJson: { teamId: 'team_123' },
    },
    runtimeContext: {
      taskSessionId: 'task-1',
      userId: 'user-1',
    },
  });
  assert.equal(vercelConfig.type, 'hosted');
  assert.equal(vercelConfig.provider, 'vercel');
  assert.deepEqual(vercelConfig.capabilities, ['initialize', 'tools/list', 'tools/call']);

  const supabaseConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'supabase',
    account: buildComposioAccount('supabase'),
  });
  assert.equal(supabaseConfig.type, 'hosted');
  assert.equal(supabaseConfig.provider, 'supabase');
});

test('connector registry materializes Slack as Composio hosted provider without remote url', () => {
  const catalog = connectorRegistry.listCatalog();
  const slack = catalog.find((item) => item.key === 'slack');
  assert.equal(slack?.available, true);
  assert.equal(slack?.runtime.urlDefault, undefined);
  assert.equal(slack?.runtime.headerTemplate, 'none');

  const runtime = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'slack',
    account: buildComposioAccount('slack'),
  });
  assert.equal(runtime.type, 'hosted');
  assert.equal(runtime.provider, 'slack');
});

test('slack catalog is unavailable when Composio API key is missing', () => {
  delete process.env.COMPOSIO_API_KEY;
  const slack = connectorRegistry.listCatalog().find((item) => item.key === 'slack');
  assert.equal(slack?.available, false);
  assert.match(String(slack?.availabilityReason || ''), /COMPOSIO_API_KEY/);
});

test('notion catalog is unavailable when Composio API key is missing', () => {
  delete process.env.COMPOSIO_API_KEY;
  const notion = connectorRegistry.listCatalog().find((item) => item.key === 'notion');
  assert.equal(notion?.available, false);
  assert.match(String(notion?.availabilityReason || ''), /COMPOSIO_API_KEY/);
});

test('supabase catalog is unavailable when Composio API key is missing', () => {
  delete process.env.COMPOSIO_API_KEY;
  const supabase = connectorRegistry.listCatalog().find((item) => item.key === 'supabase');
  assert.equal(supabase?.available, false);
  assert.match(String(supabase?.availabilityReason || ''), /COMPOSIO_API_KEY/);
});

test('connector registry materializes vercel as hosted provider without internal mcp url', () => {
  const catalog = connectorRegistry.listCatalog();
  const vercel = catalog.find((item) => item.key === 'vercel');
  assert.equal(vercel?.available, true);
  assert.equal(vercel?.runtime.urlDefault, undefined);
  assert.equal(vercel?.availabilityReason, undefined);

  const runtime = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'vercel',
    account: {
      ...buildAccount('vercel', { accessToken: 'vercel-token' }),
      configJson: { teamId: 'team_fallback' },
    },
    runtimeContext: {
      taskSessionId: 'task-fallback',
      userId: 'user-fallback',
    },
  });
  assert.equal(runtime.type, 'hosted');
  assert.equal(runtime.provider, 'vercel');
});

test('vercel catalog no longer depends on internal mcp token', () => {
  delete process.env.ONECEO_INTERNAL_TOKEN;
  const vercel = connectorRegistry.listCatalog().find((item) => item.key === 'vercel');
  assert.equal(vercel?.available, true);
  assert.equal(vercel?.availabilityReason, undefined);
});
