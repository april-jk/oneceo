import crypto from 'node:crypto';
import express from 'express';
import { appAuthOauthService } from '../services/app-auth-oauth-service';
import { runtimeEnvConfig } from '../config/runtime-env';
import { getPublicErrorMessage } from '../utils/error-response';
import {
  APP_OAUTH_STATE_COOKIE_NAME,
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_STATE_COOKIE_NAME,
} from '../utils/auth-session';
import {
  buildAppOauthStateCookieOptions,
  buildAppSessionCookieOptions,
  buildAppSessionStateCookieOptions,
} from '../utils/app-auth-cookie-policy';
import { clearCookie, setCookie } from '../utils/http-cookie';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveRedirectTarget(input: unknown) {
  const redirect = asText(input) || '/home';
  return redirect === '/' ? '/home' : redirect;
}

function isSafeRedirectTarget(target: string) {
  return target.startsWith('/') && !target.startsWith('//');
}

function sanitizeRedirectTarget(input: unknown) {
  const target = resolveRedirectTarget(input);
  return isSafeRedirectTarget(target) ? target : '/home';
}

function normalizeProvider(value: string) {
  return asText(value).toLowerCase();
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function asBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return false;
}

function resolveOauthStateSecret() {
  return (
    asText(process.env.APP_AUTH_OAUTH_STATE_SECRET) ||
    asText(process.env.APP_AUTH_GOOGLE_CLIENT_SECRET) ||
    asText(process.env.APP_AUTH_GITHUB_DEV_CLIENT_SECRET) ||
    asText(process.env.APP_AUTH_GITHUB_STAGING_CLIENT_SECRET) ||
    asText(process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_SECRET) ||
    asText(process.env.APP_AUTH_GITHUB_CLIENT_SECRET)
  );
}

function signOauthStatePayload(payload: string) {
  const secret = resolveOauthStateSecret();
  if (!secret) {
    throw new Error('OAuth state 签名密钥缺失');
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function resolveOauthCallbackBaseUrl() {
  // Prefer frontend origin because production usually exposes frontend only.
  return (
    asText(process.env.APP_AUTH_OAUTH_CALLBACK_BASE_URL) ||
    asText(process.env.FRONTEND_URL) ||
    asText(process.env.APP_AUTH_GOOGLE_CALLBACK_BASE_URL) ||
    asText(process.env.APP_AUTH_GITHUB_CALLBACK_BASE_URL) ||
    asText(process.env.COMPOSIO_OAUTH_CALLBACK_BASE_URL) ||
    asText(process.env.VITE_API_BASE_URL)
  );
}

function createOauthStatePayload(redirectTarget: string) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const payloadJson = JSON.stringify({
    nonce,
    redirectTarget,
    issuedAt: Date.now(),
  });
  const encodedPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = signOauthStatePayload(payloadJson);
  return `${encodedPayload}.${signature}`;
}

function parseOauthStatePayload(input: string): {
  nonce: string;
  redirectTarget: string;
  issuedAt: number;
} {
  const raw = asText(input);
  const separatorIndex = raw.indexOf('.');
  if (!raw || separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new Error('OAuth state 非法');
  }
  const encodedPayload = raw.slice(0, separatorIndex);
  const providedSignature = raw.slice(separatorIndex + 1);
  const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  const expectedSignature = signOauthStatePayload(payload);
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw new Error('OAuth state 校验失败');
  }
  const parsed = JSON.parse(payload) as {
    nonce?: string;
    redirectTarget?: string;
    issuedAt?: number;
  };
  if (!parsed?.nonce || !parsed?.redirectTarget || typeof parsed.issuedAt !== 'number') {
    throw new Error('OAuth state 内容缺失');
  }
  if (!isSafeRedirectTarget(parsed.redirectTarget)) {
    throw new Error('OAuth redirect 非法');
  }
  if (Date.now() - parsed.issuedAt > 1000 * 60 * 10) {
    throw new Error('OAuth state 已过期');
  }
  return {
    nonce: parsed.nonce,
    redirectTarget: parsed.redirectTarget,
    issuedAt: parsed.issuedAt,
  };
}

function clearOauthStateCookie(req: express.Request, res: express.Response) {
  clearCookie(res, APP_OAUTH_STATE_COOKIE_NAME, buildAppOauthStateCookieOptions(req));
}

