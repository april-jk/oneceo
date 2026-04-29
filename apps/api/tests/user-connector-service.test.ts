import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { connectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';
import { connectorSecretService } from '../src/services/connector-secret-service';
import { connectorAuthRequestDAO, userConnectorProfileDAO } from '../src/db/dao';
import { connectorRedisCacheService } from '../src/services/connector-redis-cache-service';
import { userConnectorService } from '../src/services/user-connector-service';

const originalFetch = global.fetch;
const originalConnectorSecretKey = process.env.CONNECTOR_SECRET_KEY;
const originalVercelClientId = process.env.VERCEL_INTEGRATION_CLIENT_ID;
const originalVercelClientSecret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
const originalVercelRedirectUri = process.env.VERCEL_INTEGRATION_REDIRECT_URI;
const originalNotionClientId = process.env.NOTION_CONNECTOR_CLIENT_ID;
const originalNotionClientSecret = process.env.NOTION_CONNECTOR_CLIENT_SECRET;
const originalNotionRedirectUri = process.env.NOTION_CONNECTOR_REDIRECT_URI;
const originalSlackClientId = process.env.SLACK_CONNECTOR_CLIENT_ID;
const originalSlackClientSecret = process.env.SLACK_CONNECTOR_CLIENT_SECRET;
const originalSlackRedirectUri = process.env.SLACK_CONNECTOR_REDIRECT_URI;
const originalSlackUserScopes = process.env.SLACK_CONNECTOR_USER_SCOPES;
const originalSlackAuthorizeUrl = process.env.SLACK_CONNECTOR_AUTHORIZE_URL;
const originalSlackTokenUrl = process.env.SLACK_CONNECTOR_TOKEN_URL;
const originalSupabaseSecretKey = process.env.SUPABASE_CONNECTOR_SECRET_KEY;
const originalComposioApiKey = process.env.COMPOSIO_API_KEY;
const originalComposioFigmaToolkits = process.env.COMPOSIO_FIGMA_TOOLKITS;
const originalFrontendUrl = process.env.FRONTEND_URL;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
  if (originalConnectorSecretKey === undefined) {
    delete process.env.CONNECTOR_SECRET_KEY;
  } else {
    process.env.CONNECTOR_SECRET_KEY = originalConnectorSecretKey;
  }
  if (originalVercelClientId === undefined) {
    delete process.env.VERCEL_INTEGRATION_CLIENT_ID;
  } else {
    process.env.VERCEL_INTEGRATION_CLIENT_ID = originalVercelClientId;
  }
  if (originalVercelClientSecret === undefined) {
    delete process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
  } else {
    process.env.VERCEL_INTEGRATION_CLIENT_SECRET = originalVercelClientSecret;
  }
  if (originalVercelRedirectUri === undefined) {
    delete process.env.VERCEL_INTEGRATION_REDIRECT_URI;
  } else {
    process.env.VERCEL_INTEGRATION_REDIRECT_URI = originalVercelRedirectUri;
  }
  if (originalNotionClientId === undefined) {
    delete process.env.NOTION_CONNECTOR_CLIENT_ID;
  } else {
    process.env.NOTION_CONNECTOR_CLIENT_ID = originalNotionClientId;
  }
  if (originalNotionClientSecret === undefined) {
    delete process.env.NOTION_CONNECTOR_CLIENT_SECRET;
  } else {
    process.env.NOTION_CONNECTOR_CLIENT_SECRET = originalNotionClientSecret;
  }
  if (originalNotionRedirectUri === undefined) {
    delete process.env.NOTION_CONNECTOR_REDIRECT_URI;
  } else {
    process.env.NOTION_CONNECTOR_REDIRECT_URI = originalNotionRedirectUri;
  }
  if (originalSlackClientId === undefined) {
    delete process.env.SLACK_CONNECTOR_CLIENT_ID;
  } else {
    process.env.SLACK_CONNECTOR_CLIENT_ID = originalSlackClientId;
  }
  if (originalSlackClientSecret === undefined) {
    delete process.env.SLACK_CONNECTOR_CLIENT_SECRET;
  } else {
    process.env.SLACK_CONNECTOR_CLIENT_SECRET = originalSlackClientSecret;
  }
  if (originalSlackRedirectUri === undefined) {
    delete process.env.SLACK_CONNECTOR_REDIRECT_URI;
  } else {
    process.env.SLACK_CONNECTOR_REDIRECT_URI = originalSlackRedirectUri;
  }
  if (originalSlackUserScopes === undefined) {
    delete process.env.SLACK_CONNECTOR_USER_SCOPES;
  } else {
    process.env.SLACK_CONNECTOR_USER_SCOPES = originalSlackUserScopes;
  }
  if (originalSlackAuthorizeUrl === undefined) {
    delete process.env.SLACK_CONNECTOR_AUTHORIZE_URL;
  } else {
    process.env.SLACK_CONNECTOR_AUTHORIZE_URL = originalSlackAuthorizeUrl;
  }
  if (originalSlackTokenUrl === undefined) {
    delete process.env.SLACK_CONNECTOR_TOKEN_URL;
  } else {
    process.env.SLACK_CONNECTOR_TOKEN_URL = originalSlackTokenUrl;
  }
  if (originalSupabaseSecretKey === undefined) {
    delete process.env.SUPABASE_CONNECTOR_SECRET_KEY;
  } else {
    process.env.SUPABASE_CONNECTOR_SECRET_KEY = originalSupabaseSecretKey;
  }
  if (originalComposioApiKey === undefined) {
    delete process.env.COMPOSIO_API_KEY;
  } else {
    process.env.COMPOSIO_API_KEY = originalComposioApiKey;
  }
  if (originalComposioFigmaToolkits === undefined) {
    delete process.env.COMPOSIO_FIGMA_TOOLKITS;
  } else {
    process.env.COMPOSIO_FIGMA_TOOLKITS = originalComposioFigmaToolkits;
  }
  if (originalFrontendUrl === undefined) {
    delete process.env.FRONTEND_URL;
  } else {
    process.env.FRONTEND_URL = originalFrontendUrl;
  }
});

function encodeStatePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

test('saveUserConnector validates GitHub token and persists resolved profile name', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
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
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.SUPABASE_CONNECTOR_SECRET_KEY = 'unit-test-supabase-secret';
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
      String(capturedCreate?.secretCiphertext || ''),
      'supabase'
    )?.accessToken,
    'sbp-token-only'
  );
});

test('createProfile does not authorize Figma from a user-supplied access token', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';
  process.env.COMPOSIO_FIGMA_TOOLKITS = 'figma';
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'listByUserAndConnectorKey', async () => []);
  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return {
      ...input,
      id: 'profile-figma-1',
      connectorKey: 'figma',
      updatedAt: new Date('2026-04-29T00:00:00.000Z'),
      createdAt: new Date('2026-04-29T00:00:00.000Z'),
      metadataJson: {},
      configJson: {},
      lastAuthAt: null,
      lastError: null,
      isDefault: true,
    } as any;
  });

  const saved = await userConnectorService.createProfile('user-1', 'figma', {
    profileName: 'Figma Token Attempt',
    credentials: {
      accessToken: 'figd_should_not_authorize',
    },
  });

  assert.equal(saved.authStatus, 'needs_auth');
  assert.equal(capturedCreate?.authMode, 'oauth');
  assert.equal(capturedCreate?.secretCiphertext, null);
  assert.equal(capturedCreate?.lastAuthAt, null);
});

test('startOAuthForProfile starts vercel integration install without PKCE', async () => {
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';
  process.env.VERCEL_INTEGRATION_REDIRECT_URI = 'https://dev.oneceo.ai/vercel/callback';

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

  assert.ok(result.authUrl.startsWith('https://vercel.com/integrations/oneceo/new?'));
  const authUrl = new URL(result.authUrl);
  assert.equal(authUrl.searchParams.get('state'), result.state);
  assert.equal(authUrl.searchParams.get('client_id'), null);
  assert.equal(authUrl.searchParams.get('redirect_uri'), null);
  assert.equal(authUrl.searchParams.get('response_type'), null);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), null);
  assert.equal(String(capturedCreate?.provider || ''), 'vercel');
  assert.equal(capturedCreate?.codeVerifier, null);
});

