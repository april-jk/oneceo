import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { connectorStorageBootstrap } from '../src/services/connector-storage-bootstrap';
import { connectorSecretService } from '../src/services/connector-secret-service';
import { userConnectorProfileDAO } from '../src/db/dao';
import { userConnectorService } from '../src/services/user-connector-service';

const originalFetch = global.fetch;

afterEach(() => {
  mock.reset();
  global.fetch = originalFetch;
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
