import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import express from 'express';
import { appUserLegacyIdMappingDAO } from '../src/db/dao/app-user-legacy-id-mapping.dao';
import { taskCreationSessionDAO } from '../src/db/dao/task-creation-session.dao';
import authRoutes from '../src/routes/auth-routes';
import authOauthRoutes from '../src/routes/auth-oauth-routes';
import { appAuthMiddleware } from '../src/middleware/app-auth-middleware';
import { appAuthLoginRateLimitService } from '../src/services/app-auth-login-rate-limit-service';
import { appAuthService } from '../src/services/app-auth-service';
import {
  APP_OAUTH_STATE_COOKIE_NAME,
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_STATE_COOKIE_NAME,
  LEGACY_APP_SESSION_COOKIE_NAME,
  LEGACY_APP_SESSION_STATE_COOKIE_NAME,
} from '../src/utils/auth-session';

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

const originalRegister = appAuthService.register;
const originalSendRegisterVerificationCode = appAuthService.sendRegisterVerificationCode;
const originalLogin = appAuthService.login;
const originalLogout = appAuthService.logout;
const originalResolve = appAuthService.resolveUserBySessionToken;
const originalUpdateProfile = appAuthService.updateProfile;
const originalLegacyMappingUpsert = appUserLegacyIdMappingDAO.upsert;
const originalRebindSessionsFromLegacyUserId = taskCreationSessionDAO.rebindSessionsFromLegacyUserId;
const originalLoginFailureWindowSeconds = process.env.APP_AUTH_LOGIN_FAILURE_WINDOW_SECONDS;
const originalLoginBlockSeconds = process.env.APP_AUTH_LOGIN_BLOCK_SECONDS;
const originalLoginEmailMaxFailures = process.env.APP_AUTH_LOGIN_EMAIL_MAX_FAILURES;
const originalLoginIpMaxFailures = process.env.APP_AUTH_LOGIN_IP_MAX_FAILURES;
const originalRedisEnabled = process.env.ONECEO_REDIS_ENABLED;
const originalGoogleClientId = process.env.APP_AUTH_GOOGLE_CLIENT_ID;
const originalGoogleClientSecret = process.env.APP_AUTH_GOOGLE_CLIENT_SECRET;
const originalAppAuthOauthStateSecret = process.env.APP_AUTH_OAUTH_STATE_SECRET;
const originalGithubDevClientId = process.env.APP_AUTH_GITHUB_DEV_CLIENT_ID;
const originalGithubDevClientSecret = process.env.APP_AUTH_GITHUB_DEV_CLIENT_SECRET;
const originalGithubStagingClientId = process.env.APP_AUTH_GITHUB_STAGING_CLIENT_ID;
const originalGithubStagingClientSecret = process.env.APP_AUTH_GITHUB_STAGING_CLIENT_SECRET;
const originalGithubProductClientId = process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_ID;
const originalGithubProductClientSecret = process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_SECRET;
const originalGithubCallbackBaseUrl = process.env.APP_AUTH_GITHUB_CALLBACK_BASE_URL;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

after(() => {
  appAuthService.register = originalRegister;
  appAuthService.sendRegisterVerificationCode = originalSendRegisterVerificationCode;
  appAuthService.login = originalLogin;
  appAuthService.logout = originalLogout;
  appAuthService.resolveUserBySessionToken = originalResolve;
  appAuthService.updateProfile = originalUpdateProfile;
  appUserLegacyIdMappingDAO.upsert = originalLegacyMappingUpsert;
  taskCreationSessionDAO.rebindSessionsFromLegacyUserId = originalRebindSessionsFromLegacyUserId;
});

