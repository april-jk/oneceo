import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import connectorRoutes, {
  CONNECTOR_CALLBACK_PATHS,
  buildConnectorFrontendCallbackRedirectUrl,
} from '../src/routes/connector-routes';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';
import { userConnectorService } from '../src/services/user-connector-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const connectorServiceAny = userConnectorService as any;
const originalGetMeSnapshot = connectorServiceAny.getMeSnapshot;
const originalCreateProfile = connectorServiceAny.createProfile;
const originalStartOAuth = connectorServiceAny.startOAuth;
const originalCompleteOAuth = connectorServiceAny.completeOAuth;
const originalCustomApiEnabled = process.env.ONECEO_CUSTOM_API_ENABLED;

after(() => {
  connectorServiceAny.getMeSnapshot = originalGetMeSnapshot;
  connectorServiceAny.createProfile = originalCreateProfile;
  connectorServiceAny.startOAuth = originalStartOAuth;
  connectorServiceAny.completeOAuth = originalCompleteOAuth;
  if (originalCustomApiEnabled === undefined) {
    delete process.env.ONECEO_CUSTOM_API_ENABLED;
  } else {
    process.env.ONECEO_CUSTOM_API_ENABLED = originalCustomApiEnabled;
  }
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware());
  app.get(CONNECTOR_CALLBACK_PATHS, (req, res) => {
    const redirectUrl = buildConnectorFrontendCallbackRedirectUrl(
      req.originalUrl || req.url,
      process.env.FRONTEND_URL || 'http://localhost:3000'
    );
    if (!redirectUrl) {
      res.status(404).json({ success: false });
      return;
    }
    res.redirect(302, redirectUrl);
  });
  app.use('/api/connectors', connectorRoutes);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

test('GET /api/connectors/me rejects anonymous access', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/connectors/me`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('connector callback redirect preserves callback path and query for frontend SPA', () => {
  const redirectUrl = buildConnectorFrontendCallbackRedirectUrl(
    '/github/callback?settings=open&connector=github&state=state-1&status=success',
    'http://localhost:3000'
  );

  assert.equal(
    redirectUrl,
    'http://localhost:3000/github/callback?settings=open&connector=github&state=state-1&status=success'
  );
});

test('GET /github/callback on api redirects to frontend callback route', async () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'http://localhost:3000';
  const server = await startServer();

  try {
    const response = await fetch(
      `${server.origin}/github/callback?settings=open&connector=github&state=state-1&status=success`,
      {
        redirect: 'manual',
      }
    );

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get('location'),
      'http://localhost:3000/github/callback?settings=open&connector=github&state=state-1&status=success'
    );
  } finally {
    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
    await server.close();
  }
});

test('GET /api/connectors/catalog disables HTTP caching for settings directory data', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/connectors/catalog`, {
      headers: {
        'if-none-match': '"stale-connector-catalog"',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
    assert.ok(Array.isArray(payload.data));
    assert.ok(payload.data.some((item: { key?: string }) => item.key === 'github'));
  } finally {
    await server.close();
  }
});

test('GET /api/connectors/me returns user-scoped catalog and profiles', async () => {
  const server = await startServer();
  connectorServiceAny.getMeSnapshot = async (userId: string) => {
    assert.equal(userId, 'connector-user-1');
    return {
      catalog: [{ key: 'github', name: 'GitHub' }],
      profiles: [{ profileId: 'profile-1', connectorKey: 'github' }],
      cache: { hit: false, source: 'db', redisEnabled: false },
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/connectors/me`, {
      headers: {
        'x-test-user-id': 'connector-user-1',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
    assert.equal(payload.data.userId, 'connector-user-1');
    assert.equal(payload.data.profiles.length, 1);
  } finally {
    await server.close();
  }
});

test('POST /api/connectors/:connectorKey/profiles creates profile under current user', async () => {
  const server = await startServer();
  let receivedUserId = '';
  let receivedConnectorKey = '';
  connectorServiceAny.createProfile = async (userId: string, connectorKey: string, input: any) => {
    receivedUserId = userId;
    receivedConnectorKey = connectorKey;
    return {
      profileId: 'profile-created-1',
      connectorKey,
      profileName: input.profileName,
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/connectors/github/profiles`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'connector-user-2',
      },
      body: JSON.stringify({
        profileName: 'My GitHub',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(receivedUserId, 'connector-user-2');
    assert.equal(receivedConnectorKey, 'github');
    assert.equal(payload.data.profileId, 'profile-created-1');
  } finally {
    await server.close();
  }
});

test('POST /api/connectors/notion/oauth/start uses connector-level oauth entrypoint', async () => {
  const server = await startServer();
  connectorServiceAny.startOAuth = async (userId: string, connectorKey: string, input: any) => {
    assert.equal(userId, 'connector-user-3');
    assert.equal(connectorKey, 'notion');
    assert.equal(input.redirectUri, 'https://example.com/callback');
    assert.equal(input.returnToSessionId, 'session-123');
    return {
      authUrl: 'https://mcp.notion.com/mcp/oauth/start?state=test',
      requestId: 'request-1',
      state: 'state-1',
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/connectors/notion/oauth/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'connector-user-3',
      },
      body: JSON.stringify({
        redirectUri: 'https://example.com/callback',
        returnToSessionId: 'session-123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.authUrl, 'https://mcp.notion.com/mcp/oauth/start?state=test');
    assert.equal(payload.data.state, 'state-1');
  } finally {
    await server.close();
  }
});

test('POST /api/connectors/notion/oauth/callback returns callback result for current user', async () => {
  const server = await startServer();
  connectorServiceAny.completeOAuth = async (userId: string, connectorKey: string, input: any) => {
    assert.equal(userId, 'connector-user-4');
    assert.equal(connectorKey, 'notion');
    assert.equal(input.state, 'state-2');
    assert.equal(input.code, 'code-2');
    return {
      account: {
        profileId: 'profile-notion-1',
        defaultProfileId: 'profile-notion-1',
        authStatus: 'needs_auth',
      },
      returnToSessionId: 'session-200',
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/connectors/notion/oauth/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'connector-user-4',
      },
      body: JSON.stringify({
        state: 'state-2',
        code: 'code-2',
        redirectUri: 'https://example.com/callback',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.returnToSessionId, 'session-200');
    assert.equal(payload.data.runtimeRefreshQueued, false);
  } finally {
    await server.close();
  }
});

test('POST /api/connectors/notion/oauth/callback reports oauth errors', async () => {
  const server = await startServer();
  connectorServiceAny.completeOAuth = async () => {
    throw new Error('OAuth 请求已过期');
  };

  try {
    const response = await fetch(`${server.origin}/api/connectors/notion/oauth/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'connector-user-5',
      },
      body: JSON.stringify({
        state: 'expired-state',
        code: 'code-expired',
        redirectUri: 'https://example.com/callback',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
  } finally {
    await server.close();
  }
});

test('custom API connector routes are unavailable while feature flag is disabled', async () => {
  delete process.env.ONECEO_CUSTOM_API_ENABLED;
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/connectors/custom-api/definitions`, {
      headers: {
        'x-test-user-id': 'connector-user-6',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.success, false);
    assert.match(String(payload.error || ''), /custom_api_disabled/);
  } finally {
    await server.close();
  }
});

test('generic connector profile route cannot create custom API while feature flag is disabled', async () => {
  delete process.env.ONECEO_CUSTOM_API_ENABLED;
  connectorServiceAny.createProfile = originalCreateProfile;
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/connectors/custom_api/profiles`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user-id': 'connector-user-7',
      },
      body: JSON.stringify({
        profileName: 'Custom API',
        credentials: {
          accessToken: 'secret-token',
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.match(String(payload.error || ''), /custom_api_disabled/);
  } finally {
    await server.close();
  }
});
