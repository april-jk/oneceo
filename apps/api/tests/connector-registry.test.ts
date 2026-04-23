import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  connectorRegistry,
  type ConnectorAccountMaterial,
} from '../src/services/connector-registry';
import { parseInternalConnectorRuntimeToken } from '../src/services/internal-mcp-auth-service';

const envBackup = {
  GITHUB_CONNECTOR_CLIENT_ID: process.env.GITHUB_CONNECTOR_CLIENT_ID,
  GITHUB_CONNECTOR_CLIENT_SECRET: process.env.GITHUB_CONNECTOR_CLIENT_SECRET,
  SLACK_MCP_REMOTE_URL: process.env.SLACK_MCP_REMOTE_URL,
  SLACK_MCP_REMOTE_HEADERS_JSON: process.env.SLACK_MCP_REMOTE_HEADERS_JSON,
  SLACK_CONNECTOR_CLIENT_ID: process.env.SLACK_CONNECTOR_CLIENT_ID,
  SLACK_CONNECTOR_CLIENT_SECRET: process.env.SLACK_CONNECTOR_CLIENT_SECRET,
  SLACK_CONNECTOR_REDIRECT_URI: process.env.SLACK_CONNECTOR_REDIRECT_URI,
  NOTION_MCP_REMOTE_URL: process.env.NOTION_MCP_REMOTE_URL,
  NOTION_MCP_REMOTE_HEADERS_JSON: process.env.NOTION_MCP_REMOTE_HEADERS_JSON,
  NOTION_CONNECTOR_CLIENT_ID: process.env.NOTION_CONNECTOR_CLIENT_ID,
  NOTION_CONNECTOR_CLIENT_SECRET: process.env.NOTION_CONNECTOR_CLIENT_SECRET,
  NOTION_CONNECTOR_REDIRECT_URI: process.env.NOTION_CONNECTOR_REDIRECT_URI,
  FRONTEND_URL: process.env.FRONTEND_URL,
  VERCEL_MCP_REMOTE_URL: process.env.VERCEL_MCP_REMOTE_URL,
  VERCEL_MCP_REMOTE_HEADERS_JSON: process.env.VERCEL_MCP_REMOTE_HEADERS_JSON,
  VERCEL_CONNECTOR_REDIRECT_URI: process.env.VERCEL_CONNECTOR_REDIRECT_URI,
  VERCEL_INTERNAL_MCP_URL: process.env.VERCEL_INTERNAL_MCP_URL,
  VERCEL_CONNECTOR_CLIENT_ID: process.env.VERCEL_CONNECTOR_CLIENT_ID,
  VERCEL_CONNECTOR_CLIENT_SECRET: process.env.VERCEL_CONNECTOR_CLIENT_SECRET,
  ONECEO_INTERNAL_TOKEN: process.env.ONECEO_INTERNAL_TOKEN,
  CONNECTOR_SECRET_KEY: process.env.CONNECTOR_SECRET_KEY,
  ONECEO_PROXY_ENABLED: process.env.ONECEO_PROXY_ENABLED,
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
};

