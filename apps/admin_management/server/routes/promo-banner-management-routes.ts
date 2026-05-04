import express from 'express';
import { config } from '../config';

export function createPromoBannerManagementRoutes() {
  const router = express.Router();

  const proxyToApi = async (req: express.Request, res: express.Response) => {
    try {
      const path = req.originalUrl.replace('/api/internal/promo-banners', '/api/internal/promo-banners');
      const url = `${config.oneceoApiUrl}${path}`;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-oneceo-internal-token': config.oneceoInternalToken,
      };
      if (req.headers.cookie) {
        headers.cookie = req.headers.cookie;
      }
      const response = await fetch(url, {
        method: req.method,
        headers,
        body:
          ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body
            ? JSON.stringify(req.body)
            : undefined,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return res.status(response.status).json(data || { error: '请求失败' });
      }
      return res.json(data);
    } catch (error) {
      console.error('[PromoBanner Proxy] 转发失败:', error);
      return res.status(502).json({ error: '无法连接宣传条幅服务' });
    }
  };

  router.get('/', proxyToApi);
  router.post('/upload-media', proxyToApi);
  router.get('/:id', proxyToApi);
  router.post('/', proxyToApi);
  router.put('/:id', proxyToApi);
  router.post('/:id/publish', proxyToApi);
  router.post('/:id/offline', proxyToApi);
  router.delete('/:id', proxyToApi);

  return router;
}
