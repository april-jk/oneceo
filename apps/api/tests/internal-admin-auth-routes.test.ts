import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import express from 'express';
import internalAdminAuthRoutes from '../src/routes/internal-admin-auth-routes';
import { adminAuthService } from '../src/services/admin-auth-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const originalLogin = adminAuthService.login;
const originalLogout = adminAuthService.logout;
const originalResolve = adminAuthService.resolveAdminBySessionToken;
const originalToken = process.env.ONECEO_INTERNAL_TOKEN;

after(() => {
  adminAuthService.login = originalLogin;
  adminAuthService.logout = originalLogout;
  adminAuthService.resolveAdminBySessionToken = originalResolve;
  process.env.ONECEO_INTERNAL_TOKEN = originalToken;
});

beforeEach(() => {
  process.env.ONECEO_INTERNAL_TOKEN = 'internal-secret';
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalAdminAuthRoutes);

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

function createAdmin(id: string) {
  return {
    id,
    loginName: `admin-${id}`,
    displayName: `Admin ${id}`,
    role: 'super_admin',
    status: 'active',
  };
}

test('POST /api/internal/admin-auth/login returns 401 when token is configured but request is missing it', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/internal/admin-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginName: 'admin',
        password: 'password123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '未授权的内部请求');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin-auth/login returns 403 when internal token is not configured', async () => {
  const server = await startServer();
  process.env.ONECEO_INTERNAL_TOKEN = '';

  try {
    const response = await fetch(`${server.origin}/api/internal/admin-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginName: 'admin',
        password: 'password123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '管理员认证内部接口未启用');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin-auth/login returns session token and admin user', async () => {
  const server = await startServer();
  adminAuthService.login = async (input) => {
    assert.equal(input.loginName, 'admin');
    return {
      token: 'internal-admin-token',
      session: { id: 'admin-session-1' } as any,
      adminUser: createAdmin('1'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/internal/admin-auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oneceo-internal-token': 'internal-secret',
      },
      body: JSON.stringify({
        loginName: 'admin',
        password: 'password123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.sessionToken, 'internal-admin-token');
    assert.equal(payload.data.adminUser.id, '1');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin-auth/logout revokes session token', async () => {
  const server = await startServer();
  let revokedToken = '';
  adminAuthService.logout = async (token: string) => {
    revokedToken = token;
  };

  try {
    const response = await fetch(`${server.origin}/api/internal/admin-auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oneceo-internal-token': 'internal-secret',
      },
      body: JSON.stringify({
        sessionToken: 'logout-admin-token',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(revokedToken, 'logout-admin-token');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin-auth/resolve returns 401 for invalid session', async () => {
  const server = await startServer();
  adminAuthService.resolveAdminBySessionToken = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/internal/admin-auth/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oneceo-internal-token': 'internal-secret',
      },
      body: JSON.stringify({
        sessionToken: 'invalid-token',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '管理员登录态无效');
  } finally {
    await server.close();
  }
});

test('POST /api/internal/admin-auth/resolve returns admin user for valid session', async () => {
  const server = await startServer();
  adminAuthService.resolveAdminBySessionToken = async (token: string) => {
    assert.equal(token, 'valid-token');
    return {
      session: { id: 'admin-session-2' } as any,
      adminUser: createAdmin('2'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/internal/admin-auth/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oneceo-internal-token': 'internal-secret',
      },
      body: JSON.stringify({
        sessionToken: 'valid-token',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.adminUser.id, '2');
  } finally {
    await server.close();
  }
});
