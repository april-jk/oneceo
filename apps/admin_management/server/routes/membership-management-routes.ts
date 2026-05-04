import express from 'express';
import { config } from '../config';

export function createMembershipManagementRoutes() {
  const router = express.Router();

  const proxyToApi = async (req: express.Request, res: express.Response) => {
    try {
      const path = req.originalUrl.replace('/api/internal/membership', '/api/internal/membership');
      const url = `${config.oneceoApiUrl}${path}`;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-oneceo-internal-token': config.oneceoInternalToken,
      };
      const cookie = req.headers.cookie;
      if (cookie) headers.cookie = cookie;

      const response = await fetch(url, {
        method: req.method,
        headers,
        body: ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body ? JSON.stringify(req.body) : undefined,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return res.status(response.status).json(data || { error: '请求失败' });
      }
      return res.json(data);
    } catch (error) {
      console.error('[Membership Proxy] 转发请求失败:', error);
      return res.status(502).json({ success: false, error: { message: '无法连接会员服务' } });
    }
  };

  router.get('/plans', proxyToApi);
  router.post('/plans', proxyToApi);
  router.get('/plans/:planId', proxyToApi);
  router.put('/plans/:planId', proxyToApi);
  router.patch('/plans/:planId/status', proxyToApi);

  router.get('/users', proxyToApi);
  router.get('/users/:userId', proxyToApi);
  router.put('/users/:userId/assign', proxyToApi);
  router.patch('/user-memberships/:membershipId/status', proxyToApi);
  router.patch('/user-memberships/:membershipId/expire', proxyToApi);

  router.post('/daily-restore/run', proxyToApi);
  router.get('/daily-restore/history', proxyToApi);

  return router;
}

