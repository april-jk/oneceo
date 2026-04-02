import express from 'express';
import { appAuthService } from '../services/app-auth-service';
import { getPublicErrorMessage } from '../utils/error-response';
import { APP_SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../utils/auth-session';
import { clearCookie, setCookie } from '../utils/http-cookie';

const router = express.Router();

function isSecureCookie(req: express.Request) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
}

router.post('/register', async (req, res) => {
  try {
    const result = await appAuthService.register(
      {
        email: req.body?.email,
        password: req.body?.password,
        displayName: req.body?.displayName,
      },
      req
    );
    setCookie(res, APP_SESSION_COOKIE_NAME, result.token, {
      maxAgeMs: SESSION_TTL_MS,
      secure: isSecureCookie(req),
    });
    return res.json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '注册失败'),
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const result = await appAuthService.login(
      {
        email: req.body?.email,
        password: req.body?.password,
      },
      req
    );
    setCookie(res, APP_SESSION_COOKIE_NAME, result.token, {
      maxAgeMs: SESSION_TTL_MS,
      secure: isSecureCookie(req),
    });
    return res.json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '登录失败'),
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const sessionToken = (req.headers.cookie || '')
      .split(/;\s*/g)
      .find((item) => item.startsWith(`${APP_SESSION_COOKIE_NAME}=`))
      ?.slice(APP_SESSION_COOKIE_NAME.length + 1);
    if (sessionToken) {
      await appAuthService.logout(decodeURIComponent(sessionToken));
    }
    clearCookie(res, APP_SESSION_COOKIE_NAME, {
      secure: isSecureCookie(req),
    });
    return res.json({
      success: true,
      data: {
        ok: true,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '退出登录失败'),
    });
  }
});

router.get('/me', async (req, res) => {
  const current = (req as any).currentAppUser;
  if (!current?.id) {
    return res.status(401).json({
      success: false,
      error: '当前未登录',
    });
  }
  return res.json({
    success: true,
    data: {
      user: current,
    },
  });
});

export default router;
