import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  connectorRegistry,
  type ConnectorAccountMaterial,
} from '../src/services/connector-registry';

const envBackup = {
  FRONTEND_URL: process.env.FRONTEND_URL,
  ONECEO_API_PUBLIC_URL: process.env.ONECEO_API_PUBLIC_URL,
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
  COMPOSIO_GITHUB_TOOLKITS: process.env.COMPOSIO_GITHUB_TOOLKITS,
  COMPOSIO_GOOGLE_SUPER_TOOLKITS: process.env.COMPOSIO_GOOGLE_SUPER_TOOLKITS,
  COMPOSIO_SLACK_TOOLKITS: process.env.COMPOSIO_SLACK_TOOLKITS,
  ONECEO_CUSTOM_API_ENABLED: process.env.ONECEO_CUSTOM_API_ENABLED,
};

beforeEach(() => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
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
  process.env.COMPOSIO_GITHUB_TOOLKITS = 'github';
  process.env.COMPOSIO_GOOGLE_SUPER_TOOLKITS = 'googlesuper';
  process.env.COMPOSIO_SLACK_TOOLKITS = 'slack';
  delete process.env.ONECEO_CUSTOM_API_ENABLED;
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
  const githubProvider = connectorRegistry.getOauthProvider('github');
  const github = catalog.find((item) => item.key === 'github');
  const slack = catalog.find((item) => item.key === 'slack');
  const notion = catalog.find((item) => item.key === 'notion');
  const customApi = catalog.find((item) => item.key === 'custom_api');
  const googleSuper = catalog.find((item) => item.key === 'google_super');
  assert.equal(catalog.length, 10);
  assert.equal(connectorRegistry.listVisibleCatalog().length, 8);
  assert.equal(github?.available, true);
  assert.equal(github?.authMode, 'oauth');
  assert.deepEqual(github?.configFields, []);
  assert.equal(github?.oauth?.provider, 'composio');
  assert.equal(githubProvider, undefined);
  assert.equal(slack?.available, true);
  assert.equal(slack?.authMode, 'oauth');
  assert.deepEqual(slack?.configFields, []);
  assert.equal(slack?.oauth?.provider, 'composio');
  assert.equal(slackProvider, undefined);
  assert.equal(notion?.available, true);
  assert.equal(notion?.authMode, 'oauth');
  assert.deepEqual(notion?.configFields, []);
  assert.equal(notionProvider, undefined);
  assert.equal(googleSuper?.available, true);
  assert.equal(googleSuper?.authMode, 'oauth');
  assert.deepEqual(googleSuper?.configFields, []);
  assert.equal(googleSuper?.oauth?.provider, 'composio');
  assert.deepEqual(googleSuper?.composio?.toolkitSlugs, ['googlesuper']);
  assert.equal(catalog.find((item) => item.key === 'supabase')?.authMode, 'oauth');
  assert.deepEqual(catalog.find((item) => item.key === 'supabase')?.configFields, []);
  assert.equal(catalog.find((item) => item.key === 'vercel')?.available, true);
  assert.equal(catalog.find((item) => item.key === 'vercel')?.oauth?.supported, true);
  assert.equal(
    catalog.find((item) => item.key === 'vercel')?.configFields.find((field) => field.key === 'profileName')?.required,
    false
  );
  assert.equal(catalog.find((item) => item.key === 'postgres')?.visibleInMenu, false);
  assert.equal(customApi?.visibleInMenu, false);
  assert.equal(customApi?.available, false);
  assert.match(String(customApi?.availabilityReason || ''), /ONECEO_CUSTOM_API_ENABLED/);
});

test('connector registry materializes current MCP connector runtimes', () => {
  const githubConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'github',
    account: buildComposioAccount('github'),
  });
  assert.equal(githubConfig.type, 'hosted');
  assert.equal(githubConfig.provider, 'github');

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

  const googleSuperConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'google_super',
    account: buildComposioAccount('google_super'),
  });
  assert.equal(googleSuperConfig.type, 'hosted');
  assert.equal(googleSuperConfig.provider, 'google_super');

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

test('custom api is hidden and cannot materialize while feature flag is disabled', () => {
  const visibleKeys = connectorRegistry.listVisibleCatalog().map((item) => item.key);
  assert.equal(visibleKeys.includes('custom_api'), false);

  assert.throws(
    () =>
      connectorRegistry.materializeRuntimeConfig({
        connectorKey: 'custom_api',
        account: {
          profileId: 'custom-api-profile',
          connectorKey: 'custom_api',
          authMode: 'token',
          authStatus: 'authorized',
          configJson: {},
          secret: { accessToken: 'secret-token' },
        },
      }),
    /custom_api_disabled/
  );
});

test('custom api can only materialize when explicitly enabled', () => {
  process.env.ONECEO_CUSTOM_API_ENABLED = 'true';

  const customApi = connectorRegistry.listCatalog().find((item) => item.key === 'custom_api');
  assert.equal(customApi?.visibleInMenu, false);
  assert.equal(customApi?.available, true);

  const runtime = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'custom_api',
    account: {
      profileId: 'custom-api-profile',
      connectorKey: 'custom_api',
      authMode: 'token',
      authStatus: 'authorized',
      configJson: {},
      secret: { accessToken: 'secret-token' },
    },
  });
  assert.equal(runtime.type, 'hosted');
  assert.equal(runtime.provider, 'custom_api');
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

test('github catalog is unavailable when Composio API key is missing', () => {
  delete process.env.COMPOSIO_API_KEY;
  const github = connectorRegistry.listCatalog().find((item) => item.key === 'github');
  assert.equal(github?.available, false);
  assert.match(String(github?.availabilityReason || ''), /COMPOSIO_API_KEY/);
});

test('google super catalog is unavailable when Composio API key is missing', () => {
  delete process.env.COMPOSIO_API_KEY;
  const googleSuper = connectorRegistry.listCatalog().find((item) => item.key === 'google_super');
  assert.equal(googleSuper?.available, false);
  assert.match(String(googleSuper?.availabilityReason || ''), /COMPOSIO_API_KEY/);
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