test('completeOAuthByProfile stores vercel integration installation context', async () => {
  process.env.VERCEL_INTEGRATION_SLUG = 'oneceo';
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';
  process.env.VERCEL_INTEGRATION_REDIRECT_URI = 'https://dev.oneceo.ai/vercel/callback';

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
    assert.equal(String(input), 'https://api.vercel.com/v2/oauth/access_token');
    assert.doesNotMatch(String(init?.body || ''), /code_verifier=/);
    assert.match(String(init?.body || ''), /code=auth-code-1/);
    assert.match(
      String(init?.body || ''),
      /redirect_uri=https%3A%2F%2Fdev.oneceo.ai%2Fvercel%2Fcallback/
    );
    return new Response(
      JSON.stringify({
        access_token: 'vercel-access-token',
        token_type: 'Bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await userConnectorService.completeOAuthByProfile('user-1', 'profile-vercel', {
    state: 'state-1',
    code: 'auth-code-1',
    redirectUri: 'http://oneceo.ai:3000/callback',
    teamId: 'team_123',
    configurationId: 'icfg_123',
    source: 'marketplace',
    next: '/dashboard',
  });

  assert.equal(result.profile.authStatus, 'authorized');
  assert.equal(result.profile.displayName, 'team_123');
  assert.equal(capturedUpdate?.profileName, 'team_123');
  assert.equal(fetchCount, 1);
  assert.deepEqual(capturedUpdate?.configJson, {
    vercelAuthMode: 'integration',
    teamId: 'team_123',
    configurationId: 'icfg_123',
    installationSource: 'marketplace',
  });
  assert.equal((capturedUpdate?.metadataJson as any)?.vercelIntegrationSlug, 'oneceo');
  assert.equal((capturedUpdate?.metadataJson as any)?.next, '/dashboard');
  assert.equal(
    connectorSecretService.decryptJson<{ accessToken?: string }>(
      String(capturedUpdate?.secretCiphertext || '')
    )?.accessToken,
    'vercel-access-token'
  );
  assert.equal(
    connectorSecretService.decryptJson<{ source?: string }>(
      String(capturedUpdate?.secretCiphertext || '')
    )?.source,
    'vercel_integration'
  );
});

test('clearProfileAuth clears local vercel integration auth without remote revoke', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.VERCEL_INTEGRATION_CLIENT_ID = 'vercel-client';
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = 'vercel-secret';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-vercel',
    userId: 'user-1',
    connectorKey: 'vercel',
    profileName: 'Vercel Default',
    authMode: 'oauth',
    authStatus: 'authorized',
    secretCiphertext: connectorSecretService.encrypt({ accessToken: 'vercel-access-token' }, 'vercel'),
  }) as any);

  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-vercel',
      userId: 'user-1',
      connectorKey: 'vercel',
      profileName: 'Vercel Default',
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: null,
      configJson: {},
      metadataJson: {},
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  const fetchMock = mock.fn(async () => {
    throw new Error('Vercel Integration disconnect should not call remote revoke');
  });
  global.fetch = fetchMock as typeof fetch;

  const result = await userConnectorService.clearProfileAuth('user-1', 'profile-vercel');

  assert.equal(result.remoteGrantRevoked, true);
  assert.equal(result.remoteGrantError, null);
  assert.equal(result.profile.authStatus, 'not_configured');
  assert.equal(capturedUpdate?.secretCiphertext, null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('getMeSnapshot returns redis payload when cache hit', async () => {
  mock.method(connectorRedisCacheService, 'isEnabled', () => true);
  mock.method(connectorRedisCacheService, 'getMe', async () => ({
    catalog: [{ key: 'github', name: 'GitHub' }],
    profiles: [{ profileId: 'profile-1', connectorKey: 'github' }],
    cachedAt: new Date().toISOString(),
  }));
  const listCatalogMock = mock.method(userConnectorService as any, 'listCatalog', async () => {
    throw new Error('listCatalog should not be called on redis hit');
  });
  const listProfilesMock = mock.method(userConnectorService as any, 'listUserProfiles', async () => {
    throw new Error('listUserProfiles should not be called on redis hit');
  });

  const snapshot = await userConnectorService.getMeSnapshot('user-cache-hit');

  assert.equal(snapshot.catalog.length, 1);
  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.cache.hit, true);
  assert.equal(snapshot.cache.source, 'redis');
  assert.equal(listCatalogMock.mock.callCount(), 0);
  assert.equal(listProfilesMock.mock.callCount(), 0);
});