function issueOauthState(req: express.Request, res: express.Response, redirectTarget: string) {
  const state = createOauthStatePayload(redirectTarget);
  // Keep cookie for same-origin API deployments; callback verification does not depend on it.
  setCookie(res, APP_OAUTH_STATE_COOKIE_NAME, state, buildAppOauthStateCookieOptions(req));
  return state;
}

function consumeOauthState(req: express.Request) {
  const stateFromQuery = asText(req.query.state);
  if (!stateFromQuery) {
    throw new Error('OAuth state 缺失');
  }
  return parseOauthStatePayload(stateFromQuery);
}

function buildGoogleAuthUrl(redirectTarget: string) {
  const clientId = asText(process.env.APP_AUTH_GOOGLE_CLIENT_ID);
  const callbackBase = resolveOauthCallbackBaseUrl();
  if (!clientId) {
    throw new Error('未配置 Google 登录客户端');
  }
  if (!callbackBase) {
    throw new Error('未配置 Google 登录回调基址');
  }
  const callbackUrl = new URL('/api/auth/oauth/google/callback', callbackBase);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl.toString());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', redirectTarget);
  return url.toString();
}

function resolveGithubConfig() {
  const runtimeEnv = runtimeEnvConfig.runtimeEnv;
  const callbackBaseUrl = resolveOauthCallbackBaseUrl();
  if (runtimeEnv === 'dev') {
    return {
      clientId: asText(process.env.APP_AUTH_GITHUB_DEV_CLIENT_ID) || asText(process.env.APP_AUTH_GITHUB_CLIENT_ID),
      clientSecret: asText(process.env.APP_AUTH_GITHUB_DEV_CLIENT_SECRET) || asText(process.env.APP_AUTH_GITHUB_CLIENT_SECRET),
      callbackBaseUrl,
    };
  }
  if (runtimeEnv === 'staging') {
    return {
      clientId: asText(process.env.APP_AUTH_GITHUB_STAGING_CLIENT_ID) || asText(process.env.APP_AUTH_GITHUB_CLIENT_ID),
      clientSecret: asText(process.env.APP_AUTH_GITHUB_STAGING_CLIENT_SECRET) || asText(process.env.APP_AUTH_GITHUB_CLIENT_SECRET),
      callbackBaseUrl,
    };
  }
  return {
    clientId: asText(process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_ID) || asText(process.env.APP_AUTH_GITHUB_CLIENT_ID),
    clientSecret: asText(process.env.APP_AUTH_GITHUB_PRODUCT_CLIENT_SECRET) || asText(process.env.APP_AUTH_GITHUB_CLIENT_SECRET),
    callbackBaseUrl,
  };
}

function buildGithubAuthUrl(redirectTarget: string) {
  const { clientId, callbackBaseUrl } = resolveGithubConfig();
  if (!clientId) {
    throw new Error('未配置 GitHub 登录客户端');
  }
  if (!callbackBaseUrl) {
    throw new Error('未配置 GitHub 登录回调基址');
  }
  const callbackUrl = new URL('/api/auth/oauth/github/callback', callbackBaseUrl);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl.toString());
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', redirectTarget);
  return url.toString();
}

router.get('/oauth/:provider/start', async (req, res) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    const redirectTarget = sanitizeRedirectTarget(req.query.redirect);
    const state = issueOauthState(req, res, redirectTarget);
    const authUrl =
      provider === 'google'
        ? buildGoogleAuthUrl(state)
        : provider === 'github'
          ? buildGithubAuthUrl(state)
          : null;
    if (!authUrl) {
      clearOauthStateCookie(req, res);
      return res.status(404).json({ success: false, error: '不支持的登录方式' });
    }
    return res.json({ success: true, data: { authUrl } });
  } catch (error: any) {
    clearOauthStateCookie(req, res);
    return res.status(400).json({ success: false, error: getPublicErrorMessage(error?.message || '启动 OAuth 失败') });
  }
});

