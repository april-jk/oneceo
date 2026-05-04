import express from 'express';
import { config } from '../config';

/**
 * 计费管理路由
 * 将请求代理转发到 oneceo API server
 */
export function createBillingManagementRoutes() {
  const router = express.Router();

  // 通用代理函数
  const proxyToApi = async (req: express.Request, res: express.Response) => {
    try {
      const path = req.originalUrl.replace('/api/internal/billing', '/api/internal/billing');
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
      console.error('[Billing Proxy] 转发请求失败:', error);
      return res.status(502).json({ error: '无法连接计费服务' });
    }
  };

  // 用户积分列表
  router.get('/users', proxyToApi);

  // 计费规则元信息
  router.get('/meta', proxyToApi);

  // 用户交易记录
  router.get('/users/:userId/billing-detail', proxyToApi);
  router.get('/users/:userId/transactions', proxyToApi);

  // 用户会话用量
  router.get('/users/:userId/session-usage', proxyToApi);

  // 调整用户积分
  router.post('/users/:userId/adjust', proxyToApi);

  // 定价配置列表
  router.get('/runtime-config', proxyToApi);
  router.post('/runtime-config/test', proxyToApi);
  router.post('/runtime-config/models', proxyToApi);
  router.put('/runtime-config/agent/:tier', proxyToApi);
  router.put('/runtime-config/sandbox/:engine', proxyToApi);
  router.get('/pricing/model-candidates', proxyToApi);
  router.get('/pricing', proxyToApi);

  // 创建定价
  router.post('/pricing', proxyToApi);

  // 删除定价
  router.delete('/pricing/:pricingId', proxyToApi);

  // 平台统计
  router.get('/stats', proxyToApi);

  // 使用明细
  router.get('/usage-logs', proxyToApi);

  // 缓存比例配置
  router.get('/cache-config', proxyToApi);
  router.post('/cache-config', proxyToApi);

  // 计费调试工具
  router.post('/debug/llm-request', proxyToApi);

  // 激活码管理
  router.get('/activation-codes', proxyToApi);
  router.get('/activation-codes/stats', proxyToApi);
  router.get('/activation-codes/export', proxyToApi);
  router.get('/activation-codes/:id', proxyToApi);
  router.post('/activation-codes', proxyToApi);
  router.post('/activation-codes/bulk-status', proxyToApi);
  router.post('/activation-codes/bulk-delete', proxyToApi);
  router.put('/activation-codes/:id', proxyToApi);
  router.delete('/activation-codes/:id', proxyToApi);

  // 激活码分组管理
  router.get('/activation-code-groups', proxyToApi);
  router.post('/activation-code-groups', proxyToApi);
  router.put('/activation-code-groups/:id', proxyToApi);
  router.delete('/activation-code-groups/:id', proxyToApi);

  return router;
}