test('getMeSnapshot falls back to db when redis is disabled', async () => {
  mock.method(connectorRedisCacheService, 'isEnabled', () => false);
  const getMeMock = mock.method(connectorRedisCacheService, 'getMe', async () => ({
    catalog: [{ key: 'github' }],
    profiles: [{ profileId: 'should-not-be-used' }],
    cachedAt: new Date().toISOString(),
  }));
  mock.method(userConnectorService as any, 'listCatalog', async () => [{ key: 'supabase' }]);
  mock.method(userConnectorService as any, 'listUserProfiles', async () => [{ profileId: 'profile-db-only' }]);

  const snapshot = await userConnectorService.getMeSnapshot('user-redis-disabled');

  assert.equal(snapshot.cache.hit, false);
  assert.equal(snapshot.cache.source, 'db');
  assert.equal(snapshot.cache.redisEnabled, false);
  assert.equal(snapshot.profiles[0]?.profileId, 'profile-db-only');
  assert.equal(getMeMock.mock.callCount(), 0);
});

test('getMeSnapshot loads from db on miss and writes redis cache', async () => {
  mock.method(connectorRedisCacheService, 'isEnabled', () => true);
  mock.method(connectorRedisCacheService, 'getMe', async () => null);
  let setMePayload: Record<string, unknown> | null = null;
  mock.method(connectorRedisCacheService, 'setMe', async (_userId: string, payload: any) => {
    setMePayload = payload;
  });
  mock.method(userConnectorService as any, 'listCatalog', async () => [{ key: 'supabase' }]);
  mock.method(userConnectorService as any, 'listUserProfiles', async () => [{ profileId: 'profile-db' }]);

  const snapshot = await userConnectorService.getMeSnapshot('user-cache-miss');

  assert.equal(snapshot.cache.hit, false);
  assert.equal(snapshot.cache.source, 'db');
  assert.equal(Array.isArray(setMePayload?.catalog), true);
  assert.equal(Array.isArray(setMePayload?.profiles), true);
});

test('getMeSnapshot falls back to db when redis get throws', async () => {
  mock.method(connectorRedisCacheService, 'isEnabled', () => true);
  mock.method(connectorRedisCacheService, 'getMe', async () => {
    throw new Error('redis injected fault');
  });
  const setMeMock = mock.method(connectorRedisCacheService, 'setMe', async () => {});
  mock.method(userConnectorService as any, 'listCatalog', async () => [{ key: 'github' }]);
  mock.method(userConnectorService as any, 'listUserProfiles', async () => [{ profileId: 'profile-fallback' }]);

  const snapshot = await userConnectorService.getMeSnapshot('user-redis-fault');

  assert.equal(snapshot.cache.hit, false);
  assert.equal(snapshot.cache.source, 'db');
  assert.equal(snapshot.catalog.length, 1);
  assert.equal(snapshot.profiles.length, 1);
  assert.equal(setMeMock.mock.callCount(), 0);
});

test('createProfile invalidates connectors me cache after persistence', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'listByUserAndConnectorKey', async () => []);
  mock.method(userConnectorProfileDAO, 'create', async (input: any) => {
    return {
      ...input,
      id: 'profile-supabase-cache-1',
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
  let invalidatedUserId = '';
  mock.method(connectorRedisCacheService, 'invalidateMe', async (userId: string) => {
    invalidatedUserId = userId;
  });

  await userConnectorService.createProfile('user-cache-invalidate', 'supabase', {
    credentials: { accessToken: 'sbp-token-only' },
  });

  assert.equal(invalidatedUserId, 'user-cache-invalidate');
});

test('getMeSnapshot deduplicates concurrent db loads on redis miss', async () => {
  mock.method(connectorRedisCacheService, 'isEnabled', () => true);
  mock.method(connectorRedisCacheService, 'getMe', async () => null);
  mock.method(connectorRedisCacheService, 'setMe', async () => {});
  let listCatalogCalls = 0;
  let releaseProfiles: (() => void) | null = null;
  mock.method(userConnectorService as any, 'listCatalog', async () => {
    listCatalogCalls += 1;
    return [{ key: 'github' }];
  });
  mock.method(userConnectorService as any, 'listUserProfiles', async () => {
    await new Promise<void>((resolve) => {
      releaseProfiles = resolve;
    });
    return [{ profileId: 'profile-concurrent' }];
  });

  const firstPromise = userConnectorService.getMeSnapshot('user-concurrent');
  const secondPromise = userConnectorService.getMeSnapshot('user-concurrent');
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!releaseProfiles) {
    throw new Error('expected concurrent gate to be initialized');
  }
  releaseProfiles();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(listCatalogCalls, 1);
  assert.equal(first.profiles.length, 1);
  assert.equal(second.profiles.length, 1);
});

