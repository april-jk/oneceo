import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { sessionConnectorService } from '../src/services/session-connector-service';

const envBackup = {
  ONECEO_PROXY_ENABLED: process.env.ONECEO_PROXY_ENABLED,
  E2B_PROXY_ENABLED: process.env.E2B_PROXY_ENABLED,
  HTTP_PROXY: process.env.HTTP_PROXY,
  http_proxy: process.env.http_proxy,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  NO_PROXY: process.env.NO_PROXY,
  no_proxy: process.env.no_proxy,
  NOTION_MCP_REMOTE_URL: process.env.NOTION_MCP_REMOTE_URL,
  NOTION_CONNECTOR_CLIENT_ID: process.env.NOTION_CONNECTOR_CLIENT_ID,
  NOTION_CONNECTOR_CLIENT_SECRET: process.env.NOTION_CONNECTOR_CLIENT_SECRET,
  NOTION_CONNECTOR_REDIRECT_URI: process.env.NOTION_CONNECTOR_REDIRECT_URI,
  FRONTEND_URL: process.env.FRONTEND_URL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function buildProfile(connectorKey: 'supabase' | 'vercel' | 'notion') {
  return {
    profileId: `profile-${connectorKey}`,
    connectorKey,
    profileName: `${connectorKey}-profile`,
    authMode: 'token',
    authStatus: 'authorized',
    configJson: {},
    metadataJson: {},
    secret: {
      accessToken: `${connectorKey}-token`,
    },
  } as any;
}

test('buildProviderTransport injects proxy env for supabase local bridge transport', () => {
  process.env.ONECEO_PROXY_ENABLED = 'true';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.NO_PROXY = 'localhost,127.0.0.1';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('supabase', buildProfile('supabase'), null);

  assert.equal(result.transport.type, 'local_stdio');
  assert.equal(result.transport.command[0], 'node');
  assert.equal(result.transport.command[1], '-e');
  assert.match(result.transport.command[2], /SUPABASE_MCP_URL/);
  assert.equal(result.transport.env.SUPABASE_ACCESS_TOKEN, 'supabase-token');
  assert.equal(result.transport.env.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(result.transport.env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(result.transport.env.NO_PROXY, 'localhost,127.0.0.1');
  assert.equal(result.transport.env.http_proxy, 'http://127.0.0.1:7890');
  assert.equal(result.transport.env.https_proxy, 'http://127.0.0.1:7890');
  assert.equal(result.transport.env.no_proxy, 'localhost,127.0.0.1');
});

test('buildProviderTransport keeps non-supabase remote transport unchanged', () => {
  process.env.ONECEO_PROXY_ENABLED = 'true';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('vercel', buildProfile('vercel'), null);

  assert.equal(result.transport.type, 'remote_sse');
  assert.deepEqual(result.transport.env, {});
});

test('buildProviderTransport honors explicit notion remote transport', () => {
  process.env.NOTION_MCP_REMOTE_URL = 'https://mcp.notion.com/sse';
  process.env.NOTION_CONNECTOR_CLIENT_ID = 'notion-client';
  process.env.NOTION_CONNECTOR_CLIENT_SECRET = 'notion-secret';
  process.env.NOTION_CONNECTOR_REDIRECT_URI = '/api/connectors/notion/callback';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('notion', buildProfile('notion'), null);

  assert.equal(result.transport.type, 'remote_sse');
  assert.equal(result.transportName, 'remote_sse');
  assert.equal(result.transport.url, 'https://mcp.notion.com/sse');
  assert.deepEqual(result.transport.env, {});
  assert.equal(result.transport.headers.Authorization, 'Bearer notion-token');
});

test('buildAttachFailureRuntimePatch clears live runtime projection for failed attach states', () => {
  const serviceAny = sessionConnectorService as any;
  const patch = serviceAny.buildAttachFailureRuntimePatch({
    runtimeStatus: 'failed',
    runtimeEnvVersion: 3,
    runtimeTransport: 'remote_sse',
    lastError: 'provider attach failed',
  });

  assert.equal(patch.runtimeStatus, 'failed');
  assert.equal(patch.runtimeProviderId, null);
  assert.deepEqual(patch.runtimeAttachedToolsJson, []);
  assert.equal(patch.runtimeEnvVersion, 3);
  assert.equal(patch.runtimeTransport, 'remote_sse');
  assert.equal(patch.recoveryQueuedAt, null);
  assert.equal(patch.recoveryCompletedAt, null);
  assert.equal(patch.lastError, 'provider attach failed');
});
