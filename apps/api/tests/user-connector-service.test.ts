import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { connectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';
import { connectorSecretService } from '../src/services/connector-secret-service';
import { connectorAuthRequestDAO, userConnectorProfileDAO } from '../src/db/dao';
import { userConnectorService } from '../src/services/user-connector-service';

const originalFetch = global.fetch;
const originalVercelClientId = process.env.VERCEL_CONNECTOR_CLIENT_ID;
const originalVercelClientSecret = process.env.VERCEL_CONNECTOR_CLIENT_SECRET;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
  if (originalVercelClientId === undefined) {
    delete process.env.VERCEL_CONNECTOR_CLIENT_ID;
  } else {
    process.env.VERCEL_CONNECTOR_CLIENT_ID = originalVercelClientId;
  }
  if (originalVercelClientSecret === undefined) {
    delete process.env.VERCEL_CONNECTOR_CLIENT_SECRET;
  } else {
    process.env.VERCEL_CONNECTOR_CLIENT_SECRET = originalVercelClientSecret;
  }
});

test('saveUserConnector validates GitHub token and persists resolved profile name', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'listByUserAndConnectorKey', async () => []);
  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return {
      ...input,
      id: 'profile-1',
      updatedAt: new Date('2026-03-09T00:00:00.000Z'),
      createdAt: new Date('2026-03-09T00:00:00.000Z'),
      profileName: input.profileName,
      isDefault: true,
    } as any;
  });
  global.fetch = mock.fn(async () =>
    new Response(JSON.stringify({ login: 'april-jk' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  ) as typeof fetch;

  const saved = await userConnectorService.saveUserConnector('user-1', 'github', {
    profileName: 'GitHub Main',
    credentials: {
      accessToken: 'ghp-valid-token',
    },
  });

  assert.equal(saved.authStatus, 'authorized');
  assert.equal(saved.displayName, 'april-jk');
  assert.equal(capturedCreate?.displayName, 'april-jk');
  assert.equal(
    connectorSecretService.decryptJson<{ accessToken?: string }>(
      String(capturedCreate?.secretCiphertext || '')
    )?.accessToken,
    'ghp-valid-token'
  );
});

test('saveUserConnector rejects invalid GitHub token before persisting', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'listByUserAndConnectorKey', async () => []);
  const createMock = mock.method(userConnectorProfileDAO, 'create', async () => {
    throw new Error('should not persist invalid github token');
  });
  global.fetch = mock.fn(async () =>
    new Response(JSON.stringify({ message: 'Bad credentials' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  ) as typeof fetch;

  await assert.rejects(
    () =>
      userConnectorService.saveUserConnector('user-1', 'github', {
        profileName: 'GitHub Main',
        credentials: {
          accessToken: 'ghp-invalid-token',
        },
      }),
    /Bad credentials/
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test('createProfile allows Supabase token-only save with empty profile/display names', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'listByUserAndConnectorKey', async () => []);
  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return {
      ...input,
      id: 'profile-supabase-1',
      connectorKey: 'supabase',
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      metadataJson: {},
      configJson: {},
      lastAuthAt: new Date('2026-04-03T00:00:00.000Z'),
      lastError: null,
      isDefault: true,
    } as any;
  });

  const saved = await userConnectorService.createProfile('user-1', 'supabase', {
    credentials: {
      accessToken: 'sbp-token-only',
    },
  });

  assert.equal(saved.profileName, 'Supabase Default');
  assert.equal(saved.displayName, null);
  assert.equal(saved.authStatus, 'authorized');
  assert.equal(capturedCreate?.profileName, 'Supabase Default');
  assert.equal(capturedCreate?.displayName, null);
  assert.equal(
    connectorSecretService.decryptJson<{ accessToken?: string }>(
      String(capturedCreate?.secretCiphertext || '')
    )?.accessToken,
    'sbp-token-only'
  );
});

test('startOAuthForProfile generates PKCE challenge for vercel oauth', async () => {
  process.env.VERCEL_CONNECTOR_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_CONNECTOR_CLIENT_SECRET = 'vercel-secret';

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
    redirectUri: 'http://oneceo.ai:3000/callback',
  });

  assert.ok(result.authUrl.startsWith('https://vercel.com/oauth/authorize?'));
  const authUrl = new URL(result.authUrl);
  assert.equal(authUrl.searchParams.get('client_id'), 'vercel-client');
  assert.equal(authUrl.searchParams.get('response_type'), 'code');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authUrl.searchParams.get('code_challenge'));
  assert.equal(String(capturedCreate?.provider || ''), 'vercel');
  assert.ok(String(capturedCreate?.codeVerifier || '').length > 20);
});

test('completeOAuthByProfile uses stored PKCE verifier for vercel oauth token exchange', async () => {
  process.env.VERCEL_CONNECTOR_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_CONNECTOR_CLIENT_SECRET = 'vercel-secret';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-vercel',
    userId: 'user-1',
    connectorKey: 'vercel',
    profileName: 'Vercel Default',
    displayName: null,
  }) as any);
  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-1',
    userId: 'user-1',
    connectorKey: 'vercel',
    profileId: 'profile-vercel',
    state: 'state-1',
    codeVerifier: 'pkce-verifier-123',
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
      configJson: {},
      metadataJson: {},
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  let fetchCount = 0;
  global.fetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      assert.equal(String(input), 'https://api.vercel.com/v2/oauth/access_token');
      assert.match(String(init?.body || ''), /code_verifier=pkce-verifier-123/);
      return new Response(
        JSON.stringify({
          access_token: 'vercel-access-token',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    assert.equal(String(input), 'https://api.vercel.com/www/user');
    return new Response(
      JSON.stringify({
        user: {
          username: 'vercel-user',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await userConnectorService.completeOAuthByProfile('user-1', 'profile-vercel', {
    state: 'state-1',
    code: 'auth-code-1',
    redirectUri: 'http://oneceo.ai:3000/callback',
  });

  assert.equal(result.profile.authStatus, 'authorized');
  assert.equal(result.profile.displayName, 'vercel-user');
  assert.equal(capturedUpdate?.profileName, 'vercel-user');
  assert.equal(
    connectorSecretService.decryptJson<{ accessToken?: string }>(
      String(capturedUpdate?.secretCiphertext || '')
    )?.accessToken,
    'vercel-access-token'
  );
});
