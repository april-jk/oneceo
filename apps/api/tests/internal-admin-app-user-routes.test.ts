import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import express from 'express';
import internalAdminAppUserRoutes from '../src/routes/internal-admin-app-user-routes';
import { adminAppUserService } from '../src/services/admin-app-user-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const originalListUsers = adminAppUserService.listUsers;
const originalGetUserDetail = adminAppUserService.getUserDetail;
const originalUpdateUserStatus = adminAppUserService.updateUserStatus;
const originalRevokeUserSessions = adminAppUserService.revokeUserSessions;
const originalToken = process.env.ONECEO_INTERNAL_TOKEN;

after(() => {
  adminAppUserService.listUsers = originalListUsers;
  adminAppUserService.getUserDetail = originalGetUserDetail;
  adminAppUserService.updateUserStatus = originalUpdateUserStatus;
  adminAppUserService.revokeUserSessions = originalRevokeUserSessions;
  process.env.ONECEO_INTERNAL_TOKEN = originalToken;
});

beforeEach(() => {
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalAdminAppUserRoutes);

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

test('GET /api/internal/admin/app-users requires internal token', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/internal/admin/app-users`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '未授权的内部请求');
  } finally {
    await server.close();
  }
});

test('GET /api/internal/admin/app-users returns app user list payload', async () => {
  const server = await startServer();
  adminAppUserService.listUsers = async (filters) => {
    assert.equal(filters.limit, 50);
    assert.equal(filters.status, 'active');
    return {
      summary: {
        totalUsers: 1,
        activeUsers7d: 1,
        disabledUsers: 0,
        ownershipAlertUsers: 0,
        generatedAt: '2026-04-15T09:43:00.000Z',
      },
      filters,
      items: [
        {
          id: 'app-user-1',
          email: 'demo@example.com',
          displayName: 'Demo User',
          status: 'active',
        },
      ],
    } as any;
  };

  try {
    const response = await fetch(
      `${server.origin}/api/internal/admin/app-users?limit=50&status=active`,
      {
        headers: {
          'x-oneceo-internal-token': 'internal-secret',
        },
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.summary.totalUsers, 1);
    assert.equal(payload.data.items[0].id, 'app-user-1');
  } finally {
    await server.close();
  }
});

test('GET /api/internal/admin/app-users/:userId returns detail payload', async () => {
  const server = await startServer();
  adminAppUserService.getUserDetail = async (userId: string) => {
    assert.equal(userId, 'user-123');
    return {
      user: {
        id: 'user-123',
        email: 'demo@example.com',
        displayName: 'Demo User',
        status: 'active',
      },
      stats: {
        sessionCount: 1,
        activeSessionCount: 1,
      },
      recentSessions: [],
      recentConversations: [],
      recentSandboxes: [],
      legacyMappings: [],
    } as any;
  };

  try {
    const response = await fetch(`${server.origin}/api/internal/admin/app-users/user-123`, {
      headers: {
        'x-oneceo-internal-token': 'internal-secret',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-123');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin/app-users/:userId/status validates status value', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/internal/admin/app-users/user-123/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oneceo-internal-token': 'internal-secret',
      },
      body: JSON.stringify({ status: 'paused' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '状态仅支持 active 或 disabled');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin/app-users/:userId/revoke-sessions forwards to service', async () => {
  const server = await startServer();
  adminAppUserService.revokeUserSessions = async (userId: string) => {
    assert.equal(userId, 'user-123');
    return {
      revokedSessionCount: 2,
      user: {
        id: 'user-123',
        email: 'demo@example.com',
        displayName: 'Demo User',
        status: 'active',
      },
      stats: {},
      recentSessions: [],
      recentConversations: [],
      recentSandboxes: [],
      legacyMappings: [],
    } as any;
  };

  try {
    const response = await fetch(`${server.origin}/api/internal/admin/app-users/user-123/revoke-sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oneceo-internal-token': 'internal-secret',
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.revokedSessionCount, 2);
  } finally {
    await server.close();
  }
});
