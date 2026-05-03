import { Router } from 'express';
import { z } from 'zod';
import type { OperationsAnalyticsService } from '../services/operations-analytics-service';
import { asyncHandler, ok } from '../utils/http';

const overviewQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '90d']).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
});

export function createOperationsAnalyticsRoutes(service: OperationsAnalyticsService) {
  const router = Router();

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      const query = overviewQuerySchema.parse(req.query);
      const overview = await service.getOverview(query);
      return ok(res, overview);
    })
  );

  return router;
}
