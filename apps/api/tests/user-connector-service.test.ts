import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { connectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';
import { connectorSecretService } from '../src/services/connector-secret-service';
import { connectorAuthRequestDAO, userConnectorProfileDAO } from '../src/db/dao';
import { connectorRedisCacheService } from '../src/services/connector-redis-cache-service';
import { userConnectorService } from '../src/services/user-connector-service';

const originalFetch = global.fetch;
const originalConnectorSecretKey = process.env.CONNECTOR_SECRET_KEY;
const originalNotionClientId = process.env.NOTION_CONNECTOR_CLIENT_ID;
const originalNotionClientSecret = process.env.NOTION_CONNECTOR_CLIENT_SECRET;
const originalNotionRedirectUri = process.env.NOTION_CONNECTOR_REDIRECT_URI;
const originalSupabaseSecretKey = process.env.SUPABASE_CONNECTOR_SECRET_KEY;
const originalComposioApiKey = process.env.COMPOSIO_API_KEY;
const originalComposioSlackToolkits = process.env.COMPOSIO_SLACK_TOOLKITS;
const originalComposioFigmaToolkits = process.env.COMPOSIO_FIGMA_TOOLKITS;
const originalVercelClientId = process.env.VERCEL_INTEGRATION_CLIENT_ID;
const originalVercelClientSecret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
const originalFrontendUrl = process.env.FRONTEND_URL;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
  if (originalConnectorSecretKey === undefined) {
    delete process.env.CONNECTOR_SECRET_KEY;
  } else {
    process.env.CONNECTOR_SECRET_KEY = originalConnectorSecretKey;
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
  if (originalComposioSlackToolkits === undefined) {
    delete process.env.COMPOSIO_SLACK_TOOLKITS;
  } else {
    process.env.COMPOSIO_SLACK_TOOLKITS = originalComposioSlackToolkits;
  }
  if (originalComposioFigmaToolkits === undefined) {
    delete process.env.COMPOSIO_FIGMA_TOOLKITS;
  } else {
    process.env.COMPOSIO_FIGMA_TOOLKITS = originalComposioFigmaToolkits;
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
  if (originalFrontendUrl === undefined) {
    delete process.env.FRONTEND_URL;
  } else {
    process.env.FRONTEND_URL = originalFrontendUrl;
  }
});

function encodeStatePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

test('createProfile does not authorize GitHub from a user-supplied access token', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';
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

  const saved = await userConnectorService.createProfile('user-1', 'github', {
    profileName: 'GitHub Main',
    credentials: {
      accessToken: 'ghp-user-supplied-token',
    },
  });

  assert.equal(saved.authStatus, 'needs_auth');
  assert.equal(saved.displayName, null);
  assert.equal(capturedCreate?.displayName, null);
  assert.equal(capturedCreate?.secretCiphertext, null);
});