afterEach(() => {
  appAuthLoginRateLimitService.resetForTests();
  restoreEnv('APP_AUTH_LOGIN_FAILURE_WINDOW_SECONDS', originalLoginFailureWindowSeconds);
  restoreEnv('APP_AUTH_LOGIN_BLOCK_SECONDS', originalLoginBlockSeconds);
  restoreEnv('APP_AUTH_LOGIN_EMAIL_MAX_FAILURES', originalLoginEmailMaxFailures);
  restoreEnv('APP_AUTH_LOGIN_IP_MAX_FAILURES', originalLoginIpMaxFailures);
  restoreEnv('ONECEO_REDIS_ENABLED', originalRedisEnabled);
  restoreEnv('APP_AUTH_GOOGLE_CLIENT_ID', originalGoogleClientId);
  restoreEnv('APP_AUTH_GOOGLE_CLIENT_SECRET', originalGoogleClientSecret);
  restoreEnv('APP_AUTH_OAUTH_STATE_SECRET', originalAppAuthOauthStateSecret);
  restoreEnv('APP_AUTH_GITHUB_DEV_CLIENT_ID', originalGithubDevClientId);
  restoreEnv('APP_AUTH_GITHUB_DEV_CLIENT_SECRET', originalGithubDevClientSecret);
  restoreEnv('APP_AUTH_GITHUB_STAGING_CLIENT_ID', originalGithubStagingClientId);
  restoreEnv('APP_AUTH_GITHUB_STAGING_CLIENT_SECRET', originalGithubStagingClientSecret);
  restoreEnv('APP_AUTH_GITHUB_PRODUCT_CLIENT_ID', originalGithubProductClientId);
  restoreEnv('APP_AUTH_GITHUB_PRODUCT_CLIENT_SECRET', originalGithubProductClientSecret);
  restoreEnv('APP_AUTH_GITHUB_CALLBACK_BASE_URL', originalGithubCallbackBaseUrl);
});

async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(appAuthMiddleware);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth', authOauthRoutes);

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
    personalization: {
      preferredName: '',
      role: '',
      about: '',
      responsePreferences: '',
    },
    status: 'active',
  };
}

function getSetCookieHeader(response: Response) {
  return response.headers.get('set-cookie') || '';
}

function assertAuthNoStoreHeaders(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
  const vary = response.headers.get('vary') || '';
  assert.match(vary, /(?:^|,\s*)Origin(?:,|$)/);
  assert.match(vary, /(?:^|,\s*)Cookie(?:,|$)/);
}

function assertAuthDebugHeaders(
  response: Response,
  expected: {
    hasSessionCookie: '0' | '1';
    hasStateCookie: '0' | '1';
    currentUser: '0' | '1';
    wroteSessionCookie: '0' | '1';
  }
) {
  assert.equal(response.headers.get('x-oneceo-auth-debug-has-session-cookie'), expected.hasSessionCookie);
  assert.equal(response.headers.get('x-oneceo-auth-debug-has-state-cookie'), expected.hasStateCookie);
  assert.equal(response.headers.get('x-oneceo-auth-debug-current-user'), expected.currentUser);
  assert.equal(response.headers.get('x-oneceo-auth-debug-wrote-session-cookie'), expected.wroteSessionCookie);
}

test('POST /api/auth/register returns user and app session cookie', async () => {
  const server = await startServer();
  appAuthService.register = async (input) => {
    assert.equal(input.email, 'new@example.com');
    assert.equal(input.verificationCode, '123456');
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
        verificationCode: '123456',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-register-1');
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_SESSION_COOKIE_NAME}=app-token-register`));
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=authenticated`));
    assertAuthNoStoreHeaders(response);
    assertAuthDebugHeaders(response, {
      hasSessionCookie: '0',
      hasStateCookie: '0',
      currentUser: '1',
      wroteSessionCookie: '1',
    });
  } finally {
    await server.close();
  }
});

