import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { connectorAuthRequestDAO, userConnectorProfileDAO } from '../src/db/dao';
import { connectorSecretService } from '../src/services/connector-secret-service';
import { connectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';
import { userConnectorService } from '../src/services/user-connector-service';

const originalFetch = global.fetch;
const envBackup = {
  CONNECTOR_SECRET_KEY: process.env.CONNECTOR_SECRET_KEY,
  FRONTEND_URL: process.env.FRONTEND_URL,
  VERCEL_CONNECTOR_CLIENT_ID: process.env.VERCEL_CONNECTOR_CLIENT_ID,
  VERCEL_CONNECTOR_CLIENT_SECRET: process.env.VERCEL_CONNECTOR_CLIENT_SECRET,
  VERCEL_CONNECTOR_REDIRECT_URI: process.env.VERCEL_CONNECTOR_REDIRECT_URI,
  VERCEL_CONNECTOR_MODE: process.env.VERCEL_CONNECTOR_MODE,
  VERCEL_INTEGRATION_SLUG: process.env.VERCEL_INTEGRATION_SLUG,
  VERCEL_INTEGRATION_CLIENT_ID: process.env.VERCEL_INTEGRATION_CLIENT_ID,
  VERCEL_INTEGRATION_CLIENT_SECRET: process.env.VERCEL_INTEGRATION_CLIENT_SECRET,
  VERCEL_INTEGRATION_REDIRECT_URI: process.env.VERCEL_INTEGRATION_REDIRECT_URI,
};

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('vercel integration oauth start uses install url without PKCE', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.VERCEL_CONNECTOR_MODE = 'integration';
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';
  process.env.VERCEL_CONNECTOR_REDIRECT_URI = '/vercel/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-vercel',
    userId: 'user-1',
    connectorKey: 'vercel',
    profileName: 'Vercel Default',
    authMode: 'oauth',
    authStatus: 'needs_auth',
  }) as any);

  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(connectorAuthRequestDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return input;
  });

  const result = await userConnectorService.startOAuthForProfile('user-1', 'profile-vercel', {
    redirectUri: 'https://unexpected.example.com/callback',
  });

  const authUrl = new URL(result.authUrl);
  assert.equal(authUrl.origin + authUrl.pathname, 'https://vercel.com/integrations/oneceo/new');
  assert.equal(authUrl.searchParams.get('state'), result.state);
  assert.equal(authUrl.searchParams.get('redirect_uri'), null);
  assert.equal(authUrl.searchParams.get('prompt'), null);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), null);
  assert.equal(capturedCreate?.state, result.state);
  assert.equal(capturedCreate?.codeVerifier, null);
});

test('vercel integration oauth callback stores installation token and team context', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.VERCEL_CONNECTOR_MODE = 'integration';
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';
  process.env.VERCEL_CONNECTOR_REDIRECT_URI = '/vercel/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-vercel',
    userId: 'user-1',
    connectorKey: 'vercel',
    profileName: 'Vercel Default',
    displayName: null,
    configJson: {},
    metadataJson: {},
  }) as any);
  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-1',
    userId: 'user-1',
    connectorKey: 'vercel',
    profileId: 'profile-vercel',
    state: 'state-1',
    codeVerifier: null,
    expiresAt: new Date(Date.now() + 60_000),
  }) as any);
  mock.method(connectorAuthRequestDAO, 'markCompleted', async () => ({}) as any);

  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-vercel',
      userId: 'user-1',
      connectorKey: 'vercel',
      profileName: input.profileName,
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: input.displayName,
      configJson: input.configJson,
      metadataJson: input.metadataJson,
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  let fetchCount = 0;
  global.fetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    fetchCount += 1;
    assert.equal(String(input), 'https://api.vercel.com/v2/oauth/access_token');
    assert.match(
      String(init?.body || ''),
      /redirect_uri=https%3A%2F%2Fdev.oneceo.ai%2Fvercel%2Fcallback/
    );
    assert.doesNotMatch(String(init?.body || ''), /code_verifier=/);
    return new Response(
      JSON.stringify({
        access_token: 'vercel-access-token',
        token_type: 'Bearer',
        team_id: 'team_vercel',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await userConnectorService.completeOAuthByProfile('user-1', 'profile-vercel', {
    state: 'state-1',
    code: 'auth-code-1',
    redirectUri: 'https://unexpected.example.com/callback',
    teamId: 'team_from_callback',
    configurationId: 'icfg_123',
    next: 'https://vercel.com/next',
    source: 'external',
  });

  assert.equal(result.profile.authStatus, 'authorized');
  assert.equal(result.profile.displayName, 'team_from_callback');
  assert.equal(capturedUpdate?.profileName, 'team_from_callback');
  const secret = connectorSecretService.decryptJson<{
    source?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
  }>(String(capturedUpdate?.secretCiphertext || ''));
  assert.equal(secret?.source, 'vercel_integration');
  assert.equal(secret?.accessToken, 'vercel-access-token');
  assert.equal(secret?.refreshToken, undefined);
  assert.equal(secret?.tokenType, 'Bearer');
  assert.equal((capturedUpdate?.configJson as any)?.teamId, 'team_from_callback');
  assert.equal((capturedUpdate?.configJson as any)?.configurationId, 'icfg_123');
  assert.equal((capturedUpdate?.configJson as any)?.vercelAuthMode, 'integration');
  assert.equal((capturedUpdate?.metadataJson as any)?.vercelIntegrationSlug, 'oneceo');
  assert.equal(fetchCount, 1);
});