test('startOAuthForProfile starts GitHub Composio Connect Link authorization', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-github',
    userId: 'user-1',
    connectorKey: 'github',
    profileName: 'GitHub Default',
    authMode: 'oauth',
    authStatus: 'needs_auth',
  }) as any);
  let capturedCreate: Record<string, unknown> | null = null;
  mock.method(connectorAuthRequestDAO, 'create', async (input: any) => {
    capturedCreate = input;
    return input;
  });
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-github',
      userId: 'user-1',
      connectorKey: 'github',
      profileName: 'GitHub Default',
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: null,
      configJson: {},
      metadataJson: input.metadataJson,
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: null,
      updatedAt: new Date('2026-04-30T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });
  global.fetch = mock.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/v3.1/tool_router/session')) {
      return new Response(
        JSON.stringify({
          session_id: 'trs_github_1',
          mcp: { url: 'https://composio.example.com/github/mcp' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.endsWith('/api/v3.1/tool_router/session/trs_github_1/link')) {
      return new Response(
        JSON.stringify({
          redirect_url: 'https://composio.example.com/connect/github',
          connected_account_id: 'ca_github_pending',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`unexpected composio request: ${url}`);
  }) as typeof fetch;

  const result = await userConnectorService.startOAuthForProfile('user-1', 'profile-github', {
    redirectUri: 'https://unexpected.example.com/callback',
    returnToSessionId: 'session-github-1',
  });

  assert.equal(result.authUrl, 'https://composio.example.com/connect/github');
  assert.equal(capturedCreate?.returnToSessionId, 'session-github-1');
  assert.equal(result.state, capturedCreate?.state);
  assert.equal(capturedCreate?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.composioSessionId, 'trs_github_1');
  assert.ok(capturedUpdate?.secretCiphertext);
});

test('startOAuthForProfile marks GitHub profile reauth needed when Composio key is invalid', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'invalid-unit-test-composio-key';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(connectorRedisCacheService, 'invalidateMe', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-github-invalid-key',
    userId: 'user-1',
    connectorKey: 'github',
    profileName: 'GitHub Default',
    authMode: 'oauth',
    authStatus: 'authorized',
    displayName: 'old-user',
    configJson: {},
    metadataJson: {
      provider: 'composio',
      connectionStatus: 'active',
    },
    secretCiphertext: null,
    isDefault: true,
    lastAuthAt: new Date('2026-04-30T00:00:00.000Z'),
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    lastError: null,
  }) as any);
  let capturedState = '';
  mock.method(connectorAuthRequestDAO, 'create', async (input: any) => {
    capturedState = input.state;
    return input;
  });
  let failedState = '';
  mock.method(connectorAuthRequestDAO, 'markFailedByState', async (state: string) => {
    failedState = state;
    return { state };
  });
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-github-invalid-key',
      userId: 'user-1',
      connectorKey: 'github',
      profileName: 'GitHub Default',
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: 'old-user',
      configJson: {},
      metadataJson: input.metadataJson,
      secretCiphertext: input.secretCiphertext || null,
      isDefault: true,
      lastAuthAt: new Date('2026-04-30T00:00:00.000Z'),
      updatedAt: new Date('2026-04-30T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });
  global.fetch = mock.fn(async () => new Response(
    JSON.stringify({
      error: {
        message: 'Invalid API key: ak_test*****',
        suggested_fix: 'Please check you are using a valid API key.',
      },
    }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  )) as typeof fetch;

  await assert.rejects(
    userConnectorService.startOAuthForProfile('user-1', 'profile-github-invalid-key', {
      redirectUri: 'https://unexpected.example.com/callback',
      returnToSessionId: 'session-github-1',
    }),
    /COMPOSIO_API_KEY/
  );

  assert.equal(failedState, capturedState);
  assert.equal(capturedUpdate?.authStatus, 'needs_auth');
  assert.equal(capturedUpdate?.secretCiphertext, null);
  assert.match(String(capturedUpdate?.lastError || ''), /COMPOSIO_API_KEY/);
  assert.equal((capturedUpdate?.metadataJson as any)?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.connectionStatus, 'start_failed');
});

test('createProfile does not authorize Supabase from a user-supplied access token', async () => {
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
  assert.equal(saved.authStatus, 'needs_auth');
  assert.equal(capturedCreate?.profileName, 'Supabase Default');
  assert.equal(capturedCreate?.displayName, null);
  assert.equal(capturedCreate?.secretCiphertext, null);
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
  assert.equal(snapshot.profiles[0]?.lastError, 'Supabase connector now requires Composio OAuth. Reconnect Supabase through Composio.');
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
  assert.equal(capturedUpdate?.lastError, 'Supabase connector now requires Composio OAuth. Reconnect Supabase through Composio.');
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

test('startOAuthForProfile starts Notion Composio Connect Link authorization', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';

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
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-notion',
      userId: 'user-1',
      connectorKey: 'notion',
      profileName: 'Notion Default',
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: null,
      configJson: {},
      metadataJson: input.metadataJson,
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: null,
      updatedAt: new Date('2026-04-30T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });
  global.fetch = mock.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/v3.1/tool_router/session')) {
      return new Response(
        JSON.stringify({
          session_id: 'trs_notion_1',
          mcp: { url: 'https://composio.example.com/notion/mcp' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.endsWith('/api/v3.1/tool_router/session/trs_notion_1/link')) {
      return new Response(
        JSON.stringify({
          redirect_url: 'https://composio.example.com/connect/notion',
          connected_account_id: 'ca_notion_pending',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`unexpected composio request: ${url}`);
  }) as typeof fetch;

  const result = await userConnectorService.startOAuthForProfile('user-1', 'profile-notion', {
    redirectUri: 'https://unexpected.example.com/callback',
    returnToSessionId: 'session-xyz',
  });

  assert.equal(result.authUrl, 'https://composio.example.com/connect/notion');
  assert.equal(capturedCreate?.returnToSessionId, 'session-xyz');
  assert.equal(result.state, capturedCreate?.state);
  assert.equal(capturedCreate?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.composioSessionId, 'trs_notion_1');
});

test('completeOAuthByProfile marks Notion Composio callback failed when metadata is missing', async () => {
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';

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
  mock.method(userConnectorProfileDAO, 'update', async () => ({
    id: 'profile-notion',
    userId: 'user-1',
    connectorKey: 'notion',
    profileName: 'Notion Default',
    authMode: 'oauth',
    authStatus: 'needs_auth',
    displayName: null,
    configJson: {},
    metadataJson: {},
    secretCiphertext: null,
    isDefault: true,
    lastAuthAt: null,
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    lastError: 'Composio session id is missing from OAuth request metadata',
  }) as any);

  await assert.rejects(
    () =>
      userConnectorService.completeOAuthByProfile('user-1', 'profile-notion', {
        state,
        code: 'code-1',
        redirectUri: 'https://unexpected.example.com/callback',
      }),
    /Composio session id is missing/
  );
  assert.equal(markFailedMock.mock.callCount(), 1);
});

test('startOAuthForProfile starts Slack Composio Connect Link authorization', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';
  process.env.COMPOSIO_SLACK_TOOLKITS = 'slack';

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
  let capturedUpdate: Record<string, unknown> | null = null;
  mock.method(userConnectorProfileDAO, 'update', async (_profileId: string, _userId: string, input: any) => {
    capturedUpdate = input;
    return {
      id: 'profile-slack',
      userId: 'user-1',
      connectorKey: 'slack',
      profileName: 'Slack Default',
      authMode: input.authMode,
      authStatus: input.authStatus,
      displayName: null,
      configJson: {},
      metadataJson: input.metadataJson,
      secretCiphertext: input.secretCiphertext,
      isDefault: true,
      lastAuthAt: null,
      updatedAt: new Date('2026-04-30T00:00:00.000Z'),
      lastError: input.lastError,
    } as any;
  });
  global.fetch = mock.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/v3.1/tool_router/session')) {
      return new Response(
        JSON.stringify({
          session_id: 'trs_slack_1',
          mcp: { url: 'https://composio.example.com/slack/mcp' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.endsWith('/api/v3.1/tool_router/session/trs_slack_1/link')) {
      return new Response(
        JSON.stringify({
          redirect_url: 'https://composio.example.com/connect/slack',
          connected_account_id: 'ca_slack_pending',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`unexpected composio request: ${url}`);
  }) as typeof fetch;

  const result = await userConnectorService.startOAuthForProfile('user-1', 'profile-slack', {
    redirectUri: 'https://unexpected.example.com/callback',
    returnToSessionId: 'session-slack-1',
  });

  assert.equal(result.authUrl, 'https://composio.example.com/connect/slack');
  assert.equal(capturedCreate?.returnToSessionId, 'session-slack-1');
  assert.equal(result.state, capturedCreate?.state);
  assert.equal(capturedCreate?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.composioSessionId, 'trs_slack_1');
  assert.ok(capturedUpdate?.secretCiphertext);
});

test('completeOAuthByProfile confirms Slack Composio authorization', async () => {
  process.env.CONNECTOR_SECRET_KEY = 'unit-test-generic-secret';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';
  process.env.COMPOSIO_SLACK_TOOLKITS = 'slack';

  const pendingSecret = connectorSecretService.encrypt(
    {
      source: 'composio',
      composioMcpUrl: 'https://composio.example.com/slack/mcp',
      composioMcpHeaders: { 'x-api-key': 'unit-test-composio-key' },
    },
    'slack'
  );

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
    metadataJson: {
      provider: 'composio',
      composioSessionId: 'trs_slack_1',
      composioConnectedAccountId: 'ca_slack_old',
    },
    secretCiphertext: pendingSecret,
  }) as any);

  const state = 'state-slack-composio-1';

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

  global.fetch = mock.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/v3.1/tool_router/session/trs_slack_1')) {
      return new Response(
        JSON.stringify({ session_id: 'trs_slack_1', mcp: { url: 'https://composio.example.com/slack/mcp' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.endsWith('/api/v3.1/tool_router/session/trs_slack_1/toolkits')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              slug: 'slack',
              connection: {
                status: 'ACTIVE',
                connected_account: { id: 'ca_slack_callback' },
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`unexpected composio request: ${url}`);
  }) as typeof fetch;

  const result = await userConnectorService.completeOAuthByProfile('user-1', 'profile-slack', {
    state,
    code: '',
    redirectUri: 'https://unexpected.example.com/callback',
    connectedAccountId: 'ca_slack_callback',
    status: 'success',
  });

  assert.equal(result.returnToSessionId, 'session-slack-1');
  assert.equal(result.profile.authStatus, 'authorized');
  assert.equal(result.profile.displayName, 'Slack');
  assert.equal(
    connectorSecretService.decryptJson<{ source?: string; composioMcpUrl?: string }>(
      String(capturedUpdate?.secretCiphertext || ''),
      'slack'
    )?.source,
    'composio'
  );
  assert.equal((capturedUpdate?.metadataJson as any)?.provider, 'composio');
  assert.equal((capturedUpdate?.metadataJson as any)?.connectionStatus, 'active');
  assert.equal((capturedUpdate?.metadataJson as any)?.composioConnectedAccountId, 'ca_slack_callback');
});

test('completeOAuthByProfile marks Slack Composio callback failed when metadata is missing', async () => {
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
  }) as any);

  const state = 'state-slack-missing-composio-session';

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
    new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  ) as typeof fetch;

  await assert.rejects(
    () =>
      userConnectorService.completeOAuthByProfile('user-1', 'profile-slack', {
        state,
        code: '',
        redirectUri: 'https://unexpected.example.com/callback',
      }),
    /Composio session id is missing/
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
  assert.equal(capturedUpdate?.lastError, 'Slack connector now requires Composio OAuth. Reconnect Slack through Composio.');
  assert.equal(material?.authStatus, 'needs_auth');
  assert.equal(material?.secret, null);
});

test('completeOAuthByProfile requires Slack Composio metadata instead of legacy OAuth state', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';

  mock.method(connectorStorageBootstrap, 'ensureReady', async () => {});
  mock.method(userConnectorProfileDAO, 'getByIdAndUser', async () => ({
    id: 'profile-slack',
    userId: 'user-1',
    connectorKey: 'slack',
    profileName: 'Slack Default',
    displayName: null,
  }) as any);

  const state = 'state-slack-composio-missing-metadata';

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
    /Composio session id is missing/
  );
  assert.equal(markFailedMock.mock.callCount(), 1);
});

test('completeOAuthByProfile marks expired Slack Composio OAuth request as failed', async () => {
  process.env.FRONTEND_URL = 'https://dev.oneceo.ai';
  process.env.COMPOSIO_API_KEY = 'unit-test-composio-key';

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
