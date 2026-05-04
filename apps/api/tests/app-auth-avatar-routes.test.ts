import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import express from 'express';
import authRoutes from '../src/routes/auth-routes';
import { appAuthService } from '../src/services/app-auth-service';
import { mockAuthContextMiddleware } from './helpers/mock-auth-context';

const originalUploadAvatar = appAuthService.uploadAvatar;
const originalRemoveAvatar = appAuthService.removeAvatar;

afterEach(() => {
  appAuthService.uploadAvatar = originalUploadAvatar;
  appAuthService.removeAvatar = originalRemoveAvatar;
});

function startServer() {
  const app = express();
  app.use(express.json());
  app.use(mockAuthContextMiddleware('x-test-user-id'));
  app.use('/api/auth', authRoutes);
  return new Promise<{ origin: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('failed to resolve test server address');
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

test('POST /api/auth/avatar/upload returns updated user and persists avatar changes', async () => {
  const server = await startServer();
  appAuthService.uploadAvatar = async (userId, input) => {
    assert.equal(userId, 'user-avatar-route');
    assert.equal(input.contentType, 'image/png');
    assert.equal(input.originalName, 'avatar.png');
    return {
      id: userId,
      email: 'avatar@example.com',
      displayName: 'Avatar User',
      avatarUrl: 'signed:avatar',
      avatarSource: 'manual',
      personalization: { preferredName: '', occupation: '', identity: '', location: '', background: '', preferences: '', responsePreferences: '' },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;
  };

  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('avatar')], { type: 'image/png' }), 'avatar.png');
    const response = await fetch(`${server.origin}/api/auth/avatar/upload`, {
      method: 'POST',
      headers: { 'x-test-user-id': 'user-avatar-route' },
      body: form,
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.avatarUrl, 'signed:avatar');
  } finally {
    await server.close();
  }
});

test('DELETE /api/auth/avatar returns updated user', async () => {
  const server = await startServer();
  appAuthService.removeAvatar = async (userId) => {
    assert.equal(userId, 'user-avatar-route');
    return {
      id: userId,
      email: 'avatar@example.com',
      displayName: 'Avatar User',
      avatarUrl: null,
      avatarSource: 'default',
      personalization: { preferredName: '', occupation: '', identity: '', location: '', background: '', preferences: '', responsePreferences: '' },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/avatar`, {
      method: 'DELETE',
      headers: { 'x-test-user-id': 'user-avatar-route' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.avatarUrl, null);
  } finally {
    await server.close();
  }
});
