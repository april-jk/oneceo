import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { connectorRegistry } from '../src/services/connector-registry';
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
  CONNECTOR_SECRET_KEY: process.env.CONNECTOR_SECRET_KEY,
  FRONTEND_URL: process.env.FRONTEND_URL,
  COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
  VERCEL_INTEGRATION_CLIENT_ID: process.env.VERCEL_INTEGRATION_CLIENT_ID,
  VERCEL_INTEGRATION_CLIENT_SECRET: process.env.VERCEL_INTEGRATION_CLIENT_SECRET,
  VERCEL_INTEGRATION_REDIRECT_URI: process.env.VERCEL_INTEGRATION_REDIRECT_URI,
  VERCEL_INTEGRATION_SLUG: process.env.VERCEL_INTEGRATION_SLUG,
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

function buildProfile(connectorKey: 'github' | 'supabase' | 'vercel' | 'notion' | 'slack' | 'figma') {
  const isComposioConnector =
    connectorKey === 'github' ||
    connectorKey === 'figma' ||
    connectorKey === 'notion' ||
    connectorKey === 'slack' ||
    connectorKey === 'supabase';
  return {
    profileId: `profile-${connectorKey}`,
    connectorKey,
    profileName: `${connectorKey}-profile`,
    authMode: 'token',
    authStatus: 'authorized',
    configJson: {},
    metadataJson: isComposioConnector
      ? {
          provider: 'composio',
        }
      : {},
    secret: {
      ...(isComposioConnector
        ? {
            source: 'composio',
            composioMcpUrl: 'https://composio.example.com/mcp',
            composioMcpHeaders: { 'x-api-key': 'test-composio-key' },
          }
        : {
            accessToken: `${connectorKey}-token`,
          }),
    },
  } as any;
}

test('buildProviderTransport materializes Supabase Composio as API-brokered MCP transport', () => {
  process.env.COMPOSIO_API_KEY = 'composio-test-key';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('supabase', buildProfile('supabase'), null, {
    taskSessionId: 'task-supabase',
    userId: 'user-supabase',
  });

  assert.equal(result.transport.type, 'backend_rpc');
  assert.equal(result.transport.rpcNamespace, 'mcp');
  assert.equal(result.transport.backendProvider, 'supabase');
  assert.deepEqual(result.transport.capabilities, ['initialize', 'tools/list', 'tools/call']);
  assert.equal(result.transportName, 'api_brokered_mcp');
});

test('buildProviderTransport materializes GitHub Composio as API-brokered MCP transport', () => {
  process.env.COMPOSIO_API_KEY = 'composio-test-key';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('github', buildProfile('github'), null, {
    taskSessionId: 'task-github',
    userId: 'user-github',
  });

  assert.equal(result.transport.type, 'backend_rpc');
  assert.equal(result.transport.rpcNamespace, 'mcp');
  assert.equal(result.transport.backendProvider, 'github');
  assert.deepEqual(result.transport.capabilities, ['initialize', 'tools/list', 'tools/call']);
  assert.equal(result.transportName, 'api_brokered_mcp');
});

test('buildProviderTransport materializes vercel as backend rpc transport', () => {
  process.env.ONECEO_PROXY_ENABLED = 'true';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.NO_PROXY = 'localhost,127.0.0.1';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';
  process.env.VERCEL_INTEGRATION_REDIRECT_URI = 'https://dev.oneceo.ai/vercel/callback';
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-secret';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('vercel', buildProfile('vercel'), null, {
    taskSessionId: 'task-1',
    userId: 'user-1',
  });

  assert.equal(result.transport.type, 'backend_rpc');
  assert.equal(result.transport.rpcNamespace, 'mcp');
  assert.equal(result.transport.backendProvider, 'vercel');
  assert.deepEqual(result.transport.capabilities, ['initialize', 'tools/list', 'tools/call']);
  assert.equal(result.transportName, 'backend_rpc');
});

test('buildProviderTransport materializes Figma Composio as API-brokered MCP transport', () => {
  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('figma', buildProfile('figma'), null, {
    taskSessionId: 'task-figma',
    userId: 'user-figma',
  });

  assert.equal(result.transport.type, 'backend_rpc');
  assert.equal(result.transport.rpcNamespace, 'mcp');
  assert.equal(result.transport.backendProvider, 'figma');
  assert.deepEqual(result.transport.capabilities, ['initialize', 'tools/list', 'tools/call']);
  assert.equal(result.transportName, 'api_brokered_mcp');
});

test('buildProviderTransport materializes Slack Composio as API-brokered MCP transport', () => {
  process.env.COMPOSIO_API_KEY = 'composio-test-key';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('slack', buildProfile('slack'), null, {
    taskSessionId: 'task-slack',
    userId: 'user-slack',
  });

  assert.equal(result.transport.type, 'backend_rpc');
  assert.equal(result.transport.rpcNamespace, 'mcp');
  assert.equal(result.transport.backendProvider, 'slack');
  assert.deepEqual(result.transport.capabilities, ['initialize', 'tools/list', 'tools/call']);
  assert.equal(result.transportName, 'api_brokered_mcp');
});

test('buildProviderTransport materializes Notion Composio as API-brokered MCP transport', () => {
  process.env.COMPOSIO_API_KEY = 'composio-test-key';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('notion', buildProfile('notion'), null, {
    taskSessionId: 'task-notion',
    userId: 'user-notion',
  });

  assert.equal(result.transport.type, 'backend_rpc');
  assert.equal(result.transport.rpcNamespace, 'mcp');
  assert.equal(result.transport.backendProvider, 'notion');
  assert.deepEqual(result.transport.capabilities, ['initialize', 'tools/list', 'tools/call']);
  assert.equal(result.transportName, 'api_brokered_mcp');
});

test('buildProviderTransport maps streamable_http connector config to OSAC http_stream transport', () => {
  const originalMaterialize = connectorRegistry.materializeRuntimeConfig.bind(connectorRegistry);
  (connectorRegistry as any).materializeRuntimeConfig = () => ({
    type: 'remote',
    enabled: true,
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer test-token' },
    transport: 'streamable_http',
  });

  try {
    const serviceAny = sessionConnectorService as any;
    const result = serviceAny.buildProviderTransport('notion', buildProfile('notion'), null);

    assert.equal(result.transport.type, 'http_stream');
    assert.equal(result.transportName, 'http_stream');
    assert.equal(result.transport.url, 'https://mcp.example.com/mcp');
    assert.equal(result.transport.headers.Authorization, 'Bearer test-token');
  } finally {
    (connectorRegistry as any).materializeRuntimeConfig = originalMaterialize;
  }
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