router.get('/oauth/google/callback', async (req, res) => {
  try {
    const code = asText(req.query.code);
    const oauthState = consumeOauthState(req);
    if (!code) {
      throw new Error('Google OAuth 缺少 code');
    }
    const clientId = asText(process.env.APP_AUTH_GOOGLE_CLIENT_ID);
    const clientSecret = asText(process.env.APP_AUTH_GOOGLE_CLIENT_SECRET);
    const callbackBase = resolveOauthCallbackBaseUrl();
    if (!clientId || !clientSecret || !callbackBase) {
      throw new Error('Google OAuth 配置缺失');
    }
    const callbackUrl = new URL('/api/auth/oauth/google/callback', callbackBase);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl.toString(),
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = asRecord(await tokenResponse.json().catch(() => ({})));
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(asText(tokenData.error_description) || asText(tokenData.error) || 'Google token exchange failed');
    }
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = asRecord(await profileResponse.json().catch(() => ({})));
    if (!profileResponse.ok) {
      throw new Error(asText(profile.error_description) || asText(profile.error) || 'Google userinfo failed');
    }
    const result = await appAuthOauthService.resolveOrCreateUser({
      provider: 'google',
      providerSubject: asText(profile.sub),
      email: asBoolean(profile.email_verified) ? asText(profile.email) : '',
      displayName: asText(profile.name) || asText(profile.given_name) || asText(profile.email),
      avatarUrl: asText(profile.picture),
    }, req);
    clearOauthStateCookie(req, res);
    setCookie(res, APP_SESSION_COOKIE_NAME, result.token, buildAppSessionCookieOptions(req));
    setCookie(res, APP_SESSION_STATE_COOKIE_NAME, 'authenticated', buildAppSessionStateCookieOptions(req));
    return res.redirect(302, oauthState.redirectTarget);
  } catch (error: any) {
    clearOauthStateCookie(req, res);
    return res.redirect(302, `/login?oauth_error=${encodeURIComponent(getPublicErrorMessage(error?.message || 'Google 登录失败'))}`);
  }
});

router.get('/oauth/github/callback', async (req, res) => {
  try {
    const code = asText(req.query.code);
    const oauthState = consumeOauthState(req);
    if (!code) {
      throw new Error('GitHub OAuth 缺少 code');
    }
    const { clientId, clientSecret, callbackBaseUrl } = resolveGithubConfig();
    if (!clientId || !clientSecret || !callbackBaseUrl) {
      throw new Error('GitHub OAuth 配置缺失');
    }
    const callbackUrl = new URL('/api/auth/oauth/github/callback', callbackBaseUrl);
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl.toString(),
      }),
    });
    const tokenData = asRecord(await tokenResponse.json().catch(() => ({})));
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(asText(tokenData.error_description) || asText(tokenData.error) || 'GitHub token exchange failed');
    }
    const profileResponse = await fetch('https://api.github.com/user', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${tokenData.access_token}`,
        'user-agent': 'oneceo-platform-auth',
      },
    });
    const profile = asRecord(await profileResponse.json().catch(() => ({})));
    if (!profileResponse.ok) {
      throw new Error(asText(profile.message) || 'GitHub userinfo failed');
    }
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${tokenData.access_token}`,
        'user-agent': 'oneceo-platform-auth',
      },
    });
    const emails = await emailsResponse.json().catch(() => []);
    const primaryEmail = Array.isArray(emails)
      ? emails.find((item) => item && item.primary && item.verified && item.email)?.email ||
        emails.find((item) => item && item.verified && item.email)?.email ||
        ''
      : '';
    const result = await appAuthOauthService.resolveOrCreateUser({
      provider: 'github',
      providerSubject: String(profile.id || ''),
      email: asText(primaryEmail),
      displayName: asText(profile.name) || asText(profile.login),
      avatarUrl: asText(profile.avatar_url),
    }, req);
    clearOauthStateCookie(req, res);
    setCookie(res, APP_SESSION_COOKIE_NAME, result.token, buildAppSessionCookieOptions(req));
    setCookie(res, APP_SESSION_STATE_COOKIE_NAME, 'authenticated', buildAppSessionStateCookieOptions(req));
    return res.redirect(302, oauthState.redirectTarget);
  } catch (error: any) {
    clearOauthStateCookie(req, res);
    return res.redirect(302, `/login?oauth_error=${encodeURIComponent(getPublicErrorMessage(error?.message || 'GitHub 登录失败'))}`);
  }
});

export default router;
