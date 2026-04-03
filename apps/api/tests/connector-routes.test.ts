import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import connectorRoutes from '../src/routes/connector-routes';
import { userConnectorService } from '../src/services/user-connector-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const connectorServiceAny = userConnectorService as any;
const originalListCatalog = connectorServiceAny.listCatalog;
const originalListUserProfiles = connectorServiceAny.listUserProfiles;
const originalCreateProfile = connectorServiceAny.createProfile;

after(() => {
  connectorServiceAny.listCatalog = originalListCatalog;
  connectorServiceAny.listUserProfiles = originalListUserProfiles;
  connectorServiceAny.createProfile = originalCreateProfile;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
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

test('GET /api/connectors/me returns user-scoped catalog and profiles', async () => {
  const server = await startServer();
  connectorServiceAny.listCatalog = async () => [{ key: 'github', name: 'GitHub' }];
  connectorServiceAny.listUserProfiles = async (userId: string) => {
    assert.equal(userId, 'connector-user-1');
    return [{ profileId: 'profile-1', connectorKey: 'github' }];
  };

  try {
    const response = await fetch(`${server.origin}/api/connectors/me`, {
      headers: {
        'x-user-id': 'connector-user-1',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
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
        'x-user-id': 'connector-user-2',
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