test('getMeSnapshot downgrades unreadable Supabase secret to needs_auth with reconnect message', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.SUPABASE_CONNECTOR_SECRET_KEY = 'unit-test-supabase-secret-old';
  const expiredCiphertext = connectorSecretService.encrypt({ accessToken: 'sbp-expired-token' }, 'supabase');
  process.env.SUPABASE_CONNECTOR_SECRET_KEY = 'unit-test-supabase-secret-new';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(connectorRedisCacheService, 'isEnabled', () => false);
  mock.method(userConnectorProfileDAO, 'listByUserId', async () => [
    {
      id: 'profile-supabase-expired',
      userId: 'user-supabase-expired',
      connectorKey: 'supabase',
      profileName: 'Supabase Default',
      authMode: 'token',
      authStatus: 'authorized',
      displayName: null,
      configJson: {},
      metadataJson: {},
      secretCiphertext: expiredCiphertext,
      isDefault: true,
      lastAuthAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      lastError: null,
    },
  ] as any);
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-supabase-expired',
      userId: 'user-supabase-expired',
      connectorKey: 'supabase',
      profileName: 'Supabase Default',
      authMode: 'token',
      authStatus: input.authStatus,
      displayName: null,
      configJson: {},
      metadataJson: {},
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  const snapshot = await userConnectorService.getMeSnapshot('user-supabase-expired');

  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.profiles[0]?.authStatus, 'needs_auth');
  assert.equal(snapshot.profiles[0]?.lastError, 'Supabase connector 授权已过期，请重新连接。');
  assert.equal(snapshot.profiles[0]?.secretSummary, null);
  assert.equal(capturedUpdate?.authStatus, 'needs_auth');
  assert.equal(capturedUpdate?.secretCiphertext, null);
});

test('getProfileMaterial downgrades unreadable Supabase secret before runtime use', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.SUPABASE_CONNECTOR_SECRET_KEY = 'unit-test-supabase-secret-old';
  const expiredCiphertext = connectorSecretService.encrypt({ accessToken: 'sbp-expired-token' }, 'supabase');
  process.env.SUPABASE_CONNECTOR_SECRET_KEY = 'unit-test-supabase-secret-new';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-supabase-expired',
    userId: 'user-supabase-expired',
    connectorKey: 'supabase',
    profileName: 'Supabase Default',
    authMode: 'token',
    authStatus: 'authorized',
    displayName: null,
    configJson: {},
    metadataJson: {},
    secretCiphertext: expiredCiphertext,
    isDefault: true,
    lastAuthAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    lastError: null,
  }) as any);
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-supabase-expired',
      userId: 'user-supabase-expired',
      connectorKey: 'supabase',
      profileName: 'Supabase Default',
      authMode: 'token',
      authStatus: input.authStatus,
      displayName: null,
      configJson: {},
      metadataJson: {},
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  const material = await userConnectorService.getProfileMaterial(
    'user-supabase-expired',
    'profile-supabase-expired'
  );

  assert.equal(material?.authStatus, 'needs_auth');
  assert.equal(material?.secret, null);
  assert.equal(capturedUpdate?.authStatus, 'needs_auth');
  assert.equal(capturedUpdate?.lastError, 'Supabase connector 授权已过期，请重新连接。');
});

test('updateProfile invalidates connectors me cache after persistence', async () => {
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-update-1',
    connectorKey: 'github',
  }) as any);
  mock.method(userConnectorService as any, 'saveProfileInternal', async () => ({
    profileId: 'profile-update-1',
    connectorKey: 'github',
  }));
  let invalidatedUserId = '';
  mock.method(connectorRedisCacheService, 'invalidateMe', async (userId: string) => {
    invalidatedUserId = userId;
  });

  await userConnectorService.updateProfile('user-update-cache', 'profile-update-1', {
    profileName: 'updated',
  });

  assert.equal(invalidatedUserId, 'user-update-cache');
});

