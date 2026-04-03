import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import authRoutes from '../src/routes/auth-routes';
import { appAuthMiddleware } from '../src/middleware/app-auth-middleware';
import { appAuthService } from '../src/services/app-auth-service';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const originalRegister = appAuthService.register;
const originalLogin = appAuthService.login;
const originalLogout = appAuthService.logout;
const originalResolve = appAuthService.resolveUserBySessionToken;

after(() => {
  appAuthService.register = originalRegister;
  appAuthService.login = originalLogin;
  appAuthService.logout = originalLogout;
  appAuthService.resolveUserBySessionToken = originalResolve;
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(appAuthMiddleware);
  app.use('/api/auth', authRoutes);

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

function createUser(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    status: 'active',
  };
}

test('POST /api/auth/register returns user and app session cookie', async () => {
  const server = await startServer();
  appAuthService.register = async (input) => {
    assert.equal(input.email, 'new@example.com');
    return {
      token: 'app-token-register',
      session: { id: 'sess-1' } as any,
      user: createUser('user-register-1'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'new@example.com',
        password: 'password123',
        displayName: 'New User',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-register-1');
    assert.match(response.headers.get('set-cookie') || '', /app_session_id=app-token-register/);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login returns 400 on invalid credentials', async () => {
  const server = await startServer();
  appAuthService.login = async () => {
    throw new Error('邮箱或密码错误');
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'bad@example.com',
        password: 'wrong-password',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '邮箱或密码错误');
    assert.equal(response.headers.get('set-cookie'), null);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login returns user and app session cookie', async () => {
  const server = await startServer();
  appAuthService.login = async (input) => {
    assert.equal(input.email, 'login@example.com');
    return {
      token: 'app-token-login',
      session: { id: 'sess-2' } as any,
      user: createUser('user-login-1'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'login@example.com',
        password: 'password123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-login-1');
    assert.match(response.headers.get('set-cookie') || '', /app_session_id=app-token-login/);
  } finally {
    await server.close();
  }
});

test('GET /api/auth/me returns current user when cookie is valid', async () => {
  const server = await startServer();
  appAuthService.resolveUserBySessionToken = async (token: string) => {
    assert.equal(token, 'valid-app-token');
    return {
      session: { id: 'sess-3' } as any,
      user: createUser('user-me-1'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/me`, {
      headers: {
        cookie: 'app_session_id=valid-app-token',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-me-1');
  } finally {
    await server.close();
  }
});

test('GET /api/auth/me returns 401 when cookie is missing', async () => {
  const server = await startServer();
  appAuthService.resolveUserBySessionToken = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/auth/me`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '当前未登录');
  } finally {
    await server.close();
  }
});

test('POST /api/auth/logout revokes session and clears cookie', async () => {
  const server = await startServer();
  let revokedToken = '';
  appAuthService.logout = async (token: string) => {
    revokedToken = token;
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: 'app_session_id=logout-token',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(revokedToken, 'logout-token');
    assert.match(response.headers.get('set-cookie') || '', /app_session_id=;/);
    assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  } finally {
    await server.close();
  }
});
