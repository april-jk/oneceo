import { Router } from 'express';
import type { AdminThemeService } from '../services/admin-theme-service';
import { asyncHandler, ok } from '../utils/http';

export function createAdminThemeRoutes(service: AdminThemeService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      return ok(res, service.getSettings());
    })
  );

  router.put(
    '/',
    asyncHandler(async (req, res) => {
      const result = await service.updateTheme(String(req.body?.themeKey || ''));
      return ok(res, result);
    })
  );

  return router;
}