test('deleteProfile invalidates connectors me cache after persistence', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-delete-1',
    connectorKey: 'github',
    isDefault: false,
  }) as any);
  const deleteMock = mock.method(userConnectorProfileDAO, 'delete', async () => {});
  let invalidatedUserId = '';
  mock.method(connectorRedisCacheService, 'invalidateMe', async (userId: string) => {
    invalidatedUserId = userId;
  });

  const deleted = await userConnectorService.deleteProfile('user-delete-cache', 'profile-delete-1');

  assert.equal(deleted, true);
  assert.equal(deleteMock.mock.callCount(), 1);
  assert.equal(invalidatedUserId, 'user-delete-cache');
});

test('setDefaultProfile invalidates connectors me cache after persistence', async () => {
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-default-1',
    connectorKey: 'github',
  }) as any);
  mock.method(userConnectorProfileDAO, 'clearDefaultForConnector', async () => {});
  mock.method(userConnectorProfileDAO, 'update', async () => ({
    id: 'profile-default-1',
    connectorKey: 'github',
    profileName: 'GitHub Main',
    authMode: 'oauth',
    authStatus: 'authorized',
    displayName: 'april-jk',
    configJson: {},
    metadataJson: {},
    secretCiphertext: null,
    isDefault: true,
    lastAuthAt: new Date('2026-04-05T12:00:00.000Z'),
    updatedAt: new Date('2026-04-05T12:00:00.000Z'),
    lastError: null,
  }) as any);
  let invalidatedUserId = '';
  mock.method(connectorRedisCacheService, 'invalidateMe', async (userId: string) => {
    invalidatedUserId = userId;
  });

  const result = await userConnectorService.setDefaultProfile('user-default-cache', 'profile-default-1');

  assert.equal(result.profileId, 'profile-default-1');
  assert.equal(invalidatedUserId, 'user-default-cache');
});

test('startOAuthForProfile uses fixed redirect uri and state payload for notion', async () => {
  process.env.NOTION_CONNECTOR_CLIENT_ID = 'notion-client';
  process.env.NOTION_CONNECTOR_CLIENT_SECRET = 'notion-secret';
  process.env.NOTION_CONNECTOR_REDIRECT_URI = 'https://dev.oneceo.ai/notion/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-notion',
    userId: 'user-1',
    connectorKey: 'notion',
    profileName: 'Notion Default',
    authMode: 'oauth',
    authStatus: 'needs_auth',
  }) as any);
  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(connectorAuthRequestDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return input;
  });

  const result = await userConnectorService.startOAuthForProfile('user-1', 'profile-notion', {
    redirectUri: 'https://unexpected.example.com/callback',
    returnToSessionId: 'session-xyz',
  });

  const authUrl = new URL(result.authUrl);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://dev.oneceo.ai/notion/callback');
  assert.equal(capturedCreate?.returnToSessionId, 'session-xyz');
  assert.match(String(result.state), /^oneceo_notion_v1\./);
  assert.equal(result.state, capturedCreate?.state);
});

test('completeOAuthByProfile rejects notion oauth when state payload does not match request session', async () => {
  process.env.NOTION_CONNECTOR_CLIENT_ID = 'notion-client';
  process.env.NOTION_CONNECTOR_CLIENT_SECRET = 'notion-secret';
  process.env.NOTION_CONNECTOR_REDIRECT_URI = 'https://dev.oneceo.ai/notion/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-notion',
    userId: 'user-1',
    connectorKey: 'notion',
    profileName: 'Notion Default',
    displayName: null,
  }) as any);

  const state = `oneceo_notion_v1.${encodeStatePayload({
    rid: 'request-1',
    sid: 'session-from-state',
    ts: Date.now(),
    nonce: 'nonce-1',
  })}`;

  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-1',
    userId: 'user-1',
    connectorKey: 'notion',
    profileId: 'profile-notion',
    state,
    returnToSessionId: 'session-from-db',
    expiresAt: new Date(Date.now() + 60_000),
  }) as any);

  const markFailedMock = mock.method(
    connectorAuthRequestDAO,
    'markFailedByState',
    async () => ({}) as any
  );

  await assert.rejects(
    () =>
      userConnectorService.completeOAuthByProfile('user-1', 'profile-notion', {
        state,
        code: 'code-1',
        redirectUri: 'https://unexpected.example.com/callback',
      }),
    /OAuth state 校验失败/
  );
  assert.equal(markFailedMock.mock.callCount(), 1);
});

