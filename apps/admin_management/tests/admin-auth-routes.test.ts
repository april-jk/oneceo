import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createAdminAuthRoutes } from '../server/routes/admin-auth-routes';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

async function startServer(connector: any): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/auth', createAdminAuthRoutes(connector));

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

test('POST /api/admin/auth/login proxies login and writes admin cookie', async () => {
  const connector = {
    adminLogin: async (input: { loginName: string; password: string }) => {
      assert.equal(input.loginName, 'admin');
      return {
        sessionToken: 'proxy-admin-token',
        adminUser: createAdmin('1'),
      };
    },
  };
  const server = await startServer(connector);

  try {
    const response = await fetch(`${server.origin}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginName: 'admin',
        password: 'password123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.adminUser.id, '1');
    assert.match(response.headers.get('set-cookie') || '', /admin_session_id=proxy-admin-token/);
  } finally {
    await server.close();
  }
});

test('GET /api/admin/auth/me returns 401 without admin cookie', async () => {
  const connector = {
    resolveAdminSession: async () => {
      throw new Error('should not be called');
    },
  };
  const server = await startServer(connector);

  try {
    const response = await fetch(`${server.origin}/api/admin/auth/me`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error.message, '当前未登录管理员账号');
  } finally {
    await server.close();
  }
});

test('GET /api/admin/auth/me returns admin user when cookie is valid', async () => {
  const connector = {
    resolveAdminSession: async (token: string) => {
      assert.equal(token, 'valid-admin-cookie');
      return {
        adminUser: createAdmin('2'),
      };
    },
  };
  const server = await startServer(connector);

  try {
    const response = await fetch(`${server.origin}/api/admin/auth/me`, {
      headers: {
        cookie: 'admin_session_id=valid-admin-cookie',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.adminUser.id, '2');
  } finally {
    await server.close();
  }
});

test('POST /api/admin/auth/logout clears cookie and proxies logout', async () => {
  let revokedToken = '';
  const connector = {
    adminLogout: async (token: string) => {
      revokedToken = token;
    },
  };
  const server = await startServer(connector);

  try {
    const response = await fetch(`${server.origin}/api/admin/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: 'admin_session_id=logout-admin-cookie',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(revokedToken, 'logout-admin-cookie');
    assert.match(response.headers.get('set-cookie') || '', /admin_session_id=;/);
    assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  } finally {
    await server.close();
  }
});
