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

function buildProfile(connectorKey: 'supabase' | 'vercel') {
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

test('buildProviderTransport injects proxy env for supabase remote transport', () => {
  process.env.ONECEO_PROXY_ENABLED = 'true';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
  process.env.NO_PROXY = 'localhost,127.0.0.1';

  const serviceAny = sessionConnectorService as any;
  const result = serviceAny.buildProviderTransport('supabase', buildProfile('supabase'), null);

  assert.equal(result.transport.type, 'remote_sse');
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