beforeEach(() => {
  process.env.GITHUB_CONNECTOR_CLIENT_ID = 'github-client';
  process.env.GITHUB_CONNECTOR_CLIENT_SECRET = 'github-secret';
  process.env.SLACK_MCP_REMOTE_URL = 'https://slack-mcp.example.com';
  process.env.SLACK_MCP_REMOTE_HEADERS_JSON = '{"Authorization":"Bearer ${token}"}';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_CONNECTOR_REDIRECT_URI = '/slack/callback';
  process.env.NOTION_MCP_REMOTE_URL = 'https://notion-mcp.example.com/sse';
  process.env.NOTION_MCP_REMOTE_HEADERS_JSON = '{"Authorization":"Bearer ${token}"}';
  process.env.NOTION_CONNECTOR_CLIENT_ID = 'notion-client';
  process.env.NOTION_CONNECTOR_CLIENT_SECRET = 'notion-secret';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.NOTION_CONNECTOR_REDIRECT_URI = '/notion/callback';
  process.env.VERCEL_CONNECTOR_REDIRECT_URI = '/vercel/callback';
  process.env.VERCEL_INTERNAL_MCP_URL = 'https://dev.oneceo.ai/api/internal/connectors/vercel/mcp';
  process.env.VERCEL_CONNECTOR_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_CONNECTOR_CLIENT_SECRET = 'vercel-secret';
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-token';
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-secret';
  process.env.ONECEO_PROXY_ENABLED = 'true';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.NO_PROXY = 'localhost,127.0.0.1';
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

test('connector registry exposes built-in connectors with availability metadata', () => {
  const catalog = connectorRegistry.listCatalog();
  const notionProvider = connectorRegistry.getOauthProvider('notion');
  const slack = catalog.find((item) => item.key === 'slack');
  const notion = catalog.find((item) => item.key === 'notion');
  assert.equal(catalog.length, 7);
  assert.equal(connectorRegistry.listVisibleCatalog().length, 6);
  assert.equal(catalog.find((item) => item.key === 'github')?.oauth?.supported, true);
  assert.equal(slack?.available, true);
  assert.equal(slack?.authMode, 'oauth');
  assert.deepEqual(slack?.configFields, []);
  assert.equal(notion?.available, true);
  assert.equal(notion?.authMode, 'oauth');
  assert.deepEqual(notion?.configFields, []);
  assert.equal(notionProvider?.redirectUri, 'https://dev.oneceo.ai/notion/callback');
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
    account: buildAccount('slack', { accessToken: 'slack-token' }),
  });
  assert.equal(slackConfig.type, 'remote');
  assert.equal(slackConfig.transport, 'remote_sse');
  assert.equal(slackConfig.headers?.Authorization, 'Bearer slack-token');

  const notionConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'notion',
    account: buildAccount('notion', { accessToken: 'notion-token' }),
  });
  assert.equal(notionConfig.type, 'remote');
  assert.equal(notionConfig.transport, 'remote_sse');
  assert.equal(notionConfig.url, 'https://notion-mcp.example.com/sse');
  assert.equal(notionConfig.headers?.Authorization, 'Bearer notion-token');

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
  assert.equal(vercelConfig.type, 'remote');
  assert.equal(vercelConfig.transport, 'streamable_http');
  assert.equal(vercelConfig.url, 'https://dev.oneceo.ai/api/internal/connectors/vercel/mcp');
  assert.equal(vercelConfig.headers?.['x-oneceo-internal-token'], 'internal-token');
  assert.ok(vercelConfig.headers?.['x-oneceo-connector-runtime-auth']);
  const runtimeContext = parseInternalConnectorRuntimeToken(
    String(vercelConfig.headers?.['x-oneceo-connector-runtime-auth'] || ''),
    'vercel'
  );
  assert.equal(runtimeContext.taskSessionId, 'task-1');
  assert.equal(runtimeContext.userId, 'user-1');
  assert.equal(runtimeContext.profileId, 'vercel-profile');

  const supabaseConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'supabase',
    account: buildAccount('supabase', { accessToken: 'supabase-token' }),
  });
  assert.equal(supabaseConfig.type, 'local');
  assert.equal(supabaseConfig.command[0], 'node');
  assert.equal(supabaseConfig.command[1], '-e');
  assert.match(supabaseConfig.command[2], /SUPABASE_MCP_URL/);
  assert.equal(supabaseConfig.environment?.SUPABASE_ACCESS_TOKEN, 'supabase-token');
  assert.equal(supabaseConfig.environment?.SUPABASE_MCP_URL, 'https://mcp.supabase.com/mcp');
  assert.equal(supabaseConfig.environment?.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(supabaseConfig.environment?.NO_PROXY, 'localhost,127.0.0.1');
});