test('POST /api/auth/register/send-code returns success without auth cookie', async () => {
  const server = await startServer();
  appAuthService.sendRegisterVerificationCode = async (input) => {
    assert.equal(input.email, 'code@example.com');
    return {
      cooldownSeconds: 60,
      expiresInSeconds: 600,
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/register/send-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'code@example.com',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.cooldownSeconds, 60);
    assert.equal(payload.data.expiresInSeconds, 600);
    assert.equal(response.headers.get('set-cookie'), null);
    assertAuthNoStoreHeaders(response);
    assertAuthDebugHeaders(response, {
      hasSessionCookie: '0',
      hasStateCookie: '0',
      currentUser: '0',
      wroteSessionCookie: '0',
    });
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
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_SESSION_COOKIE_NAME}=app-token-login`));
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=authenticated`));
    assertAuthNoStoreHeaders(response);
    assert.match(getSetCookieHeader(response), /Priority=High/);
    assertAuthDebugHeaders(response, {
      hasSessionCookie: '0',
      hasStateCookie: '0',
      currentUser: '1',
      wroteSessionCookie: '1',
    });
  } finally {
    await server.close();
  }
});

test('GET /api/auth/oauth/google/start returns google auth url', async () => {
  const server = await startServer();
  process.env.APP_AUTH_GOOGLE_CLIENT_ID = 'google-client';
  process.env.APP_AUTH_GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.APP_AUTH_OAUTH_STATE_SECRET = 'oauth-state-secret';
  process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_ID = 'github-client';
  process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_SECRET = 'github-secret';
  process.env.APP_AUTH_GITHUB_CALLBACK_BASE_URL = server.origin;

  try {
    const response = await fetch(`${server.origin}/api/auth/oauth/google/start?redirect=%2Fhome`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.data.authUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_OAUTH_STATE_COOKIE_NAME}=`));
  } finally {
    await server.close();
  }
});

test('GET /api/auth/oauth/google/start rejects unsafe redirect target', async () => {
  const server = await startServer();
  process.env.APP_AUTH_GOOGLE_CLIENT_ID = 'google-client';
  process.env.APP_AUTH_GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.APP_AUTH_OAUTH_STATE_SECRET = 'oauth-state-secret';

  try {
    const response = await fetch(`${server.origin}/api/auth/oauth/google/start?redirect=https%3A%2F%2Fevil.example.com`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.data.authUrl, /state=/);
    assert.doesNotMatch(payload.data.authUrl, /evil\.example\.com/);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login rejects non-JSON requests before reaching auth service', async () => {
  const server = await startServer();
  let loginCalled = false;
  appAuthService.login = async () => {
    loginCalled = true;
    return {
      token: 'should-not-be-issued',
      session: { id: 'sess-non-json' } as any,
      user: createUser('user-non-json'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'login@example.com',
        password: 'password123',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 415);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '请求必须使用 application/json');
    assert.equal(loginCalled, false);
    assert.equal(response.headers.get('set-cookie'), null);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login returns 429 after repeated failed attempts from the same email', async () => {
  process.env.ONECEO_REDIS_ENABLED = 'false';
  process.env.APP_AUTH_LOGIN_EMAIL_MAX_FAILURES = '2';
  process.env.APP_AUTH_LOGIN_IP_MAX_FAILURES = '10';
  process.env.APP_AUTH_LOGIN_FAILURE_WINDOW_SECONDS = '60';
  process.env.APP_AUTH_LOGIN_BLOCK_SECONDS = '120';

  const server = await startServer();
  appAuthService.login = async () => {
    throw new Error('邮箱或密码错误');
  };

  try {
    const firstResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({
        email: 'limit@example.com',
        password: 'wrong-password',
      }),
    });
    const secondResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({
        email: 'limit@example.com',
        password: 'wrong-password',
      }),
    });
    const thirdResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({
        email: 'limit@example.com',
        password: 'wrong-password',
      }),
    });

    const firstPayload = await firstResponse.json();
    const secondPayload = await secondResponse.json();
    const thirdPayload = await thirdResponse.json();

    assert.equal(firstResponse.status, 400);
    assert.equal(firstPayload.error, '邮箱或密码错误');
    assert.equal(secondResponse.status, 429);
    assert.equal(secondPayload.error, '登录尝试过于频繁，请稍后再试');
    assert.equal(secondResponse.headers.get('retry-after'), '120');
    assert.equal(thirdResponse.status, 429);
    assert.equal(thirdPayload.error, '登录尝试过于频繁，请稍后再试');
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login clears accumulated failures after a successful login', async () => {
  process.env.ONECEO_REDIS_ENABLED = 'false';
  process.env.APP_AUTH_LOGIN_EMAIL_MAX_FAILURES = '2';
  process.env.APP_AUTH_LOGIN_IP_MAX_FAILURES = '10';
  process.env.APP_AUTH_LOGIN_FAILURE_WINDOW_SECONDS = '60';
  process.env.APP_AUTH_LOGIN_BLOCK_SECONDS = '120';

  const server = await startServer();
  let callCount = 0;
  appAuthService.login = async () => {
    callCount += 1;
    if (callCount === 2) {
      return {
        token: 'app-token-reset',
        session: { id: 'sess-reset' } as any,
        user: createUser('user-reset'),
      };
    }
    throw new Error('邮箱或密码错误');
  };

  try {
    const firstResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.11',
      },
      body: JSON.stringify({
        email: 'reset@example.com',
        password: 'wrong-password',
      }),
    });
    const secondResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.11',
      },
      body: JSON.stringify({
        email: 'reset@example.com',
        password: 'password123',
      }),
    });
    const thirdResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.11',
      },
      body: JSON.stringify({
        email: 'reset@example.com',
        password: 'wrong-password',
      }),
    });

    assert.equal(firstResponse.status, 400);
    assert.equal(secondResponse.status, 200);
    assert.equal(thirdResponse.status, 400);
    assert.equal(thirdResponse.headers.get('retry-after'), null);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login rate-limits password spraying from a single IP across multiple emails', async () => {
  process.env.ONECEO_REDIS_ENABLED = 'false';
  process.env.APP_AUTH_LOGIN_EMAIL_MAX_FAILURES = '10';
  process.env.APP_AUTH_LOGIN_IP_MAX_FAILURES = '2';
  process.env.APP_AUTH_LOGIN_FAILURE_WINDOW_SECONDS = '60';
  process.env.APP_AUTH_LOGIN_BLOCK_SECONDS = '180';

  const server = await startServer();
  appAuthService.login = async () => {
    throw new Error('邮箱或密码错误');
  };

  try {
    const firstResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.7',
      },
      body: JSON.stringify({
        email: 'spray-1@example.com',
        password: 'shared-wrong-password',
      }),
    });
    const secondResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.7',
      },
      body: JSON.stringify({
        email: 'spray-2@example.com',
        password: 'shared-wrong-password',
      }),
    });
    const thirdResponse = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.7',
      },
      body: JSON.stringify({
        email: 'spray-3@example.com',
        password: 'shared-wrong-password',
      }),
    });

    const firstPayload = await firstResponse.json();
    const secondPayload = await secondResponse.json();
    const thirdPayload = await thirdResponse.json();

    assert.equal(firstResponse.status, 400);
    assert.equal(firstPayload.error, '邮箱或密码错误');
    assert.equal(secondResponse.status, 429);
    assert.equal(secondPayload.error, '登录尝试过于频繁，请稍后再试');
    assert.equal(secondResponse.headers.get('retry-after'), '180');
    assert.equal(thirdResponse.status, 429);
    assert.equal(thirdPayload.error, '登录尝试过于频繁，请稍后再试');
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login does not mark app session cookie as Secure when browser origin is http', async () => {
  const server = await startServer();
  appAuthService.login = async () => ({
    token: 'app-token-http-origin',
    session: { id: 'sess-http-origin' } as any,
    user: createUser('user-http-origin'),
  });

  try {
    const response = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://oneceo.ai:3000',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        email: 'login@example.com',
        password: 'password123',
      }),
    });
    const payload = await response.json();
    const setCookie = response.headers.get('set-cookie') || '';

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(setCookie, new RegExp(`${APP_SESSION_COOKIE_NAME}=app-token-http-origin`));
    assert.match(setCookie, new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=authenticated`));
    assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/login marks app session cookie as Secure when browser origin is https', async () => {
  const server = await startServer();
  appAuthService.login = async () => ({
    token: 'app-token-https-origin',
    session: { id: 'sess-https-origin' } as any,
    user: createUser('user-https-origin'),
  });

  try {
    const response = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://oneceo.ai',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        email: 'login@example.com',
        password: 'password123',
      }),
    });
    const payload = await response.json();
    const setCookie = response.headers.get('set-cookie') || '';

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(setCookie, new RegExp(`${APP_SESSION_COOKIE_NAME}=app-token-https-origin`));
    assert.match(setCookie, new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=authenticated`));
    assert.match(setCookie, /;\s*Secure(?:;|$)/);
  } finally {
    await server.close();
  }
});

test('GET /api/auth/session returns anonymous auth state without cookie', async () => {
  const server = await startServer();
  appAuthService.resolveUserBySessionToken = async () => null;

  try {
    const response = await fetch(`${server.origin}/api/auth/session`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.authenticated, false);
    assertAuthNoStoreHeaders(response);
    assertAuthDebugHeaders(response, {
      hasSessionCookie: '0',
      hasStateCookie: '0',
      currentUser: '0',
      wroteSessionCookie: '0',
    });
  } finally {
    await server.close();
  }
});

test('GET /api/auth/session returns authenticated auth state when cookie is valid', async () => {
  const server = await startServer();
  appAuthService.resolveUserBySessionToken = async (token: string) => {
    assert.equal(token, 'valid-app-token');
    return {
      session: { id: 'sess-session-1' } as any,
      user: createUser('user-session-1'),
    };
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/session`, {
      headers: {
        cookie: `${APP_SESSION_COOKIE_NAME}=valid-app-token`,
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.authenticated, true);
    assert.equal(payload.data.user.id, 'user-session-1');
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=authenticated`));
    assertAuthNoStoreHeaders(response);
    assertAuthDebugHeaders(response, {
      hasSessionCookie: '1',
      hasStateCookie: '0',
      currentUser: '1',
      wroteSessionCookie: '0',
    });
    assert.equal(response.headers.get('x-oneceo-auth-debug-session-cookie-count'), '1');
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
        cookie: `${LEGACY_APP_SESSION_COOKIE_NAME}=valid-app-token`,
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-me-1');
    assert.match(getSetCookieHeader(response), new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=authenticated`));
    assertAuthNoStoreHeaders(response);
    assertAuthDebugHeaders(response, {
      hasSessionCookie: '1',
      hasStateCookie: '0',
      currentUser: '1',
      wroteSessionCookie: '0',
    });
  } finally {
    await server.close();
  }
});

