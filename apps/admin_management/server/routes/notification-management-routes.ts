import express from 'express';
import { config } from '../config';

/**
 * 通知管理路由
 * 将请求代理转发到 oneceo API server
 */
export function createNotificationManagementRoutes() {
  const router = express.Router();

  // 通用代理函数
  const proxyToApi = async (req: express.Request, res: express.Response) => {
    try {
      const path = req.originalUrl.replace('/api/internal/notifications', '/api/internal/notifications');
      const url = `${config.oneceoApiUrl}${path}`;
      
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-oneceo-internal-token': config.oneceoInternalToken,
      };

      // 转发管理员会话 Cookie
      const cookie = req.headers.cookie;
      if (cookie) {
        headers['cookie'] = cookie;
      }

      const response = await fetch(url, {
        method: req.method,
        headers,
        body: ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body 
          ? JSON.stringify(req.body) 
          : undefined,
      });

      const data = await response.json().catch(() => null);
      
      if (!response.ok) {
        return res.status(response.status).json(data || { error: '请求失败' });
      }

      return res.json(data);
    } catch (error) {
      console.error('[Notification Proxy] 转发请求失败:', error);
      return res.status(502).json({ error: '无法连接通知服务' });
    }
  };

  // 获取通知列表
  router.get('/', proxyToApi);

  // 获取通知统计
  router.get('/:id/stats', proxyToApi);

  // 创建通知
  router.post('/', proxyToApi);

  // 更新通知
  router.put('/:id', proxyToApi);

  // 删除通知
  router.delete('/:id', proxyToApi);

  // 发布通知
  router.post('/:id/publish', proxyToApi);

  // 归档通知
  router.post('/:id/archive', proxyToApi);

  return router;
}