test('connector registry falls back to official slack mcp url when remote url env is missing', () => {
  delete process.env.SLACK_MCP_REMOTE_URL;
  const catalog = connectorRegistry.listCatalog();
  const slack = catalog.find((item) => item.key === 'slack');
  assert.equal(slack?.available, true);
  assert.equal(slack?.runtime.urlDefault, 'https://mcp.slack.com/mcp');

  const runtime = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'slack',
    account: buildAccount('slack', { accessToken: 'slack-token' }),
  });
  assert.equal(runtime.type, 'remote');
  assert.equal(new URL(runtime.url || '').origin, 'https://mcp.slack.com');
  assert.equal(runtime.transport, 'remote_sse');
});

test('slack catalog is unavailable when oauth client is missing', () => {
  delete process.env.SLACK_CONNECTOR_CLIENT_ID;
  const slack = connectorRegistry.listCatalog().find((item) => item.key === 'slack');
  assert.equal(slack?.available, false);
  assert.match(String(slack?.availabilityReason || ''), /Slack OAuth client/i);
});

test('notion catalog is unavailable when fixed redirect uri is missing', () => {
  delete process.env.NOTION_CONNECTOR_REDIRECT_URI;
  const notion = connectorRegistry.listCatalog().find((item) => item.key === 'notion');
  assert.equal(notion?.available, false);
  assert.match(String(notion?.availabilityReason || ''), /回调路径/);
});

test('notion catalog is unavailable when redirect path is set but frontend base url is missing', () => {
  delete process.env.FRONTEND_URL;
  process.env.NOTION_CONNECTOR_REDIRECT_URI = '/notion/callback';
  const notion = connectorRegistry.listCatalog().find((item) => item.key === 'notion');
  assert.equal(notion?.available, false);
  assert.match(String(notion?.availabilityReason || ''), /解析失败/);
});

test('notion catalog falls back to official sse endpoint when remote url env is missing', () => {
  delete process.env.NOTION_MCP_REMOTE_URL;

  const notion = connectorRegistry.listCatalog().find((item) => item.key === 'notion');
  assert.equal(notion?.available, true);
  assert.equal(notion?.runtime.urlDefault, 'https://mcp.notion.com/sse');

  const runtime = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'notion',
    account: buildAccount('notion', { accessToken: 'notion-token' }),
  });
  assert.equal(runtime.type, 'remote');
  assert.equal(runtime.transport, 'remote_sse');
  assert.equal(runtime.url, 'https://mcp.notion.com/sse');
});

test('notion catalog is unavailable when remote url is not an sse endpoint', () => {
  process.env.NOTION_MCP_REMOTE_URL = 'https://mcp.notion.com/mcp';

  const notion = connectorRegistry.listCatalog().find((item) => item.key === 'notion');
  assert.equal(notion?.available, false);
  assert.match(String(notion?.availabilityReason || ''), /SSE.*\/sse/);
});

test('connector registry resolves vercel internal mcp url from FRONTEND_URL when explicit url is missing', () => {
  delete process.env.VERCEL_INTERNAL_MCP_URL;
  const catalog = connectorRegistry.listCatalog();
  const vercel = catalog.find((item) => item.key === 'vercel');
  assert.equal(vercel?.available, true);
  assert.equal(vercel?.runtime.urlDefault, 'https://dev.oneceo.ai/api/internal/connectors/vercel/mcp');
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
  assert.equal(runtime.type, 'remote');
  assert.equal(runtime.transport, 'streamable_http');
  assert.equal(runtime.url, 'https://dev.oneceo.ai/api/internal/connectors/vercel/mcp');
});

test('vercel catalog is unavailable when internal token is missing', () => {
  delete process.env.ONECEO_INTERNAL_TOKEN;
  const vercel = connectorRegistry.listCatalog().find((item) => item.key === 'vercel');
  assert.equal(vercel?.available, false);
  assert.match(String(vercel?.availabilityReason || ''), /ONECEO_INTERNAL_TOKEN/);
});
