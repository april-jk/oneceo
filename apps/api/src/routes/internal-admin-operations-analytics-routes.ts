import express from 'express';
import { z } from 'zod';
import { platformOperationsAnalyticsService } from '../services/platform-operations-analytics-service';
import { createRequireInternalToken } from './internal-auth-middleware';
import { getPublicErrorMessage } from '../utils/error-response';

const router = express.Router();

const overviewQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '90d']).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
});

router.use(createRequireInternalToken({
  disabledMessage: '运营分析内部接口未启用',
}));

router.get('/overview', async (req, res) => {
  try {
    const query = overviewQuerySchema.parse(req.query);
    const overview = await platformOperationsAnalyticsService.getOverview(query);
    res.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    console.warn('[internal-admin-operations-analytics] overview failed', error);
    res.status(500).json({
      success: false,
      error: getPublicErrorMessage('运营分析数据读取失败'),
    });
  }
});

export default router;