test('GET /api/auth/me prefers the current session cookie over a valid legacy session cookie', async () => {
  const server = await startServer();
  const seenTokens: string[] = [];
  appAuthService.resolveUserBySessionToken = async (token: string) => {
    seenTokens.push(token);
    if (token === 'current-valid-token') {
      return {
        session: { id: 'sess-current' } as any,
        user: createUser('user-current'),
      };
    }
    if (token === 'legacy-valid-token') {
      return {
        session: { id: 'sess-legacy' } as any,
        user: createUser('user-legacy'),
      };
    }
    return null;
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/me`, {
      headers: {
        cookie: `${APP_SESSION_COOKIE_NAME}=current-valid-token; ${LEGACY_APP_SESSION_COOKIE_NAME}=legacy-valid-token`,
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-current');
    assert.deepEqual(seenTokens, ['current-valid-token']);
  } finally {
    await server.close();
  }
});

test(`GET /api/auth/me prefers a later valid session cookie when duplicate ${APP_SESSION_COOKIE_NAME} values are present`, async () => {
  const server = await startServer();
  const seenTokens: string[] = [];
  appAuthService.resolveUserBySessionToken = async (token: string) => {
    seenTokens.push(token);
    if (token === 'fresh-valid-token') {
      return {
        session: { id: 'sess-fresh' } as any,
        user: createUser('user-me-fresh'),
      };
    }
    return null;
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/me`, {
      headers: {
        cookie: `${APP_SESSION_COOKIE_NAME}=stale-invalid-token; ${APP_SESSION_COOKIE_NAME}=fresh-valid-token`,
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.id, 'user-me-fresh');
    assert.deepEqual(seenTokens, ['fresh-valid-token']);
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
        cookie: `${LEGACY_APP_SESSION_COOKIE_NAME}=logout-token`,
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(revokedToken, 'logout-token');
    const setCookie = getSetCookieHeader(response);
    assert.match(setCookie, new RegExp(`${APP_SESSION_COOKIE_NAME}=;`));
    assert.match(setCookie, new RegExp(`${LEGACY_APP_SESSION_COOKIE_NAME}=;`));
    assert.match(setCookie, new RegExp(`${APP_SESSION_STATE_COOKIE_NAME}=;`));
    assert.match(setCookie, new RegExp(`${LEGACY_APP_SESSION_STATE_COOKIE_NAME}=;`));
    assert.match(setCookie, /Max-Age=0/);
  } finally {
    await server.close();
  }
});

test('POST /api/auth/legacy-client-id requires authenticated app user', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.origin}/api/auth/legacy-client-id`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        legacyUserId: 'local-egf5ug84',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '当前未登录');
  } finally {
    await server.close();
  }
});

test('POST /api/auth/legacy-client-id upserts mapping and rebinds legacy sessions', async () => {
  const server = await startServer();
  const calls: Array<{ appUserId: string; legacyUserId: string; source?: string }> = [];
  appAuthService.resolveUserBySessionToken = async (token: string) => {
    assert.equal(token, 'valid-app-token');
    return {
      session: { id: 'sess-legacy-link' } as any,
      user: createUser('11111111-1111-1111-1111-111111111111'),
    };
  };
  appUserLegacyIdMappingDAO.upsert = async (input) => {
    calls.push(input);
    return {
      id: 'mapping-1',
      appUserId: input.appUserId as any,
      legacyUserId: input.legacyUserId,
      source: input.source || 'auth_bootstrap',
    } as any;
  };
  taskCreationSessionDAO.rebindSessionsFromLegacyUserId = async (userId, legacyUserId) => {
    assert.equal(userId, '11111111-1111-1111-1111-111111111111');
    assert.equal(legacyUserId, 'local-egf5ug84');
    return [{ id: 'session-1' }, { id: 'session-2' }] as any;
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/legacy-client-id`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${APP_SESSION_COOKIE_NAME}=valid-app-token`,
      },
      body: JSON.stringify({
        legacyUserId: 'local-egf5ug84',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.linked, true);
    assert.equal(payload.data.reboundCount, 2);
    assert.deepEqual(calls, [
      {
        appUserId: '11111111-1111-1111-1111-111111111111',
        legacyUserId: 'local-egf5ug84',
        source: 'auth_bootstrap',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('PATCH /api/auth/profile updates current user profile', async () => {
  const server = await startServer();
  appAuthService.resolveUserBySessionToken = async () => ({
    session: { id: 'sess-4' } as any,
    user: createUser('user-profile-1'),
  });
  appAuthService.updateProfile = async (userId, input) => {
    assert.equal(userId, 'user-profile-1');
    assert.equal(input.displayName, 'Watson');
    assert.deepEqual(input.personalization, {
      preferredName: 'Watson',
      role: 'Founder',
      about: 'Builds AI products.',
      responsePreferences: 'Keep answers concise.',
    });
    return {
      ...createUser('user-profile-1'),
      displayName: 'Watson',
      personalization: input.personalization as any,
    } as any;
  };

  try {
    const response = await fetch(`${server.origin}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `${APP_SESSION_COOKIE_NAME}=valid-app-token`,
      },
      body: JSON.stringify({
        displayName: 'Watson',
        personalization: {
          preferredName: 'Watson',
          role: 'Founder',
          about: 'Builds AI products.',
          responsePreferences: 'Keep answers concise.',
        },
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.displayName, 'Watson');
    assert.equal(payload.data.user.personalization.role, 'Founder');
  } finally {
    await server.close();
  }
});