test('startOAuthForProfile uses fixed redirect uri and state payload for slack', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_CONNECTOR_REDIRECT_URI = '/slack/callback';
  process.env.SLACK_CONNECTOR_USER_SCOPES = 'channels:history chat:write';
  process.env.SLACK_CONNECTOR_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    authMode: 'oauth',
    authStatus: 'needs_auth',
  }) as any);
  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(connectorAuthRequestDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return input;
  });

  const result = await userConnectorService.startOAuthForProfile('user-1', 'profile-slack', {
    redirectUri: 'https://unexpected.example.com/callback',
    returnToSessionId: 'session-slack-1',
  });

  const authUrl = new URL(result.authUrl);
  assert.equal(authUrl.origin + authUrl.pathname, 'https://slack.com/oauth/v2/authorize');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://dev.oneceo.ai/slack/callback');
  assert.equal(authUrl.searchParams.get('user_scope'), 'channels:history chat:write');
  assert.equal(capturedCreate?.returnToSessionId, 'session-slack-1');
  assert.match(String(result.state), /^oneceo_slack_v1\./);
  assert.equal(result.state, capturedCreate?.state);
});

test('completeOAuthByProfile returns returnToSessionId and fixed redirect uri for slack', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_CONNECTOR_REDIRECT_URI = '/slack/callback';
  process.env.SLACK_CONNECTOR_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
  }) as any);

  const state = `oneceo_slack_v1.${encodeStatePayload({
    rid: 'request-slack-1',
    sid: 'session-slack-1',
    ts: Date.now(),
    nonce: 'nonce-slack-1',
  })}`;

  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-slack-1',
    userId: 'user-1',
    connectorKey: 'slack',
    profileId: 'profile-slack',
    state,
    returnToSessionId: 'session-slack-1',
    expiresAt: new Date(Date.now() + 60_000),
  }) as any);
  mock.method(connectorAuthRequestDAO, 'markCompleted', async () => ({}) as any);
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-slack',
      userId: 'user-1',
      connectorKey: 'slack',
      profileName: input.profileName,
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: input.displayName,
      configJson: {},
      metadataJson: {},
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-12T17:30:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  global.fetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://slack.com/api/oauth.v2.access');
    assert.match(String(init?.body || ''), /redirect_uri=https%3A%2F%2Fdev.oneceo.ai%2Fslack%2Fcallback/);
    return new Response(
      JSON.stringify({
        ok: true,
        authed_user: {
          id: 'U12345',
          access_token: 'xoxp-user-token',
          token_type: 'user',
        },
        team: { id: 'T12345' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await userConnectorService.completeOAuthByProfile('user-1', 'profile-slack', {
    state,
    code: 'code-slack-1',
    redirectUri: 'https://unexpected.example.com/callback',
  });

  assert.equal(result.returnToSessionId, 'session-slack-1');
  assert.equal(result.profile.authStatus, 'authorized');
  assert.equal(result.profile.displayName, 'U12345');
  assert.equal(
    connectorSecretService.decryptJson<{ accessToken?: string; tokenType?: string }>(
      String(capturedUpdate?.secretCiphertext || ''),
      'slack'
    )?.accessToken,
    'xoxp-user-token'
  );
  assert.equal(
    connectorSecretService.decryptJson<{ accessToken?: string; tokenType?: string }>(
      String(capturedUpdate?.secretCiphertext || ''),
      'slack'
    )?.tokenType,
    'user'
  );
  assert.deepEqual(capturedUpdate?.metadataJson, {
    slackAuthMode: 'user_oauth',
    slackTokenType: 'user',
    slackUserId: 'U12345',
    slackTeamId: 'T12345',
  });
});

test('completeOAuthByProfile surfaces slack oauth errors instead of generic access token failures', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_CONNECTOR_REDIRECT_URI = '/slack/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
  }) as any);

  const state = `oneceo_slack_v1.${encodeStatePayload({
    rid: 'request-slack-error-1',
    sid: '',
    ts: Date.now(),
    nonce: 'nonce-slack-error-1',
  })}`;

  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-slack-error-1',
    userId: 'user-1',
    connectorKey: 'slack',
    profileId: 'profile-slack',
    state,
    returnToSessionId: '',
    expiresAt: new Date(Date.now() + 60_000),
  }) as any);
  const markFailedMock = mock.method(
    connectorAuthRequestDAO,
    'markFailedByState',
    async () => ({}) as any
  );

  global.fetch = mock.fn(async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: 'bad_redirect_uri',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  ) as typeof fetch;

  await assert.rejects(
    () =>
      userConnectorService.completeOAuthByProfile('user-1', 'profile-slack', {
        state,
        code: 'code-slack-error-1',
        redirectUri: 'https://unexpected.example.com/callback',
      }),
    /bad_redirect_uri/
  );
  assert.equal(markFailedMock.mock.callCount(), 1);
});

