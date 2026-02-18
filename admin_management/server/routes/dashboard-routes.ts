import { Router } from 'express';
import { asyncHandler, ok } from '../utils/http';
import type { DashboardService } from '../services/dashboard-service';

export function createDashboardRoutes(dashboardService: DashboardService) {
  const router = Router();

  router.get(
    '/overview',
    asyncHandler(async (_req, res) => {
      const overview = await dashboardService.getOverview();
      return ok(res, overview);
    })
  );

  return router;
}