test('getProfileMaterial invalidates legacy Slack bot token profiles before runtime use', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  const legacySecret = connectorSecretService.encrypt(
    {
      accessToken: 'xoxb-legacy-bot-token',
      tokenType: 'bearer',
    },
    'slack'
  );
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack-legacy',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    authMode: 'oauth',
    authStatus: 'authorized',
    displayName: 'Legacy Slack',
    configJson: {},
    metadataJson: {},
    secretCiphertext: legacySecret,
    isDefault: true,
    lastAuthAt: new Date('2026-04-12T18:00:00.000Z'),
    updatedAt: new Date('2026-04-12T18:00:00.000Z'),
    lastError: null,
  }) as any);

  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-slack-legacy',
      userId: 'user-1',
      connectorKey: 'slack',
      profileName: 'Slack Default',
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: 'Legacy Slack',
      configJson: {},
      metadataJson: {},
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: input.lastAuthAt,
      updatedAt: new Date('2026-04-12T18:05:00.000Z'),
      lastError: input.lastError,
    } as any;
  });

  const material = await userConnectorService.getProfileMaterial('user-1', 'profile-slack-legacy');

  assert.equal(capturedUpdate?.authStatus, 'needs_auth');
  assert.equal(capturedUpdate?.secretCiphertext, null);
  assert.equal(capturedUpdate?.lastError, 'Slack connector 已切换为 User OAuth Token，请重新连接。');
  assert.equal(material?.authStatus, 'needs_auth');
  assert.equal(material?.secret, null);
});

test('completeOAuthByProfile rejects slack oauth when state payload does not match request session', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_CONNECTOR_REDIRECT_URI = '/slack/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
  }) as any);

  const state = `oneceo_slack_v1.${encodeStatePayload({
    rid: 'request-slack-1',
    sid: 'session-from-state',
    ts: Date.now(),
    nonce: 'nonce-slack-1',
  })}`;

  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-slack-1',
    userId: 'user-1',
    connectorKey: 'slack',
    profileId: 'profile-slack',
    state,
    returnToSessionId: 'session-from-db',
    expiresAt: new Date(Date.now() + 60_000),
  }) as any);
  const markFailedMock = mock.method(
    connectorAuthRequestDAO,
    'markFailedByState',
    async () => ({}) as any
  );

  await assert.rejects(
    () =>
      userConnectorService.completeOAuthByProfile('user-1', 'profile-slack', {
        state,
        code: 'code-slack-1',
        redirectUri: 'https://unexpected.example.com/callback',
      }),
    (error: unknown) => error instanceof Error && error.message.includes('OAuth state')
  );
  assert.equal(markFailedMock.mock.callCount(), 1);
});

test('completeOAuthByProfile marks expired slack oauth request as failed', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_CONNECTOR_REDIRECT_URI = '/slack/callback';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
  }) as any);
  mock.method(connectorAuthRequestDAO, 'getByState', async () => ({
    requestId: 'request-slack-expired',
    userId: 'user-1',
    connectorKey: 'slack',
    profileId: 'profile-slack',
    state: 'expired-state',
    returnToSessionId: 'session-slack-expired',
    expiresAt: new Date(Date.now() - 60_000),
  }) as any);
  const markFailedMock = mock.method(
    connectorAuthRequestDAO,
    'markFailedByState',
    async () => ({}) as any
  );

  await assert.rejects(
    () =>
      userConnectorService.completeOAuthByProfile('user-1', 'profile-slack', {
        state: 'expired-state',
        code: 'code-slack-expired',
        redirectUri: 'https://unexpected.example.com/callback',
      }),
    (error: unknown) => error instanceof Error && error.message.includes('OAuth')
  );
  assert.equal(markFailedMock.mock.callCount(), 1);
});
